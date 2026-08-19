// =============================================================================
// CI-Politik des Referenzgraphen (GSPP-251)
//
// Trennt die Auswertung von der Entscheidung: Der Graph stellt Befunde fest,
// diese Schicht entscheidet, welcher davon einen Lauf blockiert.
//
// Zwei Regeln tragen sie:
//
//  1. **Fail-closed nur für produktive Artefakte.** Ein neuer Referenzfehler an
//     einem `supported`-Artefakt lässt den Lauf fehlschlagen. Befunde an
//     `preview`, `draft` und `blocked-by-upstream` bleiben sichtbar, blockieren
//     aber nicht — sie zu verstecken wäre die schlechtere Alternative.
//  2. **Allowlisting läuft aus.** Ein Eintrag greift nur für genau die
//     Diagnosesignatur (`name@version|code|path`) **und** genau den
//     Snapshot-Commit, für den er eingetragen wurde. Ändert sich der Snapshot
//     oder der Pfad, greift er nicht mehr und wird als abgelaufen gemeldet —
//     er wandert nie auf ein Nachfolgeartefakt.
// =============================================================================

import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { ReferenceGraph, ReferenceGraphArtifactSummary } from '@/domain/referenceGraphModel';
import type { ArtifactLifecycle } from '@/domain/sourceRegistry';

/**
 * Ein bewusst akzeptierter Befund.
 *
 * Der Matchschlüssel ist die vom Diagnosemodell definierte `signature` plus der
 * Snapshot-Commit — nicht der Artefaktschlüssel: Ein Eintrag soll den Befund
 * decken, den jemand geprüft hat, und nicht jeden späteren am selben Artefakt.
 */
export interface ReferenceGraphAllowlistEntry {
  readonly signature: string;
  readonly snapshotCommitSha: string;
  /** Warum der Befund akzeptiert ist; erscheint nur in der CI-Zusammenfassung. */
  readonly reason: string;
}

export interface ReferenceGraphEvaluation {
  readonly snapshotCommitSha: string;
  /** Blockierende Befunde: Referenzfehler an `supported`-Artefakten. */
  readonly blocking: readonly OscalDiagnostic[];
  /** Sichtbar, aber nicht blockierend: alles außerhalb von `supported`. */
  readonly nonBlocking: readonly OscalDiagnostic[];
  /** Durch einen gültigen Allowlist-Eintrag gedeckt. */
  readonly allowed: readonly OscalDiagnostic[];
  /**
   * Einträge, die am aktuellen Snapshot keinen Befund mehr decken. Sie sind
   * abgelaufen und gehören entfernt.
   */
  readonly expiredAllowlistEntries: readonly ReferenceGraphAllowlistEntry[];
  readonly evaluationPassed: boolean;
}

function lifecycleByArtifact(
  graph: ReferenceGraph,
): ReadonlyMap<string, ArtifactLifecycle> {
  return new Map(graph.artifacts.map((artifact) => [artifact.artifactKey, artifact.lifecycle]));
}

/**
 * Wertet den Graphen gegen die CI-Politik aus.
 *
 * Eine Diagnose ohne bekannten Artefaktschlüssel wird als blockierend
 * behandelt: Ohne belegten Lifecycle darf kein Befund stillschweigend in die
 * nicht blockierende Klasse fallen.
 */
export function evaluateReferenceGraph(input: {
  readonly graph: ReferenceGraph;
  readonly snapshotCommitSha: string;
  readonly allowlist?: readonly ReferenceGraphAllowlistEntry[];
}): ReferenceGraphEvaluation {
  const lifecycles = lifecycleByArtifact(input.graph);
  const allowlist = input.allowlist ?? [];
  const activeSignatures = new Set(
    allowlist
      .filter((entry) => entry.snapshotCommitSha === input.snapshotCommitSha)
      .map((entry) => entry.signature),
  );

  const blocking: OscalDiagnostic[] = [];
  const nonBlocking: OscalDiagnostic[] = [];
  const allowed: OscalDiagnostic[] = [];
  const matchedSignatures = new Set<string>();

  for (const diagnostic of input.graph.diagnostics) {
    if (activeSignatures.has(diagnostic.signature)) {
      matchedSignatures.add(diagnostic.signature);
      allowed.push(diagnostic);
      continue;
    }
    const lifecycle = diagnostic.artifact.key ? lifecycles.get(diagnostic.artifact.key) : undefined;
    if (lifecycle === undefined || lifecycle === 'supported') {
      blocking.push(diagnostic);
      continue;
    }
    nonBlocking.push(diagnostic);
  }

  const expiredAllowlistEntries = allowlist.filter(
    (entry) =>
      entry.snapshotCommitSha !== input.snapshotCommitSha ||
      !matchedSignatures.has(entry.signature),
  );

  return Object.freeze({
    snapshotCommitSha: input.snapshotCommitSha,
    blocking: Object.freeze(blocking),
    nonBlocking: Object.freeze(nonBlocking),
    allowed: Object.freeze(allowed),
    expiredAllowlistEntries: Object.freeze(expiredAllowlistEntries),
    evaluationPassed: blocking.length === 0,
  });
}

