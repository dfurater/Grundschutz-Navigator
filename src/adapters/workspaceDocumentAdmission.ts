import { dispatchOscalDocument } from '@/domain/oscalRootDispatch';
import { enforceClass2ObjectGraphInvariants } from '@/domain/oscalObjectGraph';
import type { Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import type { DocumentState } from '@/domain/workspaceModel';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { reject } from '@/adapters/workspaceStorageFailure';

export async function snapshotDocument(document: Class2OscalImportedDocument): Promise<Class2OscalImportedDocument> {
  if (document?.context?.trustClass !== 'class-2-local-user') reject('WORKSPACE_TRUST_CLASS_REJECTED');
  if (enforceClass2ObjectGraphInvariants(document.source)) reject('WORKSPACE_DOCUMENT_INVALID');
  const source = structuredClone(document.source);
  const bytes = new TextEncoder().encode(serializeWorkspaceJson(source));
  if (bytes.byteLength > CLASS_2_IMPORT_LIMITS.maxBytes) reject('WORKSPACE_DOCUMENT_INVALID');
  const bound = dispatchOscalDocument(source, { trustClass: 'class-2-local-user' });
  if (!bound.ok || bound.rootType !== document.rootType || bound.oscalVersion !== document.oscalVersion) reject('WORKSPACE_DOCUMENT_INVALID');
  const validated = await importClass2OscalDocument(bytes, { trustClass: 'class-2-local-user' });
  if (!validated.ok) reject('WORKSPACE_DOCUMENT_INVALID');
  return { source, context: { trustClass: 'class-2-local-user' }, rootType: bound.rootType, oscalVersion: bound.oscalVersion };
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
