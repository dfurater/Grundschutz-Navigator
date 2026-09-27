// =============================================================================
// Freitext der Neustempel-Einträge im Messartefakt (Greptile-Befund im
// Release-PR #309)
//
// `docs/measurements/gspp345-work-budget.json` hält unter
// `workLimitProvenanceRestamps` fest, wann der Fingerprint des Messwegs ohne
// Neumessung neu gestempelt wurde. Die Felder `vorher`, `nachher` und
// `basisCommit` nennen Verfahren, Hashes und Commits. Der Freitext daneben
// beschreibt nur, was an diesen Werten gegen Code oder Commit nachprüfbar ist
// (docs/** beschreibt den Ist-Zustand). Relative Zeitbezüge wie „bisherig“,
// „seit“ oder „alte Hülle“ tragen keinen solchen Fakt: Welches Verfahren sie
// meinen, hängt davon ab, wann man liest. Der Test sucht deshalb in jedem
// Freitext dieser Einträge nach solchen Markern.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ARTIFACT_PATH = resolve(import.meta.dirname, '..', 'docs/measurements/gspp345-work-budget.json');

const NARRATIVE_MARKERS: readonly RegExp[] = [
  /\bseit\b/i,
  /\bbisherig\w*/i,
  /\bnicht mehr\b/i,
  /\balte[nrsm]?\b/i,
  /\bneue[nrsm]?\b/i,
  /\bfrüher\w*/i,
  /\bzuvor\b/i,
  /\binzwischen\b/i,
  /\bursprünglich\w*/i,
  /\bUmstellung\w*/i,
];

interface Restamp {
  readonly issue: string;
  readonly [field: string]: unknown;
}

function restamps(): Restamp[] {
  const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as { workLimitProvenanceRestamps: Restamp[] };
  return artifact.workLimitProvenanceRestamps;
}

/** Alle Zeichenketten eines Eintrags samt JSON-Pfad, auch in Listen und Unterobjekten. */
function texts(value: unknown, path: string): Array<{ path: string; text: string }> {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, index) => texts(item, `${path}[${index}]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => texts(item, `${path}.${key}`));
  }
  return [];
}

function narrativeFindings(entry: Restamp): string[] {
  return texts(entry, entry.issue).flatMap(({ path, text }) => NARRATIVE_MARKERS
    .map((marker) => marker.exec(text))
    .filter((match) => match !== null)
    .map((match) => `${path}: „${match[0]}“`));
}

describe('Neustempel-Einträge des Messartefakts', () => {
  it('erkennt einen relativen Zeitbezug im Freitext', () => {
    // Ohne diese Probe bliebe der Test grün, wenn die Marker nichts fänden.
    expect(narrativeFindings({ issue: 'PROBE', begruendung: 'Die Hülle wird seit PROBE aus der bisherigen Zählung bestimmt.' }))
      .toEqual(['PROBE.begruendung: „seit“', 'PROBE.begruendung: „bisherigen“']);
  });

  it('beschreiben Verfahren und Commits ohne relativen Zeitbezug', () => {
    const entries = restamps();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.flatMap(narrativeFindings)).toEqual([]);
  });
});
