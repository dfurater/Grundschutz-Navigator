import { describe, expect, it } from 'vitest';
import { resolveActiveCatalogLineage } from '@/domain/catalogLineageValidation';
import type {
  CatalogLineageDocument,
  CatalogLineageImport,
  CatalogLineageProjection,
  CatalogLineageState,
} from '@/domain/catalogLineage';

function makeDocument(artifactKey = 'profile-gspp'): CatalogLineageDocument {
  return {
    artifactKey,
    title: 'Dokumenttitel',
    documentUuid: 'document-uuid',
    oscalVersion: '1.1.3',
    version: '2026-08-13',
    upstreamPath: 'sources/document.json',
    gitBlobSha: 'document-blob',
    contentSha256: 'document-sha',
  };
}

function makeImport(): CatalogLineageImport {
  return {
    index: 0,
    state: 'complete',
    importHref: '#kernel-resource',
    resourceUuid: 'kernel-resource',
    rlinkHref: '../catalogs/kernel.json',
    source: makeDocument('catalog-source-gspp-kernel-g0'),
  };
}

function makeLineage(): CatalogLineageProjection {
  return { catalogKey: 'gspp', profile: makeDocument(), imports: [makeImport()] };
}

const absent = { lineage: null, invalid: false };
const invalid = { lineage: null, invalid: true };
const malformedShapes = [undefined, null, true, 42, 'document', [], {}];
const nullableDocumentFields = [
  'title', 'documentUuid', 'oscalVersion', 'version',
  'upstreamPath', 'gitBlobSha', 'contentSha256',
] as const;
const unresolvedStates: Exclude<CatalogLineageState, 'complete' | 'configured-import-missing'>[] = [
  'import-href-missing', 'import-href-not-fragment', 'resource-missing',
  'resource-ambiguous', 'rlink-missing', 'rlink-ambiguous',
  'artifact-unregistered', 'import-duplicate',
];

