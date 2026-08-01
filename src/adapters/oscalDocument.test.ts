import { describe, it, expect } from 'vitest';
import { parseCatalogDocument } from './oscalDocument';
import {
  LOSSLESS_CATALOG_JSON,
  makeLosslessCatalogSource,
} from '@/test/fixtures/losslessCatalog';
import {
  arrayOrderSignature,
  contentMultiset,
  countPropRemarks,
  deepFreeze,
  missingFromMultiset,
  scalarLeafPaths,
} from '@/test/oscalStructure';
import type { CatalogDocumentContext } from '@/domain/models';

const context: CatalogDocumentContext = {
  catalogKey: 'gspp',
  trustClass: 'class-1-verified-public',
};

function parseFixture() {
  return parseCatalogDocument(makeLosslessCatalogSource(), context);
}

/** Erreicht einen Pfad im Quellgraphen; wirft, wenn er fehlt. */
function at(source: unknown, path: readonly (string | number)[]): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') {
      throw new Error(`Pfad ${path.join('.')} bricht bei "${String(segment)}" ab`);
    }
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/* ------------------------------------------------------------------ */
/*  §1 Originalknoten                                                  */
/* ------------------------------------------------------------------ */

describe('parseCatalogDocument — Quellgraph (§1)', () => {
  it('hält den übergebenen Quellgraphen unverändert am Dokument', () => {
    const source = makeLosslessCatalogSource();

    const document = parseCatalogDocument(source, context);

    expect(document.source).toBe(source);
  });

  it('leitet das Domänenmodell als view ab', () => {
    const document = parseFixture();

    expect(document.view.totalControls).toBe(4);
    expect(document.view.controlsById.has('GC.1.1.1')).toBe(true);
    expect(document.view.controlsByAltIdentifier.has('alt-orp-1')).toBe(true);
  });

  it('weist einen strukturell ungültigen Katalog ab', () => {
    expect(() => parseCatalogDocument({ catalog: { uuid: 'x' } }, context)).toThrow(
      'Invalid OSCAL catalog',
    );
  });
});

/* ------------------------------------------------------------------ */
/*  §2 view = derive(source, context)                                  */
/* ------------------------------------------------------------------ */

describe('parseCatalogDocument — expliziter Kontext (§2)', () => {
  it('führt den übergebenen Kontext am Dokument mit', () => {
    const document = parseFixture();

    expect(document.context).toEqual({
      catalogKey: 'gspp',
      trustClass: 'class-1-verified-public',
    });
  });

  it('projiziert den catalogKey aus dem Kontext, nicht aus dem Dokument', () => {
    const document = parseCatalogDocument(makeLosslessCatalogSource(), {
      catalogKey: 'wlan',
      trustClass: 'class-1-verified-public',
    });

    expect(document.view.catalogKey).toBe('wlan');
  });

  it('leitet aus gleichem Quellgraphen und Kontext dasselbe view ab', () => {
    const first = parseFixture();
    const second = parseFixture();

    expect(second.view.controls).toEqual(first.view.controls);
    expect(second.view.metadata).toEqual(first.view.metadata);
    expect(second.view.backMatter).toEqual(first.view.backMatter);
  });
});

/* ------------------------------------------------------------------ */
/*  Strukturerhalt — konkrete OSCAL-Strukturen                         */
/* ------------------------------------------------------------------ */

