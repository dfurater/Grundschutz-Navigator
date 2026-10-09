import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileDrawerSwipe } from './useMobileDrawerSwipe';
import type { MobileDrawerSwipe } from './useMobileDrawerSwipe';

const WIDTH = 300;

let shell: HTMLDivElement;
let drawer: HTMLElement;
let backdrop: HTMLDivElement;
let main: HTMLElement;
/** Sichtbare linke Kante der Schublade: 0 offen, `-WIDTH` geschlossen. */
let drawerLeft = 0;
let clock = 0;

function touch(type: string, target: Element, x: number, y = 0, advance = 16) {
  clock += advance;
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y };
  const active = type === 'touchend' || type === 'touchcancel' ? [] : [point];
  Object.defineProperties(event, {
    touches: { value: active },
    timeStamp: { value: clock },
  });
  act(() => { target.dispatchEvent(event); });
  return event;
}

/** Zieht ohne Wurf: Vor dem Loslassen stand der Finger still. */
function slowDrag(target: Element, from: number, to: number) {
  touch('touchstart', target, from);
  touch('touchmove', target, from + Math.sign(to - from) * 12);
  touch('touchmove', target, to);
  touch('touchend', target, to, 0, 300);
}

function render(open: boolean, enabled = true) {
  drawerLeft = open ? 0 : -WIDTH;
  const callbacks = { onPreview: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() };
  // Stabil wie `useRef` in der Shell; neue Objekte begännen den Effekt neu.
  const refs = {
    shellRef: { current: shell },
    drawerRef: { current: drawer },
    backdropRef: { current: backdrop },
  };
  const view = renderHook<MobileDrawerSwipe, { open: boolean; enabled: boolean; routeKey?: string }>(
    ({ routeKey = 'start', ...props }) => useMobileDrawerSwipe({ ...props, routeKey, ...refs, ...callbacks }),
    { initialProps: { open, enabled } },
  );
  return { ...view, ...callbacks };
}

const variable = (name: string) => shell.style.getPropertyValue(name);

function dispatchTranslate(type: 'transitionend' | 'transitioncancel') {
  const event = new Event(type);
  Object.defineProperty(event, 'propertyName', { value: 'translate' });
  act(() => { drawer.dispatchEvent(event); });
}

beforeEach(() => {
  clock = 0;
  shell = document.createElement('div');
  drawer = document.createElement('aside');
  backdrop = document.createElement('div');
  main = document.createElement('main');
  drawer.getBoundingClientRect = () => ({ width: WIDTH, left: drawerLeft }) as DOMRect;
  shell.append(drawer, backdrop, main);
  document.body.append(shell);
});

afterEach(() => {
  shell.remove();
});

