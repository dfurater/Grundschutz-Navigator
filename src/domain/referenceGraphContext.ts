// =============================================================================
// Auswertungskontext des Referenzgraphen (GSPP-251)
//
// Hier liegt alles, was Katalog-, Profil-, Mapping- und Componentkanten
// gemeinsam brauchen: der Dokumentkontext, die Kantenablage und die beiden
// Auflösungsschritte. Getrennt vom Aufbau, damit die Kantenmodule und der
// Graphaufbau dieselben Regeln teilen, ohne sich gegenseitig zu importieren.
//
// Die Formentscheidung über einen `href` fällt **ausschließlich** in
// `resolveOscalReference`; dieses Modul übersetzt deren Ergebnis in
// Kantenzustand und Folgekontext.
// =============================================================================

import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  resolveOscalReference,
  type ReferenceDocument,
  type ResolvedOscalReference,
} from '@/domain/referenceResolution';
import type { DocumentNodeIndex } from '@/domain/referenceGraphIndex';
import {
  REFERENCE_GRAPH_CODES,
  REFERENCE_GRAPH_VALIDATOR,
  type NotEvaluableReason,
  type ReferenceEdge,
  type ReferenceEdgeKind,
  type ReferenceGapAssertion,
  type ReferenceGraphDocument,
  type ReferenceNodeId,
  type ReferenceNodeKind,
} from '@/domain/referenceGraphModel';
import type { Catalog } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';

/**
 * Ein Kontext, in dem lokale IDs überhaupt gedeutet werden dürfen.
 *
 * `document` ist der einzige Zustand, in dem eine ID aufgelöst wird — und auch
 * dann nur gegen den Index genau dieses Dokuments. `resource` ist bewusst
 * getrennt: Eine `back-matter`-Ressource ist ein gültiges Referenzziel, aber
 * kein Katalog; in ihr liegen keine Controls.
 */
export type ReferenceContext =
  | { readonly kind: 'document'; readonly documentKey: string }
  | { readonly kind: 'resource' }
  | { readonly kind: 'not-evaluable'; readonly reason: NotEvaluableReason }
  | { readonly kind: 'unresolvable' };

export interface PreparedDocument {
  readonly document: ReferenceGraphDocument;
  readonly referenceDocument: ReferenceDocument;
  readonly index: DocumentNodeIndex;
}

export interface GraphEvaluationContext {
  readonly documents: ReadonlyMap<string, PreparedDocument>;
  readonly catalogsByKey: ReadonlyMap<CatalogKey, Catalog>;
  readonly documentsByHref: ReadonlyMap<string, ReferenceDocument>;
  readonly documentKeysByReferenceDocument: ReadonlyMap<ReferenceDocument, string>;
}

/** Sammelstelle des Aufbaus. Kanten, Befunde und Lückenaussagen bleiben getrennt. */
export interface EdgeSink {
  readonly edges: ReferenceEdge[];
  readonly diagnostics: OscalDiagnostic[];
  readonly gapAssertions: ReferenceGapAssertion[];
}

export interface EdgeAnchor {
  readonly kind: ReferenceEdgeKind;
  readonly from: ReferenceNodeId;
  /** Struktureller JSON Pointer; nie ein `href`- oder ID-Wert. */
  readonly path: string;
}

/* ------------------------------------------------------------------ */
/*  Diagnosen und Kanten                                               */
/* ------------------------------------------------------------------ */

export function graphDiagnostic(
  document: ReferenceGraphDocument,
  code: string,
  path: string,
  params: Readonly<Record<string, string | number>> = {},
): OscalDiagnostic {
  return createOscalDiagnostic({
    code,
    stage: 'reference',
    validator: REFERENCE_GRAPH_VALIDATOR,
    path,
    artifact: {
      key: document.artifactKey,
      rootType: document.rootType,
      oscalVersion: document.oscalVersion,
    },
    params,
  });
}

export function artifactNode(documentKey: string): ReferenceNodeId {
  return { documentKey, kind: 'artifact', localId: null };
}

export function pushResolvedEdge(sink: EdgeSink, edge: EdgeAnchor, to: ReferenceNodeId): void {
  sink.edges.push({ ...edge, state: 'resolved', to });
}

export function pushUnresolvableEdge(
  sink: EdgeSink,
  edge: EdgeAnchor,
  diagnostic: OscalDiagnostic,
): void {
  sink.edges.push({ ...edge, state: 'unresolvable', diagnostic });
  sink.diagnostics.push(diagnostic);
}

