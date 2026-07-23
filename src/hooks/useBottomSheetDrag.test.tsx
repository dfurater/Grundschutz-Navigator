import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBottomSheetDrag } from './useBottomSheetDrag';

function ref<T>(current: T): RefObject<T> {
  return { current };
}

function touchEvent(type: string, clientY: number): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: [{ clientY }],
  });
  return event as TouchEvent;
}

function setupSheet() {
  const sheet = document.createElement('aside');
  const backdrop = document.createElement('div');
  const handle = document.createElement('div');
  Object.defineProperty(sheet, 'offsetHeight', { value: 400 });
  document.body.append(backdrop, sheet);
  sheet.append(handle);

  return {
    sheet,
    backdrop,
    handle,
    sheetRef: ref<HTMLElement | null>(sheet),
    backdropRef: ref<HTMLDivElement | null>(backdrop),
    handleRef: ref<HTMLDivElement | null>(handle),
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useBottomSheetDrag', () => {
  it('attaches native touch listeners with iOS-safe options and removes them', () => {
    const refs = setupSheet();
    const onDismiss = vi.fn();
    let active = false;
    const addEventListener = vi.spyOn(refs.handle, 'addEventListener');
    const removeEventListener = vi.spyOn(refs.handle, 'removeEventListener');

    const { rerender, unmount } = renderHook(() => useBottomSheetDrag({
      ...refs,
      active,
      onDismiss,
    }));

    expect(addEventListener).not.toHaveBeenCalledWith(
      'touchstart', expect.any(Function), expect.anything(),
    );

    active = true;
    rerender();

    expect(addEventListener).toHaveBeenCalledWith(
      'touchstart', expect.any(Function), { passive: true },
    );
    expect(addEventListener).toHaveBeenCalledWith(
      'touchmove', expect.any(Function), { passive: false },
    );
    expect(addEventListener).toHaveBeenCalledWith(
      'touchend', expect.any(Function), { passive: true },
    );
    expect(addEventListener).toHaveBeenCalledWith(
      'touchcancel', expect.any(Function), { passive: true },
    );

    const listeners = Object.fromEntries(addEventListener.mock.calls.map(
      ([type, listener]) => [type, listener],
    ));
    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('touchstart', listeners.touchstart);
    expect(removeEventListener).toHaveBeenCalledWith('touchmove', listeners.touchmove);
    expect(removeEventListener).toHaveBeenCalledWith('touchend', listeners.touchend);
    expect(removeEventListener).toHaveBeenCalledWith('touchcancel', listeners.touchcancel);
  });

  it('applies downward movement and fades the backdrop proportionally', () => {
    const refs = setupSheet();
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_100);
    renderHook(() => useBottomSheetDrag({ ...refs, onDismiss: vi.fn() }));

    refs.handle.dispatchEvent(touchEvent('touchstart', 100));
    const move = touchEvent('touchmove', 200);
    refs.handle.dispatchEvent(move);

    expect(move.defaultPrevented).toBe(true);
    expect(refs.sheet.style.transform).toBe('translateY(100px)');
    expect(Number(refs.backdrop.style.opacity)).toBeCloseTo(0.225);
  });

  it('rubber-bands upward movement without fading the backdrop', () => {
    const refs = setupSheet();
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_100);
    renderHook(() => useBottomSheetDrag({ ...refs, onDismiss: vi.fn() }));

    refs.handle.dispatchEvent(touchEvent('touchstart', 100));
    refs.handle.dispatchEvent(touchEvent('touchmove', 50));

    expect(refs.sheet.style.transform).toBe('translateY(-6px)');
    expect(refs.backdrop.style.opacity).toBe('0.3');
  });

  it('dismisses beyond the default 30% distance threshold after the animation', () => {
    vi.useFakeTimers();
    const refs = setupSheet();
    const onDismiss = vi.fn();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    renderHook(() => useBottomSheetDrag({ ...refs, onDismiss }));

    refs.handle.dispatchEvent(touchEvent('touchstart', 100));
    refs.handle.dispatchEvent(touchEvent('touchmove', 221));
    refs.handle.dispatchEvent(touchEvent('touchend', 221));

    expect(refs.sheet.style.transform).toBe('translateY(400px)');
    expect(refs.backdrop.style.opacity).toBe('0');
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(200));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('supports a custom velocity threshold independently of distance', () => {
    vi.useFakeTimers();
    const refs = setupSheet();
    const onDismiss = vi.fn();
    renderHook(() => useBottomSheetDrag({
      ...refs,
      onDismiss,
      dismissThresholdPx: 300,
      dismissVelocity: 500,
    }));

    vi.setSystemTime(1_000);
    refs.handle.dispatchEvent(touchEvent('touchstart', 100));
    vi.setSystemTime(1_050);
    refs.handle.dispatchEvent(touchEvent('touchmove', 130));
    refs.handle.dispatchEvent(touchEvent('touchend', 130));
    act(() => vi.advanceTimersByTime(200));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('supports an absolute custom distance threshold', () => {
    vi.useFakeTimers();
    const refs = setupSheet();
    const onDismiss = vi.fn();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    renderHook(() => useBottomSheetDrag({
      ...refs,
      onDismiss,
      dismissThresholdPx: 50,
      dismissVelocity: Number.POSITIVE_INFINITY,
    }));

    refs.handle.dispatchEvent(touchEvent('touchstart', 100));
    refs.handle.dispatchEvent(touchEvent('touchmove', 160));
    refs.handle.dispatchEvent(touchEvent('touchend', 160));
    act(() => vi.advanceTimersByTime(200));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('resets sheet and backdrop to rest state when the gesture is cancelled', () => {
    vi.useFakeTimers();
    const refs = setupSheet();
    const onDismiss = vi.fn();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    renderHook(() => useBottomSheetDrag({ ...refs, onDismiss }));

    refs.handle.dispatchEvent(touchEvent('touchstart', 100));
    refs.handle.dispatchEvent(touchEvent('touchmove', 260));
    refs.handle.dispatchEvent(new Event('touchcancel', { bubbles: true }));

    expect(refs.sheet.style.transform).toBe('');
    expect(refs.sheet.style.transition).toContain('transform');
    expect(refs.backdrop.style.opacity).toBe('0.3');
    act(() => vi.runAllTimers());
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('allows a fresh gesture to start immediately after a cancel', () => {
    vi.useFakeTimers();
    const refs = setupSheet();
    const onDismiss = vi.fn();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    renderHook(() => useBottomSheetDrag({ ...refs, onDismiss }));

    refs.handle.dispatchEvent(touchEvent('touchstart', 100));
    refs.handle.dispatchEvent(touchEvent('touchmove', 260));
    refs.handle.dispatchEvent(new Event('touchcancel', { bubbles: true }));

    // A new drag past the threshold dismisses normally, proving state was reset.
    refs.handle.dispatchEvent(touchEvent('touchstart', 100));
    refs.handle.dispatchEvent(touchEvent('touchmove', 221));
    refs.handle.dispatchEvent(touchEvent('touchend', 221));

    expect(refs.sheet.style.transform).toBe('translateY(400px)');
    act(() => vi.advanceTimersByTime(200));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('snaps back when distance and velocity stay below their thresholds', () => {
    vi.useFakeTimers();
    const refs = setupSheet();
    const onDismiss = vi.fn();
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_200);
    renderHook(() => useBottomSheetDrag({ ...refs, onDismiss }));

    refs.handle.dispatchEvent(touchEvent('touchstart', 100));
    refs.handle.dispatchEvent(touchEvent('touchmove', 140));
    refs.handle.dispatchEvent(touchEvent('touchend', 140));

    expect(refs.sheet.style.transform).toBe('');
    expect(refs.backdrop.style.opacity).toBe('0.3');
    act(() => vi.runAllTimers());
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
