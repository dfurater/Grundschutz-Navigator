import { describe, expect, it } from 'vitest';

import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  REFERENCE_GRAPH_CODES,
  REFERENCE_GRAPH_VALIDATOR,
  type ReferenceGraph,
  type ReferenceGraphArtifactSummary,
} from '@/domain/referenceGraphModel';
import {
  evaluateReferenceGraph,
  formatReferenceGraphSummary,
  toReferenceGraphReport,
  type ReferenceGraphAllowlistEntry,
} from '@/domain/referenceGraphPolicy';
import type { ArtifactLifecycle } from '@/domain/sourceRegistry';

/*
 * Synthetische Werte mit Absicht: Diese Tests prüfen die Politik, nicht den
 * Bestand. Der reale Snapshot und die realen Artefaktschlüssel stehen im
 * Manifest und im Quellregister; sie hier zu wiederholen würde die Tests an
 * eine Autorität koppeln, von der sie nichts wissen müssen.
 */
const SNAPSHOT = 'a'.repeat(40);

function diagnostic(artifactKey: string | null, path: string): OscalDiagnostic {
  return createOscalDiagnostic({
    code: REFERENCE_GRAPH_CODES.targetNotFound,
    stage: 'reference',
    validator: REFERENCE_GRAPH_VALIDATOR,
    path,
    artifact: { key: artifactKey, rootType: 'catalog', oscalVersion: '1.1.3' },
  });
}

function artifact(
  artifactKey: string,
  lifecycle: ArtifactLifecycle,
  overrides: Partial<ReferenceGraphArtifactSummary> = {},
): ReferenceGraphArtifactSummary {
  return {
    artifactKey,
    lifecycle,
    rootType: 'catalog',
    oscalVersion: '1.1.3',
    nodes: 3,
    resolved: 1,
    unresolvable: 0,
    notEvaluable: 0,
    gapAssertions: 0,
    diagnostics: 0,
    ...overrides,
  };
}

function graphWith(
  diagnostics: readonly OscalDiagnostic[],
  artifacts: readonly ReferenceGraphArtifactSummary[],
): ReferenceGraph {
  return {
    nodes: [],
    edges: [],
    gapAssertions: [],
    diagnostics,
    artifacts,
  };
}

describe('Fail-closed nur für produktive Artefakte', () => {
  it('blockiert einen Befund an einem supported-Artefakt', () => {
    const evaluation = evaluateReferenceGraph({
      graph: graphWith([diagnostic('catalog-fixture', '/catalog/groups/0')], [
        artifact('catalog-fixture', 'supported', { unresolvable: 1, diagnostics: 1 }),
      ]),
      snapshotCommitSha: SNAPSHOT,
    });

    expect(evaluation.blocking).toHaveLength(1);
    expect(evaluation.evaluationPassed).toBe(false);
  });

  it('hält preview- und blocked-Befunde sichtbar, ohne den Lauf zu blockieren', () => {
    const evaluation = evaluateReferenceGraph({
      graph: graphWith(
        [
          diagnostic('mapping-fixture-preview', '/mapping-collection/mappings/0'),
          diagnostic('mapping-fixture-blocked', '/mapping-collection/mappings/1'),
        ],
        [
          artifact('mapping-fixture-preview', 'preview'),
          artifact('mapping-fixture-blocked', 'blocked-by-upstream'),
        ],
      ),
      snapshotCommitSha: SNAPSHOT,
    });

    expect(evaluation.blocking).toHaveLength(0);
    expect(evaluation.nonBlocking).toHaveLength(2);
    expect(evaluation.evaluationPassed).toBe(true);
  });

  it('behandelt einen Befund ohne belegten Lifecycle als blockierend', () => {
    const evaluation = evaluateReferenceGraph({
      graph: graphWith([diagnostic(null, '/catalog')], []),
      snapshotCommitSha: SNAPSHOT,
    });

    expect(evaluation.blocking).toHaveLength(1);
    expect(evaluation.evaluationPassed).toBe(false);
  });
});