export function pushNotEvaluableEdge(
  sink: EdgeSink,
  edge: EdgeAnchor,
  reason: NotEvaluableReason,
  diagnostic?: OscalDiagnostic,
): void {
  sink.edges.push({ ...edge, state: 'not-evaluable', reason, diagnostic });
  if (diagnostic) sink.diagnostics.push(diagnostic);
}

/* ------------------------------------------------------------------ */
/*  Lokale ID im Kontext                                               */
/* ------------------------------------------------------------------ */

/**
 * Löst eine lokale ID **ausschließlich** im übergebenen Kontext auf.
 *
 * Es gibt keinen Zweig, der auf einen anderen geladenen Katalog ausweicht:
 * Genau diese kontextlose Auflösung erzeugt die falschen Abdeckungszahlen, die
 * dieser Validator ausschließen soll.
 */
export function resolveLocalId(
  context: GraphEvaluationContext,
  sink: EdgeSink,
  input: {
    readonly document: ReferenceGraphDocument;
    readonly edge: EdgeAnchor;
    readonly targetKind: ReferenceNodeKind;
    readonly localId: string | undefined;
    readonly targetContext: ReferenceContext;
  },
): void {
  const { edge, targetContext } = input;

  if (targetContext.kind === 'not-evaluable') {
    pushNotEvaluableEdge(sink, edge, targetContext.reason);
    return;
  }
  if (targetContext.kind === 'resource') {
    pushNotEvaluableEdge(sink, edge, 'resource-context');
    return;
  }
  if (targetContext.kind === 'unresolvable') {
    // Der tragende Kontext ist bereits als Referenzfehler ausgewiesen. Eine
    // zweite Diagnose je untergeordneter ID würde denselben Befund vervielfachen.
    pushNotEvaluableEdge(sink, edge, 'context-not-evaluable');
    return;
  }
  // Eine fehlende Pflicht-ID ist ein Schemabefund der Stufe 3 und steht bereits
  // in den Adapterdiagnosen; der Graph verdoppelt ihn nicht.
  if (input.localId === undefined) return;

  const target = context.documents.get(targetContext.documentKey);
  if (!target) {
    pushNotEvaluableEdge(sink, edge, 'document-not-provided');
    return;
  }

  const lookup = target.index.lookup(input.targetKind, input.localId);
  if (lookup === 'found') {
    pushResolvedEdge(sink, edge, {
      documentKey: target.document.artifactKey,
      kind: input.targetKind,
      localId: input.localId,
    });
    return;
  }

  pushUnresolvableEdge(
    sink,
    edge,
    graphDiagnostic(
      input.document,
      lookup === 'ambiguous'
        ? REFERENCE_GRAPH_CODES.targetAmbiguous
        : REFERENCE_GRAPH_CODES.targetNotFound,
      edge.path,
      { targetKind: input.targetKind },
    ),
  );
}

/* ------------------------------------------------------------------ */
/*  Kontextverweise                                                    */
/* ------------------------------------------------------------------ */

export interface ContextReferenceResult {
  readonly context: ReferenceContext;
  readonly edgeTarget: ReferenceNodeId | null;
  readonly notEvaluableReason?: NotEvaluableReason;
  readonly diagnostic?: OscalDiagnostic;
}

function rootTypeMismatch(prepared: PreparedDocument, path: string): ContextReferenceResult {
  return {
    context: { kind: 'unresolvable' },
    edgeTarget: null,
    diagnostic: graphDiagnostic(
      prepared.document,
      REFERENCE_GRAPH_CODES.rootTypeMismatch,
      path,
    ),
  };
}

function classifyBoundDocument(
  context: GraphEvaluationContext,
  prepared: PreparedDocument,
  reference: Extract<ResolvedOscalReference, { kind: 'cross-document' }>,
  input: { readonly path: string; readonly allowedRootTypes: readonly OscalRootKey[] },
): ContextReferenceResult {
  const targetKey = context.documentKeysByReferenceDocument.get(reference.document);
  const target = targetKey ? context.documents.get(targetKey) : undefined;
  if (!target) {
    return {
      context: { kind: 'not-evaluable', reason: 'document-not-provided' },
      edgeTarget: null,
      notEvaluableReason: 'document-not-provided',
    };
  }
  if (reference.resource) {
    return {
      context: { kind: 'resource' },
      edgeTarget: {
        documentKey: target.document.artifactKey,
        kind: 'resource',
        localId: reference.resource.uuid,
      },
    };
  }
  if (!input.allowedRootTypes.includes(target.document.rootType)) {
    return rootTypeMismatch(prepared, input.path);
  }
  return {
    context: { kind: 'document', documentKey: target.document.artifactKey },
    edgeTarget: artifactNode(target.document.artifactKey),
  };
}

