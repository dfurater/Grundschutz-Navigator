import { describe, expect, it } from 'vitest';
import { projectCatalogLineage } from './catalogLineage';
import type { ValidatedLineageArtifact } from './catalogLineage';
import { CATALOG_LINEAGES } from './sourceRegistry.mjs';

const lineage = CATALOG_LINEAGES.find((candidate) => candidate.catalogKey === 'gspp');
if (!lineage) {
  throw new Error('Fixture requires the registered GSPP catalog lineage');
}

const [kernelImport, methodikImport, risikoImport] = lineage.imports;
if (lineage.imports.length !== 3 || !kernelImport || !methodikImport || !risikoImport) {
  throw new Error('Fixture requires exactly three registered GSPP source imports');
}

const PROFILE_ARTIFACT_KEY = lineage.profileArtifactKey;
const { href: KERNEL_HREF, artifactKey: KERNEL_ARTIFACT_KEY } = kernelImport;
const { href: METHODIK_HREF, artifactKey: METHODIK_ARTIFACT_KEY } = methodikImport;
const { href: RISIKO_HREF, artifactKey: RISIKO_ARTIFACT_KEY } = risikoImport;

interface FixtureOscalRoot {
  uuid: string;
  metadata: {
    title: string;
    version: string;
    'oscal-version': string;
  };
  imports?: Array<{ href?: string }>;
  'back-matter'?: {
    resources: Array<{ uuid: string; rlinks: Array<{ href: string }> }>;
  };
}

type FixtureOscalDocument = {
  catalog?: FixtureOscalRoot;
  profile?: FixtureOscalRoot;
};

function oscalDocument(
  root: 'catalog' | 'profile',
  title: string,
  uuid: string,
  version: string,
): FixtureOscalDocument {
  return {
    [root]: {
      uuid,
      metadata: {
        title,
        version,
        'oscal-version': '1.1.3',
      },
    },
  } as FixtureOscalDocument;
}

function makeArtifacts(profileImports: Array<{ href?: string }> = [
  { href: '#kernel-resource' },
  { href: '#methodik-resource' },
  { href: '#risiko-resource' },
]) {
  const profile = oscalDocument('profile', 'Grundschutz++ Profil', 'profile-uuid', '2026-08-13');
  const profileRoot = profile.profile!;
  profileRoot.imports = profileImports;
  profileRoot['back-matter'] = {
    resources: [
      { uuid: 'kernel-resource', rlinks: [{ href: KERNEL_HREF }] },
      { uuid: 'methodik-resource', rlinks: [{ href: METHODIK_HREF }] },
      { uuid: 'risiko-resource', rlinks: [{ href: RISIKO_HREF }] },
    ],
  };

  return new Map<string, ValidatedLineageArtifact>([
    [PROFILE_ARTIFACT_KEY, { document: profile, manifestFile: { path: 'profiles/gspp.json', gitBlobSha: 'profile-blob', contentSha256: 'profile-sha' } }],
    [KERNEL_ARTIFACT_KEY, { document: oscalDocument('catalog', 'Kernel G0', 'kernel-uuid', '2026-08-13'), manifestFile: { path: 'catalogs/kernel-g0.json', gitBlobSha: 'kernel-blob', contentSha256: 'kernel-sha' } }],
    [METHODIK_ARTIFACT_KEY, { document: oscalDocument('catalog', 'Methodik', 'methodik-uuid', '2026-08-13'), manifestFile: { path: 'catalogs/methodik.json', gitBlobSha: 'methodik-blob', contentSha256: 'methodik-sha' } }],
    [RISIKO_ARTIFACT_KEY, { document: oscalDocument('catalog', 'Risikomanagement', 'risiko-uuid', '2026-08-13'), manifestFile: { path: 'catalogs/risiko.json', gitBlobSha: 'risiko-blob', contentSha256: 'risiko-sha' } }],
  ]);
}

