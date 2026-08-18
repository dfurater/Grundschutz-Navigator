// =============================================================================
// Knotenindex des Referenzgraphen (GSPP-251)
//
// Die Knoten entstehen aus dem **Quellgraphen**, nicht aus der Projektion: Eine
// Projektion, die IDs in einer Map führt, hat ein Duplikat bereits eingeebnet.
// Genau dieses Duplikat ist aber ein Referenzbefund — eine ID, die zweimal
// vergeben ist, macht jedes Ziel auf sie mehrdeutig.
//
// Der Index klassifiziert nichts. Er zählt lokale Identitäten je Dokument und
// hält fest, wo eine zweite Vergabe steht.
// =============================================================================

import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  REFERENCE_GRAPH_CODES,
  REFERENCE_GRAPH_VALIDATOR,
  type ReferenceGraphDocument,
  type ReferenceNode,
  type ReferenceNodeKind,
} from '@/domain/referenceGraphModel';

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function getDocumentBody(document: ReferenceGraphDocument): JsonObject | null {
  if (!isJsonObject(document.source)) return null;
  const body = document.source[document.rootType];
  return isJsonObject(body) ? body : null;
}

/**
 * Der Auflösungsstand einer lokalen ID im Zielkontext. `ambiguous` ist ein
 * eigener Zustand: Ein mehrdeutiges Ziel ist nicht dasselbe wie ein fehlendes,
 * und beide sind nicht dasselbe wie ein getroffenes.
 */
export type NodeLookupResult = 'found' | 'missing' | 'ambiguous';

export interface DocumentNodeIndex {
  readonly documentKey: string;
  readonly documentUuid: string | null;
  readonly nodes: readonly ReferenceNode[];
  readonly diagnostics: readonly OscalDiagnostic[];
  lookup(kind: ReferenceNodeKind, localId: string): NodeLookupResult;
}

interface NodeCollector {
  readonly nodes: ReferenceNode[];
  readonly diagnostics: OscalDiagnostic[];
  /**
   * `undefined` heißt „der Quellknoten trägt keine ID" — dann entsteht kein
   * Knoten. `null` ist die Identität des Artefaktknotens selbst.
   */
  add(kind: ReferenceNodeKind, localId: string | null | undefined, path: string): void;
  lookup(kind: ReferenceNodeKind, localId: string): NodeLookupResult;
}

function createNodeCollector(
  document: ReferenceGraphDocument,
  documentUuid: string | null,
): NodeCollector {
  const counts = new Map<string, number>();
  const nodes: ReferenceNode[] = [];
  const diagnostics: OscalDiagnostic[] = [];

  return {
    nodes,
    diagnostics,
    add(kind, localId, path) {
      if (localId === undefined) return;

      const mapKey = `${kind}|${localId ?? ''}`;
      const seen = counts.get(mapKey) ?? 0;
      counts.set(mapKey, seen + 1);

      if (seen > 0) {
        diagnostics.push(
          createOscalDiagnostic({
            code: REFERENCE_GRAPH_CODES.duplicateNodeId,
            stage: 'reference',
            validator: REFERENCE_GRAPH_VALIDATOR,
            path,
            artifact: {
              key: document.artifactKey,
              rootType: document.rootType,
              oscalVersion: document.oscalVersion,
            },
            // `kind` stammt aus der geschlossenen Knotenmenge, nicht aus dem
            // Dokument; die ID selbst erscheint nie in einer Diagnose.
            params: { nodeKind: kind },
          }),
        );
        return;
      }

      nodes.push({
        documentKey: document.artifactKey,
        kind,
        localId,
        oscalVersion: document.oscalVersion,
        rootType: document.rootType,
        documentUuid,
        catalogKey: document.catalogKey ?? null,
      });
    },
    lookup(kind, localId) {
      const count = counts.get(`${kind}|${localId}`) ?? 0;
      if (count === 0) return 'missing';
      return count > 1 ? 'ambiguous' : 'found';
    },
  };
}

