import { act, fireEvent, renderHook } from '@testing-library/react';
import type {
  MouseEvent as ReactMouseEvent,
  MouseEventHandler,
} from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDragToResize } from './useDragToResize';

function beginResize(
  startResize: MouseEventHandler<HTMLElement>,
  { clientX = 0, clientY = 0 }: { clientX?: number; clientY?: number },
) {
  const preventDefault = vi.fn();

  act(() => {
    startResize({
      clientX,
      clientY,
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
    expect(result.current.width).toBe(260);

    fireEvent.mouseUp(document);
    expect(result.current.isResizing).toBe(false);
    expect(document.body).not.toHaveClass('is-resizing');

    fireEvent.mouseMove(document, { clientX: 200 });
    expect(result.current.width).toBe(260);
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
    expect(result.current.width).toBe(300);

    fireEvent.mouseMove(document, { clientX: -500 });
    expect(result.current.width).toBe(100);
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
    expect(result.current.width).toBe(300);

    fireEvent.mouseMove(document, { clientX: 400 });
    expect(result.current.width).toBe(100);
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

    expect(result.current.width).toBe(190);
  });

  it('removes document listeners and the body class when unmounted mid-drag', () => {
    const addEventListener = vi.spyOn(document, 'addEventListener');
    const removeEventListener = vi.spyOn(document, 'removeEventListener');
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

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('mousemove', mouseMoveListener);
    expect(removeEventListener).toHaveBeenCalledWith('mouseup', mouseUpListener);
    expect(document.body).not.toHaveClass('is-resizing');
  });
});
