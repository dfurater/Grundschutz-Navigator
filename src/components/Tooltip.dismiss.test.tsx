import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { Tooltip } from './Tooltip';

// Shim wie in `Tooltip.test.tsx`: RTL drainnt userEvent-Calls nur mit `jest`-Global.
(globalThis as unknown as { jest: { advanceTimersByTime: (ms: number) => void } }).jest = {
  advanceTimersByTime: (ms: number) => {
    vi.advanceTimersByTime(ms);
  },
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ResizeObserverMock.instances.length = 0;
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, right: left + width, bottom: top + height,
    x: left, y: top, width, height, toJSON: () => ({}),
  };
}

/** Merkt sich die beobachteten Elemente und meldet ihnen auf Wunsch eine Größenänderung. */
class ResizeObserverMock {
  static readonly instances: ResizeObserverMock[] = [];

  readonly targets = new Set<Element>();

  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  static resize(target: Element) {
    for (const observer of ResizeObserverMock.instances.filter((instance) => instance.targets.has(target))) {
      observer.callback([], observer as unknown as ResizeObserver);
    }
  }
}

function setupUser() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

/** Lauscht wie das mobile Detail-Overlay auf Esc am `document`. */
function OverlayEscape({ onEscape }: { readonly onEscape: () => void }) {
  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key === 'Escape') onEscape();
  });
  return null;
}

