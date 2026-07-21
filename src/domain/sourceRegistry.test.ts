import { describe, expect, it } from 'vitest';
import {
  SOURCE_REGISTRY,
  SUPPORTED_CATALOG,
  SUPPORTED_CATALOG_KEY,
  getArtifactByUpstreamPath,
  getCatalogByKey,
  getExpectedRootType,
  isCatalogKey,
  listArtifacts,
  listCatalogKeys,
  validateSourceRegistry,
  type CatalogKey,
  type OscalArtifactEntry,
} from '@/domain/sourceRegistry';

const OFFICIAL_CATALOG_PATH = 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json';

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
    expectedRootType: 'catalog',
    catalogKey: 'gspp',
    upstreamPath: 'Anwenderkataloge/Test/Test-catalog.json',
    lifecycle: 'preview',
    title: 'Test',
    ...overrides,
  } as OscalArtifactEntry;
}

describe('sourceRegistry', () => {
  it('validates the shipped registry without errors', () => {
    expect(() => validateSourceRegistry()).not.toThrow();
  });

  it('declares gspp as the supported catalog', () => {
    expect(SUPPORTED_CATALOG_KEY).toBe('gspp');
    expect(SUPPORTED_CATALOG.catalogKey).toBe('gspp');
    expect(SUPPORTED_CATALOG.upstreamPath).toBe(OFFICIAL_CATALOG_PATH);
    expect(SUPPORTED_CATALOG.lifecycle).toBe('supported');
  });

  it('limits the supported lifecycle exactly to the Grundschutz++ catalog and the namespace collection', () => {
    const supported = listArtifacts({ lifecycle: 'supported' });
    expect(supported.map((entry) => entry.artifactKey).sort()).toEqual([
      'catalog-gspp',
      'namespaces-bsi',
    ]);
  });

  it('resolves the official catalog path to the supported entry', () => {
    const entry = getArtifactByUpstreamPath(OFFICIAL_CATALOG_PATH);
    expect(entry?.artifactKey).toBe('catalog-gspp');
  });

  it('resolves direct namespace CSV children to the vocabulary collection', () => {
    expect(getArtifactByUpstreamPath('Dokumentation/namespaces/tags.csv')?.artifactKey).toBe(
      'namespaces-bsi',
    );
    expect(getArtifactByUpstreamPath('Dokumentation/namespaces/nested/tags.csv')).toBeNull();
    expect(getArtifactByUpstreamPath('Dokumentation/namespaces/readme.md')).toBeNull();
    expect(getArtifactByUpstreamPath('Dokumentation/namespaces')).toBeNull();
  });

  it('rejects unknown upstream paths', () => {
    expect(getArtifactByUpstreamPath('Dokumentation/readme.md')).toBeNull();
    expect(getArtifactByUpstreamPath('Quellkataloge/Kernel/BSI-Stand-der-Technik-Kernel-catalog.json')).toBeNull();
    expect(getArtifactByUpstreamPath('')).toBeNull();
  });

  it('reports the expected OSCAL root type per registered path', () => {
    expect(getExpectedRootType(OFFICIAL_CATALOG_PATH)).toBe('catalog');
    expect(
      getExpectedRootType('Anwenderkataloge/Lieferkettensicherheit/Lieferkettensicherheit-catalog.json'),
    ).toBe('catalog');
    expect(getExpectedRootType('Mappings/IT-GS2023-zu-GSpp/ITGS-to-GS++-mapping.json')).toBe(
      'mapping-collection',
    );
    expect(getExpectedRootType('Quellkataloge/WLAN/WLAN-profile.json')).toBe('profile');
    expect(
      getExpectedRootType(
        'Implementierungsbeschreibungen/Komponenten/WLAN/WLAN-component_definition.json',
      ),
    ).toBe('component-definition');
    expect(getExpectedRootType('Dokumentation/namespaces/tags.csv')).toBeNull();
    expect(getExpectedRootType('unknown.json')).toBeNull();
  });

  it('exposes catalog entries by key', () => {
    expect(getCatalogByKey('gspp')?.artifactKey).toBe('catalog-gspp');
    expect(getCatalogByKey('lieferkette')?.lifecycle).toBe('preview');
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
  });
});
