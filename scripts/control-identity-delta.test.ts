import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildControlIdentityDelta,
  compareCatalogControlIdentities,
  formatControlIdentityDeltaSummary,
  writeControlIdentityDelta,
} from './control-identity-delta.mjs';
import { buildUpstreamManifest } from './upstream-artifacts.mjs';

const OFFICIAL_REPOSITORY =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek';
const PREVIOUS_SHA = '1'.repeat(40);
const NEXT_SHA = '2'.repeat(40);
const FIXTURE_A_PREVIOUS_SHA = 'd6153cbb29e6dc84f6265dddf68fc03cb851906f';
const FIXTURE_A_NEXT_SHA = '12abb438fcdb4f4b63fb3e751e89d7c526e647b5';
const FIXTURE_B_PREVIOUS_SHA = 'cea4589c2b8337207772a88dd82d808cba5e1d89';
const FIXTURE_B_NEXT_SHA = 'c1e53dcfbb5adc503964042a859f01ea721a4419';

function getAllowedTempRoot() {
  return process.env.RUNNER_TEMP ?? tmpdir();
}

function makeControl(id: string, altIdentifier: string, title: string) {
  return {
    id,
    title,
    props: altIdentifier
      ? [{ name: 'alt-identifier', value: altIdentifier }]
      : [],
  };
}

function makeCatalog(controls: ReturnType<typeof makeControl>[], uuid = 'catalog-fixture') {
  return {
    catalog: {
      uuid,
      metadata: {
        title: 'Fixture',
        'last-modified': '2026-08-13T00:00:00Z',
        version: '1',
        'oscal-version': '1.1.3',
      },
      groups: [{ id: 'fixture', title: 'Fixture', controls }],
    },
  };
}

function unchangedControls(count: number) {
  return Array.from({ length: count }, (_, index) =>
    makeControl(
      `STABLE.${index + 1}`,
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      `Unveränderte Control ${index + 1}`,
    ),
  );
}

function fixtureA() {
  const stable = unchangedControls(989);
  const previousMoving = [
    makeControl('TEST.3.1.3', '8a88300f-98ee-41e3-9622-be00c705f252', 'Testdaten'),
    makeControl('TEST.3.1.4', '9c86f2de-9a7a-4fff-b833-7e596fdb32a8', 'Testumgebung'),
    makeControl('TEST.3.1.5', '73fab6c7-c60f-4ee5-bd97-e842915cf98d', 'Kontinuierliche Tests'),
    makeControl('TEST.3.1.6', '32a4ff7c-ee41-4d31-8a1e-f15ea1373181', 'Chaos Engineering'),
    makeControl('TEST.3.1.7', 'ab876d7f-a36e-4efe-94b3-d62af35b3ca8', 'Analyse der Zusammensetzung'),
    makeControl('TEST.3.1.8', '5bd70855-3756-4f70-b5d5-98e5211cd1ed', 'Fuzzing'),
    makeControl('TEST.3.1.9', 'ae64d67c-c9fd-48cd-837e-f71ebc850e29', 'Lasttest'),
    makeControl('TEST.3.1.10', 'd994f7fa-1271-4563-9fc5-e3189fb362b7', 'Penetrationstest bei Änderungen'),
  ];
  const nextMoving = previousMoving.map((control, index) => ({
    ...control,
    id: `TEST.3.1.${index + 4}`,
  }));

  return {
    previous: makeCatalog([
      ...stable,
      makeControl(
        'TEST.3.1.2',
        'f59da6fb-9fb8-4eaa-b338-1081e9094029',
        'Integritätstest',
      ),
      ...previousMoving,
    ]),
    next: makeCatalog([
      ...stable,
      makeControl(
        'TEST.3.1.2',
        '62e5ccc6-411b-45e0-8cd8-5a1d38f5ee7b',
        'Verwendung externer Software',
      ),
      makeControl(
        'TEST.3.1.3',
        '3c9043c9-8700-4fb4-92b1-68d9cf48602c',
        'Integritätstest',
      ),
      ...nextMoving,
    ]),
  };
}

function gitBlobSha(buffer: Buffer) {
  return execFileSync('git', ['hash-object', '--stdin'], {
    encoding: 'utf8',
    input: buffer,
  }).trim();
}

function manifestCatalogFile(
  artifactKey: string,
  lifecycle: string,
  document: unknown,
) {
  const buffer = Buffer.from(JSON.stringify(document), 'utf8');
  return {
    buffer,
    file: {
      artifactKey,
      rootType: 'catalog',
      lifecycle,
      path: `control_layer/${artifactKey}/${artifactKey}.json`,
      gitBlobSha: gitBlobSha(buffer),
      contentSha256: createHash('sha256').update(buffer).digest('hex'),
    },
  };
}

function makeManifest(snapshotCommitSha: string, files: unknown[]) {
  return buildUpstreamManifest({
    repository: OFFICIAL_REPOSITORY,
    snapshotCommitSha,
    files,
  });
}

