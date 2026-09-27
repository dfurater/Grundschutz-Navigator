import { describe, expect, it, vi } from 'vitest';
import {
  TRANSIENT_RETRY_DELAYS_MS,
  fetchWithTransientRetry,
  sleep,
} from './transientRetry.mjs';

const PINNED_URL = 'https://example.test/pinned';

describe('transienter Abruf der Lieferkettenskripte', () => {
  it('wartet zwischen den drei Versuchen 1 s und 3 s', () => {
    expect(TRANSIENT_RETRY_DELAYS_MS).toEqual([1000, 3000]);
    expect(Object.isFrozen(TRANSIENT_RETRY_DELAYS_MS)).toBe(true);
  });

  it('wiederholt einen geworfenen Transportfehler höchstens zweimal', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('UND_ERR_SOCKET: other side closed'))
      .mockRejectedValueOnce(new Error('UND_ERR_SOCKET: other side closed'))
      .mockResolvedValue(new Response('ok'));

    const result = await fetchWithTransientRetry(fetchImpl, PINNED_URL, {}, [0, 0]);

    expect(result.response.status).toBe(200);
    expect(result.attempts).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('bricht bei einem von Undici signalisierten Redirect sofort ab', async () => {
    const redirectError = new TypeError('fetch failed', {
      cause: new Error('unexpected redirect'),
    });
    const fetchImpl = vi.fn().mockRejectedValue(redirectError);

    const failure = await fetchWithTransientRetry(fetchImpl, PINNED_URL, { redirect: 'error' }, [0, 0])
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ attempts: 1, cause: redirectError });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('wiederholt HTTP 500–599, aber weder 4xx noch einen Status oberhalb 599', async () => {
    const transientFailure = vi.fn()
      .mockResolvedValueOnce(new Response('temporary failure', { status: 502 }))
      .mockResolvedValueOnce(new Response('temporary failure', { status: 599 }))
      .mockResolvedValue(new Response('ok'));
    const permanentFailure = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));
    // Der Response-Konstruktor lässt keinen Status oberhalb 599 zu; Undici
    // liefert ihn trotzdem durch, wenn ein Server ihn sendet.
    const nonStandardStatus = vi.fn().mockResolvedValue({ status: 600, ok: false });

    await expect(fetchWithTransientRetry(transientFailure, PINNED_URL, {}, [0, 0]))
      .resolves.toMatchObject({ response: { status: 200 }, attempts: 3 });
    await expect(fetchWithTransientRetry(permanentFailure, PINNED_URL, {}, [0, 0]))
      .resolves.toMatchObject({ response: { status: 403 }, attempts: 1 });
    await expect(fetchWithTransientRetry(nonStandardStatus, PINNED_URL, {}, [0, 0]))
      .resolves.toMatchObject({ response: { status: 600 }, attempts: 1 });

    expect(transientFailure).toHaveBeenCalledTimes(3);
    expect(permanentFailure).toHaveBeenCalledTimes(1);
    expect(nonStandardStatus).toHaveBeenCalledTimes(1);
  });

  it('gibt die letzte 5xx-Antwort mit ihrer Versuchszahl zurück, statt zu werfen', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('down', { status: 503 }));

    const result = await fetchWithTransientRetry(fetchImpl, PINNED_URL, {}, [0, 0]);

    expect(result.response.status).toBe(503);
    expect(result.attempts).toBe(3);
  });

  it('trägt Versuchszahl und Originalfehler an einem erschöpften Transportfehler', async () => {
    const original = new Error('UND_ERR_SOCKET https://example.test/pinned?secret=redact');
    const fetchImpl = vi.fn().mockRejectedValue(original);

    const failure = await fetchWithTransientRetry(fetchImpl, PINNED_URL, {}, [0, 0])
      .catch((error: unknown) => error);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBe(original);
    expect(failure).toMatchObject({ attempts: 3, cause: original });
  });

  it('wartet zwischen den Versuchen genau die übergebenen Verzögerungen', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('down', { status: 500 }));
      const pending = fetchWithTransientRetry(fetchImpl, PINNED_URL, {}, [10, 30]);

      await vi.advanceTimersByTimeAsync(9);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(30);
      await expect(pending).resolves.toMatchObject({ attempts: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('löst sleep erst nach der angegebenen Zeit auf', async () => {
    vi.useFakeTimers();
    try {
      let resolved = false;
      const pending = sleep(50).then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(49);
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
