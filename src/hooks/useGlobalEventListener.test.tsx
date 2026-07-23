import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGlobalEventListener } from './useGlobalEventListener';

describe('useGlobalEventListener', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps one subscription while dispatching to the latest listener', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const firstListener = vi.fn();
    const latestListener = vi.fn();

    const { rerender, unmount } = renderHook(
      ({ listener }) => {
        useGlobalEventListener('window', 'resize', listener);
      },
      { initialProps: { listener: firstListener } },
    );

    const resizeSubscriptions = () => addEventListener.mock.calls.filter(
      ([eventName]) => eventName === 'resize',
    );

    expect(resizeSubscriptions()).toHaveLength(1);

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(firstListener).toHaveBeenCalledTimes(1);

    rerender({ listener: latestListener });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(resizeSubscriptions()).toHaveLength(1);
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(latestListener).toHaveBeenCalledTimes(1);

    const subscribedListener = resizeSubscriptions()[0]?.[1];
    unmount();

    expect(removeEventListener).toHaveBeenCalledWith(
      'resize',
      subscribedListener,
    );
  });

  it('subscribes only while enabled', () => {
    const listener = vi.fn();
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');

    const { rerender } = renderHook(
      ({ enabled }) => {
        useGlobalEventListener('document', 'mousedown', listener, enabled);
      },
      { initialProps: { enabled: false } },
    );

    const mousedownSubscriptions = () => addEventListener.mock.calls.filter(
      ([eventName]) => eventName === 'mousedown',
    );

    expect(mousedownSubscriptions()).toHaveLength(0);

    rerender({ enabled: true });
    expect(mousedownSubscriptions()).toHaveLength(1);

    const subscribedListener = mousedownSubscriptions()[0]?.[1];
    rerender({ enabled: false });

    expect(removeEventListener).toHaveBeenCalledWith(
      'mousedown',
      subscribedListener,
    );
  });
});