/**
 * Statement-Knoten sind `part`-Knoten mit dem Namen `statement` und einer
 * eigenen ID — die Granularität, auf die ein `mapping-item` mit
 * `type: "statement"` zeigt. Andere `part`-Namen (etwa `guidance`) sind kein
 * Referenzziel dieses Vokabulars und werden nicht indiziert.
 */
function collectStatements(
  collector: NodeCollector,
  parts: readonly unknown[],
  path: string,
): void {
  for (const [index, candidate] of parts.entries()) {
    if (!isJsonObject(candidate)) continue;
    const partPath = `${path}/${index}`;
    if (readString(candidate.name) === 'statement') {
      collector.add('statement', readString(candidate.id), partPath);
    }
    collectStatements(collector, readArray(candidate.parts), `${partPath}/parts`);
  }
}

function collectControls(
  collector: NodeCollector,
  controls: readonly unknown[],
  path: string,
): void {
  for (const [index, candidate] of controls.entries()) {
    if (!isJsonObject(candidate)) continue;
    const controlPath = `${path}/${index}`;
    collector.add('control', readString(candidate.id), controlPath);
    collectStatements(collector, readArray(candidate.parts), `${controlPath}/parts`);
    collectControls(collector, readArray(candidate.controls), `${controlPath}/controls`);
  }
}

function collectGroups(collector: NodeCollector, groups: readonly unknown[], path: string): void {
  for (const [index, candidate] of groups.entries()) {
    if (!isJsonObject(candidate)) continue;
    const groupPath = `${path}/${index}`;
    collector.add('group', readString(candidate.id), groupPath);
    collectControls(collector, readArray(candidate.controls), `${groupPath}/controls`);
    collectGroups(collector, readArray(candidate.groups), `${groupPath}/groups`);
  }
}

function collectBackMatter(
  collector: NodeCollector,
  body: JsonObject,
  rootType: string,
): void {
  const backMatter = body['back-matter'];
  if (!isJsonObject(backMatter)) return;

  const path = `/${rootType}/back-matter/resources`;
  for (const [index, candidate] of readArray(backMatter.resources).entries()) {
    if (!isJsonObject(candidate)) continue;
    // Eine Ressource verlangt schemaseitig **nur** `uuid`. Eine inhaltsleere
    // Ressource ist gültig und hier ein vollwertiger Knoten.
    collector.add('resource', readString(candidate.uuid), `${path}/${index}`);
  }
}

function collectComponents(collector: NodeCollector, body: JsonObject, rootType: string): void {
  for (const [index, candidate] of readArray(body.components).entries()) {
    if (!isJsonObject(candidate)) continue;
    collector.add('component', readString(candidate.uuid), `/${rootType}/components/${index}`);
  }
  for (const [index, candidate] of readArray(body.capabilities).entries()) {
    if (!isJsonObject(candidate)) continue;
    collector.add('capability', readString(candidate.uuid), `/${rootType}/capabilities/${index}`);
  }
}

/** Bildet alle Knoten genau eines Dokuments aus seinem Quellgraphen. */
export function indexDocumentNodes(document: ReferenceGraphDocument): DocumentNodeIndex {
  const body = getDocumentBody(document);
  const documentUuid = body ? (readString(body.uuid) ?? null) : null;
  const collector = createNodeCollector(document, documentUuid);
  const { rootType } = document;

  collector.add('artifact', null, `/${rootType}`);

  if (body) {
    if (rootType === 'catalog') {
      collectGroups(collector, readArray(body.groups), `/${rootType}/groups`);
      collectControls(collector, readArray(body.controls), `/${rootType}/controls`);
    }
    if (rootType === 'component-definition') {
      collectComponents(collector, body, rootType);
    }
    collectBackMatter(collector, body, rootType);
  }

  return {
    documentKey: document.artifactKey,
    documentUuid,
    nodes: collector.nodes,
    diagnostics: collector.diagnostics,
    lookup: (kind, localId) => collector.lookup(kind, localId),
  };
}
