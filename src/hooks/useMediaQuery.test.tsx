import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

/**
 * `src/test-setup.ts` stellt global ein `matchMedia` bereit, dessen
 * `addEventListener` nichts tut und dessen `matches` fest `false` ist. Für die
 * Abonnement- und Aktualisierungspfade des Hooks braucht es einen Stub, der
 * seine Listener tatsächlich führt; er ersetzt den Bootstrap-Stub nur innerhalb
 * des jeweiligen Tests.
 */
function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const mediaQuery = {
    matches,
    addEventListener: vi.fn((_: string, listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_: string, listener: () => void) => {
      listeners.delete(listener);
    }),
  };
  const matchMedia = vi.fn(() => mediaQuery);
  vi.stubGlobal('matchMedia', matchMedia);

  return {
    matchMedia,
    mediaQuery,
    emitChange(nextMatches: boolean) {
      mediaQuery.matches = nextMatches;
      for (const listener of listeners) listener();
    },
  };
}

describe('useMediaQuery', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the current match state for the given query', () => {
    const { matchMedia } = stubMatchMedia(true);

    const { result } = renderHook(() => useMediaQuery('(prefers-reduced-motion: reduce)'));

    expect(result.current).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('re-renders when the media query changes', () => {
    const media = stubMatchMedia(false);

    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(false);

    act(() => {
      media.emitChange(true);
    });

    expect(result.current).toBe(true);
  });

  it('removes its change listener on unmount', () => {
    const media = stubMatchMedia(false);

    const { unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(media.mediaQuery.addEventListener).toHaveBeenCalledTimes(1);

    unmount();

    expect(media.mediaQuery.removeEventListener).toHaveBeenCalledTimes(1);
    expect(media.mediaQuery.removeEventListener.mock.calls[0][1]).toBe(
      media.mediaQuery.addEventListener.mock.calls[0][1],
    );
  });

  it('subscribes anew when the query changes', () => {
    const media = stubMatchMedia(false);

    const { rerender } = renderHook(({ query }) => useMediaQuery(query), {
      initialProps: { query: '(min-width: 768px)' },
    });
    rerender({ query: '(min-width: 1024px)' });

    expect(media.mediaQuery.removeEventListener).toHaveBeenCalledTimes(1);
    expect(media.matchMedia).toHaveBeenLastCalledWith('(min-width: 1024px)');
  });
});
