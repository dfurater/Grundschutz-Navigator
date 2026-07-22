import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MouseEventHandler, SetStateAction } from 'react';

export interface UseDragToResizeOptions {
  axis: 'x' | 'y';
  edge: 'start' | 'end';
  min: number;
  max: number;
  initial: number;
}

export interface UseDragToResizeResult {
  width: number;
  isResizing: boolean;
  setWidth: Dispatch<SetStateAction<number>>;
  startResize: MouseEventHandler<HTMLElement>;
}

interface ActiveListeners {
  mouseMove: (event: MouseEvent) => void;
  mouseUp: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function useDragToResize({
  axis,
  edge,
  min,
  max,
  initial,
}: UseDragToResizeOptions): UseDragToResizeResult {
  const [width, setWidth] = useState(() => clamp(initial, min, max));
  const [isResizing, setIsResizing] = useState(false);
  const listenersRef = useRef<ActiveListeners | null>(null);

  const stopResize = useCallback((updateState = true) => {
    const listeners = listenersRef.current;
    if (!listeners) return;

    document.removeEventListener('mousemove', listeners.mouseMove);
    document.removeEventListener('mouseup', listeners.mouseUp);
    document.body.classList.remove('is-resizing');
    listenersRef.current = null;

    if (updateState) {
      setIsResizing(false);
    }
  }, []);

  useEffect(() => () => stopResize(false), [stopResize]);

  const startResize = useCallback<MouseEventHandler<HTMLElement>>((event) => {
    event.preventDefault();
    stopResize();

    const startPosition = axis === 'x' ? event.clientX : event.clientY;
    const startWidth = width;
    const direction = edge === 'end' ? 1 : -1;

    setIsResizing(true);
    document.body.classList.add('is-resizing');

    const mouseMove = (moveEvent: MouseEvent) => {
      const position = axis === 'x' ? moveEvent.clientX : moveEvent.clientY;
      setWidth(clamp(startWidth + ((position - startPosition) * direction), min, max));
    };
    const mouseUp = () => stopResize();

    listenersRef.current = { mouseMove, mouseUp };
    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('mouseup', mouseUp);
  }, [axis, edge, max, min, stopResize, width]);

  return { width, isResizing, setWidth, startResize };
}
