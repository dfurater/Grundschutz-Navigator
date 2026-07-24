import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useControlSelection } from './useControlSelection';

describe('useControlSelection', () => {
  it('owns individual selection updates and clearing', () => {
    const { result } = renderHook(() =>
      useControlSelection({ scopeId: 'gspp:TOP.1' }),
    );

    act(() => result.current.setChecked('TOP.1.1', true));
    expect([...result.current.checkedIds]).toEqual(['TOP.1.1']);

    act(() => result.current.setChecked('TOP.1.2', true));
    expect([...result.current.checkedIds]).toEqual(['TOP.1.1', 'TOP.1.2']);

    act(() => result.current.setChecked('TOP.1.1', false));
    expect([...result.current.checkedIds]).toEqual(['TOP.1.2']);

    act(() => result.current.clear());
    expect(result.current.checkedIds).toHaveLength(0);
  });

  it('supports the Set updater consumed by ControlTable', () => {
    const { result } = renderHook(() =>
      useControlSelection({ scopeId: 'gspp:TOP.1' }),
    );

    act(() => {
      result.current.setCheckedIds((current) => new Set(current).add('TOP.1.1'));
    });

    expect(result.current.checkedIds).toEqual(new Set(['TOP.1.1']));
  });

  it('returns an empty selection synchronously when the scope changes', () => {
    // CatalogBrowser passes the catalogKey alone as scopeId (GRU-267): the
    // selection must reset on an actual catalog switch, but callers are
    // responsible for keeping scopeId stable across in-catalog navigation
    // (topic/practice changes, cross-reference jumps) so it is preserved.
    const { result, rerender } = renderHook(
      ({ scopeId }) => useControlSelection({ scopeId }),
      { initialProps: { scopeId: 'gspp' } },
    );
    act(() => result.current.setChecked('TOP.1.1', true));

    rerender({ scopeId: 'wlan' });

    expect(result.current.checkedIds).toHaveLength(0);
    act(() => result.current.setChecked('WLAN.9.1', true));
    expect(result.current.checkedIds).toEqual(new Set(['WLAN.9.1']));

    rerender({ scopeId: 'gspp' });
    expect(result.current.checkedIds).toHaveLength(0);
  });

  it('keeps the selection across rerenders when scopeId stays the same', () => {
    const { result, rerender } = renderHook(
      ({ scopeId }) => useControlSelection({ scopeId }),
      { initialProps: { scopeId: 'gspp' } },
    );
    act(() => result.current.setChecked('TOP.1.1', true));

    rerender({ scopeId: 'gspp' });

    expect(result.current.checkedIds).toEqual(new Set(['TOP.1.1']));
  });
});