describe('projectCatalogLineage', () => {
  it('projects the three-stage profile import chain through exact registered rlink href values', () => {
    const result = projectCatalogLineage({ lineage, artifactsByKey: makeArtifacts() });

    expect(result.catalogKey).toBe('gspp');
    expect(result.profile).toMatchObject({
      artifactKey: PROFILE_ARTIFACT_KEY,
      title: 'Grundschutz++ Profil',
      documentUuid: 'profile-uuid',
      oscalVersion: '1.1.3',
      version: '2026-08-13',
    });
    expect(result.imports).toEqual([
      expect.objectContaining({
        state: 'complete',
        importHref: '#kernel-resource',
        resourceUuid: 'kernel-resource',
        rlinkHref: KERNEL_HREF,
        source: expect.objectContaining({ artifactKey: KERNEL_ARTIFACT_KEY, title: 'Kernel G0' }),
      }),
      expect.objectContaining({
        state: 'complete',
        importHref: '#methodik-resource',
        resourceUuid: 'methodik-resource',
        rlinkHref: METHODIK_HREF,
        source: expect.objectContaining({ artifactKey: METHODIK_ARTIFACT_KEY, title: 'Methodik' }),
      }),
      expect.objectContaining({
        state: 'complete',
        importHref: '#risiko-resource',
        resourceUuid: 'risiko-resource',
        rlinkHref: RISIKO_HREF,
        source: expect.objectContaining({ artifactKey: RISIKO_ARTIFACT_KEY, title: 'Risikomanagement' }),
      }),
    ]);
  });

  it.each([
    ['import-href-missing', [{}]],
    ['import-href-not-fragment', [{ href: KERNEL_HREF }]],
    ['resource-missing', [{ href: '#unbekannte-resource' }]],
    ['resource-ambiguous', [{ href: '#kernel-resource' }]],
    ['rlink-missing', [{ href: '#kernel-resource' }]],
    ['rlink-ambiguous', [{ href: '#kernel-resource' }]],
    ['artifact-unregistered', [{ href: '#kernel-resource' }]],
  ] as const)('reports the named fail-closed state %s', (expectedState, imports) => {
    const artifacts = makeArtifacts([...imports]);
    const profile = (artifacts.get(PROFILE_ARTIFACT_KEY)!.document as FixtureOscalDocument).profile!;

    if (expectedState === 'rlink-missing') {
      profile['back-matter']!.resources[0]!.rlinks = [];
    }
    if (expectedState === 'resource-ambiguous') {
      profile['back-matter']!.resources.push({
        uuid: 'kernel-resource',
        rlinks: [{ href: METHODIK_HREF }],
      });
    }
    if (expectedState === 'rlink-ambiguous') {
      profile['back-matter']!.resources[0]!.rlinks.push({ href: KERNEL_HREF });
    }
    if (expectedState === 'artifact-unregistered') {
      profile['back-matter']!.resources[0]!.rlinks = [{ href: '../catalogs/Kernel/../Kernel/BSI-Stand-der-Technik-Kernel-G0-catalog.json' }];
    }

    const result = projectCatalogLineage({ lineage, artifactsByKey: artifacts });

    expect(result.imports[0]).toEqual(
      expect.objectContaining({ state: expectedState, source: null }),
    );
  });

  it('retains a named failure for every configured source import absent from the profile', () => {
    const result = projectCatalogLineage({
      lineage,
      artifactsByKey: makeArtifacts([
        { href: '#kernel-resource' },
        { href: '#risiko-resource' },
      ]),
    });

    expect(result.imports).toEqual([
      expect.objectContaining({ state: 'complete', rlinkHref: KERNEL_HREF }),
      expect.objectContaining({ state: 'complete', rlinkHref: RISIKO_HREF }),
      expect.objectContaining({
        index: null,
        state: 'configured-import-missing',
        importHref: null,
        resourceUuid: null,
        rlinkHref: METHODIK_HREF,
        source: null,
      }),
    ]);
  });

  it('does not treat a repeated configured source import as fully resolved twice', () => {
    const result = projectCatalogLineage({
      lineage,
      artifactsByKey: makeArtifacts([
        { href: '#kernel-resource' },
        { href: '#kernel-resource' },
        { href: '#risiko-resource' },
      ]),
    });

    expect(result.imports[1]).toEqual(
      expect.objectContaining({
        index: 1,
        state: 'import-duplicate',
        importHref: '#kernel-resource',
        resourceUuid: 'kernel-resource',
        rlinkHref: KERNEL_HREF,
        source: null,
      }),
    );
  });

  it('keeps configured source imports unresolved after an ambiguous rlink match', () => {
    const artifacts = makeArtifacts([
      { href: '#kernel-resource' },
      { href: '#risiko-resource' },
    ]);
    const profile = (artifacts.get(PROFILE_ARTIFACT_KEY)!.document as FixtureOscalDocument).profile!;
    profile['back-matter']!.resources[0]!.rlinks.push({ href: METHODIK_HREF });

    const result = projectCatalogLineage({ lineage, artifactsByKey: artifacts });

    expect(result.imports).toEqual([
      expect.objectContaining({ state: 'rlink-ambiguous', source: null }),
      expect.objectContaining({ state: 'complete', rlinkHref: RISIKO_HREF }),
      expect.objectContaining({
        index: null,
        state: 'configured-import-missing',
        rlinkHref: KERNEL_HREF,
        source: null,
      }),
      expect.objectContaining({
        index: null,
        state: 'configured-import-missing',
        rlinkHref: METHODIK_HREF,
        source: null,
      }),
    ]);
  });
});
