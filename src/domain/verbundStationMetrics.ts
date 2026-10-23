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
import { SUPPORTED_CATALOGS, type CatalogKey } from '@/domain/sourceRegistry';
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
  /** `catalogKey` desselben Katalogs, damit Zahl und Ziel der Catalog-Karte übereinstimmen. */
  readonly catalogKey?: CatalogKey;
  readonly documents: ReadonlyMap<LocalId, DocumentMetric>;
  /** Bezugszeitpunkt der Fristableitung (ISO 8601); die Karte nennt ihn neben „überfällig“. */
  readonly computedAt: string;
}

const SSP_REQUIREMENT_PATH = /^\/system-security-plan\/control-implementation\/implemented-requirements\/\d+\/control-id$/;

function controlCount(source: unknown): number | undefined {
  const projection = buildWorkspaceCatalog(source);
  return projection.status === 'success' ? projection.catalog.controlsById.size : undefined;
}

function findingState(finding: unknown): string | undefined {
  const target = isJsonObject(finding) && isJsonObject(finding.target) ? finding.target : undefined;
  return readString(isJsonObject(target?.status) ? target.status.state : undefined);
}

/** Ohne mindestens ein lesbares `result` ist „0 geprüft“ keine belegte Aussage. */
function assessmentMetric(source: unknown): DocumentMetric | undefined {
  const body = isJsonObject(source) && isJsonObject(source['assessment-results']) ? source['assessment-results'] : {};
  const results = readArray(body.results);
  if (results.length === 0 || !results.every(isJsonObject)) return undefined;
  const states = results.flatMap((result) => readArray(result.findings).map(findingState));
  return {
    kind: 'assessment-results',
    assessed: states.filter((state) => state === 'satisfied' || state === 'not-satisfied').length,
    notSatisfied: states.filter((state) => state === 'not-satisfied').length,
  };
}

function poamMetric(member: WorkspaceEnvelope, now: Date): DocumentMetric | undefined {
  // Der Parser übergeht unlesbare `poam-items`; „0 offene Maßnahmen“ setzt eine lesbare Liste voraus.
  const body = isJsonObject(member.source) ? member.source['plan-of-action-and-milestones'] : undefined;
  const items = readArray(isJsonObject(body) ? body['poam-items'] : undefined);
  if (items.length === 0 || !items.every(isJsonObject)) return undefined;
  try {
    const rows = derivePoamProgress(parsePoamDocument(member.source, { trustClass: member.trustClass }).view, now)
      .filter((row) => !row.completed);
    return { kind: 'poam', open: rows.length, overdue: rows.filter((row) => row.deadlineState === 'überschritten').length };
  } catch {
    // Ein Entwurf ohne lesbaren Root hat keine Maßnahmenzahl.
    return undefined;
  }
}

type Graph = Pick<WorkspaceGraph, 'edges' | 'resolutions'>;

/** Zählt Controls je Dokument: ein Profil über seine Auflösung, ein Katalog über seinen Quellgraphen. */
function createControlCounter(members: readonly WorkspaceEnvelope[], graph: Graph, class1Artifacts: readonly WorkspaceClass1Artifact[]) {
  const counts = new Map<string, number | undefined>();
  const sources = new Map<string, { readonly rootType: string; readonly source: unknown }>([
    ...members.map((member) => [`local:${member.localId}`, member] as const),
    ...class1Artifacts.map((artifact) => [`class-1:${artifact.artifactKey}`, artifact] as const),
  ]);
  const resolved = new Map(graph.resolutions.flatMap((resolution) =>
    resolution.status === 'resolved' ? [[workspaceDocumentToken(resolution.document), resolution.source] as const] : []));
  const countOf = (token: string): number | undefined => {
    if (!counts.has(token)) {
      const document = sources.get(token);
      const source = document?.rootType === 'catalog' ? document.source : resolved.get(token);
      counts.set(token, source === undefined ? undefined : controlCount(source));
    }
    return counts.get(token);
  };
  /** Summe über alle Ziele der Kanten; ein nicht aufgelöstes oder nicht zählbares Ziel ergibt `undefined`. */
  const sumOfTargets = (edges: readonly WorkspaceGraphEdge[]): number | undefined => {
    if (edges.length === 0 || edges.some((edge) => edge.state !== 'resolved' || !edge.to)) return undefined;
    const values = [...new Set(edges.flatMap((edge) => (edge.to ? [workspaceDocumentToken(edge.to.document)] : [])))].map(countOf);
    return values.every((value) => value !== undefined) ? values.reduce((sum: number, value) => sum + (value ?? 0), 0) : undefined;
  };
  return { countOf, sumOfTargets };
}

function memberMetric(member: WorkspaceEnvelope, graph: Graph, counter: ReturnType<typeof createControlCounter>, now: Date): DocumentMetric | undefined {
  const outgoing = (kind: WorkspaceGraphEdge['kind']) => graph.edges.filter((edge) =>
    edge.kind === kind && edge.from.document.kind === 'local' && edge.from.document.localId === member.localId);
  switch (member.rootType) {
    case 'profile': {
      const included = counter.countOf(`local:${member.localId}`);
      const available = counter.sumOfTargets(outgoing('profile-import'));
      return included === undefined || available === undefined ? undefined : { kind: 'profile', included, available };
    }
    case 'system-security-plan': {
      const baseline = counter.sumOfTargets(outgoing('ssp-import-profile'));
      const documented = new Set(outgoing('ssp-control')
        .filter((edge) => edge.state === 'resolved' && SSP_REQUIREMENT_PATH.test(edge.path))
        .map((edge) => edge.to?.localId)).size;
      return baseline === undefined ? undefined : { kind: 'ssp', documented, baseline };
    }
    case 'assessment-results': return assessmentMetric(member.source);
    case 'plan-of-action-and-milestones': return poamMetric(member, now);
    default: return undefined;
  }
}

/** Kennzahlen je Mitglied; `class1Artifacts` sind die geladenen, an den Verbund gebundenen BSI-Artefakte. */
export function deriveStationMetrics(
  members: readonly WorkspaceEnvelope[],
  graph: Graph,
  class1Artifacts: readonly WorkspaceClass1Artifact[],
  now: Date,
): StationMetrics {
  const counter = createControlCounter(members, graph, class1Artifacts);
  const documents = new Map<LocalId, DocumentMetric>();
  for (const member of members) {
    const metric = memberMetric(member, graph, counter, now);
    if (metric) documents.set(member.localId, metric);
  }

  const catalogs = class1Artifacts.filter((artifact) => artifact.rootType === 'catalog');
  const catalogKey = catalogs.length === 1
    ? SUPPORTED_CATALOGS.find((entry) => entry.artifactKey === catalogs[0].artifactKey)?.catalogKey
    : undefined;
  const catalogControls = catalogKey === undefined ? undefined : counter.countOf(`class-1:${catalogs[0].artifactKey}`);
  return {
    ...(catalogControls === undefined ? {} : { catalogControls, catalogKey }),
    documents,
    computedAt: now.toISOString(),
  };
}
