import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useActiveVocabulary } from './useActiveVocabulary';

describe('useActiveVocabulary', () => {
  it('keeps only one vocabulary key active and closes it when toggled again', () => {
    const { result } = renderHook(() =>
      useActiveVocabulary({ scopeId: 'gspp:TOP.1.1' }),
    );

    act(() => result.current.toggle('modalverb:MUSS'));
    expect(result.current.activeKey).toBe('modalverb:MUSS');
    expect(result.current.isActive('modalverb:MUSS')).toBe(true);

    act(() => result.current.toggle('tag:Governance'));
    expect(result.current.activeKey).toBe('tag:Governance');
    expect(result.current.isActive('modalverb:MUSS')).toBe(false);

    act(() => result.current.toggle('tag:Governance'));
    expect(result.current.activeKey).toBeNull();
  });

  it('returns no active key synchronously when the scope changes', () => {
    const { result, rerender } = renderHook(
      ({ scopeId }) => useActiveVocabulary({ scopeId }),
      { initialProps: { scopeId: 'gspp:TOP.1.1' } },
    );

    act(() => result.current.toggle('modalverb:MUSS'));
    rerender({ scopeId: 'wlan:WLAN.9.1' });

    expect(result.current.activeKey).toBeNull();
    expect(result.current.isActive('modalverb:MUSS')).toBe(false);

    act(() => result.current.toggle('modalverb:SOLL'));
    expect(result.current.activeKey).toBe('modalverb:SOLL');

    rerender({ scopeId: 'gspp:TOP.1.1' });
    expect(result.current.activeKey).toBeNull();
  });

  it('does not revive a previous scope key after a roundtrip without interaction', () => {
    const { result, rerender } = renderHook(
      ({ scopeId }) => useActiveVocabulary({ scopeId }),
      { initialProps: { scopeId: 'gspp:TOP.1.1' } },
    );

    act(() => result.current.toggle('modalverb:MUSS'));
    rerender({ scopeId: 'wlan:WLAN.9.1' });
    rerender({ scopeId: 'gspp:TOP.1.1' });

    expect(result.current.activeKey).toBeNull();
    expect(result.current.isActive('modalverb:MUSS')).toBe(false);
  });
});
