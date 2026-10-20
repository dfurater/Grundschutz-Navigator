// =============================================================================
// Validierter Export eines lokalen Profils (GSPP-292)
//
// Der Export entsteht ausschließlich aus der gespeicherten, gepatchten Quelle
// eines `export-ready`-Dokuments, nie aus einem Read-Model. Die Quelle wird
// über den kontrollierten Builder (ADR-8 Festlegung 3) zum Graphen mit
// belegter Herkunft, durchläuft `processClass2OscalValue()` gegen das gepinnte
// Schema ihrer `oscal-version` und die Referenzprüfung der `import.href`-
// Fragmente über `resolveOscalReference()`. Die Constraint-Stufe läuft nicht
// und wird als `not-checked` ausgewiesen (docs/OSCAL_VALIDATION.md, Stufe 4).
// Ausgegeben wird reines OSCAL-JSON: kein Envelope-Feld, keine Bindung.
// =============================================================================

import { createOscalDerivedGraph, type DerivedGraphValue, type DerivedJsonTree } from '@/domain/oscalDerivedGraph';
import { processClass2OscalValue } from '@/domain/oscalObjectPipeline';
import { isJsonObject, readArray, readString } from '@/domain/jsonGuards';
import { createReferenceDocument, isLocalFragmentHref, resolveOscalReference } from '@/domain/referenceResolution';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import type { DocumentState } from '@/domain/workspaceModel';

export const PROFILE_EXPORT_CODES = Object.freeze({
  notReady: 'OSCAL_EXPORT_NOT_READY',
  rootNotProfile: 'OSCAL_EXPORT_ROOT_NOT_PROFILE',
  sourceInvalid: 'OSCAL_EXPORT_SOURCE_INVALID',
  referenceUnresolved: 'OSCAL_EXPORT_REFERENCE_UNRESOLVED',
  referenceAmbiguous: 'OSCAL_EXPORT_REFERENCE_AMBIGUOUS',
} as const);

export interface ProfileExportReport {
  readonly schema: 'passed';
  /** Aufgelöste `import.href`-Fragmente / alle Fragmente. */
  readonly references: { readonly resolved: number; readonly total: number };
  readonly constraints: 'not-checked';
}

export type ProfileExportResult =
  | { readonly ok: true; readonly json: string; readonly report: ProfileExportReport }
  | { readonly ok: false; readonly code: string; readonly path: string };

const fail = (code: string, path = '/'): ProfileExportResult => ({ ok: false, code, path });

type Builder = ReturnType<typeof createOscalDerivedGraph>;

/** Baut einen reinen JSON-Wert über den Builder nach; jeder andere Wert wirft. */
function emit(builder: Builder, value: unknown): DerivedGraphValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Nicht darstellbare Zahl');
    return value;
  }
  if (Array.isArray(value)) {
    const handle = builder.array();
    for (const item of value) builder.pushArrayItem(handle, emit(builder, item));
    return handle;
  }
  if (isJsonObject(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const handle = builder.object();
    for (const [key, member] of Object.entries(value)) builder.setObjectMember(handle, key, emit(builder, member));
    return handle;
  }
  throw new TypeError('Kein JSON-Wert');
}

/** Die gespeicherte Quelle als Graph mit belegter Herkunft. */
export function toDerivedProfileTree(source: unknown): DerivedJsonTree {
  const builder = createOscalDerivedGraph();
  const root = emit(builder, source);
  if (root === null || typeof root !== 'object') throw new TypeError('Wurzel ist kein Objekt');
  return builder.finishRoot(root);
}

/** Zahl der `back-matter.resources` je UUID, ohne Groß-/Kleinschreibung (`localFragmentUuid()`). */
function resourceCounts(profile: Record<string, unknown> | undefined): Map<string, number> {
  const counts = new Map<string, number>();
  const backMatter = profile?.['back-matter'];
  for (const resource of readArray(isJsonObject(backMatter) ? backMatter.resources : undefined)) {
    const uuid = isJsonObject(resource) ? readString(resource.uuid)?.toLowerCase() : undefined;
    if (uuid !== undefined) counts.set(uuid, (counts.get(uuid) ?? 0) + 1);
  }
  return counts;
}

function checkReferences(tree: unknown, oscalVersion: string): { resolved: number; total: number; failure?: { code: string; path: string } } {
  const profile = isJsonObject(tree) && isJsonObject(tree.profile) ? tree.profile : undefined;
  const counts = resourceCounts(profile);
  const document = createReferenceDocument({ source: tree, context: { trustClass: 'class-2-local-user' }, rootType: 'profile', oscalVersion });
  let resolved = 0;
  let total = 0;
  let failure: { code: string; path: string } | undefined;
  readArray(profile?.imports).forEach((entry, index) => {
    const href = isJsonObject(entry) ? readString(entry.href) : undefined;
    if (href === undefined || !isLocalFragmentHref(href)) return;
    total += 1;
    const path = `/profile/imports/${index}/href`;
    // Der Ressourcenindex der Auflösung behält bei doppelter UUID still den ersten Eintrag.
    if ((counts.get(href.slice(1).toLowerCase()) ?? 0) > 1) failure ??= { code: PROFILE_EXPORT_CODES.referenceAmbiguous, path };
    else if (resolveOscalReference({ href, path }, { document }).kind === 'resource') resolved += 1;
    else failure ??= { code: PROFILE_EXPORT_CODES.referenceUnresolved, path };
  });
  return { resolved, total, failure };
}

/**
 * Prüft einen Graphen für den Export. Ein Graph, der nicht über
 * `createOscalDerivedGraph()` entstanden ist, scheitert an der Herkunftsprüfung
 * mit `OSCAL_OBJECT_UNPROVENANCED`.
 */
export async function validateProfileExportTree(tree: unknown): Promise<ProfileExportResult> {
  const processed = await processClass2OscalValue(tree, { trustClass: 'class-2-local-user' });
  if (!processed.ok) return fail(processed.diagnostic.code, processed.diagnostic.path);
  if (processed.document.rootType !== 'profile') return fail(PROFILE_EXPORT_CODES.rootNotProfile);
  const references = checkReferences(processed.document.source, processed.document.oscalVersion);
  if (references.failure) return fail(references.failure.code, references.failure.path);
  return {
    ok: true,
    json: serializeWorkspaceJson(processed.document.source),
    report: { schema: 'passed', references: { resolved: references.resolved, total: references.total }, constraints: 'not-checked' },
  };
}

/** Export eines gespeicherten Dokuments; nur `export-ready` und nur Root `profile`. */
export async function exportProfileDocument(document: {
  readonly documentState: DocumentState;
  readonly rootType: string;
  readonly source: unknown;
}): Promise<ProfileExportResult> {
  if (document.documentState !== 'export-ready') return fail(PROFILE_EXPORT_CODES.notReady);
  if (document.rootType !== 'profile') return fail(PROFILE_EXPORT_CODES.rootNotProfile);
  let tree: DerivedJsonTree;
  try {
    tree = toDerivedProfileTree(document.source);
  } catch {
    return fail(PROFILE_EXPORT_CODES.sourceInvalid);
  }
  return validateProfileExportTree(tree);
}
