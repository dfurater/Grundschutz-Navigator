import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useClipboard } from './useClipboard';

const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();

  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

describe('useClipboard', () => {
  it('copies text and exposes the success state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy('vollständiger Wert');
    });

    expect(writeText).toHaveBeenCalledWith('vollständiger Wert');
    expect(result.current.copied).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('captures rejected writes without rejecting the returned promise', async () => {
    const clipboardError = new Error('Permission denied');
    setClipboard(vi.fn().mockRejectedValue(clipboardError));
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await expect(result.current.copy('Wert')).resolves.toBeUndefined();
    });

    expect(result.current.copied).toBe(false);
    expect(result.current.error).toBe(clipboardError);
  });

  it('reports a missing Clipboard API as an Error', async () => {
    setClipboard();
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await expect(result.current.copy('Wert')).resolves.toBeUndefined();
    });

    expect(result.current.copied).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('clears an earlier error when a retry succeeds', async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error('Permission denied'))
      .mockResolvedValueOnce(undefined);
    setClipboard(writeText);
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy('erster Versuch');
    });
    expect(result.current.error).toBeInstanceOf(Error);

    await act(async () => {
      await result.current.copy('zweiter Versuch');
    });

    expect(result.current.copied).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('resets the success state after the default 2000 milliseconds', async () => {
    vi.useFakeTimers();
    setClipboard(vi.fn().mockResolvedValue(undefined));
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy('Wert');
    });

    act(() => vi.advanceTimersByTime(1999));
    expect(result.current.copied).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.copied).toBe(false);
  });

  it('uses a custom reset interval', async () => {
    vi.useFakeTimers();
    setClipboard(vi.fn().mockResolvedValue(undefined));
    const { result } = renderHook(() => useClipboard({ resetMs: 250 }));

    await act(async () => {
      await result.current.copy('Wert');
    });

    act(() => vi.advanceTimersByTime(249));
    expect(result.current.copied).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.copied).toBe(false);
  });

  it('restarts the reset timer when copying again', async () => {
    vi.useFakeTimers();
    setClipboard(vi.fn().mockResolvedValue(undefined));
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy('erster Wert');
    });
    act(() => vi.advanceTimersByTime(1500));

    await act(async () => {
      await result.current.copy('zweiter Wert');
    });
    act(() => vi.advanceTimersByTime(500));

    expect(result.current.copied).toBe(true);

    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.copied).toBe(false);
  });

  it('ignores an older async result after a newer attempt completes', async () => {
    const olderWrite = deferred();
    const newerError = new Error('Newer write failed');
    const writeText = vi
      .fn()
      .mockImplementationOnce(() => olderWrite.promise)
      .mockRejectedValueOnce(newerError);
    setClipboard(writeText);
    const { result } = renderHook(() => useClipboard());
    let olderCopy = Promise.resolve();

    act(() => {
      olderCopy = result.current.copy('älterer Wert');
    });
    await act(async () => {
      await result.current.copy('neuerer Wert');
    });
    expect(result.current.error).toBe(newerError);

    await act(async () => {
      olderWrite.resolve();
      await olderCopy;
    });

    expect(result.current.copied).toBe(false);
    expect(result.current.error).toBe(newerError);
  });

  it('clears an active reset timer on unmount', async () => {
    vi.useFakeTimers();
    setClipboard(vi.fn().mockResolvedValue(undefined));
    const { result, unmount } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copy('Wert');
    });
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a pending write that resolves after unmount', async () => {
    vi.useFakeTimers();
    const pendingWrite = deferred();
    setClipboard(vi.fn().mockReturnValue(pendingWrite.promise));
    const { result, unmount } = renderHook(() => useClipboard());
    let copyPromise = Promise.resolve();

    act(() => {
      copyPromise = result.current.copy('Wert');
    });
    unmount();

    await act(async () => {
      pendingWrite.resolve();
      await copyPromise;
    });

    expect(vi.getTimerCount()).toBe(0);
  });
});