describe('parseCatalogDocument — Strukturerhalt', () => {
  it('erhält prop.remarks samt class, group und uuid', () => {
    const { source } = parseFixture();
    const prop = at(source, ['catalog', 'metadata', 'props', 0]) as Record<string, unknown>;

    expect(prop.remarks).toBe('Diese Bemerkung existiert nur im Quellgraphen.');
    expect(prop.class).toBe('informational');
    expect(prop.group).toBe('publication');
    expect(prop.uuid).toBe('aaaaaaaa-0000-0000-0000-000000000001');
    expect(countPropRemarks(source)).toBe(3);
  });

  it('erhält link.resource-fragment und link.media-type', () => {
    const { source } = parseFixture();
    const metadataLink = at(source, ['catalog', 'metadata', 'links', 0]) as Record<
      string,
      unknown
    >;
    const controlLink = at(source, [
      'catalog', 'groups', 0, 'groups', 0, 'controls', 0, 'links', 0,
    ]) as Record<string, unknown>;

    expect(metadataLink['resource-fragment']).toBe('kapitel-3');
    expect(metadataLink['media-type']).toBe('application/oscal+json');
    expect(controlLink['resource-fragment']).toBe('abschnitt-2.4');
    expect(controlLink['media-type']).toBe('application/pdf');
  });

  it('erhält back-matter-Ressourcen ohne Inhalt', () => {
    const { source } = parseFixture();
    const resource = at(source, ['catalog', 'back-matter', 'resources', 0]);

    expect(resource).toEqual({ uuid: 'dddddddd-0000-0000-0000-000000000001' });
  });

  it('erhält citation und document-ids einer back-matter-Ressource', () => {
    const { source } = parseFixture();
    const resource = at(source, ['catalog', 'back-matter', 'resources', 1]) as Record<
      string,
      unknown
    >;

    expect(resource.citation).toEqual({ text: 'BSI, Grundschutz++, 2026' });
    expect(resource['document-ids']).toEqual([
      { scheme: 'https://www.doi.org/', identifier: '10.1000/quelle' },
    ]);
  });

  it('erhält metadata.revisions vollständig', () => {
    const { source } = parseFixture();
    const revisions = at(source, ['catalog', 'metadata', 'revisions']) as unknown[];

    expect(revisions).toHaveLength(2);
    expect((revisions[0] as Record<string, unknown>).remarks).toBe(
      'Revisionshistorie ist Teil des Dokuments.',
    );
  });

  it('erhält metadata.document-ids und metadata.locations', () => {
    const { source } = parseFixture();

    expect(at(source, ['catalog', 'metadata', 'document-ids'])).toHaveLength(1);
    expect(at(source, ['catalog', 'metadata', 'locations', 0, 'address', 'city'])).toBe(
      'Bonn',
    );
  });

  it('erhält control.class und verschachtelte Sub-Controls', () => {
    const { source } = parseFixture();
    const control = at(source, [
      'catalog', 'groups', 0, 'groups', 0, 'controls', 0,
    ]) as Record<string, unknown>;

    expect(control.class).toBe('BSI-Methodik-Grundschutz-plus-plus');
    expect((control.controls as unknown[])[0]).toMatchObject({
      id: 'GC.1.1.1',
      class: 'verstaerkung',
    });
  });

  it('erhält alle Array-Reihenfolgen des Originals', () => {
    const { source } = parseFixture();

    expect(arrayOrderSignature(source)).toEqual(
      arrayOrderSignature(JSON.parse(LOSSLESS_CATALOG_JSON)),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  §3 Unbekannte Felder und Extensions                                */
/* ------------------------------------------------------------------ */

describe('parseCatalogDocument — Extensions (§3)', () => {
  it('erhält herstellerspezifische props mit eigenem ns', () => {
    const { source } = parseFixture();
    const vendorProp = at(source, ['catalog', 'metadata', 'props', 1]);

    expect(vendorProp).toEqual({
      name: 'vendor-classification',
      ns: 'https://example.vendor.invalid/ns/oscal',
      value: 'internal-only',
      remarks: 'Herstellerspezifische Extension mit eigenem ns.',
    });
  });

  it('erhält im Domänenmodell unbekannte Felder auf allen Ebenen', () => {
    const { source } = parseFixture();

    expect(at(source, ['catalog', 'x-fixture-unknown-catalog-field'])).toEqual([
      'erhalten',
      'bleiben',
    ]);
    expect(
      at(source, ['catalog', 'metadata', 'x-fixture-unknown-metadata-field', 'leerobjekt']),
    ).toEqual({});
    expect(
      at(source, [
        'catalog', 'groups', 0, 'groups', 0, 'controls', 1,
        'x-fixture-unknown-control-field',
      ]),
    ).toBe('nur im source');
  });

  it('hebt unbekannte Felder nicht ins view', () => {
    const { view } = parseFixture();

    expect(view).not.toHaveProperty('x-fixture-unknown-catalog-field');
    expect(view.metadata).not.toHaveProperty('x-fixture-unknown-metadata-field');
    expect(view.controlsById.get('GC.1.2')).not.toHaveProperty(
      'x-fixture-unknown-control-field',
    );
  });
});

/* ------------------------------------------------------------------ */
/*  §0 No-op-Serialisierung                                            */
/* ------------------------------------------------------------------ */

describe('parseCatalogDocument — No-op-Serialisierung (§0)', () => {
  it('serialisiert den Quellgraphen zeichengleich zum geparsten Original', () => {
    const { source } = parseFixture();

    expect(JSON.stringify(source)).toBe(
      JSON.stringify(JSON.parse(LOSSLESS_CATALOG_JSON)),
    );
  });

  it('verliert nach der Inhalts-Multiset-Regel kein Element', () => {
    const { source } = parseFixture();

    const missing = missingFromMultiset(
      contentMultiset(JSON.parse(LOSSLESS_CATALOG_JSON)),
      contentMultiset(source),
    );

    expect(missing).toEqual([]);
  });

  it('erzeugt kein Element, das im Original fehlt', () => {
    const { source } = parseFixture();

    const added = missingFromMultiset(
      contentMultiset(source),
      contentMultiset(JSON.parse(LOSSLESS_CATALOG_JSON)),
    );

    expect(added).toEqual([]);
  });

  it('behält jedes skalare Blatt an seinem Pfad', () => {
    const { source } = parseFixture();

    expect(scalarLeafPaths(source)).toEqual(
      scalarLeafPaths(JSON.parse(LOSSLESS_CATALOG_JSON)),
    );
  });

  it('lässt Dokument-UUID und metadata.last-modified unverändert', () => {
    const original = JSON.parse(LOSSLESS_CATALOG_JSON);
    const { source } = parseFixture();

    expect(at(source, ['catalog', 'uuid'])).toBe(at(original, ['catalog', 'uuid']));
    expect(at(source, ['catalog', 'metadata', 'last-modified'])).toBe(
      at(original, ['catalog', 'metadata', 'last-modified']),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  §1 Nicht-Mutation (Negativtest)                                    */
/* ------------------------------------------------------------------ */

describe('parseCatalogDocument — Nicht-Mutation (§1)', () => {
  it('leitet aus einem eingefrorenen Quellgraphen ab, ohne zu schreiben', () => {
    const frozen = deepFreeze(makeLosslessCatalogSource());

    expect(() => parseCatalogDocument(frozen, context)).not.toThrow();
  });

  it('lässt den Quellgraphen vor und nach der Ableitung unverändert', () => {
    const source = makeLosslessCatalogSource();
    const before = JSON.stringify(source);

    parseCatalogDocument(source, context);

    expect(JSON.stringify(source)).toBe(before);
  });

  it('trennt den Quellgraphen von Mutationen am view', () => {
    const document = parseFixture();

    document.view.controls[0].tags.push('nachträglich');

    expect(JSON.stringify(document.source)).toBe(
      JSON.stringify(JSON.parse(LOSSLESS_CATALOG_JSON)),
    );
  });
});