function blobResponse(expectedSha: string, buffer: Buffer) {
  return new Response(JSON.stringify({
    sha: expectedSha,
    encoding: 'base64',
    size: buffer.length,
    content: buffer.toString('base64'),
  }), { headers: { 'Content-Type': 'application/json' } });
}

describe('semantic control identity comparison', () => {
  it('reproduces fixture A with the exact 998 to 999 semantic classifications', () => {
    const { previous, next } = fixtureA();
    const result = compareCatalogControlIdentities({
      artifactKey: 'catalog-gspp',
      previousSnapshotSha: FIXTURE_A_PREVIOUS_SHA,
      nextSnapshotSha: FIXTURE_A_NEXT_SHA,
      previousCatalog: previous,
      nextCatalog: next,
    });

    expect(result.previousControlCount).toBe(998);
    expect(result.nextControlCount).toBe(999);
    expect(result.counts).toEqual({
      added: 1,
      removed: 0,
      moved: 8,
      'id-rebound': 1,
      'identifier-changed': 1,
      ambiguous: 0,
    });
    expect(result.entries.find((entry) => entry.classification === 'identifier-changed'))
      .toMatchObject({
        oldControlId: 'TEST.3.1.2',
        newControlId: 'TEST.3.1.3',
        title: 'Integritätstest',
        evidence: {
          kind: 'title-equality',
          cryptographicallyProven: false,
        },
      });
    expect(result.entries.find((entry) => entry.classification === 'id-rebound'))
      .toMatchObject({
        oldControlId: 'TEST.3.1.2',
        newControlId: 'TEST.3.1.2',
      });
    expect(result.entries.every((entry) =>
      Object.hasOwn(entry, 'oldControlId') &&
      Object.hasOwn(entry, 'newControlId') &&
      Object.hasOwn(entry, 'oldAltIdentifier') &&
      Object.hasOwn(entry, 'newAltIdentifier') &&
      entry.artifactKey === 'catalog-gspp' &&
      entry.previousSnapshotSha === FIXTURE_A_PREVIOUS_SHA &&
      entry.nextSnapshotSha === FIXTURE_A_NEXT_SHA,
    )).toBe(true);
  });

  it('reproduces fixture B as exactly seven additions despite a catalog UUID change', () => {
    const previousControls = unchangedControls(54);
    const addedControls = [
      ['ASST.2.2', 'Inventar der Systeme'],
      ['ARCH.2.4', 'Inventar der Netze'],
      ['DET.4.19', 'Unautorisierte Sendeanlagen'],
      ['SENS.2.4.1', 'Verbindung unautorisierter IT-Systeme'],
      ['SENS.7.12', 'Öffentliche WLANs'],
      ['SENS.7.13', 'Unverschlüsselte WLANs'],
      ['SENS.7.14', 'Unautorisierte WLANs'],
    ];
    const nextControls = [
      ...previousControls,
      ...addedControls.map(([id, title], index) =>
        makeControl(
          id,
          `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          title,
        ),
      ),
    ];

    const result = compareCatalogControlIdentities({
      artifactKey: 'catalog-wlan',
      previousSnapshotSha: FIXTURE_B_PREVIOUS_SHA,
      nextSnapshotSha: FIXTURE_B_NEXT_SHA,
      previousCatalog: makeCatalog(
        previousControls,
        '63294a33-023b-4a9b-9d9e-73ecc037d375',
      ),
      nextCatalog: makeCatalog(
        nextControls,
        '4eda1f1c-f992-4bec-8240-bf04eced921d',
      ),
    });

    expect(result.previousControlCount).toBe(54);
    expect(result.nextControlCount).toBe(61);
    expect(result.counts).toEqual({
      added: 7,
      removed: 0,
      moved: 0,
      'id-rebound': 0,
      'identifier-changed': 0,
      ambiguous: 0,
    });
    expect(result.entries.map((entry) => entry.title)).toEqual(
      expect.arrayContaining(addedControls.map(([, title]) => title)),
    );
  });

  it('marks repeated title candidates and duplicate alt-identifiers as ambiguous', () => {
    const repeatedTitle = compareCatalogControlIdentities({
      artifactKey: 'catalog-title-ambiguity',
      previousSnapshotSha: PREVIOUS_SHA,
      nextSnapshotSha: NEXT_SHA,
      previousCatalog: makeCatalog([
        makeControl('OLD.1', 'old-alt-1', 'Gleicher Titel'),
        makeControl('OLD.2', 'old-alt-2', 'Gleicher Titel'),
      ]),
      nextCatalog: makeCatalog([
        makeControl('NEW.1', 'new-alt-1', 'Gleicher Titel'),
      ]),
    });
    expect(repeatedTitle.counts.ambiguous).toBe(3);
    expect(repeatedTitle.counts['identifier-changed']).toBe(0);

    const repeatedTitleWithStableIdentity = compareCatalogControlIdentities({
      artifactKey: 'catalog-hidden-title-ambiguity',
      previousSnapshotSha: PREVIOUS_SHA,
      nextSnapshotSha: NEXT_SHA,
      previousCatalog: makeCatalog([
        makeControl('STABLE.1', 'stable-alt', 'Gleicher Titel'),
        makeControl('OLD.1', 'old-alt', 'Gleicher Titel'),
      ]),
      nextCatalog: makeCatalog([
        makeControl('STABLE.1', 'stable-alt', 'Gleicher Titel'),
        makeControl('NEW.1', 'new-alt', 'Gleicher Titel'),
      ]),
    });
    expect(repeatedTitleWithStableIdentity.counts.ambiguous).toBe(2);
    expect(repeatedTitleWithStableIdentity.counts['identifier-changed']).toBe(0);

    const duplicateAlt = compareCatalogControlIdentities({
      artifactKey: 'catalog-alt-ambiguity',
      previousSnapshotSha: PREVIOUS_SHA,
      nextSnapshotSha: NEXT_SHA,
      previousCatalog: makeCatalog([
        makeControl('OLD.1', 'duplicate-alt', 'Eins'),
        makeControl('OLD.2', 'duplicate-alt', 'Zwei'),
      ]),
      nextCatalog: makeCatalog([]),
    });
    expect(duplicateAlt.counts.ambiguous).toBe(2);
    expect(duplicateAlt.counts.removed).toBe(0);
  });
});

describe('manifest-driven catalog loading', () => {
  it('covers every catalog lifecycle and validates both Git and content hashes', async () => {
    const lifecycles = ['supported', 'preview', 'draft', 'blocked-by-upstream'];
    const previousArtifacts = lifecycles.map((lifecycle, index) =>
      manifestCatalogFile(
        `catalog-${lifecycle}`,
        lifecycle,
        makeCatalog([makeControl(`OLD.${index}`, `alt-${index}`, `Titel ${index}`)]),
      ),
    );
    const nextArtifacts = lifecycles.map((lifecycle, index) =>
      manifestCatalogFile(
        `catalog-${lifecycle}`,
        lifecycle,
        makeCatalog([
          makeControl(`OLD.${index}`, `alt-${index}`, `Titel ${index}`),
          makeControl(`NEW.${index}`, `new-alt-${index}`, `Neu ${index}`),
        ]),
      ),
    );
    const byBlobSha = new Map(
      [...previousArtifacts, ...nextArtifacts].map((artifact) => [
        artifact.file.gitBlobSha,
        artifact.buffer,
      ]),
    );
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const sha = String(input).split('/').at(-1) ?? '';
      const buffer = byBlobSha.get(sha);
      if (!buffer) return new Response('not found', { status: 404 });
      return blobResponse(sha, buffer);
    });
    const delta = await buildControlIdentityDelta(
      makeManifest(PREVIOUS_SHA, previousArtifacts.map(({ file }) => file)),
      makeManifest(NEXT_SHA, nextArtifacts.map(({ file }) => file)),
      { fetchImpl, token: '' },
    );

    expect(delta.artifacts.map((artifact) => artifact.artifactKey)).toEqual(
      lifecycles.map((lifecycle) => `catalog-${lifecycle}`).sort(),
    );
    expect(delta.artifacts.every((artifact) => artifact.counts.added === 1)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(8);
    expect(fetchImpl.mock.calls.every(([input]) =>
      String(input).includes('/BSI-Bund/Stand-der-Technik-Bibliothek/git/blobs/'),
    )).toBe(true);
  });

  it('fails closed when a GitHub blob does not match its manifest hashes', async () => {
    const artifact = manifestCatalogFile(
      'catalog-gspp',
      'supported',
      makeCatalog([makeControl('OLD.1', 'alt-1', 'Titel')]),
    );
    const previousManifest = makeManifest(PREVIOUS_SHA, [artifact.file]);
    const nextManifest = makeManifest(NEXT_SHA, [artifact.file]);
    const fetchImpl = vi.fn(async () =>
      blobResponse('f'.repeat(40), artifact.buffer),
    );

    await expect(buildControlIdentityDelta(
      previousManifest,
      nextManifest,
      { fetchImpl, token: '' },
    )).rejects.toThrow(/blob SHA|Git/i);
  });

  it('writes deterministic JSON only below the repository or temp roots', async () => {
    const directory = await mkdtemp(
      path.join(getAllowedTempRoot(), 'control-identity-delta-'),
    );
    const outputPath = path.join(directory, 'control-identity-delta.json');
    const delta = {
      schemaVersion: 1,
      previousSnapshotSha: PREVIOUS_SHA,
      nextSnapshotSha: NEXT_SHA,
      artifacts: [],
    };

    await writeControlIdentityDelta(delta, outputPath);
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).toEqual(delta);
    await expect(writeControlIdentityDelta(delta, '/etc/control-identity-delta.json'))
      .rejects.toThrow('allowed working directory');
    expect(formatControlIdentityDeltaSummary(delta)).toBe(
      '- Keine Control-Identitätsänderungen erkannt',
    );
  });
});
