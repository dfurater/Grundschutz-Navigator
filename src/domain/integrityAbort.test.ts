import { afterEach, expect, it, vi } from 'vitest';
import { fetchJsonDocument, fetchProvenance } from './integrity';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(['response', 'body'])('bricht den Metadatenabruf beim Warten auf %s durch das externe Signal ab', async (phase) => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const reason = new Error('Catalog failed');
  let bodyStarted = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    const hang = () => new Promise<Response>((_resolve, reject) => {
      bodyStarted = true;
      if (init?.signal?.aborted) reject(init.signal.reason);
      else init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
    return phase === 'body' ? { ok: true, json: hang } as unknown as Response : hang();
  });
  const pending = fetchProvenance('/metadata.json', controller.signal);
  const assertion = expect(pending).rejects.toBe(reason);
  await vi.waitFor(() => expect(bodyStarted).toBe(true));
  controller.abort(reason);
  // Red-Fall nicht 60 Sekunden hängen lassen; der erwartete Abbruchgrund bleibt prüfbar.
  await vi.advanceTimersByTimeAsync(60_000);
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});

it('erhält ein bereits abgebrochenes Signal und entfernt seinen Listener nach erfolgreichem Laden', async () => {
  const controller = new AbortController();
  const reason = new Error('Already cancelled');
  controller.abort(reason);
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    if (init?.signal?.aborted) throw init.signal.reason;
    return new Response('{"ok":true}');
  });
  await expect(fetchProvenance('/metadata.json', controller.signal)).rejects.toBe(reason);
  expect(fetchSpy).toHaveBeenCalledOnce();

  const active = new AbortController();
  const remove = vi.spyOn(active.signal, 'removeEventListener');
  await expect(fetchJsonDocument('/metadata.json', 'metadata', 60_000, active.signal)).resolves.toEqual({ ok: true });
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});
