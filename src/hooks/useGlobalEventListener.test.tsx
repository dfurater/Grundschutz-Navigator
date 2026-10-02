import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGlobalEventListener } from './useGlobalEventListener';

describe('useGlobalEventListener', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps one subscription while dispatching to the latest listener', () => {
    const addEventListener = vi.spyOn(globalThis, 'addEventListener');
    const removeEventListener = vi.spyOn(globalThis, 'removeEventListener');
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
      globalThis.dispatchEvent(new Event('resize'));
    });
    expect(firstListener).toHaveBeenCalledTimes(1);

    rerender({ listener: latestListener });
    act(() => {
      globalThis.dispatchEvent(new Event('resize'));
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

  it('keeps default subscriptions in the bubble phase', () => {
    const order: string[] = [];
    const view = render(<button type="button" onKeyDown={() => order.push('target')}>Target</button>);
    const target = view.getByRole('button', { name: 'Target' });
    const { unmount } = renderHook(() => {
      useGlobalEventListener('document', 'keydown', () => order.push('document'));
    });

    fireEvent.keyDown(target, { key: 'Escape' });

    expect(order).toEqual(['target', 'document']);
    unmount();
  });

  it('captures before target handlers and removes the same capture subscription', () => {
    const order: string[] = [];
    const view = render(<button type="button" onKeyDown={() => order.push('target')}>Target</button>);
    const target = view.getByRole('button', { name: 'Target' });
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => {
      useGlobalEventListener('document', 'keydown', () => order.push('capture'), true, undefined, true);
    });

    fireEvent.keyDown(target, { key: 'Escape' });

    expect(order).toEqual(['capture', 'target']);
    const subscription = addEventListener.mock.calls.find(([name]) => name === 'keydown');
    expect(subscription?.[2]).toBe(true);
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith('keydown', subscription?.[1], true);
    order.length = 0;
    fireEvent.keyDown(target, { key: 'Escape' });
    expect(order).toEqual(['target']);
  });

  it('replaces the phase when capture changes without changing the subscription key', () => {
    const phases: number[] = [];
    const { rerender, unmount } = renderHook(
      ({ capture }) => {
        useGlobalEventListener('document', 'keydown', (event) => phases.push(event.eventPhase), true, 'stable', capture);
      },
      { initialProps: { capture: false } },
    );

    fireEvent.keyDown(document.body, { key: 'Escape' });
    rerender({ capture: true });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    unmount();
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(phases).toEqual([Event.BUBBLING_PHASE, Event.CAPTURING_PHASE]);
  });
});
