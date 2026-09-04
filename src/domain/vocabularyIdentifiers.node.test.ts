// @vitest-environment node
// =============================================================================
// GSPP-380 — Abdeckung der Kennungserkennung am realen Artefakt
//
// Die Regel steht im Build-Skript, die Wirkung zeigt sich erst am erzeugten
// Artefakt. Dieser Test misst sie dort: Er nagelt keine Namespace-Namen fest,
// sondern die Invarianten der Regel selbst — ein Upstream, der eine Spalte
// hinzufügt oder umbenennt, verschiebt die Zahlen, ohne dass etwas kaputt ist.
//
// Ohne `npm run fetch-catalog` fehlt das Artefakt; die Suite wird dann
// übersprungen statt fehlzuschlagen.
// =============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { VocabularyRegistryData } from './models';
import { buildVocabularyRegistry, getIdentifierColumns } from './vocabulary';

const vocabulariesPath =
  process.env.GSPP_VOCABULARIES_PATH ?? 'public/data/vocabularies.json';
const vocabulariesAvailable = existsSync(vocabulariesPath);

/**
 * Gemessener Bestand am Upstream-Snapshot `9c820fd8b125`.
 *
 * Die Regelprüfung unten vergleicht Soll und Ist innerhalb desselben
 * Artefakts. Das deckt einen Fehler in der Ableitung auf, aber nicht den Fall,
 * dass Upstream eine Kennungsspalte entfernt oder umbenennt — dann wandern
 * beide Seiten gemeinsam. Diese Zahlen sind die Gegenprobe dazu: Sie werden
 * bei einer echten Spaltenänderung rot und sind dann bewusst nachzuziehen,
 * statt still mitzuwandern.
 */
const EXPECTED_NAMESPACE_COUNT = 13;
const EXPECTED_IDENTIFIER_COLUMN_COUNT = 9;
const EXPECTED_NAMESPACES_WITH_IDENTIFIERS = 7;
const EXPECTED_REFERENCE_COLUMN_COUNT = 2;

function loadRegistryData(): VocabularyRegistryData {
  return JSON.parse(readFileSync(vocabulariesPath, 'utf8'));
}

describe.skipIf(!vocabulariesAvailable)('Kennungsspalten im realen Vokabularartefakt', () => {
  it('hält den gemessenen Bestand an Kennungsspalten', () => {
    const data = loadRegistryData();
    const withIdentifiers = data.namespaces.filter(
      (namespace) => getIdentifierColumns(namespace).length > 0,
    );
    const columnCount = withIdentifiers.reduce(
      (total, namespace) => total + getIdentifierColumns(namespace).length,
      0,
    );
    const referenceCount = data.namespaces.reduce(
      (total, namespace) => total + (namespace.identifierReferenceColumns?.length ?? 0),
      0,
    );

    expect(data.namespaces).toHaveLength(EXPECTED_NAMESPACE_COUNT);
    expect(withIdentifiers).toHaveLength(EXPECTED_NAMESPACES_WITH_IDENTIFIERS);
    expect(columnCount).toBe(EXPECTED_IDENTIFIER_COLUMN_COUNT);
    expect(referenceCount).toBe(EXPECTED_REFERENCE_COLUMN_COUNT);
  });

  it('markiert jede Spalte, deren Name auf uuid endet — und nur diese', () => {
    const data = loadRegistryData();

    for (const namespace of data.namespaces) {
      const marked = new Set(getIdentifierColumns(namespace));
      const expected = namespace.columnOrder.filter(
        (column) =>
          column !== namespace.valueColumn &&
          column !== namespace.definitionColumn &&
          column.toLowerCase().endsWith('uuid'),
      );

      expect([...marked].sort()).toEqual([...expected].sort());
    }
  });

  it('trennt eigene Kennung und Verweis am Spaltennamen', () => {
    const data = loadRegistryData();

    for (const namespace of data.namespaces) {
      for (const column of namespace.identifierColumns ?? []) {
        expect(column.toLowerCase()).toBe('uuid');
      }
      for (const column of namespace.identifierReferenceColumns ?? []) {
        expect(column.toLowerCase().endsWith('uuid')).toBe(true);
        expect(column.toLowerCase()).not.toBe('uuid');
      }
    }
  });

  it('markiert weder Wert- noch Definitionsspalte als Kennung', () => {
    const data = loadRegistryData();

    for (const namespace of data.namespaces) {
      const marked = getIdentifierColumns(namespace);

      expect(marked).not.toContain(namespace.valueColumn);
      if (namespace.definitionColumn) {
        expect(marked).not.toContain(namespace.definitionColumn);
      }
    }
  });

  it('erfasst die Kennungen als Suchindex je Namespace', () => {
    const registry = buildVocabularyRegistry(loadRegistryData());

    for (const namespace of registry.namespaces) {
      const ownColumns = namespace.identifierColumns ?? [];
      const populated = namespace.entries.filter((entry) =>
        ownColumns.some((column) => entry.columns[column]?.trim()),
      );

      expect(namespace.entriesByIdentifier.size).toBe(populated.length);
    }
  });

  it('löst jeden befüllten Verweis auf einen Eintrag desselben Namespace auf', () => {
    const registry = buildVocabularyRegistry(loadRegistryData());
    const unresolved: string[] = [];

    for (const namespace of registry.namespaces) {
      for (const entry of namespace.entries) {
        for (const column of namespace.identifierReferenceColumns ?? []) {
          const reference = entry.columns[column]?.trim().toLowerCase();
          if (reference && !namespace.entriesByIdentifier.has(reference)) {
            unresolved.push(`${namespace.source.fileName}: ${entry.value} → ${reference}`);
          }
        }
      }
    }

    // Ein unauflösbarer Verweis ist kein Fehler dieser App, sondern ein
    // Upstream-Datenstand. Die Karte blendet die Zeile dann aus; der Test hält
    // fest, ob dieser Fall real eintritt.
    expect(unresolved).toEqual([]);
  });
});
