import { describe, expect, it } from 'vitest';
import {
  MONITORED_UPSTREAM_ROOTS,
  ENTRY_CATALOG,
  ENTRY_CATALOG_KEY,
  SOURCE_REGISTRY,
  SUPPORTED_CATALOGS,
  SUPPORTED_CATALOG_KEYS,
  catalogDataFileName,
  catalogMetadataFileName,
  getArtifactByUpstreamPath,
  getCatalogByKey,
  getExpectedOscalVersion,
  getExpectedRootType,
  getSchemaPinForArtifact,
  isCatalogKey,
  isPathWithinMonitoredRoot,
  isSafeRepoPath,
  listArtifacts,
  listCatalogArtifactFileNames,
  listCatalogKeys,
  listOscalArtifacts,
  listSupportedCatalogs,
  resolveEntryCatalog,
  validateSourceRegistry,
  type CatalogKey,
  type OscalArtifactEntry,
  type SupportedCatalogEntry,
} from '@/domain/sourceRegistry';

const OFFICIAL_CATALOG_PATH = 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json';

/** Muss mit der CatalogKey-Union in sourceRegistry.d.mts übereinstimmen. */
const EXPECTED_CATALOG_KEYS = [
  'gspp',
  'lieferkette',
  'wlan',
  'iso27001-annex-a',
  'mindeststandard-tls',
] as const satisfies readonly CatalogKey[];

function makeOscalEntry(overrides: Partial<OscalArtifactEntry> = {}): OscalArtifactEntry {
  return {
    artifactKey: 'catalog-test',
    kind: 'oscal',
    oscalVersion: '1.1.3',
    expectedRootType: 'catalog',
    catalogKey: 'gspp',
    upstreamPath: 'control_layer/Test/Test-catalog.json',
    lifecycle: 'preview',
    title: 'Test',
    ...overrides,
  } as OscalArtifactEntry;
}

