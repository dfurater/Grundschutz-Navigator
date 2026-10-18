import { processClass2OscalBytes, type Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { WORKSPACE_DIAGNOSTIC_CODES } from '@/domain/workspaceDiagnostics';
import { enforceClass2ObjectGraphInvariants } from '@/domain/oscalObjectGraph';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import type { LocalId, VerbundId, WorkspaceEnvelope } from '@/domain/workspaceModel';

export type WorkspaceMembershipResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic; readonly existingLocalId?: never; readonly action?: never }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic; readonly existingLocalId: LocalId; readonly action: 'replace' };

const validator = Object.freeze({ name: 'gspp-workspace-membership', version: '1' });
function diagnostic(code: string, path = '/'): OscalDiagnostic {
  return createOscalDiagnostic({ code, stage: 'domain', path, validator });
}

/** Pure admission decision; replacing a member and preserving bindings belongs to the workspace store. */
export async function checkWorkspaceMembership(input: {
  readonly document: Class2OscalImportedDocument;
  readonly members: readonly WorkspaceEnvelope[];
  readonly verbundId: VerbundId;
  readonly replacingLocalId?: LocalId;
}): Promise<WorkspaceMembershipResult> {
  const { document, members, verbundId, replacingLocalId } = input;
  if (document?.context?.trustClass !== 'class-2-local-user') {
    return { ok: false, diagnostic: diagnostic(WORKSPACE_DIAGNOSTIC_CODES.trustClassRejected) };
  }
  if (replacingLocalId !== undefined && !members.some(member => member.localId === replacingLocalId && member.verbundId === verbundId)) {
    return { ok: false, diagnostic: diagnostic(WORKSPACE_DIAGNOSTIC_CODES.replacementTargetInvalid) };
  }
  const structuralFailure = enforceClass2ObjectGraphInvariants(document.source);
  if (structuralFailure) return { ok: false, diagnostic: structuralFailure };
  // Worker transport has no parser-container identity. Re-enter the existing
  // byte pipeline after checking the bounded plain-data graph, as storage does.
  const bytes = new TextEncoder().encode(serializeWorkspaceJson(document.source));
  const validated = await processClass2OscalBytes(bytes, { trustClass: 'class-2-local-user' });
  if (!validated.ok) return validated;
  if (validated.document.rootType !== document.rootType || validated.document.oscalVersion !== document.oscalVersion) {
    return { ok: false, diagnostic: diagnostic(WORKSPACE_DIAGNOSTIC_CODES.documentInvalid) };
  }
  if (document.rootType === 'mapping-collection') {
    return { ok: false, diagnostic: diagnostic(WORKSPACE_DIAGNOSTIC_CODES.membershipRootRejected, '/mapping-collection') };
  }
  const source = validated.document.source as Record<string, { uuid: string }>;
  const uuid = source[document.rootType].uuid.toLowerCase();
  const duplicate = members.find(member => {
    if (member.verbundId !== verbundId || member.localId === replacingLocalId) return false;
    if (member.source === null || typeof member.source !== 'object') return false;
    const body = (member.source as Record<string, unknown>)[member.rootType];
    const existingUuid = body !== null && typeof body === 'object' ? (body as Record<string, unknown>).uuid : undefined;
    return typeof existingUuid === 'string' && existingUuid.toLowerCase() === uuid;
  });
  if (duplicate) {
    return { ok: false, diagnostic: diagnostic(WORKSPACE_DIAGNOSTIC_CODES.rootUuidDuplicate, `/${document.rootType}/uuid`), existingLocalId: duplicate.localId, action: 'replace' };
  }
  return { ok: true };
}
