// @vitest-environment node
// =============================================================================
// Positivkorpus — Verlustfreiheit am realen Grundschutz++-Katalog
//
// Der Katalog wird nie committet, sondern bei jedem Build frisch von BSI
// geholt. Deshalb prüft diese Datei ausschließlich **Erhaltung**, nie feste
// Inhaltszahlen: Assertions gegen "genau 999 Controls" oder "genau 20
// prop.remarks" wären beim nächsten Upstream-Update rot, ohne dass etwas
// kaputt ist. Die inhaltlich festgenagelten Strukturprüfungen liegen im
// eingefrorenen Fixture in `oscalDocument.test.ts`.
//
// Ohne `npm run fetch-catalog` fehlt die Datei; die Suite wird dann
// übersprungen statt fehlzuschlagen.
// =============================================================================

import { beforeAll, describe, it, expect } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCatalogDocument } from './oscalDocument';
import { SUPPORTED_CATALOG_KEY } from '@/domain/sourceRegistry';
import {
  arrayOrderSignature,
  contentMultiset,
  countContainers,
  countPropRemarks,
  missingFromMultiset,
} from '@/test/oscalStructure';

/** Relativ zum Projektwurzelverzeichnis, dem Arbeitsverzeichnis des Testlaufs. */
const catalogPath = process.env.GSPP_CATALOG_CORPUS_PATH ?? 'public/data/catalog.json';
const catalogAvailable = existsSync(catalogPath);

function loadCatalogCorpus(path: string) {
  const text = readFileSync(path, 'utf8');
  const original = JSON.parse(text);

  return {
    original,
    document: parseCatalogDocument(original, {
      catalogKey: SUPPORTED_CATALOG_KEY,
      trustClass: 'class-1-verified-public',
    }),
  };
}

describe('Katalogkorpus — Fail-closed-Dateizugriff', () => {
  it('weist eine vorhandene Datei ohne OSCAL-Root mit der Dispatcher-Diagnose ab', () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'gspp-catalog-corpus-'));
    const fixturePath = join(fixtureDirectory, 'catalog.json');

    try {
      writeFileSync(fixturePath, '{}', 'utf8');

      expect(existsSync(fixturePath)).toBe(true);
      expect(() => loadCatalogCorpus(fixturePath)).toThrow('OSCAL_ROOT_KEY_MISSING');
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!catalogAvailable)('Verlustfreiheit am realen Katalog', () => {
  let corpus: ReturnType<typeof loadCatalogCorpus> | null = null;

  beforeAll(() => {
    corpus = loadCatalogCorpus(catalogPath);
  });

  function currentCorpus(): ReturnType<typeof loadCatalogCorpus> {
    if (corpus === null) throw new Error('Katalogkorpus wurde nicht geladen.');
    return corpus;
  }

  it('enthält die geprüften Strukturen überhaupt', () => {
    const { document, original } = currentCorpus();

    // Ohne diese Schranke liefe der Erhaltungsnachweis leer durch: Ein
    // Katalog ohne prop.remarks würde jeden Vergleich trivial bestehen.
    expect(countPropRemarks(original)).toBeGreaterThan(0);
    expect(document.view.totalControls).toBeGreaterThan(0);
  });

  it('verliert nach der Inhalts-Multiset-Regel kein Element', () => {
    const { document, original } = currentCorpus();

    const missing = missingFromMultiset(
      contentMultiset(original),
      contentMultiset(document.source),
    );

    expect(missing).toEqual([]);
  });

  it('erzeugt kein Element, das im Original fehlt', () => {
    const { document, original } = currentCorpus();

    const added = missingFromMultiset(
      contentMultiset(document.source),
      contentMultiset(original),
    );

    expect(added).toEqual([]);
  });

  it('erhält alle Array-Reihenfolgen', () => {
    const { document, original } = currentCorpus();

    expect(arrayOrderSignature(document.source)).toEqual(arrayOrderSignature(original));
  });

  it('erhält jedes prop.remarks des Originals', () => {
    const { document, original } = currentCorpus();

    expect(countPropRemarks(document.source)).toBe(countPropRemarks(original));
  });

  it('serialisiert den Quellgraphen zeichengleich zum geparsten Original', () => {
    const { document, original } = currentCorpus();

    expect(JSON.stringify(document.source)).toBe(JSON.stringify(original));
  });

  it('lässt Dokument-UUID und metadata.last-modified unverändert', () => {
    const { document, original } = currentCorpus();

    const before = original.catalog;
    const after = (document.source as typeof original).catalog;

    expect(after.uuid).toBe(before.uuid);
    expect(after.metadata['last-modified']).toBe(before.metadata['last-modified']);
  });

  it('belegt den bisherigen Verlust an einem realen, nicht projizierten Feld', () => {
    const { document, original } = currentCorpus();

    // metadata.document-ids existiert im Katalog, hat aber keine Entsprechung
    // im Domänenmodell. Vor dieser Umstellung war es nach dem Parsen weg.
    expect(original.catalog.metadata['document-ids']).toBeDefined();
    expect(document.view.metadata).not.toHaveProperty('documentIds');
    expect(
      (document.source as typeof original).catalog.metadata['document-ids'],
    ).toEqual(original.catalog.metadata['document-ids']);
  });

  it('hält die Container-Zahl in der für den Heap-Referenzwert erwarteten Größenordnung', () => {
    const { document } = currentCorpus();

    // Der Referenzwert aus GSPP-280 (21.289 Container) wurde an einem älteren
    // Katalogstand gemessen; der Wert wandert mit jedem Upstream-Update.
    // Geprüft wird deshalb die Größenordnung, nicht die exakte Zahl — sie
    // bindet den Wert je Container aus oscalDocument.heap.node.test.ts an
    // ein plausibles Dokument.
    const { total } = countContainers(document.source);

    expect(total).toBeGreaterThan(15_000);
    expect(total).toBeLessThan(30_000);
  });
});