describe('sourceRegistry', () => {
  it('validates the shipped registry without errors', () => {
    expect(() => validateSourceRegistry()).not.toThrow();
  });

  it('declares gspp as the entry catalog', () => {
    expect(ENTRY_CATALOG_KEY).toBe('gspp');
    expect(ENTRY_CATALOG.catalogKey).toBe('gspp');
    expect(ENTRY_CATALOG.upstreamPath).toBe(OFFICIAL_CATALOG_PATH);
    expect(ENTRY_CATALOG.lifecycle).toBe('supported');
    expect(ENTRY_CATALOG.entryCatalog).toBe(true);
  });

  it('ships the entry catalog and the promoted Lieferkette catalog (GSPP-242)', () => {
    expect(SUPPORTED_CATALOG_KEYS).toEqual(['gspp', 'lieferkette']);
    expect(SUPPORTED_CATALOGS.map((entry) => entry.artifactKey)).toEqual([
      'catalog-gspp',
      'catalog-lieferkette',
    ]);
  });

  it('limits the supported lifecycle exactly to both shipped catalogs and the namespace collection', () => {
    const supported = listArtifacts({ lifecycle: 'supported' });
    expect(supported.map((entry) => entry.artifactKey).sort()).toEqual([
      'catalog-gspp',
      'catalog-lieferkette',
      'namespaces-bsi',
    ]);
  });

  it('blocks exactly the upstream-reported schema-defective OSCAL artifacts', () => {
    expect(
      SOURCE_REGISTRY.filter(
        (entry): entry is OscalArtifactEntry =>
          entry.kind === 'oscal' && entry.lifecycle === 'blocked-by-upstream',
      )
        .map((entry) => ({ artifactKey: entry.artifactKey, upstreamIssue: entry.upstreamIssue }))
        .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey)),
    ).toEqual([
      {
        artifactKey: 'catalog-iso27001-annex-a',
        upstreamIssue: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/69',
      },
      {
        artifactKey: 'component-ga-lotse-grundmodul',
        upstreamIssue: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/70',
      },
      {
        artifactKey: 'component-lieferkette',
        upstreamIssue: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/71',
      },
      {
        artifactKey: 'mapping-iso27001-annex-a-zu-gspp',
        upstreamIssue: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/68',
      },
    ]);
  });

  it('monitors exactly the registry-backed BSI discovery roots', () => {
    expect(MONITORED_UPSTREAM_ROOTS).toEqual([
      'control_layer',
      'documentation/namespaces',
      'implementation_layer',
    ]);
    expect(Object.isFrozen(MONITORED_UPSTREAM_ROOTS)).toBe(true);
  });

  it.each([
    'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
    'documentation/namespaces/tags.csv',
    'implementation_layer/AWS Beispiel-Components/AWS Security Hub-component_definition.json',
    'control_layer/ISO27001/ISO27001-AnnexA-catalog.json',
    'control_layer/Grundschutz++/sources/profiles/Grundschutz++-profile.json',
  ])('accepts safe repository path %s', (repoPath) => {
    expect(isSafeRepoPath(repoPath)).toBe(true);
  });

  it('tracks only the approved AWS Security Hub replacement as preview', () => {
    const awsEntries = SOURCE_REGISTRY.filter((entry) =>
      entry.artifactKey.startsWith('component-aws-'),
    );

    expect(awsEntries).toEqual([
      {
        artifactKey: 'component-aws-security-hub',
        kind: 'oscal',
        oscalVersion: '1.1.3',
        expectedRootType: 'component-definition',
        upstreamPath:
          'implementation_layer/AWS Beispiel-Components/AWS Security Hub-component_definition.json',
        lifecycle: 'preview',
        title: 'Component Definition AWS Security Hub V2/Essentials',
      },
    ]);
  });

  it.each([
    '',
    ' ',
    '/control_layer/catalog.json',
    '../control_layer/catalog.json',
    'control_layer/../secret.json',
    'control_layer//catalog.json',
    'control_layer/./catalog.json',
    'control_layer\\catalog.json',
  ])('rejects unsafe repository path %s', (repoPath) => {
    expect(isSafeRepoPath(repoPath)).toBe(false);
  });

  it('matches monitored roots on complete path segments only', () => {
    for (const root of MONITORED_UPSTREAM_ROOTS) {
      expect(isPathWithinMonitoredRoot(root)).toBe(true);
      expect(isPathWithinMonitoredRoot(`${root}/artifact.json`)).toBe(true);
      expect(isPathWithinMonitoredRoot(`${root}-external/artifact.json`)).toBe(false);
    }

    expect(isPathWithinMonitoredRoot('README.md')).toBe(false);
    expect(isPathWithinMonitoredRoot('control_layer/../secret.json')).toBe(false);
    // documentation/ ist bewusst nur bis namespaces/ beobachtet.
    expect(isPathWithinMonitoredRoot('documentation/OSCAL.md')).toBe(false);
    expect(isPathWithinMonitoredRoot('assessment_layer/README.md')).toBe(false);
  });

  it('resolves the official catalog path to the supported entry', () => {
    const entry = getArtifactByUpstreamPath(OFFICIAL_CATALOG_PATH);
    expect(entry?.artifactKey).toBe('catalog-gspp');
  });

  it('resolves direct namespace CSV children to the vocabulary collection', () => {
    expect(getArtifactByUpstreamPath('documentation/namespaces/tags.csv')?.artifactKey).toBe(
      'namespaces-bsi',
    );
    expect(getArtifactByUpstreamPath('documentation/namespaces/nested/tags.csv')).toBeNull();
    expect(getArtifactByUpstreamPath('documentation/namespaces/readme.md')).toBeNull();
    expect(getArtifactByUpstreamPath('documentation/namespaces')).toBeNull();
  });

  it('rejects unknown upstream paths', () => {
    expect(getArtifactByUpstreamPath('documentation/OSCAL.md')).toBeNull();
    expect(
      getArtifactByUpstreamPath(
        'control_layer/Grundschutz++/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-catalog.json',
      ),
    ).toBeNull();
    expect(getArtifactByUpstreamPath('')).toBeNull();
  });

  it('reports the expected OSCAL root type per registered path', () => {
    expect(getExpectedRootType(OFFICIAL_CATALOG_PATH)).toBe('catalog');
    expect(
      getExpectedRootType(
        'control_layer/Lieferkettensicherheit/Lieferkettensicherheit-resolved_catalog.json',
      ),
    ).toBe('catalog');
    expect(
      getExpectedRootType(
        'control_layer/Mappings/IT-GS2023-zu-GSpp/ITGS-to-GS++-mapping_collection.json',
      ),
    ).toBe('mapping-collection');
    expect(getExpectedRootType('control_layer/WLAN/sources/profiles/WLAN-profile.json')).toBe(
      'profile',
    );
    expect(
      getExpectedRootType(
        'implementation_layer/Keycloak/Keycloak-component_definition.json',
      ),
    ).toBe('component-definition');
    expect(
      getExpectedRootType('implementation_layer/WLAN/WLAN-component_definition.json'),
    ).toBeNull();
    expect(getExpectedRootType('documentation/namespaces/tags.csv')).toBeNull();
    expect(getExpectedRootType('unknown.json')).toBeNull();
  });

  it('exposes catalog entries by key', () => {
    expect(getCatalogByKey('gspp')?.artifactKey).toBe('catalog-gspp');
    expect(getCatalogByKey('lieferkette')?.lifecycle).toBe('supported');
    expect(getCatalogByKey('wlan')?.lifecycle).toBe('preview');
    expect(getCatalogByKey('unbekannt')).toBeNull();
  });

  it('keeps the CatalogKey union and the runtime keys in sync', () => {
    expect([...listCatalogKeys()].sort()).toEqual([...EXPECTED_CATALOG_KEYS].sort());
  });

  it('narrows catalog keys with isCatalogKey', () => {
    expect(isCatalogKey('gspp')).toBe(true);
    expect(isCatalogKey('GSPP')).toBe(false);
    expect(isCatalogKey('grundschutzpp')).toBe(false);
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(SOURCE_REGISTRY)).toBe(true);
    for (const entry of SOURCE_REGISTRY) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  describe('OSCAL-Versionskompatibilität (GSPP-283)', () => {
    /**
     * Die am BSI-Snapshot 47de2824 aus `metadata.oscal-version` ausgelesenen
     * Versionen aller registrierten OSCAL-Artefakte. Blob-SHA und SHA-256 der
     * Quelldokumente wurden dabei gegen `upstream-manifest.json` geprüft.
     *
     * Dieser Erwartungswert wird bewusst ausgeschrieben statt aus der Registry
     * abgeleitet: Er ist das unabhängige Orakel, das eine stille Änderung an
     * der Registry auffällig macht.
     */
    const DECLARED_UPSTREAM_VERSIONS: Record<string, string> = {
      'catalog-gspp': '1.1.3',
      'catalog-iso27001-annex-a': '1.1.3',
      'catalog-lieferkette': '1.1.3',
      'catalog-mindeststandard-tls': '1.1.3',
      'catalog-wlan': '1.1.3',
      'component-aws-security-hub': '1.1.3',
      'component-ga-lotse-grundmodul': '1.1.2',
      'component-keycloak': '1.2.2',
      'component-lieferkette': '1.1.2',
      'component-netzarchitektur': '1.2.2',
      'component-passwortrichtlinie': '1.1.2',
      'mapping-iso27001-annex-a-zu-gspp': '1.2.2',
      'mapping-itgs2023-zu-gspp': '1.2.1',
      'profile-gspp': '1.1.3',
      'profile-lieferkette': '1.1.3',
      'profile-wlan': '1.1.3',
    };

    it('covers every registered OSCAL artifact exactly once', () => {
      expect(listOscalArtifacts().map((entry) => entry.artifactKey).sort()).toEqual(
        Object.keys(DECLARED_UPSTREAM_VERSIONS).sort(),
      );
    });

    it('matches the version declared by every registered upstream artifact', () => {
      for (const entry of listOscalArtifacts()) {
        expect(entry.oscalVersion).toBe(DECLARED_UPSTREAM_VERSIONS[entry.artifactKey]);
      }
    });

    it('resolves a pinned schema for every registered artifact', () => {
      for (const entry of listOscalArtifacts()) {
        const pin = getSchemaPinForArtifact(entry.artifactKey);
        expect(pin, `kein Schema-Pin für ${entry.artifactKey}`).not.toBeNull();
        expect(pin!.oscalVersion).toBe(entry.oscalVersion);
        expect(pin!.rootKey).toBe(entry.expectedRootType);
        expect(pin!.releaseTag).toBe(`v${entry.oscalVersion}`);
        expect(pin!.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('spans exactly the four pinned versions found in the BSI corpus', () => {
      expect([...new Set(listOscalArtifacts().map((entry) => entry.oscalVersion))].sort()).toEqual([
        '1.1.2',
        '1.1.3',
        '1.2.1',
        '1.2.2',
      ]);
    });

    it('exposes the expected version per upstream path', () => {
      expect(getExpectedOscalVersion(OFFICIAL_CATALOG_PATH)).toBe('1.1.3');
      expect(
        getExpectedOscalVersion(
          'control_layer/Mappings/IT-GS2023-zu-GSpp/ITGS-to-GS++-mapping_collection.json',
        ),
      ).toBe('1.2.1');
      expect(getExpectedOscalVersion('documentation/namespaces/tags.csv')).toBeNull();
      expect(getExpectedOscalVersion('unknown.json')).toBeNull();
      expect(getSchemaPinForArtifact('namespaces-bsi')).toBeNull();
      expect(getSchemaPinForArtifact('unbekannt')).toBeNull();
    });

    it('rejects a registry entry without a declared version', () => {
      expect(() =>
        validateSourceRegistry([makeOscalEntry({ oscalVersion: undefined as never })]),
      ).toThrow(/Missing oscalVersion/);
    });

    it('rejects a registry entry with an unpinned version', () => {
      expect(() =>
        validateSourceRegistry([makeOscalEntry({ oscalVersion: '1.0.4' as never })]),
      ).toThrow(/unpinned OSCAL version/);
    });

    it('rejects a mapping-collection entry below OSCAL 1.2.0', () => {
      expect(() =>
        validateSourceRegistry([
          makeOscalEntry({
            artifactKey: 'mapping-test',
            expectedRootType: 'mapping-collection',
            catalogKey: undefined,
            oscalVersion: '1.1.3',
          }),
        ]),
      ).toThrow(/impossible OSCAL combination/);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Mehr-Katalog-Contract (GSPP-284)                                  */
  /* ---------------------------------------------------------------- */

  describe('supported catalog contract', () => {
    function makeSupportedCatalog(
      overrides: Partial<SupportedCatalogEntry> = {},
    ): SupportedCatalogEntry {
      return makeOscalEntry({ lifecycle: 'supported', ...overrides }) as SupportedCatalogEntry;
    }

    const entryFixture = makeSupportedCatalog({
      artifactKey: 'catalog-entry',
      catalogKey: 'gspp',
      entryCatalog: true,
    });
    const secondFixture = makeSupportedCatalog({
      artifactKey: 'catalog-second',
      catalogKey: 'wlan',
      upstreamPath: 'control_layer/WLAN/WLAN-catalog.json',
    });

    it('accepts more than one supported catalog', () => {
      expect(listSupportedCatalogs([entryFixture, secondFixture])).toHaveLength(2);
      expect(resolveEntryCatalog([entryFixture, secondFixture]).artifactKey).toBe(
        'catalog-entry',
      );
    });

    it('rejects a registry without any supported catalog', () => {
      expect(() => resolveEntryCatalog([makeOscalEntry()])).toThrow(
        /at least one supported catalog/,
      );
    });

    it('rejects a registry without exactly one designated entry catalog', () => {
      expect(() => resolveEntryCatalog([secondFixture])).toThrow(
        /exactly one supported entry catalog/,
      );
      expect(() =>
        resolveEntryCatalog([entryFixture, { ...secondFixture, entryCatalog: true }]),
      ).toThrow(/exactly one supported entry catalog/);
    });

    it('rejects an entry-catalog marker outside a supported catalog entry', () => {
      expect(() =>
        validateSourceRegistry([makeOscalEntry({ entryCatalog: true })]),
      ).toThrow(/entry catalog/);
      expect(() =>
        validateSourceRegistry([
          makeOscalEntry({
            artifactKey: 'profile-test',
            expectedRootType: 'profile',
            catalogKey: undefined,
            lifecycle: 'supported',
            entryCatalog: true,
          }),
        ]),
      ).toThrow(/entry catalog/);
    });

    it('derives the artifact file names from the catalogKey', () => {
      expect(catalogDataFileName(entryFixture)).toBe('catalog.json');
      expect(catalogMetadataFileName(entryFixture)).toBe('catalog-metadata.json');
      expect(catalogDataFileName(secondFixture)).toBe('catalog-wlan.json');
      expect(catalogMetadataFileName(secondFixture)).toBe('catalog-wlan-metadata.json');
    });

    it('derives the shipped catalog file set from the registry', () => {
      expect(listCatalogArtifactFileNames([entryFixture, secondFixture])).toEqual([
        'catalog.json',
        'catalog-metadata.json',
        'catalog-wlan.json',
        'catalog-wlan-metadata.json',
      ]);
    });

    it('derives the real shipped file set from the registry, entry catalog unchanged', () => {
      expect(listCatalogArtifactFileNames()).toEqual([
        'catalog.json',
        'catalog-metadata.json',
        'catalog-lieferkette.json',
        'catalog-lieferkette-metadata.json',
      ]);
    });

    it('refuses to derive file names for entries that are not shipped catalogs', () => {
      expect(() => catalogDataFileName(makeOscalEntry() as SupportedCatalogEntry)).toThrow(
        /Not a supported catalog registry entry/,
      );
    });
  });

  describe('validateSourceRegistry invariants', () => {
    it('rejects duplicate artifact keys', () => {
      const entry = makeOscalEntry({ catalogKey: undefined, expectedRootType: 'profile' });
      expect(() => validateSourceRegistry([entry, { ...entry, upstreamPath: 'Other/x.json' }])).toThrow(
        /artifactKey/,
      );
    });

    it('rejects duplicate upstream paths and catalog keys', () => {
      expect(() =>
        validateSourceRegistry([
          makeOscalEntry({ artifactKey: 'catalog-a' }),
          makeOscalEntry({ artifactKey: 'catalog-b', catalogKey: 'wlan' }),
        ]),
      ).toThrow(/upstreamPath/);
      expect(() =>
        validateSourceRegistry([
          makeOscalEntry({ artifactKey: 'catalog-a' }),
          makeOscalEntry({ artifactKey: 'catalog-b', upstreamPath: 'Other/x.json' }),
        ]),
      ).toThrow(/catalogKey/);
    });

    it('requires catalogKey exactly for catalog root types', () => {
      expect(() => validateSourceRegistry([makeOscalEntry({ catalogKey: undefined })])).toThrow(
        /catalogKey/,
      );
      expect(() =>
        validateSourceRegistry([
          makeOscalEntry({ expectedRootType: 'profile', artifactKey: 'profile-test' }),
        ]),
      ).toThrow(/catalogKey/);
    });

    it('rejects keys outside the allowed grammar', () => {
      expect(() => validateSourceRegistry([makeOscalEntry({ artifactKey: 'Catalog-Test' })])).toThrow(
        /grammar/i,
      );
      expect(() => validateSourceRegistry([makeOscalEntry({ artifactKey: 'catalog-test-' })])).toThrow(
        /grammar/i,
      );
    });

    it('rejects unsafe upstream paths', () => {
      expect(() => validateSourceRegistry([makeOscalEntry({ upstreamPath: '../etc/passwd' })])).toThrow(
        /unsafe/i,
      );
      expect(() => validateSourceRegistry([makeOscalEntry({ upstreamPath: '/absolute.json' })])).toThrow(
        /unsafe/i,
      );
      expect(() => validateSourceRegistry([makeOscalEntry({ upstreamPath: 'a//b.json' })])).toThrow(
        /unsafe/i,
      );
      expect(() => validateSourceRegistry([makeOscalEntry({ upstreamPath: 'a\\b.json' })])).toThrow(
        /unsafe/i,
      );
    });

    it('rejects unknown lifecycle or root type values', () => {
      expect(() =>
        validateSourceRegistry([
          makeOscalEntry({ lifecycle: 'experimental' as never }),
        ]),
      ).toThrow(/lifecycle/);
      expect(() =>
        validateSourceRegistry([
          makeOscalEntry({ expectedRootType: 'plan' as never }),
        ]),
      ).toThrow(/root type/i);
    });

    it('requires an exact BSI issue only for blocked upstream artifacts', () => {
      expect(() =>
        validateSourceRegistry([
          makeOscalEntry({ lifecycle: 'blocked-by-upstream' }),
        ]),
      ).toThrow(/requires a BSI upstream issue/);
      expect(() =>
        validateSourceRegistry([
          makeOscalEntry({
            lifecycle: 'blocked-by-upstream',
            upstreamIssue: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/1',
          }),
        ]),
      ).not.toThrow();
      expect(() =>
        validateSourceRegistry([
          makeOscalEntry({
            upstreamIssue: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/1',
          }),
        ]),
      ).toThrow(/Only blocked source registry entries/);
    });
  });
});
