import { act, render, renderHook } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMobileDrawerPlacement } from './useMobileDrawerPlacement';

function scrollTo(y: number) {
  Object.defineProperty(globalThis, 'scrollY', { configurable: true, value: y });
}

function scrollDocument(y: number) {
  scrollTo(y);
  act(() => { globalThis.dispatchEvent(new Event('scroll')); });
}

const drawerRef: { current: HTMLElement | null } = { current: null };

/** Schublade mit den Animationen, die `getAnimations` meldet. */
function drawerWith(animations: { readonly transitionProperty: string }[]) {
  const element = document.createElement('aside');
  element.getAnimations = () => animations as unknown as Animation[];
  return element;
}

function dispatchTransition(type: 'transitionend' | 'transitioncancel', target: Element, propertyName = 'translate') {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: propertyName });
  act(() => { target.dispatchEvent(event); });
}

function nextFrame() {
  return act(() => new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); }));
}

/** Öffnet die Schublade bei Dokumentposition 640 und schließt sie mit Überblendung. */
function openAndClose(drawer: HTMLElement = document.createElement('aside')) {
  drawerRef.current = drawer;
  const { result, rerender } = renderHook(
    ({ open }) => useMobileDrawerPlacement(open, false, false, drawerRef),
    { initialProps: { open: false } },
  );
  scrollTo(640);
  act(() => result.current.captureOffset());
  rerender({ open: true });
  rerender({ open: false });
  return { result, drawer };
}

// Wie die neue Seite einer Themenwahl: scrollt im eigenen Layout-Effekt,
// also im selben Commit und vor den Layout-Effekten der Shell.
function ScrollingPage({ open }: { readonly open: boolean }) {
  useLayoutEffect(() => {
    if (!open) scrollTo(0);
  }, [open]);
  return null;
}

function Shell({ open }: { readonly open: boolean }) {
  const placement = useMobileDrawerPlacement(open, false, false, drawerRef);
  return (
    <>
      <ScrollingPage open={open} />
      <button type="button" onClick={placement.captureOffset}>Menü</button>
      <output>{placement.top}</output>
    </>
  );
}