describe('useMobileDrawerSwipe – offene Schublade', () => {
  it('folgt dem Finger nach links und blendet die Abdunklung anteilig', () => {
    render(true);
    touch('touchstart', drawer, 250);
    const move = touch('touchmove', drawer, 175);
    expect(move.defaultPrevented).toBe(true);
    expect(variable('--mobile-nav-drag')).toBe('-75px');
    expect(variable('--mobile-nav-progress')).toBe('0.75');
    expect(variable('--mobile-nav-motion')).toBe('0s');
    // Nach rechts zieht der Finger nicht über die offene Endlage hinaus.
    touch('touchmove', drawer, 400);
    expect(variable('--mobile-nav-drag')).toBe('0px');
  });

  it('schließt über die halbe Breite gezogen und gleitet sonst zurück', () => {
    const { onClose } = render(true);
    slowDrag(drawer, 280, 200);
    expect(onClose).not.toHaveBeenCalled();
    expect(variable('--mobile-nav-drag')).toBe('');
    expect(variable('--mobile-nav-motion')).toBe('90ms cubic-bezier(0.333, 0, 0.667, 1)');

    slowDrag(backdrop, 290, 100);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(variable('--mobile-nav-progress')).toBe('');
  });

  it('schließt bei einem Wurf nach links auch über eine kurze Strecke, mit dem Tempo des Fingers', () => {
    const { onClose } = render(true);
    touch('touchstart', drawer, 280);
    touch('touchmove', drawer, 268, 0, 10);
    touch('touchmove', drawer, 250, 0, 10);
    touch('touchend', drawer, 250, 0, 5);
    expect(onClose).toHaveBeenCalledTimes(1);
    // 1,5 px/ms über die restlichen 270 px: 198 ms (anteilig an 220 ms) mit der Anfangssteigung 1,1.
    expect(variable('--mobile-nav-motion')).toBe('198ms cubic-bezier(0.333, 0.367, 0.667, 0.733)');
  });

  it('überlässt senkrechte Gesten dem Scrollen', () => {
    const { onClose } = render(true);
    touch('touchstart', drawer, 200, 100);
    expect(touch('touchmove', drawer, 195, 160).defaultPrevented).toBe(false);
    expect(touch('touchmove', drawer, 50, 170).defaultPrevented).toBe(false);
    touch('touchend', drawer, 50, 170);
    expect(onClose).not.toHaveBeenCalled();
    expect(variable('--mobile-nav-drag')).toBe('');
  });

  it('setzt die Lage bei abgebrochener Geste und beim Abbau mitten im Ziehen zurück', () => {
    const view = render(true);
    touch('touchstart', drawer, 250);
    touch('touchmove', drawer, 150);
    touch('touchcancel', drawer, 150);
    expect(variable('--mobile-nav-drag')).toBe('');
    expect(variable('--mobile-nav-motion')).toBe('');

    // Ein Abbruch der Shell (Escape, Suchkürzel) wirkt wie `touchcancel`.
    touch('touchstart', drawer, 250);
    touch('touchmove', drawer, 150);
    act(() => { view.result.current.cancel(); });
    expect(variable('--mobile-nav-drag')).toBe('');
    expect(variable('--mobile-nav-motion')).toBe('');
    touch('touchend', drawer, 50, 0, 300);
    expect(view.onClose).not.toHaveBeenCalled();

    touch('touchstart', drawer, 250);
    touch('touchmove', drawer, 150);
    view.rerender({ open: false, enabled: true });
    expect(variable('--mobile-nav-drag')).toBe('');
    expect(variable('--mobile-nav-motion')).toBe('');
  });

  it('gibt Tempo und Kurve der Freigabe mit dem Ende der Bewegung und beim nächsten Öffnen zurück', () => {
    const view = render(true);
    slowDrag(drawer, 280, 200);
    const transitionEnd = new Event('transitionend');
    Object.defineProperty(transitionEnd, 'propertyName', { value: 'translate' });
    act(() => { drawer.dispatchEvent(transitionEnd); });
    expect(variable('--mobile-nav-motion')).toBe('');

    slowDrag(drawer, 280, 50);
    view.rerender({ open: false, enabled: true });
    expect(variable('--mobile-nav-motion')).not.toBe('');
    view.rerender({ open: true, enabled: true });
    expect(variable('--mobile-nav-motion')).toBe('');
  });
});

