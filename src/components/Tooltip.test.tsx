import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from './Tooltip';

// RTL-`asyncWrapper` drainnt jeden userEvent-Call per `setTimeout(..., 0)` und
// advanced ihn nur, wenn `jestFakeTimersAreEnabled()` (reines `jest`-Global,
// s. @testing-library/react pure.js) zutrifft. Unter Vitest gibt es kein
// `jest`-Global — ohne diesen file-lokalen Shim hängt JEDER userEvent-Call
// unter `vi.useFakeTimers()`, unabhängig von der `advanceTimers`-Config.
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

describe('Tooltip (GSPP-303 T3)', () => {
  it("mode='hover': nach 500 ms KEIN Tooltip, nach 500+ ms sichtbar", async () => {
    const user = setupUser();
    render(
      <Tooltip
        id="tt-hover"
        content="Inhalt"
        describeTarget={(describedById) => (
          <button aria-describedby={describedById} type="button">
            Begriff
          </button>
        )}
      />,
    );
    const target = screen.getByRole('button', { name: 'Begriff' });

    await user.hover(target);

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.getByRole('tooltip', { name: 'Inhalt' })).toBeInTheDocument();
  });

  it('Fokus öffnet SOFORT (hoverDelayMs gegentesten)', async () => {
    const user = setupUser();
    render(
      <Tooltip
        id="tt-focus"
        content="Inhalt"
        hoverDelayMs={10000}
        describeTarget={(describedById) => (
          <button aria-describedby={describedById} type="button">
            Begriff
          </button>
        )}
      />,
    );

    await user.tab();

    expect(screen.getByRole('tooltip', { name: 'Inhalt' })).toBeInTheDocument();
  });

  it('Esc schließt offenen Tooltip', async () => {
    const user = setupUser();
    render(
      <Tooltip
        id="tt-esc"
        content="Inhalt"
        describeTarget={(describedById) => (
          <button aria-describedby={describedById} type="button">
            Begriff
          </button>
        )}
      />,
    );

    await user.tab();
    expect(screen.getByRole('tooltip', { name: 'Inhalt' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it("mode='toggle': Klick öffnet, zweiter Klick schließt", async () => {
    const user = setupUser();
    render(
      <Tooltip
        id="tt-toggle"
        mode="toggle"
        content="Inhalt"
        describeTarget={(describedById) => (
          <span aria-describedby={describedById}>Platzhalter</span>
        )}
      />,
    );
    const target = screen.getByText('Platzhalter');

    await user.click(target);
    expect(screen.getByRole('tooltip', { name: 'Inhalt' })).toBeInTheDocument();

    await user.click(target);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it("mode='hover-toggle': öffnet bei Hover nach 500 ms und per Antippen sofort", async () => {
    const user = setupUser();
    render(
      <Tooltip
        id="tt-placeholder"
        mode="hover-toggle"
        content="Platzhalter"
        describeTarget={(describedById) => (
          <span aria-describedby={describedById}>Frist</span>
        )}
      />,
    );
    const target = screen.getByText('Frist');

    await user.hover(target);
    act(() => vi.advanceTimersByTime(499));
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('tooltip', { name: 'Platzhalter' })).toBeInTheDocument();

    await user.unhover(target);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.click(target);
    expect(screen.getByRole('tooltip', { name: 'Platzhalter' })).toBeInTheDocument();
  });

  it('Vertragsbruch: describeTarget ohne aria-describedby schlägt fehl', () => {
    render(
      <Tooltip
        id="tt-vertrag"
        content="Inhalt"
        describeTarget={() => <span>ohne Refs</span>}
      />,
    );
    const target = screen.getByText('ohne Refs');

    let threw = false;
    try {
      expect(target).toHaveAttribute('aria-describedby', 'tt-vertrag');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('hält einen rechts überstehenden Tooltip innerhalb des Detail-Panels', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-control-detail-scroll')) return rect(100, 100, 200, 200);
      if (this.getAttribute('role') === 'tooltip') return rect(270, 130, 100, 30);
      return rect(0, 0, 0, 0);
    });
    render(
      <div data-control-detail-scroll>
        <Tooltip id="tt-panel" content="Erklärung" describeTarget={(id) => (
          <button type="button" aria-describedby={id}>Begriff</button>
        )} />
      </div>,
    );

    const user = setupUser();
    await user.tab();
    act(() => vi.advanceTimersByTime(20));

    expect(screen.getByRole('tooltip')).toHaveStyle({ transform: 'translate(-78px, 0px)' });
  });
});
