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
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, right: left + width, bottom: top + height,
    x: left, y: top, width, height, toJSON: () => ({}),
  };
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
        <Tooltip id="tt-esc" mode="toggle" content="Inhalt" describeTarget={() => <span>Platzhalter</span>} />
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
      return rect(0, 0, 0, 0);
    });
    render(
      <div data-control-detail-scroll>
        <Tooltip id="tt-resize" content="Erklärung" describeTarget={(id) => (
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
});
