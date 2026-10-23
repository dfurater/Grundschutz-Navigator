import { describe, expect, it } from 'vitest';
import { projectCatalogLineage, resolveRelativeRepoPath } from './catalogLineage';
import type { ValidatedLineageArtifact } from './catalogLineage';

const PROFILE_PATH = 'control_layer/Grundschutz++/sources/profiles/Grundschutz++-profile.json';
const KERNEL_PATH = 'control_layer/Kernel/BSI-Stand-der-Technik-Kernel-catalog.json';
const METHODIK_PATH =
  'control_layer/Grundschutz++/sources/catalogs/Methodik-Grundschutz++/BSI-Methodik-Grundschutz++-catalog.json';
const RISIKO_PATH = 'control_layer/Risikomanagement/BSI-Anforderungen-zum-Risikomanagement-catalog.json';
const KERNEL_HREF = '../../../Kernel/BSI-Stand-der-Technik-Kernel-catalog.json';
const METHODIK_HREF = '../catalogs/Methodik-Grundschutz++/BSI-Methodik-Grundschutz++-catalog.json';
const RISIKO_HREF = '../../../Risikomanagement/BSI-Anforderungen-zum-Risikomanagement-catalog.json';

interface FixtureOscalRoot {
  uuid: string;
  metadata: { title: string; version: string; 'oscal-version': string };
  imports?: Array<{ href?: string }>;
  'back-matter'?: { resources: Array<{ uuid: string; rlinks: Array<{ href: string }> }> };
}

type FixtureOscalDocument = { catalog?: FixtureOscalRoot; profile?: FixtureOscalRoot };

function oscalDocument(root: 'catalog' | 'profile', title: string, uuid: string): FixtureOscalDocument {
  return {
    [root]: { uuid, metadata: { title, version: '2026-08-13', 'oscal-version': '1.1.3' } },
  } as FixtureOscalDocument;
}

function artifact(document: FixtureOscalDocument, artifactKey: string, path: string): ValidatedLineageArtifact {
  return {
    document,
    manifestFile: { artifactKey, path, gitBlobSha: `${artifactKey}-blob`, contentSha256: `${artifactKey}-sha` },
  };
}

function makeProfile(profileImports: Array<{ href?: string }> = [
  { href: '#kernel-resource' },
  { href: '#methodik-resource' },
  { href: '#risiko-resource' },
]) {
  const profile = oscalDocument('profile', 'Grundschutz++ Profil', 'profile-uuid');
  profile.profile!.imports = profileImports;
  profile.profile!['back-matter'] = {
    resources: [
      { uuid: 'kernel-resource', rlinks: [{ href: KERNEL_HREF }] },
      { uuid: 'methodik-resource', rlinks: [{ href: METHODIK_HREF }] },
      { uuid: 'risiko-resource', rlinks: [{ href: RISIKO_HREF }] },
    ],
  };
  return profile;
}

function makeSources() {
  return new Map<string, ValidatedLineageArtifact>([
    [KERNEL_PATH, artifact(oscalDocument('catalog', 'Kernel', 'kernel-uuid'), 'kernel', KERNEL_PATH)],
    [METHODIK_PATH, artifact(oscalDocument('catalog', 'Methodik', 'methodik-uuid'), 'methodik', METHODIK_PATH)],
    [RISIKO_PATH, artifact(oscalDocument('catalog', 'Risikomanagement', 'risiko-uuid'), 'risiko', RISIKO_PATH)],
  ]);
}

function project(profile: FixtureOscalDocument, artifactsByPath = makeSources()) {
  return projectCatalogLineage({
    catalogKey: 'gspp',
    profileArtifact: artifact(profile, 'profile-gspp', PROFILE_PATH),
    artifactsByPath,
  });
}

describe('resolveRelativeRepoPath', () => {
  it('normalizes a relative href against the profile folder', () => {
    expect(resolveRelativeRepoPath(PROFILE_PATH, KERNEL_HREF)).toBe(KERNEL_PATH);
    expect(resolveRelativeRepoPath(PROFILE_PATH, METHODIK_HREF)).toBe(METHODIK_PATH);
    expect(resolveRelativeRepoPath(PROFILE_PATH, `./${METHODIK_HREF}`)).toBe(METHODIK_PATH);
  });

  it.each([
    'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/blob/main/control_layer/x.json',
    '/control_layer/x.json',
    '#kernel-resource',
    '../../../../../escape.json',
    '../../../../documentation/OSCAL.md',
  ])('rejects %s', (href) => {
    expect(resolveRelativeRepoPath(PROFILE_PATH, href)).toBeNull();
  });
});

