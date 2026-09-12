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
  const sources = collectWorkLimitSources();

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

  it('nimmt keine externen Abhängigkeiten auf', () => {
    for (const path of sources) {
      expect(path.startsWith('node_modules/')).toBe(false);
    }
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
});