function classifyUnresolved(
  reference: Extract<ResolvedOscalReference, { kind: 'unresolved' }>,
  prepared: PreparedDocument,
  path: string,
): ContextReferenceResult {
  // `relative` und `document-not-provided` sind keine Datenqualitätsbefunde:
  // Das Ziel liegt außerhalb des geprüften Kontexts und wird nach GSPP-286
  // bewusst nicht aufgelöst. Die Diagnose des Klassifikators wird deshalb hier
  // nicht übernommen.
  if (reference.reason === 'relative' || reference.reason === 'document-not-provided') {
    return {
      context: { kind: 'not-evaluable', reason: reference.reason },
      edgeTarget: null,
      notEvaluableReason: reference.reason,
    };
  }
  return {
    context: { kind: 'unresolvable' },
    edgeTarget: null,
    diagnostic: graphDiagnostic(
      prepared.document,
      reference.reason === 'unsafe-protocol'
        ? REFERENCE_GRAPH_CODES.externalContextUnpinned
        : REFERENCE_GRAPH_CODES.targetNotFound,
      path,
      { reason: reference.reason },
    ),
  };
}

/**
 * Klassifiziert einen Verweis, der einen Auflösungskontext eröffnet
 * (`profile.imports[].href`, `mapping.*-resource.href`,
 * `control-implementation.source`).
 */
export function classifyContextReference(
  context: GraphEvaluationContext,
  prepared: PreparedDocument,
  input: {
    readonly href: string;
    readonly path: string;
    readonly allowedRootTypes: readonly OscalRootKey[];
  },
): ContextReferenceResult {
  const reference = resolveOscalReference(
    { href: input.href, path: input.path },
    {
      document: prepared.referenceDocument,
      catalogsByKey: context.catalogsByKey,
      documentsByHref: context.documentsByHref,
    },
  );

  switch (reference.kind) {
    case 'external':
      // Ein externes Ziel wird nie abgerufen und nie aufgelöst. Als tragender
      // Kontext ist das ein eigener Befund — „extern und damit nicht
      // versionsstabil überprüfbar" —, ausdrücklich nicht „ID nicht gefunden".
      return {
        context: { kind: 'not-evaluable', reason: 'external' },
        edgeTarget: null,
        notEvaluableReason: 'external',
        diagnostic: graphDiagnostic(
          prepared.document,
          REFERENCE_GRAPH_CODES.externalContextUnpinned,
          input.path,
        ),
      };
    case 'resource':
      return {
        context: { kind: 'resource' },
        edgeTarget: {
          documentKey: prepared.document.artifactKey,
          kind: 'resource',
          localId: reference.resource.uuid,
        },
      };
    case 'cross-document':
      return classifyBoundDocument(context, prepared, reference, input);
    case 'control':
      // Ein Kontextverweis, der auf eine Control zeigt, benennt kein Dokument
      // des erlaubten Root-Typs.
      return rootTypeMismatch(prepared, input.path);
    case 'provenance':
      return {
        context: { kind: 'not-evaluable', reason: 'context-not-evaluable' },
        edgeTarget: null,
        notEvaluableReason: 'context-not-evaluable',
      };
    case 'unresolved':
      return classifyUnresolved(reference, prepared, input.path);
  }
}

/** Trägt das Ergebnis von `classifyContextReference` als Kante ein. */
export function pushContextEdge(
  sink: EdgeSink,
  edge: EdgeAnchor,
  result: ContextReferenceResult,
): void {
  if (result.edgeTarget) {
    pushResolvedEdge(sink, edge, result.edgeTarget);
    return;
  }
  if (result.context.kind === 'unresolvable' && result.diagnostic) {
    pushUnresolvableEdge(sink, edge, result.diagnostic);
    return;
  }
  pushNotEvaluableEdge(
    sink,
    edge,
    result.notEvaluableReason ?? 'context-not-evaluable',
    result.diagnostic,
  );
}