describe('projectCatalogLineage', () => {
  it('derives the three-stage import chain from the profile back-matter', () => {
    const result = project(makeProfile());

    expect(result.catalogKey).toBe('gspp');
    expect(result.profile).toMatchObject({
      artifactKey: 'profile-gspp',
      title: 'Grundschutz++ Profil',
      upstreamPath: PROFILE_PATH,
      gitBlobSha: 'profile-gspp-blob',
    });
    expect(result.imports).toEqual([
      expect.objectContaining({ index: 0, state: 'complete', rlinkHref: KERNEL_HREF, source: expect.objectContaining({ artifactKey: 'kernel', upstreamPath: KERNEL_PATH }) }),
      expect.objectContaining({ index: 1, state: 'complete', rlinkHref: METHODIK_HREF, source: expect.objectContaining({ artifactKey: 'methodik' }) }),
      expect.objectContaining({ index: 2, state: 'complete', rlinkHref: RISIKO_HREF, source: expect.objectContaining({ artifactKey: 'risiko' }) }),
    ]);
  });

  it('resolves only the relative rlink and never an external reference of the same resource', () => {
    const externalHref =
      'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/blob/47de2824a341812438ef3f044b3f65ce2cad6e32/control_layer/Kernel/BSI-Stand-der-Technik-Kernel-catalog.json';
    const profile = makeProfile([{ href: '#kernel-resource' }]);
    profile.profile!['back-matter']!.resources[0]!.rlinks.unshift({ href: externalHref });

    const result = project(profile);

    expect(result.imports).toEqual([
      expect.objectContaining({ state: 'complete', rlinkHref: KERNEL_HREF }),
    ]);
    expect(JSON.stringify(result)).not.toContain('github.com');
  });

  it.each([
    ['import-href-missing', [{}]],
    ['import-href-not-fragment', [{ href: `https://example.org/${KERNEL_PATH}` }]],
    ['resource-missing', [{ href: '#unbekannte-resource' }]],
    ['resource-ambiguous', [{ href: '#kernel-resource' }]],
    ['rlink-missing', [{ href: '#kernel-resource' }]],
    ['rlink-ambiguous', [{ href: '#kernel-resource' }]],
    ['artifact-unregistered', [{ href: '#kernel-resource' }]],
  ] as const)('reports the named fail-closed state %s', (expectedState, imports) => {
    const profile = makeProfile([...imports]);
    const resources = profile.profile!['back-matter']!.resources;
    let sources = makeSources();

    if (expectedState === 'rlink-missing') resources[0]!.rlinks = [];
    if (expectedState === 'resource-ambiguous') {
      resources.push({ uuid: 'kernel-resource', rlinks: [{ href: METHODIK_HREF }] });
    }
    if (expectedState === 'rlink-ambiguous') resources[0]!.rlinks.push({ href: METHODIK_HREF });
    if (expectedState === 'artifact-unregistered') {
      sources = new Map([...sources].filter(([path]) => path !== KERNEL_PATH));
    }

    const result = project(profile, sources);

    expect(result.imports[0]).toEqual(expect.objectContaining({ state: expectedState, source: null }));
  });

  it('resolves a direct relative import href through the same bounded path resolver', () => {
    const result = project(makeProfile([{ href: KERNEL_HREF }, { href: '../../../Unbekannt/x-catalog.json' }]));

    expect(result.imports).toEqual([
      expect.objectContaining({
        state: 'complete',
        importHref: KERNEL_HREF,
        resourceUuid: null,
        rlinkHref: null,
        source: expect.objectContaining({ artifactKey: 'kernel', upstreamPath: KERNEL_PATH }),
      }),
      expect.objectContaining({ state: 'artifact-unregistered', resourceUuid: null, rlinkHref: null, source: null }),
    ]);
  });

  it('reports a direct import of an already resolved fragment source as duplicate', () => {
    const result = project(makeProfile([{ href: '#kernel-resource' }, { href: KERNEL_HREF }]));

    expect(result.imports.map((entry) => entry.state)).toEqual(['complete', 'import-duplicate']);
  });

  it('does not treat a repeated source import as fully resolved twice', () => {
    const result = project(makeProfile([{ href: '#kernel-resource' }, { href: '#kernel-resource' }]));

    expect(result.imports.map((entry) => entry.state)).toEqual(['complete', 'import-duplicate']);
  });

  it('requires a catalog key, a profile path and an artifact map', () => {
    expect(() =>
      projectCatalogLineage({
        catalogKey: 'gspp',
        profileArtifact: { document: makeProfile(), manifestFile: { artifactKey: 'p', path: '' } },
        artifactsByPath: makeSources(),
      }),
    ).toThrow(/requires a catalog key, a profile/);
  });
});
