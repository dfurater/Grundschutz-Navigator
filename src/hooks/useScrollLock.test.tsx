import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useScrollLock } from './useScrollLock';

describe('useScrollLock', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('does not change body overflow while inactive', () => {
    document.body.style.overflow = 'scroll';

    renderHook(() => useScrollLock(false));

    expect(document.body.style.overflow).toBe('scroll');
  });

  it('locks scrolling and restores the exact previous inline value', () => {
    document.body.style.overflow = 'clip';
    const { rerender } = renderHook(
      ({ active }) => useScrollLock(active),
      { initialProps: { active: true } },
    );

    expect(document.body.style.overflow).toBe('hidden');

    rerender({ active: false });
    expect(document.body.style.overflow).toBe('clip');
  });

  it('restores the previous inline value on unmount', () => {
    document.body.style.overflow = 'auto';
    const { unmount } = renderHook(() => useScrollLock(true));

    unmount();

    expect(document.body.style.overflow).toBe('auto');
  });
});
