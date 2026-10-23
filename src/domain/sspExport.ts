// =============================================================================
// Validierter Export eines lokalen SSP (GSPP-609)
//
// Der Export entsteht ausschließlich aus der gespeicherten Quelle eines
// `export-ready`-Dokuments, nie aus dem Read-Model. Die Quelle wird über den
// kontrollierten Builder (ADR-8 Festlegung 3) zum Graphen mit belegter
// Herkunft, durchläuft `processClass2OscalValue()` gegen das gepinnte Schema
// ihrer `oscal-version` und die Referenzprüfung (`component-uuid`, `role-id`,
// Party-UUID). Die Constraint-Stufe läuft nicht und wird als `not-checked`
// ausgewiesen. Ausgegeben wird reines OSCAL-JSON ohne Envelope-Feld und ohne
// Bindung; `import-profile.href` wird nicht aufgelöst.
// =============================================================================

import type { DerivedJsonTree } from '@/domain/oscalDerivedGraph';
import { processClass2OscalValue } from '@/domain/oscalObjectPipeline';
import { toDerivedOscalTree } from '@/domain/profileExport';
import { validateSspTargets, type TargetCategoryContext } from '@/domain/sspTargetObjects';
import { sspReadinessBlocker } from '@/domain/sspSave';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import type { DocumentState } from '@/domain/workspaceModel';

export const SSP_EXPORT_CODES = Object.freeze({
  notReady: 'OSCAL_EXPORT_NOT_READY',
  rootNotSsp: 'OSCAL_EXPORT_ROOT_NOT_SSP',
  sourceInvalid: 'OSCAL_EXPORT_SOURCE_INVALID',
} as const);

export interface SspExportReport {
  readonly schema: 'passed';
  readonly references: 'passed';
  readonly constraints: 'not-checked';
}

export type SspExportResult =
  | { readonly ok: true; readonly json: string; readonly report: SspExportReport }
  | { readonly ok: false; readonly code: string; readonly path: string };

const fail = (code: string, path = '/'): SspExportResult => ({ ok: false, code, path });

/**
 * Prüft einen Graphen für den Export. Ein Graph, der nicht über
 * `createOscalDerivedGraph()` entstanden ist, scheitert an der Herkunftsprüfung
 * mit `OSCAL_OBJECT_UNPROVENANCED`.
 */
export async function validateSspExportTree(tree: unknown, categories?: TargetCategoryContext): Promise<SspExportResult> {
  const processed = await processClass2OscalValue(tree, { trustClass: 'class-2-local-user' });
  if (!processed.ok) return fail(processed.diagnostic.code, processed.diagnostic.path);
  if (processed.document.rootType !== 'system-security-plan') return fail(SSP_EXPORT_CODES.rootNotSsp);
  const blocker = validateSspTargets(processed.document.source, categories) ?? sspReadinessBlocker(processed.document.source);
  if (blocker) return fail(blocker.code, blocker.path);
  return {
    ok: true,
    json: serializeWorkspaceJson(processed.document.source),
    report: { schema: 'passed', references: 'passed', constraints: 'not-checked' },
  };
}

/** Export eines gespeicherten Dokuments; nur `export-ready` und nur Root `system-security-plan`. */
export async function exportSspDocument(document: {
  readonly documentState: DocumentState;
  readonly rootType: string;
  readonly source: unknown;
  readonly categories?: TargetCategoryContext;
}): Promise<SspExportResult> {
  if (document.documentState !== 'export-ready') return fail(SSP_EXPORT_CODES.notReady);
  if (document.rootType !== 'system-security-plan') return fail(SSP_EXPORT_CODES.rootNotSsp);
  let tree: DerivedJsonTree;
  try {
    tree = toDerivedOscalTree(document.source);
  } catch {
    return fail(SSP_EXPORT_CODES.sourceInvalid);
  }
  return validateSspExportTree(tree, document.categories);
}
