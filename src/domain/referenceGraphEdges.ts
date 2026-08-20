// =============================================================================
// Kanten des Referenzgraphen für Profile, Mappings und Components (GSPP-251)
//
// Jede Kante entsteht aus der Projektion des zuständigen Adapters — der Graph
// leitet die Quellstruktur nicht ein zweites Mal ab. Die Katalogkanten stehen
// in `referenceGraph.ts`, weil sie über die vorhandene Katalogauflösung laufen.
// =============================================================================

import {
  MAPPING_RELATIONSHIP_GAP,
  type Mapping,
  type MappingCollection,
  type MappingEntry,
  type MappingItem,
  type MappingResourceReference,
  type MappingVocabularyBinding,
} from '@/domain/mappingModel';
import type {
  ComponentControlImplementation,
  ComponentDefinition,
  ComponentImplementedRequirement,
} from '@/domain/componentDefinitionModel';
import type { Profile, ProfileControlSelector, ProfileImport } from '@/domain/profileModel';
import {
  REFERENCE_GRAPH_CODES,
  type ReferenceNodeId,
  type ReferenceNodeKind,
} from '@/domain/referenceGraphModel';
import {
  artifactNode,
  classifyContextReference,
  graphDiagnostic,
  pushContextEdge,
  pushNotEvaluableEdge,
  pushUnresolvableEdge,
  resolveLocalId,
  type EdgeSink,
  type GraphEvaluationContext,
  type PreparedDocument,
  type ReferenceContext,
} from '@/domain/referenceGraphContext';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';

