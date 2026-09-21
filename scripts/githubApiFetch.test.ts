import { describe, expect, it, vi } from 'vitest';
import { fetchGitHubJson } from './githubApiFetch.mjs';

const URL = 'https://api.github.com/repos/dfurater/Grundschutz-Navigator/commits/abc123';
const LABEL = 'probe lookup';

function okResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload };
}

describe('fetchGitHubJson', () => {
  it('liefert das parsebare JSON und sendet den Token als Bearer', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ sha: 'abc123' }));
    const payload = await fetchGitHubJson(URL, {
      fetchImpl,
      token: 'geheim',
      label: LABEL,
      requestTimeoutMs: 30_000,
    });

    expect(payload).toEqual({ sha: 'abc123' });
    const [, options] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string>; signal: AbortSignal }];
    expect(options.headers.Authorization).toBe('Bearer geheim');
    expect(options.headers.Accept).toBe('application/vnd.github+json');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('sendet ohne Token keinen Authorization-Header', async () => {
    const fetchImpl = vi.fn(async () => okResponse({}));
    await fetchGitHubJson(URL, { fetchImpl, label: LABEL, requestTimeoutMs: 30_000 });

    const [, options] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(options.headers).not.toHaveProperty('Authorization');
  });

  it('meldet Netzwerkfehler mit Ursache statt sie zu verschlucken', async () => {
    const failure = new TypeError('fetch failed');
    const fetchImpl = vi.fn(async () => {
      throw failure;
    });

    const error = await fetchGitHubJson(URL, {
      fetchImpl,
      label: LABEL,
      requestTimeoutMs: 30_000,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`${LABEL} failed: fetch failed`);
    expect((error as Error).cause).toBe(failure);
  });

  it('meldet Nicht-Error-Abbrüche als Netzwerkfehler und bewahrt die Ursache', async () => {
    const fetchImpl = vi.fn(async (): Promise<never> => {
      throw 'boom';
    });

    const error = await fetchGitHubJson(URL, {
      fetchImpl,
      label: LABEL,
      requestTimeoutMs: 30_000,
    }).catch((cause: unknown) => cause);

    expect((error as Error).message).toBe(`${LABEL} failed: network error`);
    expect((error as Error).cause).toBe('boom');
  });

  it('meldet HTTP-Fehler mit Status statt sie zu parsen', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));

    await expect(
      fetchGitHubJson(URL, { fetchImpl, label: LABEL, requestTimeoutMs: 30_000 }),
    ).rejects.toThrow(`${LABEL} failed with HTTP 403`);
  });

  it('meldet unparsebares JSON statt es weiterzureichen', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }));

    await expect(
      fetchGitHubJson(URL, { fetchImpl, label: LABEL, requestTimeoutMs: 30_000 }),
    ).rejects.toThrow(`${LABEL} returned invalid JSON`);
  });
});