describe('Allowlisting mit Auslaufregel', () => {
  const finding = diagnostic('catalog-fixture', '/catalog/groups/0/controls/1/links/0/href');
  const artifacts = [artifact('catalog-fixture', 'supported', { unresolvable: 1, diagnostics: 1 })];

  function entry(overrides: Partial<ReferenceGraphAllowlistEntry> = {}): ReferenceGraphAllowlistEntry {
    return {
      signature: finding.signature,
      snapshotCommitSha: SNAPSHOT,
      reason: 'Upstream gemeldet, Fixversion angekündigt',
      ...overrides,
    };
  }

  it('deckt einen Befund nur bei gleicher Signatur und gleichem Snapshot', () => {
    const evaluation = evaluateReferenceGraph({
      graph: graphWith([finding], artifacts),
      snapshotCommitSha: SNAPSHOT,
      allowlist: [entry()],
    });

    expect(evaluation.allowed).toHaveLength(1);
    expect(evaluation.blocking).toHaveLength(0);
    expect(evaluation.expiredAllowlistEntries).toHaveLength(0);
    expect(evaluation.evaluationPassed).toBe(true);
  });

  it('lässt den Eintrag mit einem neuen Snapshot auslaufen statt ihn zu übertragen', () => {
    const evaluation = evaluateReferenceGraph({
      graph: graphWith([finding], artifacts),
      snapshotCommitSha: 'b'.repeat(40),
      allowlist: [entry()],
    });

    expect(evaluation.allowed).toHaveLength(0);
    expect(evaluation.blocking).toHaveLength(1);
    expect(evaluation.expiredAllowlistEntries).toHaveLength(1);
    expect(evaluation.evaluationPassed).toBe(false);
  });

  it('lässt den Eintrag bei geändertem Pfad auslaufen', () => {
    const movedFinding = diagnostic(
      'catalog-fixture',
      '/catalog/groups/0/controls/2/links/0/href',
    );
    const evaluation = evaluateReferenceGraph({
      graph: graphWith([movedFinding], artifacts),
      snapshotCommitSha: SNAPSHOT,
      allowlist: [entry()],
    });

    expect(evaluation.blocking).toHaveLength(1);
    expect(evaluation.expiredAllowlistEntries.map((expired) => expired.signature)).toEqual([
      finding.signature,
    ]);
  });
});

describe('Ausgabe', () => {
  const graph = graphWith(
    [diagnostic('mapping-fixture-preview', '/mapping-collection/mappings/0')],
    [
      artifact('catalog-fixture', 'supported', { resolved: 3 }),
      artifact('mapping-fixture-preview', 'preview', {
        rootType: 'mapping-collection',
        oscalVersion: '1.2.2',
        notEvaluable: 7,
        diagnostics: 1,
      }),
    ],
  );
  const evaluation = evaluateReferenceGraph({ graph, snapshotCommitSha: SNAPSHOT });
  const summary = formatReferenceGraphSummary(graph, evaluation);

  it('weist ein preview-Artefakt nie als abschließend bewertet aus', () => {
    expect(summary).toContain('mapping-fixture-preview');
    expect(summary).toMatch(/mapping-fixture-preview.*status=nicht abschliessend bewertet/);
    expect(summary).toMatch(/catalog-fixture.*status=ohne Referenzfehler/);
  });

  it('liefert einen maschinenlesbaren Bericht ohne Dokumentwerte', () => {
    const report = toReferenceGraphReport(graph, evaluation);
    expect(JSON.parse(JSON.stringify(report))).toMatchObject({
      snapshotCommitSha: SNAPSHOT,
      evaluationPassed: true,
      gapAssertions: 0,
    });
    expect(report.artifacts).toHaveLength(2);
    for (const entry of report.nonBlocking) {
      expect(entry.stage).toBe('reference');
      expect(entry.path.startsWith('/')).toBe(true);
    }
  });
});
