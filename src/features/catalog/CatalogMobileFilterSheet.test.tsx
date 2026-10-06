import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterPanelProps } from './FilterPanel';
import { CatalogMobileFilterSheet } from './CatalogMobileFilterSheet';

vi.mock('./FilterPanel', () => ({
  FilterPanel: () => <button type="button">Filteraktion</button>,
}));

const filterPanelProps = {} as FilterPanelProps;

function touchEvent(type: string, clientY: number): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: [{ clientY }],
  });
  return event as TouchEvent;
}

describe('CatalogMobileFilterSheet', () => {
  beforeEach(() => {
    document.documentElement.style.overflow = 'scroll';
  });

  afterEach(() => {
    document.documentElement.style.overflow = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('traps focus, closes on Escape and restores focus and scroll', () => {
    render(<CatalogMobileFilterSheet filterPanelProps={filterPanelProps} />);
    const trigger = screen.getByRole('button', { name: 'Filter anzeigen' });

    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('button', { name: 'Filteraktion' })).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('hidden');

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: 'Filteraktion' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('scroll');
  });

  it('closes when its backdrop is clicked', () => {
    const view = render(
      <CatalogMobileFilterSheet filterPanelProps={filterPanelProps} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter anzeigen' }));
    const backdrop = view.container.querySelector(
      '.fixed.inset-0[aria-hidden="true"]',
    );
    expect(backdrop).not.toBeNull();
    expect(backdrop!.className).not.toMatch(/\bbg-/);
    fireEvent.click(backdrop!);

    expect(screen.queryByRole('button', { name: 'Filteraktion' })).not.toBeInTheDocument();
  });

  it('dismisses after a downward drag beyond the sheet threshold', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const view = render(
      <CatalogMobileFilterSheet filterPanelProps={filterPanelProps} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter anzeigen' }));
    const sheet = view.container.querySelector('aside.fixed');
    const handle = view.container.querySelector('.touch-none');
    expect(sheet).not.toBeNull();
    expect(handle).not.toBeNull();
    Object.defineProperty(sheet!, 'offsetHeight', { value: 400 });

    handle!.dispatchEvent(touchEvent('touchstart', 100));
    vi.setSystemTime(1_200);
    handle!.dispatchEvent(touchEvent('touchmove', 250));
    handle!.dispatchEvent(touchEvent('touchend', 250));
    act(() => vi.advanceTimersByTime(200));

    expect(screen.queryByRole('button', { name: 'Filteraktion' })).not.toBeInTheDocument();
  });
});