/* ------------------------------------------------------------------ */
/*  Maschinenlesbarer Bericht                                          */
/* ------------------------------------------------------------------ */

export interface ReferenceGraphReport {
  readonly snapshotCommitSha: string;
  readonly nodes: number;
  readonly edges: Readonly<Record<'resolved' | 'unresolvable' | 'notEvaluable', number>>;
  readonly gapAssertions: number;
  readonly artifacts: readonly ReferenceGraphArtifactSummary[];
  readonly blocking: readonly OscalDiagnostic[];
  readonly nonBlocking: readonly OscalDiagnostic[];
  readonly allowed: readonly OscalDiagnostic[];
  readonly expiredAllowlistEntries: readonly ReferenceGraphAllowlistEntry[];
  readonly evaluationPassed: boolean;
}

/**
 * Der maschinenlesbare Bericht. Er enthält ausschließlich Werte, die die
 * Redaction-Regel zulässt: Codes, Stufen, Registry-Schlüssel, strukturelle
 * JSON Pointer und Zählungen — nie `href`- oder ID-Werte.
 */
export function toReferenceGraphReport(
  graph: ReferenceGraph,
  evaluation: ReferenceGraphEvaluation,
): ReferenceGraphReport {
  return Object.freeze({
    snapshotCommitSha: evaluation.snapshotCommitSha,
    nodes: graph.nodes.length,
    edges: Object.freeze({
      resolved: graph.edges.filter((edge) => edge.state === 'resolved').length,
      unresolvable: graph.edges.filter((edge) => edge.state === 'unresolvable').length,
      notEvaluable: graph.edges.filter((edge) => edge.state === 'not-evaluable').length,
    }),
    gapAssertions: graph.gapAssertions.length,
    artifacts: graph.artifacts,
    blocking: evaluation.blocking,
    nonBlocking: evaluation.nonBlocking,
    allowed: evaluation.allowed,
    expiredAllowlistEntries: evaluation.expiredAllowlistEntries,
    evaluationPassed: evaluation.evaluationPassed,
  });
}

/* ------------------------------------------------------------------ */
/*  CI-Zusammenfassung                                                 */
/* ------------------------------------------------------------------ */

/**
 * Ein Artefakt außerhalb von `supported` darf in keiner Ausgabe als
 * abschließend bewertet erscheinen — auch dann nicht, wenn es null Befunde
 * trägt. Der Status benennt das ausdrücklich, statt es der Zahl zu überlassen.
 */
function artifactStatus(artifact: ReferenceGraphArtifactSummary): string {
  if (artifact.lifecycle !== 'supported') return 'nicht abschliessend bewertet';
  return artifact.unresolvable === 0 ? 'ohne Referenzfehler' : 'Referenzfehler';
}

function diagnosticLines(label: string, diagnostics: readonly OscalDiagnostic[]): string[] {
  if (diagnostics.length === 0) return [];
  return [
    `${label}: ${diagnostics.length}`,
    ...diagnostics.map(
      (diagnostic) =>
        `  ${diagnostic.artifact.key ?? 'unbekannt'}: ${diagnostic.code} ${diagnostic.path}`,
    ),
  ];
}

/** Kurze, redaktionssichere Zusammenfassung für die CI-Ausgabe. */
export function formatReferenceGraphSummary(
  graph: ReferenceGraph,
  evaluation: ReferenceGraphEvaluation,
): string {
  const report = toReferenceGraphReport(graph, evaluation);
  const artifactLines = [...graph.artifacts]
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
    .map(
      (artifact) =>
        `  ${artifact.artifactKey}: lifecycle=${artifact.lifecycle}; oscal=${artifact.oscalVersion}; knoten=${artifact.nodes}; aufgeloest=${artifact.resolved}; referenzfehler=${artifact.unresolvable}; nicht-bewertbar=${artifact.notEvaluable}; lueckenaussagen=${artifact.gapAssertions}; status=${artifactStatus(artifact)}`,
    );

  return [
    'reference-graph@1 — Referenzintegrität über die geladenen OSCAL-Artefakte',
    `Snapshot: ${report.snapshotCommitSha}`,
    `Knoten: ${report.nodes}`,
    `Kanten: aufgeloest=${report.edges.resolved}; referenzfehler=${report.edges.unresolvable}; nicht-bewertbar=${report.edges.notEvaluable}`,
    `Lueckenaussagen (no-relationship): ${report.gapAssertions}`,
    'Artefakte:',
    ...artifactLines,
    ...diagnosticLines('Blockierend (supported)', evaluation.blocking),
    ...diagnosticLines('Nicht blockierend (preview/draft/blocked-by-upstream)', evaluation.nonBlocking),
    ...diagnosticLines('Durch Allowlist gedeckt', evaluation.allowed),
    ...(evaluation.expiredAllowlistEntries.length === 0
      ? []
      : [
        `Abgelaufene Allowlist-Eintraege: ${evaluation.expiredAllowlistEntries.length}`,
        ...evaluation.expiredAllowlistEntries.map((entry) => `  ${entry.signature}`),
      ]),
  ].join('\n');
}
