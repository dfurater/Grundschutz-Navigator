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

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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
const catalogPath = 'public/data/catalog.json';
const catalogAvailable = existsSync(catalogPath);

describe.skipIf(!catalogAvailable)('Verlustfreiheit am realen Katalog', () => {
  const text = catalogAvailable ? readFileSync(catalogPath, 'utf8') : '{}';
  const document = parseCatalogDocument(JSON.parse(text), {
    catalogKey: SUPPORTED_CATALOG_KEY,
    trustClass: 'class-1-verified-public',
  });
  const original = JSON.parse(text);

  it('enthält die geprüften Strukturen überhaupt', () => {
    // Ohne diese Schranke liefe der Erhaltungsnachweis leer durch: Ein
    // Katalog ohne prop.remarks würde jeden Vergleich trivial bestehen.
    expect(countPropRemarks(original)).toBeGreaterThan(0);
    expect(document.view.totalControls).toBeGreaterThan(0);
  });

  it('verliert nach der Inhalts-Multiset-Regel kein Element', () => {
    const missing = missingFromMultiset(
      contentMultiset(original),
      contentMultiset(document.source),
    );

    expect(missing).toEqual([]);
  });

  it('erzeugt kein Element, das im Original fehlt', () => {
    const added = missingFromMultiset(
      contentMultiset(document.source),
      contentMultiset(original),
    );

    expect(added).toEqual([]);
  });

  it('erhält alle Array-Reihenfolgen', () => {
    expect(arrayOrderSignature(document.source)).toEqual(arrayOrderSignature(original));
  });

  it('erhält jedes prop.remarks des Originals', () => {
    expect(countPropRemarks(document.source)).toBe(countPropRemarks(original));
  });

  it('serialisiert den Quellgraphen zeichengleich zum geparsten Original', () => {
    expect(JSON.stringify(document.source)).toBe(JSON.stringify(original));
  });

  it('lässt Dokument-UUID und metadata.last-modified unverändert', () => {
    const before = original.catalog;
    const after = (document.source as typeof original).catalog;

    expect(after.uuid).toBe(before.uuid);
    expect(after.metadata['last-modified']).toBe(before.metadata['last-modified']);
  });

  it('belegt den bisherigen Verlust an einem realen, nicht projizierten Feld', () => {
    // metadata.document-ids existiert im Katalog, hat aber keine Entsprechung
    // im Domänenmodell. Vor dieser Umstellung war es nach dem Parsen weg.
    expect(original.catalog.metadata['document-ids']).toBeDefined();
    expect(document.view.metadata).not.toHaveProperty('documentIds');
    expect(
      (document.source as typeof original).catalog.metadata['document-ids'],
    ).toEqual(original.catalog.metadata['document-ids']);
  });

  it('hält die Container-Zahl in der für den Heap-Referenzwert erwarteten Größenordnung', () => {
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
