import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseClipboardOptions {
  resetMs?: number;
}

export interface UseClipboardResult {
  copy: (text: string) => Promise<void>;
  copied: boolean;
  error: Error | null;
}

function normalizeClipboardError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Clipboard write failed.');
}

export function useClipboard({ resetMs = 2000 }: UseClipboardOptions = {}): UseClipboardResult {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      attemptRef.current += 1;
      clearResetTimer();
    };
  }, [clearResetTimer]);

  const copy = useCallback(async (text: string) => {
    if (!mountedRef.current) {
      return;
    }

    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    clearResetTimer();
    setCopied(false);
    setError(null);

    try {
      if (typeof navigator === 'undefined' || typeof navigator.clipboard?.writeText !== 'function') {
        throw new TypeError('Clipboard API is not available.');
      }

      await navigator.clipboard.writeText(text);
    } catch (cause) {
      if (mountedRef.current && attemptRef.current === attempt) {
        setError(normalizeClipboardError(cause));
      }
      return;
    }

    if (!mountedRef.current || attemptRef.current !== attempt) {
      return;
    }

    setCopied(true);
    resetTimerRef.current = setTimeout(() => {
      if (mountedRef.current && attemptRef.current === attempt) {
        setCopied(false);
      }
      resetTimerRef.current = null;
    }, resetMs);
  }, [clearResetTimer, resetMs]);

  return { copy, copied, error };
}
