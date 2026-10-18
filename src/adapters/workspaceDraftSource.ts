import { dispatchOscalDocument } from '@/domain/oscalRootDispatch';
import { enforceClass2ObjectGraphInvariants } from '@/domain/oscalObjectGraph';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';

/** Resource and object-graph limits that every stored source keeps, schema-valid or not. */
export function withinSourceLimits(source: unknown): boolean {
  return !enforceClass2ObjectGraphInvariants(source)
    && new TextEncoder().encode(serializeWorkspaceJson(source)).byteLength <= CLASS_2_IMPORT_LIMITS.maxBytes;
}

/** Source limits plus a root binding that matches the envelope; the admission of a draft row, without schema validity. */
export function bindsEnvelopeSource(source: unknown, rootType: string, oscalVersion: string): boolean {
  if (!withinSourceLimits(source)) return false;
  const bound = dispatchOscalDocument(source, { trustClass: 'class-2-local-user' });
  return bound.ok && bound.rootType === rootType && bound.oscalVersion === oscalVersion;
}
