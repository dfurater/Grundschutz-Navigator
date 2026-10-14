import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterPanelProps } from './FilterPanel';
import { CatalogMobileFilterSheet } from './CatalogMobileFilterSheet';

vi.mock('./FilterPanel', () => ({
  FilterPanel: ({ headerAction }: { headerAction?: ReactNode }) => (
    <>
      {headerAction}
      <button type="button">Filteraktion</button>
    </>
  ),
}));

const filterPanelProps = { filteredCount: 3, totalCount: 10 } as FilterPanelProps;

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

  it('shows no badge for zero active filters and keeps the touch target', () => {
    render(<CatalogMobileFilterSheet filterPanelProps={filterPanelProps} activeCount={0} />);
    const trigger = screen.getByRole('button', { name: 'Filter anzeigen' });
    expect(trigger.querySelector('.filter-count-badge')).toBeNull();
    expect(trigger).toHaveClass('min-h-[44px]', 'min-w-[44px]');
  });

  it('updates the badge and accessible name when active selections change', () => {
    const view = render(<CatalogMobileFilterSheet filterPanelProps={filterPanelProps} activeCount={2} />);
    const trigger = screen.getByRole('button', { name: 'Filter anzeigen, 2 aktiv' });
    expect(within(trigger).getByText('2')).toHaveClass('filter-count-badge');
    expect(within(trigger).getByText('2')).toHaveAttribute('aria-hidden', 'true');

    view.rerender(<CatalogMobileFilterSheet filterPanelProps={filterPanelProps} activeCount={12} />);
    expect(trigger).toHaveAccessibleName('Filter anzeigen, 12 aktiv');
    expect(within(trigger).getByText('12')).toBeInTheDocument();

    view.rerender(<CatalogMobileFilterSheet filterPanelProps={filterPanelProps} activeCount={0} />);
    expect(trigger).toHaveAccessibleName('Filter anzeigen');
    expect(trigger.querySelector('.filter-count-badge')).toBeNull();
  });

  it('updates the close action with the live result count without reopening', () => {
    const view = render(<CatalogMobileFilterSheet filterPanelProps={filterPanelProps} activeCount={2} />);
    const trigger = screen.getByRole('button', { name: 'Filter anzeigen, 2 aktiv' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Schließen (3)' })).toBeInTheDocument();

    view.rerender(<CatalogMobileFilterSheet filterPanelProps={{ ...filterPanelProps, filteredCount: 0 }} activeCount={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'Schließen (0)' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAccessibleName('Filter anzeigen, 3 aktiv');
  });

  it('traps focus, closes on Escape and restores focus and scroll', () => {
    const view = render(<CatalogMobileFilterSheet filterPanelProps={filterPanelProps} activeCount={0} />);
    const trigger = screen.getByRole('button', { name: 'Filter anzeigen' });

    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByRole('button', { name: 'Filteraktion' })).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(view.container).toHaveAttribute('inert');

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: 'Filteraktion' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('scroll');
    expect(view.container).not.toHaveAttribute('inert');
  });

  it('opens as a named modal dialog outside the app root (GSPP-503)', () => {
    const view = render(
      <CatalogMobileFilterSheet
        filterPanelProps={filterPanelProps} activeCount={0}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter anzeigen' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(view.container).not.toContainElement(dialog);
  });

  it('closes via the visible Schließen button and returns focus to the trigger', () => {
    const view = render(<CatalogMobileFilterSheet filterPanelProps={filterPanelProps} activeCount={0} />);
    const trigger = screen.getByRole('button', { name: 'Filter anzeigen' });

    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Schließen (3)' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(view.container).not.toHaveAttribute('inert');
    expect(document.documentElement.style.overflow).toBe('scroll');
  });

  it('releases isolation and scroll lock when unmounted while open', () => {
    const view = render(<CatalogMobileFilterSheet filterPanelProps={filterPanelProps} activeCount={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter anzeigen' }));

    view.unmount();

    expect(document.querySelector('[inert]')).toBeNull();
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.documentElement.style.overflow).toBe('scroll');
  });

  it('closes when its backdrop is clicked', () => {
    render(
      <CatalogMobileFilterSheet filterPanelProps={filterPanelProps} activeCount={0} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter anzeigen' }));
    const backdrop = document.querySelector(
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
    render(
      <CatalogMobileFilterSheet filterPanelProps={filterPanelProps} activeCount={0} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter anzeigen' }));
    const sheet = screen.getByRole('dialog');
    const handle = sheet.querySelector('.touch-none');
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