/** Ein `import`, eine Mapping-Ressource und eine `source` dürfen beides sein. */
const CONTROL_SOURCE_ROOT_TYPES: readonly OscalRootKey[] = ['catalog', 'profile'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readList<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Ein Kontext ohne `href` ist nicht bewertbar, nicht fehlerhaft: Das fehlende
 * Pflichtfeld ist ein Schemabefund der Stufe 3 und steht bereits in den
 * Adapterdiagnosen.
 */
const MISSING_HREF_CONTEXT: ReferenceContext = {
  kind: 'not-evaluable',
  reason: 'context-not-evaluable',
};

/* ------------------------------------------------------------------ */
/*  Profile                                                            */
/* ------------------------------------------------------------------ */

function selectorsOfImport(profileImport: ProfileImport): readonly ProfileControlSelector[] {
  const { selection } = profileImport;
  const included =
    selection.kind === 'include-controls' || selection.kind === 'ambiguous'
      ? selection.includeControls
      : [];
  // Ein Ausschluss benennt dieselben Controls wie ein Einschluss: Beide sind
  // Verweise in den importierten Kontext und werden gleich geprüft.
  return [...included, ...profileImport.excludeControls];
}

export function deriveProfileEdges(
  sink: EdgeSink,
  prepared: PreparedDocument,
  context: GraphEvaluationContext,
): void {
  const view = prepared.document.view as Profile;
  if (!isRecord(view)) return;

  const from = artifactNode(prepared.document.artifactKey);
  for (const profileImport of readList<ProfileImport>(view.imports)) {
    const importPath = `${profileImport.path}/href`;
    const result = profileImport.href
      ? classifyContextReference(context, prepared, {
        href: profileImport.href,
        path: importPath,
        allowedRootTypes: CONTROL_SOURCE_ROOT_TYPES,
      })
      : { context: MISSING_HREF_CONTEXT, edgeTarget: null };

    if (profileImport.href) {
      pushContextEdge(sink, { kind: 'profile-import', from, path: importPath }, result);
    }

    // Ein importiertes **Profil** trägt selbst keine Controls; sein aufgelöstes
    // Control-Set entsteht erst durch Profile Resolution (GSPP-291). Die
    // Selektion bleibt darum nicht bewertbar, statt falsch zu scheitern.
    const targetIsProfile =
      result.context.kind === 'document' &&
      context.documents.get(result.context.documentKey)?.document.rootType === 'profile';
    const selectionContext: ReferenceContext = targetIsProfile
      ? { kind: 'not-evaluable', reason: 'context-not-evaluable' }
      : result.context;

    for (const selector of selectorsOfImport(profileImport)) {
      for (const [index, withId] of selector.withIds.entries()) {
        resolveLocalId(context, sink, {
          document: prepared.document,
          edge: {
            kind: 'profile-selection',
            from,
            path: `${selector.path}/with-ids/${index}`,
          },
          targetKind: 'control',
          localId: withId,
          targetContext: selectionContext,
        });
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Mapping Collections                                                */
/* ------------------------------------------------------------------ */

interface MappingSide {
  readonly context: ReferenceContext;
}

function allowedRootTypesForResource(
  type: MappingVocabularyBinding<'catalog' | 'profile'>,
): readonly OscalRootKey[] {
  return type.kind === 'known' ? [type.value] : CONTROL_SOURCE_ROOT_TYPES;
}

function deriveMappingResource(
  sink: EdgeSink,
  prepared: PreparedDocument,
  context: GraphEvaluationContext,
  resource: MappingResourceReference | null,
): MappingSide {
  if (!resource) return { context: MISSING_HREF_CONTEXT };

  const from = artifactNode(prepared.document.artifactKey);
  const edge = { kind: 'mapping-resource' as const, from, path: `${resource.path}/href` };

  if (resource.type.kind === 'unknown') {
    pushUnresolvableEdge(
      sink,
      edge,
      graphDiagnostic(
        prepared.document,
        REFERENCE_GRAPH_CODES.resourceTypeUnsupported,
        `${resource.path}/type`,
      ),
    );
    return { context: { kind: 'unresolvable' } };
  }
  if (resource.type.kind === 'extension') {
    // Ein fremder `ns` hebt die Vokabularbindung auf. Welcher Root-Typ dann
    // gemeint ist, sagt OSCAL nicht — geraten wird nichts.
    pushNotEvaluableEdge(sink, edge, 'vocabulary-extension');
    return { context: { kind: 'not-evaluable', reason: 'vocabulary-extension' } };
  }
  if (!resource.href) return { context: MISSING_HREF_CONTEXT };

  const result = classifyContextReference(context, prepared, {
    href: resource.href,
    path: edge.path,
    allowedRootTypes: allowedRootTypesForResource(resource.type),
  });
  pushContextEdge(sink, edge, result);
  return { context: result.context };
}

function targetKindOfItem(item: MappingItem): ReferenceNodeKind | null {
  return item.type.kind === 'known' ? item.type.value : null;
}

function deriveMappingItems(
  sink: EdgeSink,
  prepared: PreparedDocument,
  context: GraphEvaluationContext,
  items: readonly MappingItem[],
  side: MappingSide,
): void {
  const from = artifactNode(prepared.document.artifactKey);
  for (const item of items) {
    const edge = { kind: 'mapping-item' as const, from, path: `${item.path}/id-ref` };

    if (item.type.kind === 'unknown') {
      pushUnresolvableEdge(
        sink,
        edge,
        graphDiagnostic(
          prepared.document,
          REFERENCE_GRAPH_CODES.itemTypeUnsupported,
          `${item.path}/type`,
        ),
      );
      continue;
    }
    const targetKind = targetKindOfItem(item);
    if (!targetKind) {
      pushNotEvaluableEdge(sink, edge, 'vocabulary-extension');
      continue;
    }

    resolveLocalId(context, sink, {
      document: prepared.document,
      edge,
      targetKind,
      localId: item.idRef,
      targetContext: side.context,
    });
  }
}

/**
 * `no-relationship` ist eine gültige fachliche Aussage und **keine** Kante:
 * Es gibt kein Ziel, das vorhanden sein müsste. Der Eintrag wird deshalb als
 * Lückenaussage geführt und erzeugt nie einen Referenzfehler.
 */
function assertsGap(entry: MappingEntry): boolean {
  return (
    entry.relationship.kind === 'known' &&
    entry.relationship.value === MAPPING_RELATIONSHIP_GAP
  );
}

export function deriveMappingEdges(
  sink: EdgeSink,
  prepared: PreparedDocument,
  context: GraphEvaluationContext,
): void {
  const view = prepared.document.view as MappingCollection;
  if (!isRecord(view)) return;

  for (const mapping of readList<Mapping>(view.mappings)) {
    const source = deriveMappingResource(sink, prepared, context, mapping.sourceResource);
    const target = deriveMappingResource(sink, prepared, context, mapping.targetResource);

    for (const entry of readList<MappingEntry>(mapping.maps)) {
      if (assertsGap(entry)) {
        sink.gapAssertions.push({
          documentKey: prepared.document.artifactKey,
          path: entry.path,
        });
        continue;
      }
      deriveMappingItems(sink, prepared, context, entry.sources, source);
      deriveMappingItems(sink, prepared, context, entry.targets, target);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Component Definitions                                              */
/* ------------------------------------------------------------------ */

function deriveControlImplementation(
  sink: EdgeSink,
  prepared: PreparedDocument,
  context: GraphEvaluationContext,
  owner: ReferenceNodeId,
  implementation: ComponentControlImplementation,
): void {
  const sourcePath = `${implementation.path}/source`;
  const result = implementation.source
    ? classifyContextReference(context, prepared, {
      href: implementation.source.href,
      path: sourcePath,
      allowedRootTypes: CONTROL_SOURCE_ROOT_TYPES,
    })
    : { context: MISSING_HREF_CONTEXT, edgeTarget: null };

  if (implementation.source) {
    pushContextEdge(sink, { kind: 'component-source', from: owner, path: sourcePath }, result);
  }

  for (const requirement of readList<ComponentImplementedRequirement>(
    implementation.implementedRequirements,
  )) {
    resolveLocalId(context, sink, {
      document: prepared.document,
      edge: {
        kind: 'component-control',
        from: owner,
        path: `${requirement.path}/control-id`,
      },
      targetKind: 'control',
      localId: requirement.controlId,
      targetContext: result.context,
    });
  }
}

interface ImplementationOwner {
  readonly uuid?: string;
  readonly controlImplementations: readonly ComponentControlImplementation[];
}

export function deriveComponentEdges(
  sink: EdgeSink,
  prepared: PreparedDocument,
  context: GraphEvaluationContext,
): void {
  const view = prepared.document.view as ComponentDefinition;
  if (!isRecord(view)) return;

  const documentKey = prepared.document.artifactKey;
  // Beide Träger, nicht nur `components`: Eine Capability kann eine **eigene**
  // `control-implementation` führen. Ein Durchlauf nur über `components`
  // verlöre deren Referenzen still.
  const owners: readonly (readonly [ReferenceNodeKind, ImplementationOwner])[] = [
    ...readList<ImplementationOwner>(view.components).map(
      (component) => ['component', component] as const,
    ),
    ...readList<ImplementationOwner>(view.capabilities).map(
      (capability) => ['capability', capability] as const,
    ),
  ];

  for (const [kind, owner] of owners) {
    const ownerNode: ReferenceNodeId = owner.uuid
      ? { documentKey, kind, localId: owner.uuid }
      : artifactNode(documentKey);
    for (const implementation of readList<ComponentControlImplementation>(
      owner.controlImplementations,
    )) {
      deriveControlImplementation(sink, prepared, context, ownerNode, implementation);
    }
  }
}
