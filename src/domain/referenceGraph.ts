// =============================================================================
// Referenzgraph über Catalogs, Profiles, Mappings und Components (GSPP-251)
//
// Stufe 5 des Validierungsvertrags aus `docs/OSCAL_VALIDATION.md`. Der Graph
// setzt auf `src/domain/referenceResolution.ts` (GSPP-286) auf und fügt
// ausschließlich die übergreifende Sicht hinzu: Er entscheidet **nie** selbst,
// welche Form ein `href` hat — kein Fragmentvergleich, kein Protokollvergleich,
// keine Pfadnormalisierung, keine Auswertung von Dateinamen, Titeln oder
// Fremd-Namespace-`props`. Er fragt den Klassifikator und deutet dessen
// Ergebnis im Dokumentkontext.
//
// Die Auswertung ist rein: kein Netzwerk-, kein Dateizugriff, keine Auswertung
// eingebetteter Nutzlasten. Sie terminiert auch bei zyklischen Profilketten.
// =============================================================================

import {
  createReferenceDocument,
  resolveCatalogControlReferences,
  resolveCatalogMetadataReferences,
  type ReferenceDocument,
  type ResolvedOscalReference,
} from '@/domain/referenceResolution';
import { indexDocumentNodes } from '@/domain/referenceGraphIndex';
import {
  REFERENCE_GRAPH_CODES,
  type ReferenceEdge,
  type ReferenceGraph,
  type ReferenceGraphArtifactSummary,
  type ReferenceGraphDocument,
  type ReferenceGraphInput,
  type ReferenceNode,
  type ReferenceNodeId,
} from '@/domain/referenceGraphModel';
import {
  artifactNode,
  graphDiagnostic,
  pushNotEvaluableEdge,
  pushResolvedEdge,
  pushUnresolvableEdge,
  type EdgeSink,
  type GraphEvaluationContext,
  type PreparedDocument,
} from '@/domain/referenceGraphContext';
import {
  deriveComponentEdges,
  deriveMappingEdges,
  deriveProfileEdges,
} from '@/domain/referenceGraphEdges';
import type { Catalog } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';

export {
  REFERENCE_GRAPH_CODES,
  REFERENCE_GRAPH_VALIDATOR,
} from '@/domain/referenceGraphModel';
export type {
  ReferenceEdge,
  ReferenceEdgeKind,
  ReferenceEdgeState,
  ReferenceGapAssertion,
  ReferenceGraph,
  ReferenceGraphArtifactSummary,
  ReferenceGraphBinding,
  ReferenceGraphDocument,
  ReferenceGraphInput,
  ReferenceNode,
  ReferenceNodeId,
} from '@/domain/referenceGraphModel';

/* ------------------------------------------------------------------ */
/*  Dokumentinterne Verweise eines Katalogs                            */
/* ------------------------------------------------------------------ */

function pushCatalogReference(
  sink: EdgeSink,
  prepared: PreparedDocument,
  context: GraphEvaluationContext,
  from: ReferenceNodeId,
  reference: ResolvedOscalReference,
): void {
  const documentKey = prepared.document.artifactKey;
  const edge = { kind: 'document-internal' as const, from, path: reference.path };

  switch (reference.kind) {
    case 'provenance':
      // Herkunftsangaben benennen kein Referenzziel im Dokumentkontext.
      return;
    case 'control':
      pushResolvedEdge(sink, edge, { documentKey, kind: 'control', localId: reference.control.id });
      return;
    case 'resource':
      pushResolvedEdge(sink, edge, {
        documentKey,
        kind: 'resource',
        localId: reference.resource.uuid,
      });
      return;
    case 'external':
      // Ein informativer Verweis nach außen eröffnet keinen Auflösungskontext
      // und ist deshalb befundfrei nicht bewertbar.
      pushNotEvaluableEdge(sink, edge, 'external');
      return;
    case 'cross-document': {
      const targetKey = context.documentKeysByReferenceDocument.get(reference.document);
      if (!targetKey) {
        pushNotEvaluableEdge(sink, edge, 'document-not-provided');
        return;
      }
      pushResolvedEdge(
        sink,
        edge,
        reference.resource
          ? { documentKey: targetKey, kind: 'resource', localId: reference.resource.uuid }
          : artifactNode(targetKey),
      );
      return;
    }
    case 'unresolved':
      if (reference.reason === 'relative' || reference.reason === 'document-not-provided') {
        pushNotEvaluableEdge(sink, edge, reference.reason);
        return;
      }
      pushUnresolvableEdge(
        sink,
        edge,
        graphDiagnostic(
          prepared.document,
          reference.reason === 'unsafe-protocol'
            ? REFERENCE_GRAPH_CODES.externalContextUnpinned
            : REFERENCE_GRAPH_CODES.targetNotFound,
          reference.path,
          { reason: reference.reason },
        ),
      );
  }
}

