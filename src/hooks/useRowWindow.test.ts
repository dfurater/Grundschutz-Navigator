import { describe, expect, it } from 'vitest';
import { computeRowSlots, measureRowPitch } from './useRowWindow';

const base = { rowCount: 100, firstVisibleIndex: 0, visibleRowCount: 10, overscan: 5, pinnedIndex: 0 };

describe('computeRowSlots', () => {
  it('renders the visible rows plus overscan and one trailing spacer', () => {
    expect(computeRowSlots(base)).toEqual([
      ...Array.from({ length: 15 }, (_, index) => ({ kind: 'row', index })),
      { kind: 'spacer', key: 'spacer-15', rowCount: 85 },
    ]);
  });

  it('surrounds a scrolled window with spacers that add up to the full row count', () => {
    const slots = computeRowSlots({ ...base, firstVisibleIndex: 50, pinnedIndex: 52 });
    const rows = slots.filter((slot) => slot.kind === 'row').map((slot) => slot.index);
    const spacerRows = slots.reduce((sum, slot) => sum + (slot.kind === 'spacer' ? slot.rowCount : 0), 0);

    expect(rows).toEqual(Array.from({ length: 20 }, (_, i) => 45 + i));
    expect(rows.length + spacerRows).toBe(100);
    expect(slots[0]).toEqual({ kind: 'spacer', key: 'spacer-0', rowCount: 45 });
  });

  it('keeps a pinned row above the window rendered between two spacers', () => {
    const slots = computeRowSlots({ ...base, firstVisibleIndex: 60, pinnedIndex: 3 });

    expect(slots.slice(0, 4)).toEqual([
      { kind: 'spacer', key: 'spacer-0', rowCount: 3 },
      { kind: 'row', index: 3 },
      { kind: 'spacer', key: 'spacer-4', rowCount: 51 },
      { kind: 'row', index: 55 },
    ]);
  });

  it('keeps a pinned row below the window rendered', () => {
    const slots = computeRowSlots({ ...base, pinnedIndex: 99 });

    expect(slots.slice(-2)).toEqual([
      { kind: 'spacer', key: 'spacer-15', rowCount: 84 },
      { kind: 'row', index: 99 },
    ]);
  });

  it('clamps a scroll position beyond the end to the last rows', () => {
    const slots = computeRowSlots({ ...base, rowCount: 20, firstVisibleIndex: 500 });
    const rows = slots.filter((slot) => slot.kind === 'row').map((slot) => slot.index);

    expect(rows).toContain(19);
    expect(rows).toContain(0);
  });

  it('returns no slots for an empty list', () => {
    expect(computeRowSlots({ ...base, rowCount: 0 })).toEqual([]);
  });
});

describe('measureRowPitch', () => {
  function row(index: number, top: number, height: number): HTMLElement {
    const element = document.createElement('tr');
    element.dataset.rowIndex = String(index);
    element.getBoundingClientRect = () => ({ top, height } as DOMRect);
    return element;
  }

  it('measures between the second and third row of a run, not from a row after a spacer', () => {
    // Zeile 5 folgt auf einen Platzhalter und ist einen halben Rand niedriger.
    const rows = [row(5, 400, 40.5), row(6, 440.5, 41), row(7, 481.5, 41)];
    expect(measureRowPitch(rows, 'data-row-index')).toBe(41);
  });

  it('falls back to the first consecutive pair without a run of three', () => {
    expect(measureRowPitch([row(0, 0, 41), row(5, 400, 40.5), row(6, 441, 41)], 'data-row-index')).toBe(41);
  });

  it('falls back to the height of a single row', () => {
    expect(measureRowPitch([row(3, 0, 40.5)], 'data-row-index')).toBe(40.5);
  });

  it('returns 0 without rendered rows', () => {
    expect(measureRowPitch([], 'data-row-index')).toBe(0);
  });
});