describe('resolveActiveCatalogLineage', () => {
  it.each([undefined, [], [makeLineage()]])(
    'reports absent lineage when there is no active match: %j',
    (lineages) => {
      expect(resolveActiveCatalogLineage(lineages, 'wlan')).toEqual(absent);
    },
  );

  it.each([null, true, 42, 'lineages', {}])(
    'rejects a present sidecar that is not an array: %j',
    (lineages) => {
      expect(resolveActiveCatalogLineage(lineages, 'gspp')).toEqual(invalid);
    },
  );

  it('selects exactly the active catalog and ignores malformed unrelated entries', () => {
    const active = { ...makeLineage(), catalogKey: 'wlan' };
    const lineages = [...malformedShapes, makeLineage(), { catalogKey: 'lieferkette' }, active];

    expect(resolveActiveCatalogLineage(lineages, 'wlan')).toEqual({
      lineage: active, invalid: false,
    });
    expect(resolveActiveCatalogLineage(lineages, 'lieferkette')).toEqual(invalid);
  });

  it.each([makeLineage(), { catalogKey: 'gspp' }])(
    'rejects duplicate active entries even if one is malformed',
    (duplicate) => {
      expect(resolveActiveCatalogLineage([makeLineage(), duplicate], 'gspp')).toEqual(invalid);
    },
  );

  it('returns the validated entry by reference without changing frozen input', () => {
    const source = Object.freeze(makeDocument('catalog-source-gspp-kernel-g0'));
    const imported = Object.freeze({ ...makeImport(), source });
    const lineage = Object.freeze({
      catalogKey: 'gspp',
      profile: Object.freeze(makeDocument()),
      imports: Object.freeze([imported]),
    });
    const lineages = Object.freeze([lineage]);
    const before = JSON.stringify(lineages);

    expect(resolveActiveCatalogLineage(lineages, 'gspp').lineage).toBe(lineage);
    expect(JSON.stringify(lineages)).toBe(before);
  });

  it('accepts a valid profile with no imports', () => {
    const lineage = { ...makeLineage(), imports: [] };
    expect(resolveActiveCatalogLineage([lineage], 'gspp')).toEqual({
      lineage, invalid: false,
    });
  });

  it.each(malformedShapes)('rejects invalid profile documents: %j', (profile) => {
    expect(resolveActiveCatalogLineage([{ ...makeLineage(), profile }], 'gspp')).toEqual(invalid);
  });

  it.each(malformedShapes)('rejects invalid complete source documents: %j', (source) => {
    const lineage = { ...makeLineage(), imports: [{ ...makeImport(), source }] };
    expect(resolveActiveCatalogLineage([lineage], 'gspp')).toEqual(invalid);
  });

  for (const location of ['profile', 'source'] as const) {
    it.each([undefined, null, 42, {}, []])(
      `rejects a non-string artifact key in the ${location}: %j`,
      (artifactKey) => {
        const document = { ...makeDocument(), artifactKey };
        const lineage = location === 'profile'
          ? { ...makeLineage(), profile: document }
          : { ...makeLineage(), imports: [{ ...makeImport(), source: document }] };
        expect(resolveActiveCatalogLineage([lineage], 'gspp')).toEqual(invalid);
      },
    );

    for (const field of nullableDocumentFields) {
      it.each([undefined, true, 42, {}, []])(
        `rejects an invalid ${location}.${field}: %j`,
        (value) => {
          const document = { ...makeDocument(), [field]: value };
          const lineage = location === 'profile'
            ? { ...makeLineage(), profile: document }
            : { ...makeLineage(), imports: [{ ...makeImport(), source: document }] };
          expect(resolveActiveCatalogLineage([lineage], 'gspp')).toEqual(invalid);
        },
      );
    }
  }

  it('accepts null document metadata without inferring missing values', () => {
    const document = {
      artifactKey: 'profile-gspp', title: null, documentUuid: null, oscalVersion: null,
      version: null, upstreamPath: null, gitBlobSha: null, contentSha256: null,
    };
    const lineage = {
      ...makeLineage(), profile: document, imports: [{ ...makeImport(), source: document }],
    };
    expect(resolveActiveCatalogLineage([lineage], 'gspp')).toEqual({ lineage, invalid: false });
  });

  it.each([undefined, null, true, 42, 'imports', {}])(
    'rejects a non-array imports field: %j',
    (imports) => {
      expect(resolveActiveCatalogLineage([{ ...makeLineage(), imports }], 'gspp')).toEqual(invalid);
    },
  );

  it.each(malformedShapes)('rejects malformed import entries: %j', (imported) => {
    const lineage = { ...makeLineage(), imports: [imported] };
    expect(resolveActiveCatalogLineage([lineage], 'gspp')).toEqual(invalid);
  });

  it.each([undefined, null, 42, 'unknown-state'])('rejects unknown import states: %j', (state) => {
    const lineage = { ...makeLineage(), imports: [{ ...makeImport(), state }] };
    expect(resolveActiveCatalogLineage([lineage], 'gspp')).toEqual(invalid);
  });

  it.each([undefined, null, -1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0'])(
    'rejects invalid indices for complete imports: %s',
    (index) => {
      const lineage = { ...makeLineage(), imports: [{ ...makeImport(), index }] };
      expect(resolveActiveCatalogLineage([lineage], 'gspp')).toEqual(invalid);
    },
  );

  it.each(unresolvedStates)('accepts the named unresolved state %s with a numeric index', (state) => {
    const lineage = { ...makeLineage(), imports: [{ ...makeImport(), state, source: null }] };
    expect(resolveActiveCatalogLineage([lineage], 'gspp')).toEqual({ lineage, invalid: false });
    const invalidIndex = { ...lineage, imports: [{ ...lineage.imports[0], index: null }] };
    expect(resolveActiveCatalogLineage([invalidIndex], 'gspp')).toEqual(invalid);
    const invalidSource = { ...lineage, imports: [{ ...lineage.imports[0], source: makeDocument() }] };
    expect(resolveActiveCatalogLineage([invalidSource], 'gspp')).toEqual(invalid);
  });

  it('requires a null index for a configured import absent from the profile', () => {
    const imported = {
      ...makeImport(), index: null, state: 'configured-import-missing',
      importHref: null, resourceUuid: null, source: null,
    };
    const lineage = { ...makeLineage(), imports: [imported] };
    expect(resolveActiveCatalogLineage([lineage], 'gspp')).toEqual({ lineage, invalid: false });
    expect(resolveActiveCatalogLineage([
      { ...lineage, imports: [{ ...imported, index: 0 }] },
    ], 'gspp')).toEqual(invalid);
  });

  for (const field of ['importHref', 'resourceUuid', 'rlinkHref'] as const) {
    it.each([undefined, true, 42, {}, []])(`rejects an invalid import ${field}: %j`, (value) => {
      const lineage = { ...makeLineage(), imports: [{ ...makeImport(), [field]: value }] };
      expect(resolveActiveCatalogLineage([lineage], 'gspp')).toEqual(invalid);
    });
  }

  it('accepts nullable import references without resolving them', () => {
    const imported = { ...makeImport(), importHref: null, resourceUuid: null, rlinkHref: null };
    const lineage = { ...makeLineage(), imports: [imported] };
    expect(resolveActiveCatalogLineage([lineage], 'gspp')).toEqual({ lineage, invalid: false });
  });
});
