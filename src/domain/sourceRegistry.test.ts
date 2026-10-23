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
  deriveCompanionArtifactKey,
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
  listProductUpstreamPaths,
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

  it('ships the entry, Lieferkette, and WLAN catalogs', () => {
    expect(SUPPORTED_CATALOG_KEYS).toEqual(['gspp', 'lieferkette', 'wlan']);
    expect(SUPPORTED_CATALOGS.map((entry) => entry.artifactKey)).toEqual([
      'catalog-gspp',
      'catalog-lieferkette',
      'catalog-wlan',
    ]);
  });

  it('limits the supported lifecycle exactly to all shipped catalogs and the namespace collection', () => {
    const supported = listArtifacts({ lifecycle: 'supported' });
    expect(supported.map((entry) => entry.artifactKey).sort()).toEqual([
      'catalog-gspp',
      'catalog-lieferkette',
      'catalog-wlan',
      'namespaces-bsi',
    ]);
  });

  it('registers exactly the product artifacts and the profile path of each shipped catalog', () => {
    expect(SOURCE_REGISTRY.map((entry) => entry.artifactKey)).toEqual([
      'catalog-gspp',
      'namespaces-bsi',
      'catalog-lieferkette',
      'catalog-wlan',
      'catalog-mindeststandard-tls',
    ]);
    expect(
      SUPPORTED_CATALOGS.map((entry) => [entry.catalogKey, entry.profileUpstreamPath]),
    ).toEqual([
      ['gspp', 'control_layer/Grundschutz++/sources/profiles/Grundschutz++-profile.json'],
      ['lieferkette', 'control_layer/Lieferkettensicherheit/sources/profiles/Lieferkettensicherheit-profile.json'],
      ['wlan', 'control_layer/WLAN/sources/profiles/WLAN-profile.json'],
    ]);
    expect(listProductUpstreamPaths()).toEqual(listOscalArtifacts().map((entry) => entry.upstreamPath));
  });

  it('rejects a profile path outside the monitored roots or on a non-catalog entry', () => {
    expect(() =>
      validateSourceRegistry([makeOscalEntry({ profileUpstreamPath: 'other/Test-profile.json' })]),
    ).toThrow(/Invalid profileUpstreamPath/);
    expect(() =>
      validateSourceRegistry([
        makeOscalEntry({
          expectedRootType: 'profile',
          catalogKey: undefined,
          profileUpstreamPath: 'control_layer/Test/Test-profile.json',
        }),
      ]),
    ).toThrow(/Invalid profileUpstreamPath/);
    expect(() =>
      validateSourceRegistry([
        makeOscalEntry({ profileUpstreamPath: 'control_layer/Test/Test-catalog.json' }),
      ]),
    ).toThrow(/Duplicate upstreamPath/);
  });

  it('derives a grammar-conformant companion key from the path', () => {
    expect(deriveCompanionArtifactKey('control_layer/Kernel/BSI-Stand-der-Technik-Kernel-catalog.json'))
      .toBe('control-layer-kernel-bsi-stand-der-technik-kernel-catalog');
    expect(
      deriveCompanionArtifactKey('implementation_layer/AWS Beispiel-Components/AWS Security Hub-component_definition.json'),
    ).toBe('implementation-layer-aws-beispiel-components-aws-security-hub-component-definition');
    expect(deriveCompanionArtifactKey('control_layer/Grundschutz++/x.json')).toBe('control-layer-grundschutz-x');
    expect(deriveCompanionArtifactKey('control_layer/catalog.csv')).toBeNull();
    expect(deriveCompanionArtifactKey('../control_layer/catalog.json')).toBeNull();
    expect(deriveCompanionArtifactKey('1/2.json')).toBeNull();
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
    expect(getArtifactByUpstreamPath('')).toBeNull();
  });

  it('reports the expected OSCAL root type per product path only', () => {
    expect(getExpectedRootType(OFFICIAL_CATALOG_PATH)).toBe('catalog');
    expect(
      getExpectedRootType(
        'control_layer/Lieferkettensicherheit/Lieferkettensicherheit-resolved_catalog.json',
      ),
    ).toBe('catalog');
    expect(getExpectedRootType('control_layer/WLAN/sources/profiles/WLAN-profile.json')).toBeNull();
    expect(getExpectedRootType('documentation/namespaces/tags.csv')).toBeNull();
    expect(getExpectedRootType('unknown.json')).toBeNull();
  });

  it('exposes catalog entries by key', () => {
    expect(getCatalogByKey('gspp')?.artifactKey).toBe('catalog-gspp');
    expect(getCatalogByKey('lieferkette')?.lifecycle).toBe('supported');
    expect(getCatalogByKey('wlan')?.lifecycle).toBe('supported');
    expect(getCatalogByKey('unbekannt')).toBeNull();
  });

  it('keeps the CatalogKey union and the runtime keys in sync', () => {
    expect([...listCatalogKeys()].sort()).toEqual([...EXPECTED_CATALOG_KEYS].sort());
  });

  it('narrows catalog keys with isCatalogKey', () => {
    expect(isCatalogKey('gspp')).toBe(true);
    expect(isCatalogKey('iso27001-annex-a')).toBe(false);
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
     * Die aus `metadata.oscal-version` ausgelesenen Versionen aller
     * registrierten Produktartefakte. Blob-SHA und SHA-256 der
     * Quelldokumente wurden dabei gegen `upstream-manifest.json` geprüft.
     *
     * Dieser Erwartungswert wird bewusst ausgeschrieben statt aus der Registry
     * abgeleitet: Er ist das unabhängige Orakel, das eine stille Änderung an
     * der Registry auffällig macht.
     */
    const DECLARED_UPSTREAM_VERSIONS: Record<string, string> = {
      'catalog-gspp': '1.1.3',
      'catalog-lieferkette': '1.1.3',
      'catalog-mindeststandard-tls': '1.1.3',
      'catalog-wlan': '1.1.3',
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

    it('exposes the expected version per upstream path', () => {
      expect(getExpectedOscalVersion(OFFICIAL_CATALOG_PATH)).toBe('1.1.3');
      expect(
        getExpectedOscalVersion(
          'control_layer/Mappings/IT-GS2023-zu-GSpp/ITGS-to-GS++-mapping_collection.json',
        ),
      ).toBeNull();
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
        'catalog-wlan.json',
        'catalog-wlan-metadata.json',
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

    it('allows unshipped source catalogs without a catalogKey but requires it for app delivery', () => {
      expect(() => validateSourceRegistry([makeOscalEntry({ catalogKey: undefined })])).not.toThrow();
      expect(() =>
        validateSourceRegistry([
          makeOscalEntry({ catalogKey: undefined, lifecycle: 'supported' }),
        ]),
      ).toThrow(/catalogKey/);
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
      expect(() =>
        validateSourceRegistry([makeOscalEntry({ artifactKey: '1catalog-test' })]),
      ).toThrow(/grammar/i);
      expect(() =>
        validateSourceRegistry([
          makeOscalEntry({ catalogKey: '1catalog-test' as CatalogKey }),
        ]),
      ).toThrow(/grammar/i);
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
