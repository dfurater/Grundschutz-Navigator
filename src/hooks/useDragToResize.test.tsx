import { act, fireEvent, renderHook } from '@testing-library/react';
import type {
  MouseEvent as ReactMouseEvent,
  MouseEventHandler,
} from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDragToResize } from './useDragToResize';

function beginResize(
  startResize: MouseEventHandler<HTMLElement>,
  { clientX = 0, clientY = 0, button = 0 }: { clientX?: number; clientY?: number; button?: number },
) {
  const preventDefault = vi.fn();

  act(() => {
    startResize({
      clientX,
      clientY,
      button,
      preventDefault,
    } as unknown as ReactMouseEvent<HTMLElement>);
  });

  return preventDefault;
}

afterEach(() => {
  document.body.classList.remove('is-resizing');
  vi.restoreAllMocks();
});

describe('useDragToResize', () => {
  it('resizes from an end edge and manages resize state until mouseup', () => {
    const { result } = renderHook(() => useDragToResize({
      axis: 'x',
      edge: 'end',
      min: 100,
      max: 300,
      initial: 200,
    }));

    const preventDefault = beginResize(result.current.startResize, { clientX: 100 });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(result.current.isResizing).toBe(true);
    expect(document.body).toHaveClass('is-resizing');

    fireEvent.mouseMove(document, { clientX: 160 });
    expect(result.current.size).toBe(260);

    fireEvent.mouseUp(document);
    expect(result.current.isResizing).toBe(false);
    expect(document.body).not.toHaveClass('is-resizing');

    fireEvent.mouseMove(document, { clientX: 200 });
    expect(result.current.size).toBe(260);
  });

  it('clamps drag updates to the configured minimum and maximum', () => {
    const { result } = renderHook(() => useDragToResize({
      axis: 'x',
      edge: 'end',
      min: 100,
      max: 300,
      initial: 200,
    }));

    beginResize(result.current.startResize, { clientX: 100 });

    fireEvent.mouseMove(document, { clientX: 500 });
    expect(result.current.size).toBe(300);

    fireEvent.mouseMove(document, { clientX: -500 });
    expect(result.current.size).toBe(100);
  });

  it('reverses the drag direction for a start edge', () => {
    const { result } = renderHook(() => useDragToResize({
      axis: 'x',
      edge: 'start',
      min: 100,
      max: 300,
      initial: 200,
    }));

    beginResize(result.current.startResize, { clientX: 200 });

    fireEvent.mouseMove(document, { clientX: 100 });
    expect(result.current.size).toBe(300);

    fireEvent.mouseMove(document, { clientX: 400 });
    expect(result.current.size).toBe(100);
  });

  it('uses vertical coordinates when configured for the y axis', () => {
    const { result } = renderHook(() => useDragToResize({
      axis: 'y',
      edge: 'end',
      min: 100,
      max: 300,
      initial: 150,
    }));

    beginResize(result.current.startResize, { clientY: 80 });
    fireEvent.mouseMove(document, { clientY: 120 });

    expect(result.current.size).toBe(190);
  });

  it('ignores middle and right clicks entirely', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const { result } = renderHook(() => useDragToResize({
      axis: 'x',
      edge: 'end',
      min: 100,
      max: 300,
      initial: 200,
    }));

    for (const button of [1, 2]) {
      const preventDefault = beginResize(result.current.startResize, { clientX: 100, button });
      expect(preventDefault).not.toHaveBeenCalled();
    }

    expect(result.current.isResizing).toBe(false);
    expect(document.body).not.toHaveClass('is-resizing');
    expect(addEventListener).not.toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(addEventListener).not.toHaveBeenCalledWith('mouseup', expect.any(Function));

    fireEvent.mouseMove(document, { clientX: 160 });
    expect(result.current.size).toBe(200);
  });

  it('ends the previous session exclusively when a new instance starts resizing', async () => {
    const first = renderHook(() => useDragToResize({
      axis: 'x',
      edge: 'end',
      min: 100,
      max: 300,
      initial: 200,
    }));
    const second = renderHook(() => useDragToResize({
      axis: 'x',
      edge: 'end',
      min: 100,
      max: 300,
      initial: 200,
    }));

    beginResize(first.result.current.startResize, { clientX: 100 });
    beginResize(second.result.current.startResize, { clientX: 100 });

    // Beide Instanzen hängen an eigenen Render-Roots; der State-Stopp der
    // ersten Sitzung wird erst mit einem Flush sichtbar.
    await act(async () => {});

    // Die neue Sitzung hat die alte deterministisch beendet.
    expect(first.result.current.isResizing).toBe(false);
    expect(second.result.current.isResizing).toBe(true);
    expect(document.body).toHaveClass('is-resizing');

    // Höchstens eine Sitzung verarbeitet mousemove: nur die neue.
    fireEvent.mouseMove(document, { clientX: 150 });
    expect(first.result.current.size).toBe(200);
    expect(second.result.current.size).toBe(250);

    // Das Unmounten der beendeten Instanz nimmt der aktiven Sitzung nichts weg.
    first.unmount();
    expect(document.body).toHaveClass('is-resizing');
    fireEvent.mouseMove(document, { clientX: 180 });
    expect(second.result.current.size).toBe(280);

    second.unmount();
    expect(document.body).not.toHaveClass('is-resizing');
  });

  it('ends the active session on window blur, idempotently', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const { result } = renderHook(() => useDragToResize({
      axis: 'x',
      edge: 'end',
      min: 100,
      max: 300,
      initial: 200,
    }));

    beginResize(result.current.startResize, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 140 });
    expect(result.current.size).toBe(240);

    const blurListener = addEventListener.mock.calls.find(
      ([type]) => type === 'blur',
    )?.[1];

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(result.current.isResizing).toBe(false);
    expect(document.body).not.toHaveClass('is-resizing');

    // Idempotent: Ein zweites blur ohne aktive Sitzung bleibt wirkungslos.
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    fireEvent.mouseMove(document, { clientX: 200 });
    expect(result.current.size).toBe(240);

    // Der Blur-Listener wurde mit dem Sitzungsende exakt entfernt.
    expect(removeEventListener).toHaveBeenCalledWith('blur', blurListener);
  });

  it('removes document and window listeners and the body class when unmounted mid-drag', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
    const addWindowEventListener = vi.spyOn(window, 'addEventListener');
    const removeWindowEventListener = vi.spyOn(window, 'removeEventListener');
    const { result, unmount } = renderHook(() => useDragToResize({
      axis: 'x',
      edge: 'end',
      min: 100,
      max: 300,
      initial: 200,
    }));

    beginResize(result.current.startResize, { clientX: 100 });

    const mouseMoveListener = addEventListener.mock.calls.find(
      ([type]) => type === 'mousemove',
    )?.[1];
    const mouseUpListener = addEventListener.mock.calls.find(
      ([type]) => type === 'mouseup',
    )?.[1];
    const blurListener = addWindowEventListener.mock.calls.find(
      ([type]) => type === 'blur',
    )?.[1];

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('mousemove', mouseMoveListener);
    expect(removeEventListener).toHaveBeenCalledWith('mouseup', mouseUpListener);
    expect(removeWindowEventListener).toHaveBeenCalledWith('blur', blurListener);
    expect(document.body).not.toHaveClass('is-resizing');
  });
});