describe('useMobileDrawerPlacement', () => {
  afterEach(() => {
    drawerRef.current = null;
    scrollTo(0);
    document.documentElement.style.overflow = '';
  });

  it('legt die offene Schublade an die beim Öffnen erfasste Dokumentposition und sperrt das Dokument', () => {
    const { result, rerender } = renderHook(
      ({ open }) => useMobileDrawerPlacement(open, false, false, drawerRef),
      { initialProps: { open: false } },
    );
    expect(result.current.top).toBe(0);

    scrollTo(640);
    act(() => result.current.captureOffset());
    rerender({ open: true });

    expect(result.current.top).toBe(640);
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('setzt die geschlossene Schublade erst nach dem Hinausgleiten zurück', () => {
    const { result, drawer } = openAndClose();

    // Während des Hinausgleitens bleibt die Lage, sonst spränge die Schublade.
    expect(result.current.top).toBe(640);
    expect(document.documentElement.style.overflow).toBe('');

    // Transitionen von Nachfahren zählen nicht.
    const child = drawer.appendChild(document.createElement('div'));
    dispatchTransition('transitionend', child);
    expect(result.current.top).toBe(640);

    // Die Breiten-Transition läuft gleichzeitig, darf den Drawer aber nicht
    // vor dem Ende seiner Translate-Transition zurücksetzen.
    dispatchTransition('transitionend', drawer, 'width');
    expect(result.current.top).toBe(640);

    dispatchTransition('transitionend', drawer);
    expect(result.current.top).toBe(0);
  });

  it('hält die hinausgleitende Schublade an der Dokumentposition, wenn die neue Seite im selben Commit scrollt', () => {
    const { container, getByRole, rerender } = render(<Shell open={false} />);
    scrollTo(640);
    act(() => getByRole('button').click());
    rerender(<Shell open />);
    expect(container.querySelector('output')?.textContent).toBe('640');

    rerender(<Shell open={false} />);
    expect(globalThis.scrollY).toBe(0);
    expect(container.querySelector('output')?.textContent).toBe('0');
  });

  it('führt die hinausgleitende Schublade mit der Dokumentposition nach, bis sie verschwunden ist', () => {
    const { result, drawer } = openAndClose();

    scrollDocument(320);
    expect(result.current.top).toBe(320);

    dispatchTransition('transitionend', drawer);
    expect(result.current.top).toBe(0);

    // Die verschwundene Schublade folgt nicht mehr; sie bleibt oben.
    scrollDocument(480);
    expect(result.current.top).toBe(0);
  });

  it('beendet das Hinausgleiten bei abgebrochener Transition', () => {
    const { result, drawer } = openAndClose(drawerWith([]));

    dispatchTransition('transitioncancel', drawer);
    scrollDocument(320);
    expect(result.current.top).toBe(0);
  });

  it('gleitet weiter hinaus, wenn das Schließen das Hereingleiten abbricht', () => {
    // Der Abbruch der Einfahrt kommt erst nach dem Schließen an; die
    // umgekehrte Translate-Transition läuft da bereits.
    const { result, drawer } = openAndClose(drawerWith([{ transitionProperty: 'translate' }]));

    dispatchTransition('transitioncancel', drawer);
    dispatchTransition('transitionend', drawer);
    scrollDocument(320);
    expect(result.current.top).toBe(320);
  });

  it.each([
    ['endet', 'width', 0],
    ['folgt weiter', 'translate', 320],
  ])('%s im nächsten Frame, wenn an der Schublade eine %s-Transition läuft', async (_, transitionProperty, expectedTop) => {
    const { result } = openAndClose(drawerWith([{ transitionProperty }]));
    expect(result.current.top).toBe(640);

    await nextFrame();
    scrollDocument(320);
    expect(result.current.top).toBe(expectedTop);
  });

  it('legt die geschlossene Schublade ohne Überblendung sofort oben ab', () => {
    const { result, rerender } = renderHook(
      ({ open }) => useMobileDrawerPlacement(open, false, true, drawerRef),
      { initialProps: { open: true } },
    );
    scrollTo(640);
    act(() => result.current.captureOffset());
    expect(result.current.top).toBe(640);

    rerender({ open: false });
    expect(result.current.top).toBe(0);
  });

  it('hält die geschlossene Schublade oben, wenn Reduced Motion danach endet', () => {
    const { result, rerender } = renderHook(
      ({ open, transitionDisabled }) => useMobileDrawerPlacement(open, false, transitionDisabled, drawerRef),
      { initialProps: { open: true, transitionDisabled: true } },
    );
    scrollTo(640);
    act(() => result.current.captureOffset());
    rerender({ open: false, transitionDisabled: true });
    rerender({ open: false, transitionDisabled: false });

    expect(result.current.top).toBe(0);
  });

  it('legt die Schublade oben ab, wenn Reduced Motion während des Hinausgleitens beginnt', () => {
    const { result, rerender } = renderHook(
      ({ open, transitionDisabled }) => useMobileDrawerPlacement(open, false, transitionDisabled, drawerRef),
      { initialProps: { open: true, transitionDisabled: false } },
    );
    scrollTo(640);
    act(() => result.current.captureOffset());
    rerender({ open: false, transitionDisabled: false });
    expect(result.current.top).toBe(640);

    // Die Transition entfällt; ein `transitionend` käme nicht mehr.
    rerender({ open: false, transitionDisabled: true });
    expect(result.current.top).toBe(0);
  });

  it('legt Schublade und Dokument nach einem Wechsel über md bei offener Schublade nach oben', () => {
    const scrollToSpy = vi.spyOn(globalThis, 'scrollTo').mockImplementation(() => {});
    const { result, rerender } = renderHook(
      ({ persistent }) => useMobileDrawerPlacement(true, persistent, false, drawerRef),
      { initialProps: { persistent: false } },
    );
    scrollTo(640);
    act(() => result.current.captureOffset());

    rerender({ persistent: true });
    expect(result.current.top).toBeUndefined();
    expect(document.documentElement.style.overflow).toBe('');

    scrollToSpy.mockClear();
    rerender({ persistent: false });
    expect(result.current.top).toBe(0);
    expect(scrollToSpy).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    expect(document.documentElement.style.overflow).toBe('hidden');
    scrollToSpy.mockRestore();
  });
});
