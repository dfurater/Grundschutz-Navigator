// =============================================================================
// Deterministischer Importgraph der Profile Resolution (GSPP-291 Commit B)
//
// Normalisiert Profil-zu-Profil- und Profil-zu-Katalog-Kanten zu einer
// festen Auswertungsreihenfolge und prüft fail-closed, bevor irgendeine
// Semantik läuft: Zyklusabbruch ohne Teilergebnis, fehlende Ziele,
// Root-Type-Mismatch und gemischte OSCAL-Versionen im Graphen.
//
// Die Kanten kommen aus der Quellregister-Nachfolgetafel
// (`CATALOG_LINEAGES`-Nachfolger); aufgelöst wird ausschließlich gegen
// explizit bereitgestellte, verifizierte Dokumente — kein Netzwerk, kein
// Dateizugriff.
// =============================================================================

import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';

export const PROFILE_RESOLUTION_STAGE = 'profile-resolution' as const;

export const PROFILE_RESOLUTION_VALIDATOR = Object.freeze({
  name: 'gspp-profile-resolution',
  version: '1',
});

/** Stabile, redigierte Codes des Importgraphen. */
export const PROFILE_RESOLUTION_DIAGNOSTIC_CODES = Object.freeze({
  /** Ein Profil importiert sich mittelbar oder unmittelbar selbst. */
  CYCLE: 'PROFILE_RESOLUTION_CYCLE',
  /** Eine Importkante zeigt auf kein bereitgestelltes Dokument. */
  TARGET_MISSING: 'PROFILE_RESOLUTION_TARGET_MISSING',
  /** Ziel-Dokument trägt weder `catalog` noch `profile` als Root-Key. */
  ROOT_TYPE_MISMATCH: 'PROFILE_RESOLUTION_ROOT_TYPE_MISMATCH',
  /** Ein Dokument des Graphen deklariert keine `oscal-version`. */
  VERSION_MISSING: 'PROFILE_RESOLUTION_VERSION_MISSING',
  /** Der Graph trägt gemischte `oscal-version`-Werte. */
  VERSION_MISMATCH: 'PROFILE_RESOLUTION_VERSION_MISMATCH',
} as const);

/** Eine normalisierte Importkante. */
export interface ProfileResolutionEdge {
  readonly href: string;
  readonly artifactKey: string;
}

export interface ProfileResolutionPlanInput {
  /** Artefaktschlüssel des obersten, steuernden Profils. */
  readonly topProfileArtifactKey: string;
  /** Verifizierte Rohdokumente nach Artefaktschlüssel. */
  readonly documents: ReadonlyMap<string, unknown>;
  /** Normalisierte Importkanten je Artefaktschlüssel. */
  readonly edgesByArtifactKey: ReadonlyMap<string, readonly ProfileResolutionEdge[]>;
}

export type ProfileResolutionPlan =
  | {
    readonly ok: true;
    /** Feste Preorder-Reihenfolge: das steuernde Profil zuerst. */
    readonly order: readonly string[];
    readonly documents: ReadonlyMap<string, unknown>;
    /** Deklarierte Version des obersten Profils — die Graphenversion. */
    readonly oscalVersion: string;
  }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

function reject(code: string): { readonly ok: false; readonly diagnostic: OscalDiagnostic } {
  return {
    ok: false,
    diagnostic: createOscalDiagnostic({
      code,
      stage: PROFILE_RESOLUTION_STAGE,
      validator: PROFILE_RESOLUTION_VALIDATOR,
      path: '/',
    }),
  };
}

function rootEntry(document: unknown): [string, Record<string, unknown>] | null {
  if (document === null || typeof document !== 'object') return null;
  const keys = Reflect.ownKeys(document as object);
  if (keys.length !== 1) return null;
  const rootKey = keys[0]!;
  if (typeof rootKey !== 'string') return null;
  // Rein deskriptorbasierter Zugriff: Ein Root-Accessor wird nie ausgeführt
  // und führt fail-closed zur strukturellen Ablehnung (Greptile-Befund zu
  // bcde872).
  const descriptor = Object.getOwnPropertyDescriptor(document, rootKey);
  if (descriptor === undefined || !('value' in descriptor)) return null;
  const body: unknown = descriptor.value;
  if (body === null || typeof body !== 'object') return null;
  return [rootKey, body as Record<string, unknown>];
}

function declaredOscalVersion(document: unknown): string | null {
  const entry = rootEntry(document);
  if (entry === null) return null;
  const [, body] = entry;
  // Auch hier nur Deskriptorzugriff — kein Feld eines Dokuments wird gelesen,
  // ohne seine Data-Property-Natur vorher festzustellen.
  const metadataDescriptor = Object.getOwnPropertyDescriptor(body, 'metadata');
  const metadata =
    metadataDescriptor !== undefined && 'value' in metadataDescriptor
      ? metadataDescriptor.value
      : undefined;
  if (metadata === null || typeof metadata !== 'object') return null;
  const versionDescriptor = Object.getOwnPropertyDescriptor(
    metadata as object,
    'oscal-version',
  );
  const version =
    versionDescriptor !== undefined && 'value' in versionDescriptor
      ? versionDescriptor.value
      : undefined;
  return typeof version === 'string' && version.length > 0 ? version : null;
}

