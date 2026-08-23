import { describe, expect, it, vi } from 'vitest';
import {
  DEPLOY_CONFIRMED,
  FALLBACK_REQUIRED,
  findPushDeployRun,
  stripControlCharacters,
  verifyCatalogDeploy,
} from './verify-catalog-deploy.mjs';

const REPOSITORY = 'dfurater/Grundschutz-Navigator';
const MERGE_SHA = '0433321ebd0de1758f1ab6fae083d1aa1abfccf0';
const SNAPSHOT_SHA = '12abb438fcdb4f4b63fb3e751e89d7c526e647b5';
const SIGNATURE = 'a'.repeat(64);

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 29871256790,
    head_sha: MERGE_SHA,
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    html_url: 'https://github.com/dfurater/Grundschutz-Navigator/actions/runs/29871256790',
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => payload };
}

function encodeManifest(manifest: unknown) {
  return {
    encoding: 'base64',
    content: Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64'),
  };
}

/**
 * Routes requests by URL shape so tests describe API state rather than call order.
 * `runSequence` is consumed one entry per run-status poll.
 */
function makeFetch({
  discovered = [] as Array<ReturnType<typeof makeRun> | undefined>,
  runSequence = [] as Array<ReturnType<typeof makeRun>>,
  compareStatus = 'behind',
  manifest = { snapshotCommitSha: SNAPSHOT_SHA, signatureSha256: SIGNATURE } as unknown,
} = {}) {
  const discoveries = [...discovered];
  const runs = [...runSequence];
  return vi.fn(async (url: string) => {
    if (url.includes('/actions/workflows/')) {
      const run = discoveries.length > 0 ? discoveries.shift() : undefined;
      return jsonResponse({ workflow_runs: run ? [run] : [] });
    }
    if (url.includes('/actions/runs/')) {
      return jsonResponse(runs.shift() ?? makeRun());
    }
    if (url.includes('/compare/')) {
      return jsonResponse({ status: compareStatus });
    }
    if (url.includes('/contents/')) {
      return jsonResponse(encodeManifest(manifest));
    }
    throw new Error(`unexpected request: ${url}`);
  });
}

function options(fetchImpl: ReturnType<typeof makeFetch>, overrides = {}) {
  return {
    repository: REPOSITORY,
    mergeCommitSha: MERGE_SHA,
    snapshotSha: SNAPSHOT_SHA,
    signature: SIGNATURE,
    fetchImpl,
    token: 'opaque-test-token',
    sleep: async () => {},
    log: () => {},
    ...overrides,
  };
}

describe('findPushDeployRun', () => {
  it('rejects an abbreviated SHA, which the GitHub API silently fails to match', async () => {
    await expect(
      findPushDeployRun(REPOSITORY, '0433321', { fetchImpl: makeFetch() }),
    ).rejects.toThrow('full 40-character SHA');
  });

  it('rejects a run whose head_sha does not match the merge commit', async () => {
    const fetchImpl = makeFetch({ discovered: [makeRun({ head_sha: 'b'.repeat(40) })] });
    await expect(findPushDeployRun(REPOSITORY, MERGE_SHA, { fetchImpl })).rejects.toThrow(
      'reports head_sha',
    );
  });

  it('surfaces API failures instead of treating them as "no deploy found"', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 503));
    await expect(findPushDeployRun(REPOSITORY, MERGE_SHA, { fetchImpl })).rejects.toThrow(
      'deploy run lookup failed with HTTP 503',
    );
  });
});

describe('verifyCatalogDeploy — push deploy exists', () => {
  it('confirms a deploy that completed successfully', async () => {
    const fetchImpl = makeFetch({ discovered: [makeRun()] });
    await expect(verifyCatalogDeploy(options(fetchImpl))).resolves.toBe(DEPLOY_CONFIRMED);
  });

  it('waits for an in-progress deploy to reach a terminal state', async () => {
    const fetchImpl = makeFetch({
      discovered: [makeRun({ status: 'in_progress', conclusion: null })],
      runSequence: [makeRun({ status: 'in_progress', conclusion: null }), makeRun()],
    });
    await expect(verifyCatalogDeploy(options(fetchImpl))).resolves.toBe(DEPLOY_CONFIRMED);
  });

  it('fails when the deploy completed with a non-success conclusion', async () => {
    const fetchImpl = makeFetch({ discovered: [makeRun({ conclusion: 'failure' })] });
    await expect(verifyCatalogDeploy(options(fetchImpl))).rejects.toThrow(
      'completed with conclusion failure',
    );
  });

  it('fails when a discovered deploy never reaches a terminal state', async () => {
    const pending = makeRun({ status: 'in_progress', conclusion: null });
    const fetchImpl = makeFetch({
      discovered: [pending],
      runSequence: [pending, pending, pending],
    });
    await expect(
      verifyCatalogDeploy(options(fetchImpl, { terminalAttempts: 3 })),
    ).rejects.toThrow('did not reach a terminal state');
  });

  it('does not dispatch a fallback when a deploy was found', async () => {
    const fetchImpl = makeFetch({ discovered: [makeRun()] });
    await verifyCatalogDeploy(options(fetchImpl));
    const urls = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes('/compare/') || url.includes('/contents/'))).toBe(false);
  });

  it('picks up a deploy that only appears on a later discovery attempt', async () => {
    const fetchImpl = makeFetch({ discovered: [undefined, undefined, makeRun()] });
    await expect(
      verifyCatalogDeploy(options(fetchImpl, { discoveryAttempts: 3 })),
    ).resolves.toBe(DEPLOY_CONFIRMED);
  });
});