describe('Tooltip schließen (GSPP-303 Review)', () => {
  it('Esc schließt nur den Tooltip, nicht das umgebende Overlay', async () => {
    const user = setupUser();
    const overlayEscape = vi.fn();
    render(
      <>
        <OverlayEscape onEscape={overlayEscape} />
        <Tooltip idPrefix="tt-esc" mode="toggle" content="Inhalt" describeTarget={() => <span>Platzhalter</span>} />
      </>,
    );

    await user.click(screen.getByText('Platzhalter'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(overlayEscape).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(overlayEscape).toHaveBeenCalledTimes(1);
  });

  it('misst die Begrenzung nach einer Fenstergrößenänderung neu', async () => {
    let panelRight = 400;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-control-detail-scroll')) return rect(100, 100, panelRight - 100, 200);
      if (this.getAttribute('role') === 'tooltip') return rect(270, 130, 100, 30);
      if (this.hasAttribute('data-tooltip-root')) return rect(250, 130, 20, 20);
      return rect(0, 0, 0, 0);
    });
    render(
      <div data-control-detail-scroll>
        <Tooltip idPrefix="tt-resize" content="Erklärung" describeTarget={(id) => (
          <button type="button" aria-describedby={id}>Begriff</button>
        )} />
      </div>,
    );

    const user = setupUser();
    await user.tab();
    act(() => vi.advanceTimersByTime(20));
    expect(screen.getByRole('tooltip')).toHaveStyle({ transform: 'translate(0px, 0px)' });

    panelRight = 300;
    act(() => {
      globalThis.dispatchEvent(new Event('resize'));
    });
    act(() => vi.advanceTimersByTime(20));
    expect(screen.getByRole('tooltip')).toHaveStyle({ transform: 'translate(-78px, 0px)' });
  });

  it('misst die Begrenzung neu, wenn sich nur das Panel verengt', async () => {
    // Ziehen am Panelrand ändert die Breite ohne Fensterereignis und nimmt den
    // Fokus nicht (`useDragToResize`): Ein per Tastatur geöffneter Tooltip bleibt offen.
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    let panelRight = 400;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-control-detail-scroll')) return rect(100, 100, panelRight - 100, 200);
      if (this.getAttribute('role') === 'tooltip') return rect(270, 130, 100, 30);
      if (this.hasAttribute('data-tooltip-root')) return rect(250, 130, 20, 20);
      return rect(0, 0, 0, 0);
    });
    const { container } = render(
      <div data-control-detail-scroll>
        <Tooltip idPrefix="tt-panel-resize" content="Erklärung" describeTarget={(id) => (
          <button type="button" aria-describedby={id}>Begriff</button>
        )} />
      </div>,
    );
    const panel = container.querySelector('[data-control-detail-scroll]')!;

    const user = setupUser();
    await user.tab();
    expect(screen.getByRole('tooltip')).toHaveStyle({ transform: 'translate(0px, 0px)' });

    panelRight = 300;
    act(() => {
      ResizeObserverMock.resize(panel);
    });
    expect(screen.getByRole('tooltip')).toHaveStyle({ transform: 'translate(-78px, 0px)' });

    // Geschlossen beobachtet der Tooltip das Panel nicht mehr.
    await user.keyboard('{Escape}');
    expect(ResizeObserverMock.instances.some((observer) => observer.targets.size > 0)).toBe(false);
  });

  it('misst die Begrenzung beim Scrollen des Panels neu und löst sie, wenn der Auslöser hinausscrollt', async () => {
    let scrollTop = 0;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-control-detail-scroll')) return rect(100, 100, 200, 200);
      if (this.getAttribute('role') === 'tooltip') return rect(120, 200 - scrollTop, 100, 30);
      if (this.hasAttribute('data-tooltip-root')) return rect(110, 190 - scrollTop, 20, 10);
      return rect(0, 0, 0, 0);
    });
    const { container } = render(
      <div data-control-detail-scroll>
        <Tooltip idPrefix="tt-scroll" content="Erklärung" describeTarget={(id) => (
          <button type="button" aria-describedby={id}>Begriff</button>
        )} />
      </div>,
    );
    const panel = container.querySelector('[data-control-detail-scroll]');
    const scrollPanel = (top: number) => {
      scrollTop = top;
      act(() => {
        panel?.dispatchEvent(new Event('scroll'));
      });
    };

    const user = setupUser();
    await user.tab();
    expect(screen.getByRole('tooltip')).toHaveStyle({ transform: 'translate(0px, 0px)' });

    // Auslöser noch sichtbar, Tooltip oben angeschnitten: nach unten ins Panel schieben.
    scrollPanel(95);
    expect(screen.getByRole('tooltip')).toHaveStyle({ transform: 'translate(0px, 3px)' });

    // Auslöser ganz oberhalb des Panels: Tooltip bleibt am Auslöser.
    scrollPanel(120);
    expect(screen.getByRole('tooltip').style.transform).toBe('');
  });

  it('klappt über den Auslöser, wenn unten im Panel kein Platz ist, statt ihn zu verdecken', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-control-detail-scroll')) return rect(100, 100, 200, 200);
      if (this.getAttribute('role') === 'tooltip') return rect(120, 290, 100, 26);
      if (this.hasAttribute('data-tooltip-root')) return rect(110, 270, 20, 17);
      return rect(0, 0, 0, 0);
    });
    render(
      <div data-control-detail-scroll>
        <Tooltip idPrefix="tt-flip" content="Erklärung" describeTarget={(id) => (
          <button type="button" aria-describedby={id}>Begriff</button>
        )} />
      </div>,
    );

    const user = setupUser();
    await user.tab();

    // Oberkante über dem Auslöser: 270 − 3 px Abstand − 26 px Höhe = 241.
    expect(screen.getByRole('tooltip')).toHaveStyle({ transform: 'translate(0px, -49px)' });
  });

  it('klappt mit der Höhe nach der Breitenbegrenzung um, damit der Auslöser frei bleibt', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-control-detail-scroll')) return rect(100, 100, 200, 200);
      // Schmaler begrenzt bricht der Text auf mehr Zeilen um.
      if (this.getAttribute('role') === 'tooltip') {
        return this.style.maxWidth ? rect(120, 290, 180, 60) : rect(120, 290, 400, 26);
      }
      if (this.hasAttribute('data-tooltip-root')) return rect(110, 270, 20, 17);
      return rect(0, 0, 0, 0);
    });
    render(
      <div data-control-detail-scroll>
        <Tooltip idPrefix="tt-wrap" content="Lange Erklärung" describeTarget={(id) => (
          <button type="button" aria-describedby={id}>Begriff</button>
        )} />
      </div>,
    );

    const user = setupUser();
    await user.tab();

    // Verfügbar 184 px breit; Oberkante über dem Auslöser: 270 − 3 px Abstand − 60 px Höhe = 207.
    expect(screen.getByRole('tooltip')).toHaveStyle({ maxWidth: '184px', transform: 'translate(-8px, -83px)' });
  });

  it.each([
    {
      side: 'darüber', triggerTop: 250,
      // Oben 250 − 3 px Abstand − 108 = 139 px, unten 292 − 270 = 22 px: Oberkante an 108.
      expected: { maxHeight: '139px', overflowY: 'auto', transform: 'translate(0px, -162px)' },
    },
    {
      side: 'darunter', triggerTop: 130,
      // Unten 292 − 150 = 142 px, oben 127 − 108 = 19 px: Er bleibt an seiner Lage.
      expected: { maxHeight: '142px', overflowY: 'auto', transform: 'translate(0px, 0px)' },
    },
  ])('nimmt die größere Seite ($side) und scrollt, wenn er auf keine Seite ganz passt, statt den Auslöser zu verdecken', async ({ triggerTop, expected }) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-control-detail-scroll')) return rect(100, 100, 200, 200);
      if (this.getAttribute('role') === 'tooltip') return rect(120, triggerTop + 20, 100, 180);
      if (this.hasAttribute('data-tooltip-root')) return rect(110, triggerTop, 20, 17);
      return rect(0, 0, 0, 0);
    });
    render(
      <div data-control-detail-scroll>
        <Tooltip idPrefix="tt-tall" content="Sehr lange Erklärung" describeTarget={(id) => (
          <button type="button" aria-describedby={id}>Begriff</button>
        )} />
      </div>,
    );

    const user = setupUser();
    await user.tab();

    expect(screen.getByRole('tooltip')).toHaveStyle(expected);
  });

  it('entfernt die Scroll- und Resize-Listener beim Schließen', async () => {
    const removeDocument = vi.spyOn(globalThis.document, 'removeEventListener');
    const removeWindow = vi.spyOn(globalThis, 'removeEventListener');
    render(
      <Tooltip idPrefix="tt-cleanup" mode="toggle" content="Inhalt" describeTarget={() => <span>Platzhalter</span>} />,
    );
    const user = setupUser();
    await user.click(screen.getByText('Platzhalter'));
    await user.keyboard('{Escape}');

    expect(removeDocument).toHaveBeenCalledWith('scroll', expect.any(Function), { capture: true });
    expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});