/** Prüft Root-Typ und Versionsbindung eines Dokuments des Graphen. */
function admitDocument(document: unknown, graphVersion: string): OscalDiagnostic | null {
  const root = rootEntry(document);
  if (root?.[0] !== 'catalog' && root?.[0] !== 'profile') {
    return reject(PROFILE_RESOLUTION_DIAGNOSTIC_CODES.ROOT_TYPE_MISMATCH).diagnostic;
  }
  const version = declaredOscalVersion(document);
  if (version === null) return reject(PROFILE_RESOLUTION_DIAGNOSTIC_CODES.VERSION_MISSING).diagnostic;
  if (version !== graphVersion) {
    return reject(PROFILE_RESOLUTION_DIAGNOSTIC_CODES.VERSION_MISMATCH).diagnostic;
  }
  return null;
}

/**
 * Baut den Auflösungsplan: Preorder-Walk über die normalisierten Kanten ab
 * dem steuernden Profil mit globaler Besuchsmenge (geteilte Ziele sind
 * zulässig und werden genau einmal geplant) und Zyklenerkennung über den
 * aktiven Pfad. Die Traversierung läuft auf einem expliziten Frame-Stack —
 * tiefe azyklische Ketten erschöpfen keinen Aufrufstapel (Greptile-Befund
 * zu 9da9883) — und bindet die Graphenversion an das oberste Profil.
 */
export function buildProfileResolutionPlan(
  input: ProfileResolutionPlanInput,
): ProfileResolutionPlan {
  const { topProfileArtifactKey, documents, edgesByArtifactKey } = input;
  const emptyEdges: readonly ProfileResolutionEdge[] = [];

  const topDocument = documents.get(topProfileArtifactKey);
  if (topDocument === undefined) return reject(PROFILE_RESOLUTION_DIAGNOSTIC_CODES.TARGET_MISSING);
  const topRoot = rootEntry(topDocument);
  if (topRoot?.[0] !== 'profile') {
    return reject(PROFILE_RESOLUTION_DIAGNOSTIC_CODES.ROOT_TYPE_MISMATCH);
  }
  const graphVersion = declaredOscalVersion(topDocument);
  if (graphVersion === null) {
    return reject(PROFILE_RESOLUTION_DIAGNOSTIC_CODES.VERSION_MISSING);
  }

  const order: string[] = [];
  const planned = new Set<string>();
  const activePath = new Set<string>();
  const stack: { readonly artifactKey: string; readonly edges: readonly ProfileResolutionEdge[]; index: number }[] = [];

  /** Zyklus, Zielvorhandensein und Dokumentaufnahme je Kante. */
  const planEdge = (edge: ProfileResolutionEdge): OscalDiagnostic | null => {
    if (activePath.has(edge.artifactKey)) {
      return reject(PROFILE_RESOLUTION_DIAGNOSTIC_CODES.CYCLE).diagnostic;
    }
    const document = documents.get(edge.artifactKey);
    if (document === undefined) {
      return reject(PROFILE_RESOLUTION_DIAGNOSTIC_CODES.TARGET_MISSING).diagnostic;
    }
    return admitDocument(document, graphVersion);
  };

  activePath.add(topProfileArtifactKey);
  planned.add(topProfileArtifactKey);
  order.push(topProfileArtifactKey);
  stack.push({
    artifactKey: topProfileArtifactKey,
    edges: edgesByArtifactKey.get(topProfileArtifactKey) ?? emptyEdges,
    index: 0,
  });

  while (stack.length > 0) {
    const frame = stack.at(-1)!;
    if (frame.index >= frame.edges.length) {
      activePath.delete(frame.artifactKey);
      stack.pop();
      continue;
    }
    const edge = frame.edges[frame.index]!;
    frame.index += 1;

    if (activePath.has(edge.artifactKey)) {
      return reject(PROFILE_RESOLUTION_DIAGNOSTIC_CODES.CYCLE);
    }
    if (planned.has(edge.artifactKey)) continue;

    const failure = planEdge(edge);
    if (failure !== null) return { ok: false, diagnostic: failure };

    activePath.add(edge.artifactKey);
    planned.add(edge.artifactKey);
    order.push(edge.artifactKey);

    const childEdges = edgesByArtifactKey.get(edge.artifactKey) ?? emptyEdges;
    if (childEdges.length === 0) {
      activePath.delete(edge.artifactKey);
      continue;
    }
    stack.push({ artifactKey: edge.artifactKey, edges: childEdges, index: 0 });
  }

  return { ok: true, order, documents, oscalVersion: graphVersion };
}
