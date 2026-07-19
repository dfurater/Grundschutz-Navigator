import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  OFFICIAL_BSI_REPOSITORY_URL,
  computeManifestSignature,
  guardCatalogSyncPullRequest,
  parseNameStatusDiff,
  validateCatalogSyncManifest,
  validateCatalogSyncPullRequest,
  verifySnapshotProgress,
} from './catalog-sync-guard.mjs';
import { OFFICIAL_CATALOG_PATH } from './security-guards.mjs';

const OLD_SHA = '1'.repeat(40);
const NEW_SHA = '2'.repeat(40);
const NAMESPACE_BLOB_SHA = '4'.repeat(40);
const CATALOG_DOCUMENT = {
  catalog: {
    metadata: {
      ns: `${OFFICIAL_BSI_REPOSITORY_URL}/tree/main/Dokumentation/namespaces/result.csv`,
    },
  },
};
const CATALOG_CONTENTS = Buffer.from(JSON.stringify(CATALOG_DOCUMENT));
const CATALOG_BLOB_SHA = createHash('sha1')
  .update(`blob ${CATALOG_CONTENTS.length}\0`)
  .update(CATALOG_CONTENTS)
  .digest('hex');

function signManifest(manifest: Record<string, unknown>) {
  const payload = {
    repository: manifest.repository,
    snapshotCommitSha: manifest.snapshotCommitSha,
    catalogPath: manifest.catalogPath,
    files: manifest.files,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function makeManifest(snapshotCommitSha = NEW_SHA) {
  const manifest = {
    repository: OFFICIAL_BSI_REPOSITORY_URL,
    snapshotCommitSha,
    catalogPath: OFFICIAL_CATALOG_PATH,
    files: [
      {
        kind: 'catalog',
        path: OFFICIAL_CATALOG_PATH,
        gitBlobSha: CATALOG_BLOB_SHA,
      },
      {
        kind: 'namespace',
        path: 'Dokumentation/namespaces/result.csv',
        namespace: `${OFFICIAL_BSI_REPOSITORY_URL}/tree/main/Dokumentation/namespaces/result.csv`,
        gitBlobSha: NAMESPACE_BLOB_SHA,
      },
    ],
    signatureSha256: '',
  };
  manifest.signatureSha256 = signManifest(manifest);
  return manifest;
}

function makeResponse(body: unknown, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

function makeAheadFetch() {
  return vi.fn()
    .mockResolvedValueOnce(makeResponse({ sha: NEW_SHA }))
    .mockResolvedValueOnce(makeResponse({ status: 'ahead' }))
    .mockResolvedValueOnce(makeResponse({
      truncated: false,
      tree: [
        { type: 'blob', path: OFFICIAL_CATALOG_PATH, sha: CATALOG_BLOB_SHA },
        {
          type: 'blob',
          path: 'Dokumentation/namespaces/result.csv',
          sha: NAMESPACE_BLOB_SHA,
        },
      ],
    }))
    .mockResolvedValueOnce(makeResponse({
      sha: CATALOG_BLOB_SHA,
      encoding: 'base64',
      content: CATALOG_CONTENTS.toString('base64'),
    }));
}

describe('validateCatalogSyncManifest', () => {
  it('accepts the exact catalog contract and canonical signature', () => {
    const manifest = makeManifest();
    expect(validateCatalogSyncManifest(manifest)).toEqual(manifest);
    expect(computeManifestSignature(manifest)).toBe(manifest.signatureSha256);
  });

  it('rejects schema additions and a manipulated signature', () => {
    expect(() => validateCatalogSyncManifest({ ...makeManifest(), unexpected: true })).toThrow(
      'unexpected or missing fields',
    );
    expect(() => validateCatalogSyncManifest({
      ...makeManifest(),
      signatureSha256: 'f'.repeat(64),
    })).toThrow('canonical payload');
  });

  it.each([
    '/Dokumentation/namespaces/result.csv',
    'Dokumentation/namespaces/../result.csv',
    'Dokumentation\\namespaces\\result.csv',
    'Dokumentation/namespaces/nested/result.csv',
  ])('rejects unsafe or out-of-contract path %s', (unsafePath) => {
    const manifest = makeManifest();
    manifest.files[1] = {
      ...manifest.files[1],
      path: unsafePath,
      namespace: `${OFFICIAL_BSI_REPOSITORY_URL}/tree/main/${unsafePath}`,
    };
    manifest.signatureSha256 = signManifest(manifest);
    expect(() => validateCatalogSyncManifest(manifest)).toThrow();
  });

  it('rejects duplicate manifest paths', () => {
    const manifest = makeManifest();
    manifest.files.push({ ...manifest.files[1] });
    manifest.signatureSha256 = signManifest(manifest);
    expect(() => validateCatalogSyncManifest(manifest)).toThrow('duplicate path');
  });
});

describe('catalog sync PR shape', () => {
  const validShape = {
    branch: `chore/catalog-sync-${NEW_SHA.slice(0, 12)}`,
    title: `chore(ci): BSI-Katalog-Sync ${NEW_SHA.slice(0, 12)}`,
    diffEntries: [{ status: 'M', path: 'upstream-manifest.json' }],
  };

  it('accepts exactly one modified manifest', () => {
    expect(() => validateCatalogSyncPullRequest(validShape)).not.toThrow();
    expect(parseNameStatusDiff('M\tupstream-manifest.json\n')).toEqual(validShape.diffEntries);
  });

  it('rejects an invalid branch', () => {
    expect(() => validateCatalogSyncPullRequest({
      ...validShape,
      branch: 'feature/catalog-sync-222222222222',
    })).toThrow('branch must match');
  });

  it.each([
    [{ status: 'A', path: 'upstream-manifest.json' }],
    [{ status: 'D', path: 'upstream-manifest.json' }],
    [{ status: 'R100', path: 'upstream-manifest.json' }],
    [
      { status: 'M', path: 'upstream-manifest.json' },
      { status: 'A', path: 'scripts/extra.mjs' },
    ],
  ])('rejects added, deleted, renamed, or additional paths', (diffEntries) => {
    expect(() => validateCatalogSyncPullRequest({ ...validShape, diffEntries })).toThrow(
      'must modify exactly upstream-manifest.json',
    );
  });

  it('lets a normal PR pass without manifest or network work', async () => {
    const fetchImpl = vi.fn();
    await expect(guardCatalogSyncPullRequest({
      branch: 'feature/ui-copy',
      title: 'feat: improve copy',
      diffEntries: [{ status: 'M', path: 'src/App.tsx' }],
      previousManifest: undefined,
      nextManifest: undefined,
      fetchImpl,
    })).resolves.toEqual({ catalogSync: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('checks the old and new snapshot for a valid sync PR', async () => {
    const fetchImpl = makeAheadFetch();
    await expect(guardCatalogSyncPullRequest({
      ...validShape,
      previousManifest: makeManifest(OLD_SHA),
      nextManifest: makeManifest(NEW_SHA),
      fetchImpl,
    })).resolves.toEqual({ catalogSync: true, snapshotCommitSha: NEW_SHA });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('rejects a manifest that omits catalog-referenced namespaces', async () => {
    const nextManifest = makeManifest(NEW_SHA);
    nextManifest.files = nextManifest.files.slice(0, 1);
    nextManifest.signatureSha256 = signManifest(nextManifest);
    await expect(guardCatalogSyncPullRequest({
      ...validShape,
      previousManifest: makeManifest(OLD_SHA),
      nextManifest,
      fetchImpl: makeAheadFetch(),
    })).rejects.toThrow('namespace inventory');
  });

  it('rejects manifest blob SHAs that do not match the selected snapshot', async () => {
    const nextManifest = makeManifest(NEW_SHA);
    nextManifest.files[1].gitBlobSha = '5'.repeat(40);
    nextManifest.signatureSha256 = signManifest(nextManifest);
    await expect(guardCatalogSyncPullRequest({
      ...validShape,
      previousManifest: makeManifest(OLD_SHA),
      nextManifest,
      fetchImpl: makeAheadFetch(),
    })).rejects.toThrow('blob SHA does not match');
  });

  it('fails closed when GitHub returns a truncated snapshot tree', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(makeResponse({ sha: NEW_SHA }))
      .mockResolvedValueOnce(makeResponse({ status: 'ahead' }))
      .mockResolvedValueOnce(makeResponse({ truncated: true, tree: [] }));
    await expect(guardCatalogSyncPullRequest({
      ...validShape,
      previousManifest: makeManifest(OLD_SHA),
      nextManifest: makeManifest(NEW_SHA),
      fetchImpl,
    })).rejects.toThrow('incomplete tree');
  });

  it('binds the branch suffix to the new manifest snapshot', async () => {
    await expect(guardCatalogSyncPullRequest({
      ...validShape,
      branch: 'chore/catalog-sync-aaaaaaaaaaaa',
      title: 'chore(ci): BSI-Katalog-Sync aaaaaaaaaaaa',
      previousManifest: makeManifest(OLD_SHA),
      nextManifest: makeManifest(NEW_SHA),
      fetchImpl: makeAheadFetch(),
    })).rejects.toThrow('must match the new snapshot');
  });
});

describe('verifySnapshotProgress', () => {
  it.each(['behind', 'diverged', 'identical'])('fails closed for compare status %s', async (status) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(makeResponse({ sha: NEW_SHA }))
      .mockResolvedValueOnce(makeResponse({ status }));
    await expect(verifySnapshotProgress(OLD_SHA, NEW_SHA, { fetchImpl })).rejects.toThrow(
      `status=${status}`,
    );
  });

  it('fails closed when the new snapshot does not exist', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse({}, { ok: false, status: 404 }));
    await expect(verifySnapshotProgress(OLD_SHA, NEW_SHA, { fetchImpl })).rejects.toThrow('HTTP 404');
  });

  it('fails closed on API and network errors', async () => {
    const apiFailure = vi.fn().mockResolvedValue(makeResponse({}, { ok: false, status: 503 }));
    const networkFailure = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(verifySnapshotProgress(OLD_SHA, NEW_SHA, { fetchImpl: apiFailure })).rejects.toThrow('HTTP 503');
    await expect(verifySnapshotProgress(OLD_SHA, NEW_SHA, { fetchImpl: networkFailure })).rejects.toThrow('offline');
  });
});
