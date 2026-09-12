// =============================================================================
// Die Provenienz der Arbeitsgrenze (GSPP-345). Der Fingerprint entscheidet, ob
// ein committetes Messartefakt den gelieferten Grenzwert noch trägt — eine zu
// enge Hülle macht diese Prüfung still wertlos.
// =============================================================================

import { describe, expect, it } from 'vitest';
import {
  WORK_LIMIT_ENTRY_POINTS,
  PROVENANCE_EXCLUDED_PATHS,
  collectWorkLimitSources,
  workLimitProvenance,
} from './measureWorkLimitProvenance.mjs';

describe('collectWorkLimitSources', () => {
  const { paths: sources, packages } = collectWorkLimitSources();

  it('erfasst den gesamten Auflösungspfad, nicht nur die Einstiegspunkte', () => {
    // Die Hülle wird aus den ECHTEN Importen berechnet. Diese Module tauchen in
    // keinem Einstiegspunkt namentlich auf und sind trotzdem der Code, dessen
    // Kosten gemessen werden — genau deshalb reicht eine handgeschriebene
    // Liste nicht.
    for (const path of [
      'src/domain/profileResolutionMerge.ts',
      'src/domain/profileResolutionModify.ts',
      'src/domain/oscalObjectGraph.ts',
      'src/domain/class2ImportLimits.mjs',
    ]) {
      expect(sources).toContain(path);
    }
  });

  it('enthält jeden Einstiegspunkt selbst', () => {
    for (const entry of WORK_LIMIT_ENTRY_POINTS) expect(sources).toContain(entry);
  });

  it('lässt den Grenzwertkandidaten aus', () => {
    // Diese Datei MUSS zwischen Mess- und Lieferstand verschieden sein. Läge
    // sie in der Hülle, könnte kein Artefakt je zum gelieferten Stand passen.
    for (const path of PROVENANCE_EXCLUDED_PATHS) expect(sources).not.toContain(path);
  });

  it('trennt externe Pakete von Repository-Dateien', () => {
    for (const path of sources) expect(path.startsWith('node_modules/')).toBe(false);
    // Der gemessene Lauf führt vor dem Ergebnis die Schemaprüfung aus. Würde
    // diese Bibliothek langsamer, müsste das Gate das sehen.
    expect(packages).toContain('ajv');
  });

  it('lässt die Auswertung außen vor — sie ist schärfer gebunden als durch einen Hash', () => {
    // Der Bindungstest leitet den Grenzwert bei jedem Lauf mit der AKTUELLEN
    // Auswertung aus dem Artefakt neu her. Sie zusätzlich zu fingerprinten
    // erzwänge einen Browsermesslauf für eine Änderung, die an den Rohdaten
    // nichts ändert.
    expect(sources).not.toContain('scripts/measureClass2BudgetReport.mjs');
  });

  it('ist sortiert und doppelfrei, damit der Fingerprint nicht an der Reihenfolge hängt', () => {
    expect(sources).toEqual([...new Set(sources)].sort());
  });

  it('bricht bei einem fehlenden Einstiegspunkt ab, statt eine leere Hülle zu liefern', () => {
    expect(() => collectWorkLimitSources(['src/domain/gibtEsNicht.ts']))
      .toThrow(/Einstiegspunkt des Messwegs fehlt/);
  });
});

describe('workLimitProvenance', () => {
  it('liefert einen stabilen Fingerprint über die gezählte Hülle', () => {
    const first = workLimitProvenance();
    const second = workLimitProvenance();
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.sha256).toBe(second.sha256);
    expect(first.files).toBe(first.paths.length);
    expect(first.files).toBeGreaterThan(WORK_LIMIT_ENTRY_POINTS.length);
  });

  it('nennt die aufgelösten Laufzeitversionen, nicht nur die Paketnamen', () => {
    const runtime = workLimitProvenance().runtime;
    expect(runtime.some((entry) => /^ajv@\d+\.\d+\.\d+/.test(entry))).toBe(true);
    // Transitiv: Ajv bringt eigene Abhängigkeiten mit, und auch deren Laufzeit
    // läuft im gemessenen Pfad mit.
    expect(runtime.length).toBeGreaterThan(1);
  });
});
