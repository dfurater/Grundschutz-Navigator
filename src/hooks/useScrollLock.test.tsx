import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useScrollLock } from './useScrollLock';

describe('useScrollLock', () => {
  afterEach(() => {
    document.documentElement.style.overflow = '';
  });

  it('does not change root overflow while inactive', () => {
    document.documentElement.style.overflow = 'scroll';

    renderHook(() => useScrollLock(false));

    expect(document.documentElement.style.overflow).toBe('scroll');
  });

  it('locks scrolling and restores the exact previous inline value', () => {
    document.documentElement.style.overflow = 'clip';
    const { rerender } = renderHook(
      ({ active }) => useScrollLock(active),
      { initialProps: { active: true } },
    );

    expect(document.documentElement.style.overflow).toBe('hidden');

    rerender({ active: false });
    expect(document.documentElement.style.overflow).toBe('clip');
  });

  it('restores the previous inline value on unmount', () => {
    document.documentElement.style.overflow = 'auto';
    const { unmount } = renderHook(() => useScrollLock(true));

    unmount();

    expect(document.documentElement.style.overflow).toBe('auto');
  });

  it('keeps scrolling locked until the last overlapping lock ends, in any order', () => {
    document.documentElement.style.overflow = '';
    const first = renderHook(() => useScrollLock(true));
    const second = renderHook(() => useScrollLock(true));

    // Die zuerst gesetzte Sperre endet zuerst: Die spätere bleibt wirksam.
    first.unmount();
    expect(document.documentElement.style.overflow).toBe('hidden');

    second.unmount();
    expect(document.documentElement.style.overflow).toBe('');
  });
});