function deriveCatalogEdges(
  sink: EdgeSink,
  prepared: PreparedDocument,
  context: GraphEvaluationContext,
): void {
  const resolverInput = {
    document: prepared.referenceDocument,
    catalogsByKey: context.catalogsByKey,
    documentsByHref: context.documentsByHref,
  };
  const documentKey = prepared.document.artifactKey;

  for (const reference of resolveCatalogMetadataReferences(resolverInput)) {
    pushCatalogReference(sink, prepared, context, artifactNode(documentKey), reference);
  }
  for (const [controlId, references] of resolveCatalogControlReferences(resolverInput)) {
    const from: ReferenceNodeId = { documentKey, kind: 'control', localId: controlId };
    for (const reference of references) {
      pushCatalogReference(sink, prepared, context, from, reference);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Zyklen in Profilketten                                             */
/* ------------------------------------------------------------------ */

/**
 * Erkennt geschlossene Importketten und **beendet** die Auswertung an der
 * schließenden Kante, statt ihr weiter zu folgen. Die Kante bleibt `resolved`
 * — ihr Ziel ist vorhanden —, trägt aber den Zyklusbefund.
 */
function markImportCycles(sink: EdgeSink, context: GraphEvaluationContext): void {
  const outgoing = new Map<string, number[]>();
  for (const [index, edge] of sink.edges.entries()) {
    // Nur Kanten auf ein **anderes Dokument** bilden die Kette. Ein Import auf
    // eine dokumentinterne `back-matter`-Ressource zeigt auf einen
    // Ressourcenknoten desselben Artefakts und ist keine Kette, sondern der
    // Normalfall in den BSI-Profilen.
    if (edge.kind !== 'profile-import' || edge.state !== 'resolved') continue;
    if (edge.to.kind !== 'artifact') continue;
    outgoing.set(edge.from.documentKey, [...(outgoing.get(edge.from.documentKey) ?? []), index]);
  }

  const finished = new Set<string>();
  const onPath = new Set<string>();

  const visit = (documentKey: string): void => {
    onPath.add(documentKey);
    for (const edgeIndex of outgoing.get(documentKey) ?? []) {
      const edge = sink.edges[edgeIndex];
      if (edge.state !== 'resolved') continue;

      const targetKey = edge.to.documentKey;
      if (onPath.has(targetKey)) {
        const prepared = context.documents.get(documentKey);
        if (!prepared || edge.diagnostic) continue;
        const diagnostic = graphDiagnostic(
          prepared.document,
          REFERENCE_GRAPH_CODES.importCycle,
          edge.path,
        );
        sink.edges[edgeIndex] = { ...edge, diagnostic };
        sink.diagnostics.push(diagnostic);
        continue;
      }
      if (!finished.has(targetKey)) visit(targetKey);
    }
    onPath.delete(documentKey);
    finished.add(documentKey);
  };

  for (const documentKey of outgoing.keys()) {
    if (!finished.has(documentKey)) visit(documentKey);
  }
}

/* ------------------------------------------------------------------ */
/*  Aufbau                                                             */
/* ------------------------------------------------------------------ */

/**
 * Nur eine Katalogprojektion trägt die kataloggescopte Control-Identität, die
 * die Referenzschicht für `#<control-id>` braucht. Geprüft wird die Struktur,
 * nicht der Root-Key: Ein Aufrufer, der etwas anderes übergibt, erhält keinen
 * Katalogkontext statt eines falschen.
 */
function isCatalogView(value: unknown): value is Catalog {
  return (
    typeof value === 'object' &&
    value !== null &&
    'controlsById' in value &&
    (value as { controlsById: unknown }).controlsById instanceof Map
  );
}

function summarize(
  document: ReferenceGraphDocument,
  sink: EdgeSink,
  nodeCount: number,
): ReferenceGraphArtifactSummary {
  const edges = sink.edges.filter((edge) => edge.from.documentKey === document.artifactKey);
  return {
    artifactKey: document.artifactKey,
    lifecycle: document.lifecycle,
    rootType: document.rootType,
    oscalVersion: document.oscalVersion,
    nodes: nodeCount,
    resolved: edges.filter((edge) => edge.state === 'resolved').length,
    unresolvable: edges.filter((edge) => edge.state === 'unresolvable').length,
    notEvaluable: edges.filter((edge) => edge.state === 'not-evaluable').length,
    gapAssertions: sink.gapAssertions.filter(
      (assertion) => assertion.documentKey === document.artifactKey,
    ).length,
    diagnostics: sink.diagnostics.filter(
      (diagnostic) => diagnostic.artifact.key === document.artifactKey,
    ).length,
  };
}

/**
 * Baut den vollständigen Referenzgraphen über alle übergebenen Artefakte.
 *
 * Artefakte, die der Aufrufer nicht übergibt — etwa ein `blocked-by-upstream`
 * gemeldetes, vollständig aus dem Upstream-Tree entferntes Artefakt —, sind
 * schlicht nicht geladen. Sie erzeugen weder Knoten noch einen Abbruch.
 */
export function buildReferenceGraph(input: ReferenceGraphInput): ReferenceGraph {
  const documents = new Map<string, PreparedDocument>();
  const catalogsByKey = new Map<CatalogKey, Catalog>();
  const documentKeysByReferenceDocument = new Map<ReferenceDocument, string>();
  const sink: EdgeSink = { edges: [], diagnostics: [], gapAssertions: [] };

  for (const document of input.documents) {
    const referenceDocument = createReferenceDocument({
      source: document.source,
      context: document.catalogKey ? { catalogKey: document.catalogKey } : {},
      rootType: document.rootType,
      oscalVersion: document.oscalVersion,
    });
    documents.set(document.artifactKey, {
      document,
      referenceDocument,
      index: indexDocumentNodes(document),
    });
    documentKeysByReferenceDocument.set(referenceDocument, document.artifactKey);
    if (document.catalogKey && isCatalogView(document.view)) {
      catalogsByKey.set(document.catalogKey, document.view);
    }
  }

  // Die einzige Quelle dokumentübergreifender Auflösbarkeit ist die
  // ausdrückliche Bindung des Aufrufers. Ein nicht gebundener Referenzwert
  // bleibt nicht bewertbar — auch dann, wenn ein gleichnamiges Artefakt
  // geladen ist.
  const documentsByHref = new Map<string, ReferenceDocument>();
  for (const binding of input.bindings ?? []) {
    const target = documents.get(binding.artifactKey);
    if (target) documentsByHref.set(binding.href, target.referenceDocument);
  }

  const context: GraphEvaluationContext = {
    documents,
    catalogsByKey,
    documentsByHref,
    documentKeysByReferenceDocument,
  };

  const nodes: ReferenceNode[] = [];
  for (const prepared of documents.values()) {
    nodes.push(...prepared.index.nodes);
    sink.diagnostics.push(...prepared.index.diagnostics);

    switch (prepared.document.rootType) {
      case 'catalog':
        deriveCatalogEdges(sink, prepared, context);
        break;
      case 'profile':
        deriveProfileEdges(sink, prepared, context);
        break;
      case 'mapping-collection':
        deriveMappingEdges(sink, prepared, context);
        break;
      case 'component-definition':
        deriveComponentEdges(sink, prepared, context);
        break;
      default:
        // Der Assessment Layer ist im ersten Slice noch nicht erschlossen; ein
        // noch nicht erfasster Root trägt seine Knoten bei, aber keine Kanten.
        break;
    }
  }

  markImportCycles(sink, context);

  const artifacts = [...documents.values()].map((prepared) =>
    summarize(prepared.document, sink, prepared.index.nodes.length),
  );

  return Object.freeze({
    nodes: Object.freeze(nodes) as readonly ReferenceNode[],
    edges: Object.freeze([...sink.edges]) as readonly ReferenceEdge[],
    gapAssertions: Object.freeze([...sink.gapAssertions]),
    diagnostics: Object.freeze([...sink.diagnostics]),
    artifacts: Object.freeze(artifacts),
  });
}