describe('verifyCatalogDeploy — no push deploy', () => {
  it('requires a fallback once merge commit and manifest are re-verified on main', async () => {
    const fetchImpl = makeFetch();
    await expect(
      verifyCatalogDeploy(options(fetchImpl, { discoveryAttempts: 2 })),
    ).resolves.toBe(FALLBACK_REQUIRED);
  });

  it('refuses the fallback when the merge commit is no longer on main', async () => {
    const fetchImpl = makeFetch({ compareStatus: 'diverged' });
    await expect(
      verifyCatalogDeploy(options(fetchImpl, { discoveryAttempts: 1 })),
    ).rejects.toThrow('no longer verifiably on main');
  });

  it('refuses the fallback when main carries a different snapshot', async () => {
    const fetchImpl = makeFetch({
      manifest: { snapshotCommitSha: 'c'.repeat(40), signatureSha256: SIGNATURE },
    });
    await expect(
      verifyCatalogDeploy(options(fetchImpl, { discoveryAttempts: 1 })),
    ).rejects.toThrow('no longer contains the verified manifest');
  });

  it('refuses the fallback when the manifest signature differs', async () => {
    const fetchImpl = makeFetch({
      manifest: { snapshotCommitSha: SNAPSHOT_SHA, signatureSha256: 'd'.repeat(64) },
    });
    await expect(
      verifyCatalogDeploy(options(fetchImpl, { discoveryAttempts: 1 })),
    ).rejects.toThrow('no longer contains the verified manifest');
  });

  it('checks the merge commit before reading the manifest', async () => {
    const fetchImpl = makeFetch({ compareStatus: 'diverged' });
    await expect(
      verifyCatalogDeploy(options(fetchImpl, { discoveryAttempts: 1 })),
    ).rejects.toThrow();
    const urls = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes('/contents/'))).toBe(false);
  });

  it('exhausts the configured discovery attempts before falling back', async () => {
    const fetchImpl = makeFetch();
    await verifyCatalogDeploy(options(fetchImpl, { discoveryAttempts: 4 }));
    const lookups = fetchImpl.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/actions/workflows/'));
    // Four discovery attempts plus the late-registration re-check.
    expect(lookups).toHaveLength(5);
  });

  it('confirms instead of dispatching when the deploy registers during re-verification', async () => {
    const fetchImpl = makeFetch({ discovered: [undefined, makeRun()] });
    await expect(
      verifyCatalogDeploy(options(fetchImpl, { discoveryAttempts: 1 })),
    ).resolves.toBe(DEPLOY_CONFIRMED);
  });

  it('fails on a late-registered deploy that did not succeed', async () => {
    const fetchImpl = makeFetch({
      discovered: [undefined, makeRun({ conclusion: 'failure' })],
    });
    await expect(
      verifyCatalogDeploy(options(fetchImpl, { discoveryAttempts: 1 })),
    ).rejects.toThrow('completed with conclusion failure');
  });
});

describe('stripControlCharacters', () => {
  it('strips control characters so API-derived text cannot forge log lines', () => {
    const forged = 'deploy run 1 failed: HTTP 500\u001b]0;pwned\u0007 / status x';
    expect(stripControlCharacters(forged)).toBe('deploy run 1 failed: HTTP 500]0;pwned / status x');
  });

  it('also strips DEL and line breaks, but keeps readable text including umlauts', () => {
    expect(stripControlCharacters('Zeile 1\nZeile 2\u007f')).toBe('Zeile 1Zeile 2');
    expect(stripControlCharacters('Verifikation fehlgeschlagen: Manifest ≠ erwartet ✓')).toBe(
      'Verifikation fehlgeschlagen: Manifest ≠ erwartet ✓',
    );
  });

  it('passes non-string values through unchanged, like console.error would', () => {
    const sentinel = { unexpected: true };
    expect(stripControlCharacters(sentinel)).toBe(sentinel);
    expect(stripControlCharacters(undefined)).toBe(undefined);
  });
});
