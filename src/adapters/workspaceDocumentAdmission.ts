import { enforceClass2ObjectGraphInvariants } from '@/domain/oscalObjectGraph';
import type { Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import type { DocumentState } from '@/domain/workspaceModel';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { reject } from '@/adapters/workspaceStorageFailure';
import { bindsEnvelopeSource } from '@/adapters/workspaceDraftSource';

/**
 * Every state keeps the source limits and a root binding. The schema check runs unless the target state is draft;
 * a known target state other than draft requires it, an undecided one (undefined) reports it for assertAdmissible().
 */
export async function snapshotDocument(document: Class2OscalImportedDocument, state?: DocumentState): Promise<{ document: Class2OscalImportedDocument; schemaValid: boolean }> {
  if (document?.context?.trustClass !== 'class-2-local-user') reject('WORKSPACE_TRUST_CLASS_REJECTED');
  // The caller's graph is checked before structuredClone touches it; the clone is what gets stored and is checked again.
  if (enforceClass2ObjectGraphInvariants(document.source)) reject('WORKSPACE_DOCUMENT_INVALID');
  const source = structuredClone(document.source);
  if (!bindsEnvelopeSource(source, document.rootType, document.oscalVersion)) reject('WORKSPACE_DOCUMENT_INVALID');
  const snapshot = { source, context: { trustClass: 'class-2-local-user' as const }, rootType: document.rootType, oscalVersion: document.oscalVersion };
  if (state === 'draft') return { document: snapshot, schemaValid: false };
  const validated = await importClass2OscalDocument(new TextEncoder().encode(serializeWorkspaceJson(source)), { trustClass: 'class-2-local-user' });
  if (!validated.ok && state !== undefined) reject('WORKSPACE_DOCUMENT_INVALID');
  return { document: snapshot, schemaValid: validated.ok };
}

/** A stored document leaves state draft only with a schema-valid source. */
export function assertAdmissible(state: DocumentState, schemaValid: boolean): void {
  if (state !== 'draft' && !schemaValid) reject('WORKSPACE_DOCUMENT_INVALID');
}

export function assertState(state: DocumentState): void {
  if (!['imported', 'draft', 'export-ready'].includes(state)) reject('WORKSPACE_DOCUMENT_INVALID');
}

export function pointerValue(source: unknown, pointer: string): unknown {
  if (!pointer.startsWith('/') || /~(?![01])/.test(pointer)) reject('WORKSPACE_BINDING_INVALID');
  let value = source;
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) reject('WORKSPACE_BINDING_INVALID');
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
