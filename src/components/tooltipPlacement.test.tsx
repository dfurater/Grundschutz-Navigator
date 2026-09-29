import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepInVisibleArea } from './tooltipPlacement';

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, right: left + width, bottom: top + height,
    x: left, y: top, width, height, toJSON: () => ({}),
  };
}

let release: (() => void) | undefined;

afterEach(() => {
  release?.();
  release = undefined;
  vi.restoreAllMocks();
});

/**
 * Panel 200 × 200 px ab (100, 100), sichtbar also 108 bis 292. Der Auslöser
 * steht bei `triggerTop`, der Tooltip ist 180 px hoch und passt auf keine
 * Seite ganz. `onMeasureTooltip` läuft bei jeder Messung des Tooltips.
 */
function openTooltip(triggerTop: number, onMeasureTooltip: (tooltip: HTMLElement) => void = () => {}) {
  const { container } = render(
    <div data-control-detail-scroll>
      <span data-testid="trigger"><span role="tooltip">Erklärung</span></span>
    </div>,
  );
  const panel = container.querySelector('[data-control-detail-scroll]')!;
  const trigger = screen.getByTestId('trigger');
  const tooltip = screen.getByRole('tooltip');
  const layout = new Map<Element, () => DOMRect>([
    [panel, () => rect(100, 100, 200, 200)],
    [trigger, () => rect(110, triggerTop, 20, 17)],
    [tooltip, () => {
      onMeasureTooltip(tooltip);
      return rect(120, triggerTop + 20, 100, 180);
    }],
  ]);
  const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return layout.get(this)?.() ?? rect(0, 0, 0, 0);
  });
  release = keepInVisibleArea(tooltip);
  return { panel, tooltip, measure };
}

describe('keepInVisibleArea', () => {
  it('beginnt beim Dokument-Scrollen unter dem mitlaufenden App-Kopf', () => {
    // Mobile Detailseite: Das Panel reicht über den Viewport hinaus, der
    // sticky Kopf deckt die obersten 56 px ab (GSPP-447).
    const { container } = render(
      <>
        <header data-sticky-header />
        <div data-control-detail-scroll>
          <span data-testid="trigger"><span role="tooltip">Erklärung</span></span>
        </div>
      </>,
    );
    const header = container.querySelector('[data-sticky-header]')!;
    const panel = container.querySelector('[data-control-detail-scroll]')!;
    const trigger = screen.getByTestId('trigger');
    const tooltip = screen.getByRole('tooltip');
    const layout = new Map<Element, DOMRect>([
      [header, rect(0, 0, 400, 56)],
      [panel, rect(0, -500, 400, 3000)],
      [trigger, rect(10, 80, 20, 17)],
      [tooltip, rect(10, 20, 100, 30)],
    ]);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return layout.get(this) ?? rect(0, 0, 0, 0);
    });

    release = keepInVisibleArea(tooltip);

    // Oberkante 56 + 8 px Randabstand = 64, statt 20 hinter dem Kopf.
    expect(tooltip).toHaveStyle({ transform: 'translate(0px, 44px)' });
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
  ])('nimmt die größere Seite ($side) und scrollt, wenn er auf keine Seite ganz passt, statt den Auslöser zu verdecken', ({ triggerTop, expected }) => {
    const { tooltip } = openTooltip(triggerTop);

    expect(tooltip).toHaveStyle(expected);
  });

  it('misst beim Scrollen im Tooltip nicht neu und behält beim Nachmessen seine Scrollposition', () => {
    // Wie in einer Engine, die den Scrollstand verwirft, sobald der Tooltip
    // beim Messen ohne `overflow-y: auto` kurz kein Scrollcontainer ist.
    let offset = 0;
    const { panel, tooltip, measure } = openTooltip(250, (measured) => {
      if (measured.style.overflowY !== 'auto') offset = 0;
    });
    Object.defineProperty(tooltip, 'scrollTop', {
      configurable: true,
      get: () => offset,
      set: (value: number) => {
        offset = value;
      },
    });

    tooltip.scrollTop = 60;
    const measured = measure.mock.calls.length;
    tooltip.dispatchEvent(new Event('scroll'));
    expect(measure.mock.calls).toHaveLength(measured);

    panel.dispatchEvent(new Event('scroll'));
    expect(measure.mock.calls.length).toBeGreaterThan(measured);
    expect(tooltip).toHaveStyle({ maxHeight: '139px', overflowY: 'auto' });
    expect(tooltip.scrollTop).toBe(60);
  });
});