describe('useMobileDrawerSwipe – unterbrochene Bewegungen', () => {
  it('übernimmt eine noch gleitende Schublade an ihrer sichtbaren Lage beim Übernehmen der Geste', () => {
    render(true);
    drawerLeft = -150;
    touch('touchstart', drawer, 200);
    // Bis die Richtung feststeht, gleitet die Schublade weiter.
    drawerLeft = -120;
    touch('touchmove', drawer, 180);
    expect(variable('--mobile-nav-drag')).toBe('-140px');
    touch('touchmove', drawer, 170);
    expect(variable('--mobile-nav-drag')).toBe('-150px');
  });

  it('behält die Fingerführung, wenn die unterbrochene Bewegung danach abgebrochen meldet', () => {
    render(true);
    touch('touchstart', drawer, 250);
    touch('touchmove', drawer, 200);
    dispatchTranslate('transitioncancel');
    expect(variable('--mobile-nav-motion')).toBe('0s');
  });

  it('behält das Tempo eines kurzen Wurfs, wenn der Abbruch der unterbrochenen Bewegung erst danach ankommt', () => {
    const { onClose } = render(true);
    touch('touchstart', drawer, 280);
    touch('touchmove', drawer, 268, 0, 10);
    touch('touchmove', drawer, 250, 0, 10);
    touch('touchend', drawer, 250, 0, 5);
    expect(onClose).toHaveBeenCalledTimes(1);
    dispatchTranslate('transitioncancel');
    expect(variable('--mobile-nav-motion')).toBe('198ms cubic-bezier(0.333, 0.367, 0.667, 0.733)');
    dispatchTranslate('transitionend');
    expect(variable('--mobile-nav-motion')).toBe('');
  });

  it('beendet eine Öffnen-Geste auch, wenn die Vorschau ihr Touch-Ziel aushängt', () => {
    const { result, onOpen } = render(false);
    const trigger = document.createElement('button');
    main.append(trigger);
    touch('touchstart', trigger, 20);
    touch('touchmove', trigger, 40);
    expect(result.current.previewing).toBe(true);
    trigger.remove();
    touch('touchmove', trigger, 250);
    expect(variable('--mobile-nav-drag')).toBe('-70px');
    touch('touchend', trigger, 250, 0, 300);
    expect(result.current.previewing).toBe(false);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('useMobileDrawerSwipe – geschlossene Schublade', () => {
  it('zieht die Schublade beim Wischen nach rechts über die Seite fingergeführt herein', () => {
    const { result, onPreview, onOpen } = render(false);
    touch('touchstart', main, 20);
    touch('touchmove', main, 35);
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(result.current.previewing).toBe(true);
    touch('touchmove', main, 220);
    expect(variable('--mobile-nav-drag')).toBe('-100px');
    touch('touchend', main, 220, 0, 300);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(result.current.previewing).toBe(false);
  });

  it('lässt eine kurze Öffnen-Geste zurückgleiten', () => {
    const { result, onOpen } = render(false);
    slowDrag(main, 20, 100);
    expect(onOpen).not.toHaveBeenCalled();
    expect(result.current.previewing).toBe(false);
  });

  it('öffnet bei einem Wurf nach rechts auch über eine kurze Strecke', () => {
    const { onOpen } = render(false);
    touch('touchstart', main, 20);
    touch('touchmove', main, 40, 0, 10);
    touch('touchmove', main, 70, 0, 10);
    touch('touchend', main, 70, 0, 5);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('öffnet nicht nach links, außerhalb der Seite, in festen Ebenen oder ab md', () => {
    const view = render(false);
    slowDrag(main, 250, 100);
    slowDrag(backdrop, 20, 250);
    const sheet = document.createElement('div');
    sheet.style.position = 'fixed';
    main.append(sheet);
    slowDrag(sheet, 20, 250);
    view.rerender({ open: false, enabled: false });
    slowDrag(main, 20, 250);
    expect(view.onPreview).not.toHaveBeenCalled();
    expect(view.onOpen).not.toHaveBeenCalled();
  });

  // Waagerechtes Ziehen bewegt dort Schreibmarke oder Textauswahl (Suchfeld auf `/suche`).
  it('öffnet nicht aus Eingabefeldern und lässt ihnen die Berührung', () => {
    const view = render(false);
    const search = document.createElement('input');
    search.type = 'search';
    const textarea = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', '');
    const editableText = document.createElement('span');
    editable.append(editableText);
    main.append(search, textarea, editable);

    for (const target of [search, textarea, editableText]) {
      touch('touchstart', target, 20);
      expect(touch('touchmove', target, 40).defaultPrevented).toBe(false);
      expect(touch('touchmove', target, 250).defaultPrevented).toBe(false);
      touch('touchend', target, 250, 0, 300);
    }
    expect(view.onPreview).not.toHaveBeenCalled();
    expect(view.onOpen).not.toHaveBeenCalled();

    // Gegenprobe: Ein abgeschaltetes `contenteditable` ist kein Eingabefeld.
    editable.setAttribute('contenteditable', 'false');
    slowDrag(editableText, 20, 250);
    expect(view.onOpen).toHaveBeenCalledTimes(1);
  });

  // Breite Tabellen und andere waagerecht scrollende Bereiche behalten das Wischen für sich.
  it('öffnet nicht aus waagerecht scrollbaren Bereichen und lässt ihnen die Berührung', () => {
    const view = render(false);
    const scroller = document.createElement('div');
    scroller.style.overflowX = 'auto';
    Object.defineProperties(scroller, {
      scrollWidth: { value: 2 * WIDTH, configurable: true },
      clientWidth: { value: WIDTH, configurable: true },
    });
    const cell = document.createElement('span');
    scroller.append(cell);
    main.append(scroller);

    touch('touchstart', cell, 20);
    expect(touch('touchmove', cell, 40).defaultPrevented).toBe(false);
    expect(touch('touchmove', cell, 250).defaultPrevented).toBe(false);
    touch('touchend', cell, 250, 0, 300);
    expect(view.onPreview).not.toHaveBeenCalled();
    expect(view.onOpen).not.toHaveBeenCalled();

    // Gegenproben: Ohne Überbreite oder ohne eigenes Scrollen gehört die Geste der Schublade.
    Object.defineProperty(scroller, 'scrollWidth', { value: WIDTH });
    slowDrag(cell, 20, 250);
    expect(view.onOpen).toHaveBeenCalledTimes(1);
    Object.defineProperty(scroller, 'scrollWidth', { value: 2 * WIDTH });
    scroller.style.overflowX = 'hidden';
    slowDrag(cell, 20, 250);
    expect(view.onOpen).toHaveBeenCalledTimes(2);
  });

  // Die Vorschau ändert `open` nicht; ohne Routenbindung bliebe sie nach einer
  // Navigation stehen und öffnete beim Loslassen auf der neuen Seite.
  it('beendet eine Öffnen-Geste bei einer Navigation vor dem Loslassen', () => {
    const view = render(false);
    touch('touchstart', main, 20);
    touch('touchmove', main, 120);
    expect(view.result.current.previewing).toBe(true);

    view.rerender({ open: false, enabled: true, routeKey: 'suche' });
    expect(view.result.current.previewing).toBe(false);
    expect(variable('--mobile-nav-drag')).toBe('');
    expect(variable('--mobile-nav-motion')).toBe('');

    // Die alte Berührung wirkt auf der neuen Seite nicht weiter.
    expect(touch('touchmove', main, 260).defaultPrevented).toBe(false);
    touch('touchend', main, 260, 0, 300);
    expect(variable('--mobile-nav-drag')).toBe('');
    expect(view.result.current.previewing).toBe(false);
    expect(view.onOpen).not.toHaveBeenCalled();
  });

  it('beendet die Vorschau, wenn die Geste abbricht', () => {
    const { result, onOpen } = render(false);
    touch('touchstart', main, 20);
    touch('touchmove', main, 200);
    expect(result.current.previewing).toBe(true);
    touch('touchcancel', main, 200);
    expect(result.current.previewing).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
  });

  // Escape und das Suchkürzel der Shell beenden die Geste vor dem Loslassen;
  // sonst öffnete es die Schublade danach doch noch.
  it('beendet auf Abbruch der Shell die Vorschau samt ihrer Berührung', () => {
    const view = render(false);
    touch('touchstart', main, 20);
    touch('touchmove', main, 120);
    expect(view.result.current.previewing).toBe(true);

    act(() => { view.result.current.cancel(); });
    expect(view.result.current.previewing).toBe(false);
    expect(variable('--mobile-nav-drag')).toBe('');
    expect(variable('--mobile-nav-motion')).toBe('');
    expect(touch('touchmove', main, 260).defaultPrevented).toBe(false);
    touch('touchend', main, 260, 0, 300);
    expect(view.result.current.previewing).toBe(false);

    // Auch eine Berührung, deren Richtung noch nicht feststeht, wirkt danach nicht mehr.
    touch('touchstart', main, 20);
    act(() => { view.result.current.cancel(); });
    expect(touch('touchmove', main, 120).defaultPrevented).toBe(false);
    touch('touchend', main, 120, 0, 300);
    expect(view.onPreview).toHaveBeenCalledTimes(1);
    expect(view.onOpen).not.toHaveBeenCalled();
  });
});
