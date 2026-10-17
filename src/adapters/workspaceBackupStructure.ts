import { hasRegistryKeyGrammar } from '@/domain/sourceRegistry';
import { STORAGE_SCHEMA_VERSION, isVerbundName, type WorkspaceBackup, type WorkspaceVerbundBackup } from '@/domain/workspaceModel';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fields(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  return record(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function timestamp(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
function times(value: Record<string, unknown>): boolean { return timestamp(value.createdAt) && timestamp(value.savedAt); }
function collectVerbuende(rows: WorkspaceBackup['verbuende'], ids: Set<string>): boolean {
  for (const row of rows) {
    if (!fields(row, ['verbundId', 'name', 'createdAt', 'savedAt']) || !uuid(row.verbundId) || !isVerbundName(row.name)
      || !times(row) || ids.has(row.verbundId)) return false;
    ids.add(row.verbundId);
  }
  return true;
}

function validDerivedFrom(value: unknown): boolean {
  if (value === undefined) return true;
  return fields(value, ['artifactKey', 'contentSha256', 'snapshotCommit'])
    && hasRegistryKeyGrammar(value.artifactKey) && typeof value.contentSha256 === 'string'
    && /^[a-f0-9]{64}$/.test(value.contentSha256) && typeof value.snapshotCommit === 'string'
    && /^[a-f0-9]{40}$/.test(value.snapshotCommit);
}

/** Ein mitgeführtes `backupSavedAt` — der `savedAt`-Wert eines eingelesenen Bündels — muss ein Zeitstempel sein. */
function validBackupSavedAt(value: unknown): boolean {
  return value === undefined || timestamp(value);
}

function validDocumentFields(row: unknown): row is Record<string, unknown> {
  return fields(row, ['localId', 'verbundId', 'storageSchemaVersion', 'rootType', 'oscalVersion', 'trustClass', 'documentState', 'createdAt', 'savedAt', 'source'], ['derivedFrom', 'backupSavedAt'])
    && uuid(row.localId) && uuid(row.verbundId) && row.storageSchemaVersion === STORAGE_SCHEMA_VERSION
    && row.trustClass === 'class-2-local-user' && ['imported', 'draft', 'export-ready'].includes(row.documentState as string)
    && times(row) && validBackupSavedAt(row.backupSavedAt) && validDerivedFrom(row.derivedFrom);
}

function validDocumentRoot(row: Record<string, unknown>): boolean {
  if (!record(row.source)) return false;
  const root = row.source[row.rootType as string];
  return record(root) && root.uuid !== row.localId;
}

function collectDocuments(rows: WorkspaceBackup['documents'], verbuende: Set<string>, documents: Map<string, string>): boolean {
  for (const row of rows) {
    if (!validDocumentFields(row) || !verbuende.has(row.verbundId) || documents.has(row.localId) || !validDocumentRoot(row)) return false;
    documents.set(row.localId, row.verbundId);
  }
  return true;
}

function validDrafts(rows: WorkspaceBackup['drafts'], documents: Map<string, string>): boolean {
  const drafts = new Set<string>();
  for (const row of rows) {
    if (!fields(row, ['localId', 'savedAt', 'source'], ['backupSavedAt']) || !uuid(row.localId) || !documents.has(row.localId)
      || drafts.has(row.localId) || !timestamp(row.savedAt) || !validBackupSavedAt(row.backupSavedAt)) return false;
    drafts.add(row.localId);
  }
  return true;
}

function validBindingFields(row: unknown, documents: Map<string, string>): row is Record<string, unknown> {
  return fields(row, ['fromLocalId', 'pointer', 'href', 'target']) && uuid(row.fromLocalId) && documents.has(row.fromLocalId)
    && typeof row.pointer === 'string' && /^(?:\/(?:[^~/]|~[01])*)*$/.test(row.pointer)
    && typeof row.href === 'string' && record(row.target);
}

function validBindingTarget(target: Record<string, unknown>, fromLocalId: string, documents: Map<string, string>): boolean {
  if (target.kind === 'local') {
    return fields(target, ['kind', 'localId']) && uuid(target.localId) && documents.has(target.localId)
      && documents.get(fromLocalId) === documents.get(target.localId);
  }
  return target.kind === 'class-1' && fields(target, ['kind', 'artifactKey']) && hasRegistryKeyGrammar(target.artifactKey);
}

function validBindings(rows: WorkspaceBackup['bindings'], documents: Map<string, string>): boolean {
  const bindings = new Set<string>();
  for (const row of rows) {
    if (!validBindingFields(row, documents)) return false;
    const key = JSON.stringify([row.fromLocalId, row.pointer]);
    if (bindings.has(key)) return false;
    bindings.add(key);
    if (!validBindingTarget(row.target as unknown as Record<string, unknown>, row.fromLocalId, documents)) return false;
  }
  return true;
}

function validWorkspaceMeta(rows: WorkspaceBackup['workspaceMeta']): boolean {
  return rows.length === 1 && rows.every(row => fields(row, ['id', 'storageSchemaVersion', 'createdAt', 'savedAt'])
    && row.id === 'workspace' && row.storageSchemaVersion === STORAGE_SCHEMA_VERSION && times(row));
}

function validBackupStructure(value: unknown, format: 'gspp-workspace' | 'gspp-workspace-verbund'): boolean {
  const required = ['format', 'storageSchemaVersion', 'verbuende', 'documents', 'drafts', 'bindings'];
  if (format === 'gspp-workspace') required.push('workspaceMeta');
  if (!fields(value, required) || value.format !== format || value.storageSchemaVersion !== STORAGE_SCHEMA_VERSION
    || ![value.verbuende, value.documents, value.drafts, value.bindings].every(Array.isArray)) return false;
  const backup = value as unknown as WorkspaceBackup;
  if (format === 'gspp-workspace' && (!Array.isArray(backup.workspaceMeta) || !validWorkspaceMeta(backup.workspaceMeta))) return false;
  if (format === 'gspp-workspace-verbund' && backup.verbuende.length !== 1) return false;
  const verbuende = new Set<string>();
  const documents = new Map<string, string>();
  return collectVerbuende(backup.verbuende, verbuende) && collectDocuments(backup.documents, verbuende, documents)
    && validDrafts(backup.drafts, documents) && validBindings(backup.bindings, documents);
}

export function validWorkspaceBackupStructure(value: unknown): value is WorkspaceBackup {
  return validBackupStructure(value, 'gspp-workspace');
}
export function validVerbundBackupStructure(value: unknown): value is WorkspaceVerbundBackup {
  return validBackupStructure(value, 'gspp-workspace-verbund');
}
