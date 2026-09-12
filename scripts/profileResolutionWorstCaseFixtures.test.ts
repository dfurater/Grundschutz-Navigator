// =============================================================================
// Die Worst-Case-Fixtures der Arbeitsgrenze (GSPP-345) prüfen sich selbst.
//
// Sie sind Messwerkzeug, aber ihre Deckel tragen eine Aussage: dass eine
// Kategorie eine bestimmte Arbeitsmenge mit einem ZULÄSSIGEN Steuerdokument
// überhaupt erreichen kann. Unterschätzte der Deckel die Dokumentgröße, würde
// der Messapparat Stützpunkte fahren, die ein Angreifer nie einreichen könnte
// — und der daraus abgeleitete Grenzwert stünde auf einem Dokument, das die
// Klasse-2-Eingangsprüfung gar nicht passiert.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { PROFILE_RESOLUTION_WORK_UNITS } from '@/domain/profileResolutionBudget';
import {
  DOCUMENT_LIMITS,
  WORK_UNIT_CATEGORIES,
  buildWorkUnitCalibration,
  buildWorkUnitWorstCase,
  maxRepetitions,
  measuredCategoryShare,
  reachableWorkUnits,
  workUnitSupportPoints,
} from './profileResolutionWorstCaseFixtures.mjs';

/** Knoten eines JSON-Werts nach der Zählsemantik der Postcondition. */
function countNodes(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((sum: number, element) => sum + countNodes(element), 1);
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).reduce((sum: number, member) => sum + countNodes(member), 1);
  }
  return 1;
}

describe('Deckung des geschlossenen Work-Unit-Satzes', () => {
  it('fährt für jede Kategorie eine Reihe', () => {
    // Eine Kategorie ohne Reihe wäre eine Kategorie ohne Kostenbeleg — genau
    // die Lücke, die der Cross-Review an der ersten Fassung fand.
    expect([...WORK_UNIT_CATEGORIES].sort()).toEqual(
      Object.values(PROFILE_RESOLUTION_WORK_UNITS).sort(),
    );
  });

  it('kennt Deckel und gemessenen Anteil jeder Kategorie', () => {
    for (const category of WORK_UNIT_CATEGORIES) {
      expect(maxRepetitions(category)).toBeGreaterThan(0);
      expect(reachableWorkUnits(category)).toBeGreaterThan(0);
      expect(measuredCategoryShare(category)).toBeGreaterThan(0);
      expect(measuredCategoryShare(category)).toBeLessThanOrEqual(1);
    }
  });
});

describe('Dokumentgrenzen der Fixtures', () => {
  it('übernimmt die Klasse-2-Grenzen unverändert', () => {
    // Die Fixture-Datei muss im Browser-Tab ohne Aliasauflösung ladbar
    // bleiben und dupliziert die Werte deshalb. Diese Erwartung ist der
    // Grund, warum die Duplikation nicht auseinanderlaufen kann.
    expect(DOCUMENT_LIMITS.maxBytes).toBe(CLASS_2_IMPORT_LIMITS.maxBytes);
    expect(DOCUMENT_LIMITS.maxNodes).toBe(CLASS_2_IMPORT_LIMITS.maxNodes);
  });

  it.each([...WORK_UNIT_CATEGORIES])(
    'hält das Steuerdokument von %s auch bei maximaler Wiederholungszahl innerhalb der Grenzen',
    (category: string) => {
      const fixture = buildWorkUnitCalibration(category, maxRepetitions(category));
      const profile = fixture.documents[fixture.topProfileArtifactKey];
      expect(JSON.stringify(profile).length).toBeLessThanOrEqual(DOCUMENT_LIMITS.maxBytes);
      expect(countNodes(profile)).toBeLessThanOrEqual(DOCUMENT_LIMITS.maxNodes);
    },
    60_000,
  );
});

describe('Stützpunkte jenseits des Deckels', () => {
  it('meldet einen nicht baubaren Stützpunkt, statt still kleiner zu bauen', () => {
    // `alter-target-lookup` ist die Kategorie, deren ungünstigster Fall durch
    // die Dokumentgrenzen und nicht durch die Arbeitsgrenze gedeckelt ist.
    const ceiling = reachableWorkUnits('alter-target-lookup');
    const fixture = buildWorkUnitWorstCase('alter-target-lookup', ceiling * 2);
    expect(fixture.capped).toBe(true);
    expect(fixture.documents).toBeUndefined();
    expect(fixture.reachableWorkUnits).toBe(ceiling);
  });

  it('baut einen erreichbaren Stützpunkt vollständig', () => {
    const fixture = buildWorkUnitWorstCase('selector-compare', 1_000_000);
    expect(fixture.capped).toBe(false);
    expect(fixture.repetitions).toBeGreaterThan(0);
    expect(fixture.documents[fixture.topProfileArtifactKey]).toBeDefined();
  });
});

describe('Stützpunktleiter', () => {
  it('geht bis zum Kandidaten und nicht darüber', () => {
    const points = workUnitSupportPoints(1_024);
    expect(points[points.length - 1]).toBe(1_024);
    expect(points).toEqual([...points].sort((left, right) => left - right));
  });
});
