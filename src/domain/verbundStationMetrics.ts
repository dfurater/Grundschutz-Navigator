// =============================================================================
// Kennzahlen der Stationskarten einer Verbund-Übersicht (GSPP-616)
//
// Jede Zahl stammt aus dem Dokumentgraphen oder dem Quellgraphen eines
// Mitglieds; fehlt die Grundlage, fehlt die Kennzahl. Controls zählt
// `buildWorkspaceCatalog()`, dieselbe Projektion, gegen die der Graph
// `control-id` auflöst.
// =============================================================================

import { parsePoamDocument } from '@/adapters/oscalPoamDocument';
import { isJsonObject, readArray, readString } from '@/domain/jsonGuards';
import { derivePoamProgress } from '@/domain/poamProgress';
import { buildWorkspaceCatalog } from '@/domain/workspaceCatalog';
import {
  workspaceDocumentToken, type WorkspaceClass1Artifact, type WorkspaceGraph, type WorkspaceGraphEdge,
} from '@/domain/workspaceGraphModel';
import type { LocalId, WorkspaceEnvelope } from '@/domain/workspaceModel';

export type DocumentMetric =
  /** Aufgenommene Controls der Profilauflösung von verfügbaren Controls der Importziele. */
  | { readonly kind: 'profile'; readonly included: number; readonly available: number }
  /** `implemented-requirements`, deren `control-id` in der Baseline auflöst, von Controls der Baseline. */
  | { readonly kind: 'ssp'; readonly documented: number; readonly baseline: number }
  /** Findings mit `target.status.state` `satisfied` oder `not-satisfied`. */
  | { readonly kind: 'assessment-results'; readonly assessed: number; readonly notSatisfied: number }
  /** Nicht abgeschlossene `poam-items` und davon die mit überschrittener Frist. */
  | { readonly kind: 'poam'; readonly open: number; readonly overdue: number };

export interface StationMetrics {
  /** Controls des gebundenen BSI-Katalogs, nur bei genau einem gebundenen Katalog. */
  readonly catalogControls?: number;
  readonly documents: ReadonlyMap<LocalId, DocumentMetric>;
}

const SSP_REQUIREMENT_PATH = /^\/system-security-plan\/control-implementation\/implemented-requirements\/\d+\/control-id$/;

function controlCount(source: unknown): number | undefined {
  const projection = buildWorkspaceCatalog(source);
  return projection.status === 'success' ? projection.catalog.controlsById.size : undefined;
}

function assessmentMetric(source: unknown): DocumentMetric {
  let assessed = 0;
  let notSatisfied = 0;
  const body = isJsonObject(source) && isJsonObject(source['assessment-results']) ? source['assessment-results'] : {};
  for (const result of readArray(body.results)) {
    for (const finding of readArray(isJsonObject(result) ? result.findings : undefined)) {
      const target = isJsonObject(finding) && isJsonObject(finding.target) ? finding.target : undefined;
      const state = readString(isJsonObject(target?.status) ? target.status.state : undefined);
      if (state === 'satisfied' || state === 'not-satisfied') assessed += 1;
      if (state === 'not-satisfied') notSatisfied += 1;
    }
  }
  return { kind: 'assessment-results', assessed, notSatisfied };
}

function poamMetric(member: WorkspaceEnvelope, now: Date): DocumentMetric | undefined {
  try {
    const rows = derivePoamProgress(parsePoamDocument(member.source, { trustClass: member.trustClass }).view, now)
      .filter((row) => !row.completed);
    return { kind: 'poam', open: rows.length, overdue: rows.filter((row) => row.deadlineState === 'überschritten').length };
  } catch {
    // Ein Entwurf ohne lesbaren Root hat keine Maßnahmenzahl.
    return undefined;
  }
}

/** Kennzahlen je Mitglied; `class1Artifacts` sind die geladenen, an den Verbund gebundenen BSI-Artefakte. */
export function deriveStationMetrics(
  members: readonly WorkspaceEnvelope[],
  graph: Pick<WorkspaceGraph, 'edges' | 'resolutions'>,
  class1Artifacts: readonly WorkspaceClass1Artifact[],
  now: Date,
): StationMetrics {
  const counts = new Map<string, number | undefined>();
  const sources = new Map<string, { readonly rootType: string; readonly source: unknown }>([
    ...members.map((member) => [`local:${member.localId}`, member] as const),
    ...class1Artifacts.map((artifact) => [`class-1:${artifact.artifactKey}`, artifact] as const),
  ]);
  const resolved = new Map(graph.resolutions.flatMap((resolution) =>
    resolution.status === 'resolved' ? [[workspaceDocumentToken(resolution.document), resolution.source] as const] : []));
  // Ein Profil zählt mit seiner Auflösung, ein Katalog mit seinem Quellgraphen.
  const countOf = (token: string): number | undefined => {
    if (!counts.has(token)) {
      const document = sources.get(token);
      const source = document?.rootType === 'catalog' ? document.source : resolved.get(token);
      counts.set(token, source === undefined ? undefined : controlCount(source));
    }
    return counts.get(token);
  };
  const outgoing = (localId: LocalId, kind: WorkspaceGraphEdge['kind']) => graph.edges.filter((edge) =>
    edge.kind === kind && edge.from.document.kind === 'local' && edge.from.document.localId === localId);
  const targetsOf = (edges: readonly WorkspaceGraphEdge[]) => {
    const tokens = new Set(edges.map((edge) => (edge.state === 'resolved' && edge.to ? workspaceDocumentToken(edge.to.document) : '')));
    return tokens.has('') ? undefined : [...tokens];
  };
  const sumOf = (tokens: readonly string[] | undefined) => {
    const values = tokens?.map(countOf);
    return values && values.length > 0 && values.every((value) => value !== undefined)
      ? values.reduce((sum: number, value) => sum + (value ?? 0), 0)
      : undefined;
  };

  const documents = new Map<LocalId, DocumentMetric>();
  for (const member of members) {
    const token = `local:${member.localId}`;
    let metric: DocumentMetric | undefined;
    if (member.rootType === 'profile') {
      const included = countOf(token);
      const available = sumOf(targetsOf(outgoing(member.localId, 'profile-import')));
      if (included !== undefined && available !== undefined) metric = { kind: 'profile', included, available };
    } else if (member.rootType === 'system-security-plan') {
      const baseline = sumOf(targetsOf(outgoing(member.localId, 'ssp-import-profile')));
      const documented = new Set(outgoing(member.localId, 'ssp-control')
        .filter((edge) => edge.state === 'resolved' && SSP_REQUIREMENT_PATH.test(edge.path))
        .map((edge) => edge.to?.localId)).size;
      if (baseline !== undefined) metric = { kind: 'ssp', documented, baseline };
    } else if (member.rootType === 'assessment-results') {
      metric = assessmentMetric(member.source);
    } else if (member.rootType === 'plan-of-action-and-milestones') {
      metric = poamMetric(member, now);
    }
    if (metric) documents.set(member.localId, metric);
  }

  const catalogs = class1Artifacts.filter((artifact) => artifact.rootType === 'catalog');
  const catalogControls = catalogs.length === 1 ? countOf(`class-1:${catalogs[0].artifactKey}`) : undefined;
  return { ...(catalogControls === undefined ? {} : { catalogControls }), documents };
}
