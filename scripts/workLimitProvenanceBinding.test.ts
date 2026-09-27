// =============================================================================
// Bindung des Messartefakts an den Messweg (Greptile-Befunde in den
// Release-PRs #309 und #311)
//
// `docs/measurements/gspp345-work-budget.json` liegt unter docs/** und
// beschreibt deshalb nur den Ist-Zustand. Ein Protokoll von Neustempel-
// Ereignissen mit vorher/nachher ist Entstehungsgeschichte, auch wenn jeder
// Satz Commits nennt. Die Bindung steht stattdessen in
// `workLimitProvenanceBinding`: was der Fingerprint beschreibt und in welchen
// Dateien der Messweg vom Messcommit abweicht. Der Test verlangt, dass kein
// Ereignisprotokoll mehr im Artefakt steht, dass jede als abweichend genannte
// Datei zur Hülle gehört und dass der Freitext keinen relativen Zeitbezug
// trägt.
// =============================================================================

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeSource } from './measureWorkLimitProvenance.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const ARTIFACT_PATH = resolve(REPOSITORY_ROOT, 'docs/measurements/gspp345-work-budget.json');

/** Je Marker ein Beispiel, das er treffen muss; Wortformen zählen mit (bisher, bisherige …). */
const NARRATIVE_MARKERS: ReadonlyArray<{ readonly pattern: RegExp; readonly sample: string }> = [
  { pattern: /\bseit\b/i, sample: 'Die Hülle wird seit GSPP-445 gezählt.' },
  { pattern: /\bbisher\w*/i, sample: 'Bisher wurde der Fingerprint über die Importhülle berechnet.' },
  { pattern: /\bnicht mehr\b/i, sample: 'Die Datei zählt nicht mehr.' },
  { pattern: /\bbis dahin\b/i, sample: 'Die Typkante hat die Datei bis dahin gehalten.' },
  { pattern: /\balt(?:e[nrsm]?)?\b/i, sample: 'Die Hülle war alt.' },
  { pattern: /\bneu(?:e[nrsm]?)?\b/i, sample: 'Der Fingerprint wurde neu berechnet.' },
  { pattern: /\bjetzt\b/i, sample: 'Die Hülle ist jetzt kleiner.' },
  { pattern: /\bnunmehr\b/i, sample: 'Nunmehr zählt die Ausführung.' },
  { pattern: /\bfrüher\w*/i, sample: 'Der frühere Fingerprint gilt.' },
  { pattern: /\bzuvor\b/i, sample: 'Zuvor lag die Datei in der Hülle.' },
  { pattern: /\binzwischen\b/i, sample: 'Inzwischen fehlt die Datei.' },
  { pattern: /\bursprünglich\w*/i, sample: 'Die ursprüngliche Hülle umfasst 62 Dateien.' },
  { pattern: /\b(?:vormals|ehemal\w*)/i, sample: 'Die ehemalige Hülle umfasst 62 Dateien.' },
  { pattern: /\bUmstellung\w*/i, sample: 'Der Umstellungscommit ändert nur scripts/.' },
];

interface Artifact {
  readonly sourceAfter: {
    readonly workLimitProvenance: { readonly paths: readonly string[]; readonly fixture: { readonly path: string } };
  };
  readonly workLimitProvenanceBinding?: {
    readonly messcommitQuelltext?: Readonly<Record<string, string>>;
    readonly abweichendeDateien: Readonly<Record<string, string>>;
  };
  readonly [field: string]: unknown;
}

function artifact(): Artifact {
  return JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8')) as Artifact;
}

/** SHA-256 des normalisierten Quelltexts, wie ihn der Fingerprint des Messwegs sieht. */
function normalizedSha256(path: string): string {
  const source = readFileSync(resolve(REPOSITORY_ROOT, path), 'utf8');
  return createHash('sha256').update(normalizeSource(path, source)).digest('hex');
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

function narrativeFindings(value: unknown, path: string): string[] {
  return texts(value, path).flatMap(({ path, text }) => NARRATIVE_MARKERS
    .map(({ pattern }) => pattern.exec(text))
    .filter((match) => match !== null)
    .map((match) => `${path}: „${match[0]}“`));
}

describe('Bindung des Messartefakts an den Messweg', () => {
  it('führt kein Protokoll von Neustempel-Ereignissen', () => {
    expect(Object.keys(artifact()).filter((key) => /restamp/i.test(key))).toEqual([]);
  });

  it('hält für jede gebundene Datei den normalisierten Quelltext am Messcommit fest', () => {
    // Der Messcommit liegt nicht in der Historie von develop; der Test liest
    // deshalb die dort festgehaltenen Hashes statt des Commits selbst.
    const { sourceAfter, workLimitProvenanceBinding } = artifact();
    const { paths, fixture } = sourceAfter.workLimitProvenance;
    expect(Object.keys(workLimitProvenanceBinding?.messcommitQuelltext ?? {}).sort())
      .toEqual([...paths, fixture.path].sort());
  });

  it('nennt genau die Dateien als abweichend, deren normalisierter Quelltext vom Messcommit abweicht', () => {
    const binding = artifact().workLimitProvenanceBinding;
    const deviating = Object.entries(binding?.messcommitQuelltext ?? {})
      .filter(([path, sha256]) => normalizedSha256(path) !== sha256)
      .map(([path]) => path)
      .sort();
    expect(Object.keys(binding?.abweichendeDateien ?? {}).sort()).toEqual(deviating);
  }, 30_000);

  it('erkennt einen relativen Zeitbezug im Freitext', () => {
    // Ohne diese Probe bliebe der Test grün, wenn die Marker nichts fänden.
    expect(narrativeFindings({ aussage: 'Die Hülle wird seit PROBE aus der bisherigen Zählung bestimmt.' }, 'PROBE'))
      .toEqual(['PROBE.aussage: „seit“', 'PROBE.aussage: „bisherigen“']);
  });

  it.each(NARRATIVE_MARKERS)('erkennt $pattern in seinem Beispiel', ({ sample }) => {
    expect(narrativeFindings({ nachweis: [sample] }, 'PROBE')).toHaveLength(1);
  });

  it('beschreibt die Bindung ohne relativen Zeitbezug', () => {
    const binding = artifact().workLimitProvenanceBinding;
    expect(binding).toBeDefined();
    expect(narrativeFindings(binding, 'workLimitProvenanceBinding')).toEqual([]);
  });
});
