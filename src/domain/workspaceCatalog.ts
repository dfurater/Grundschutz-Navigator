import { isJsonObject, type JsonObject } from '@/domain/jsonGuards';
import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';

/** Minimal transient lookup projection; contains no registry or provenance claim. */
export interface WorkspaceCatalogControl {
  readonly id: string;
  readonly statementIds: readonly string[];
}

export interface WorkspaceCatalog {
  readonly controlsById: ReadonlyMap<string, WorkspaceCatalogControl>;
}

export type WorkspaceCatalogResult =
  | { readonly status: 'success'; readonly catalog: WorkspaceCatalog }
  | { readonly status: 'failure'; readonly diagnostics: readonly OscalDiagnostic[] };

interface LocatedNode { readonly node: JsonObject; readonly path: string }
type Diagnose = (path: string, code?: string) => void;

function children(item: LocatedNode, key: string, diagnose: Diagnose): LocatedNode[] {
  const value = item.node[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnose(`${item.path}/${key}`);
    return [];
  }
  const result: LocatedNode[] = [];
  value.forEach((child: unknown, index: number) => {
    const path = `${item.path}/${key}/${index}`;
    if (isJsonObject(child)) result.push({ node: child, path });
    else diagnose(path);
  });
  return result;
}

function addPartIdentity(part: LocatedNode, seen: Set<string>, ids: string[], diagnose: Diagnose): void {
  const id = part.node.id;
  if (id === undefined) return;
  if (typeof id !== 'string' || id.length === 0) {
    diagnose(`${part.path}/id`);
  } else if (seen.has(id)) {
    diagnose(`${part.path}/id`, 'OSCAL_WORKSPACE_CATALOG_STATEMENT_AMBIGUOUS');
  } else {
    seen.add(id);
    ids.push(id);
  }
}

function statementIds(item: LocatedNode, diagnose: Diagnose): readonly string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const parts = children(item, 'parts', diagnose).reverse();
  while (parts.length > 0) {
    const part = parts.pop()!;
    addPartIdentity(part, seen, ids, diagnose);
    for (const child of children(part, 'parts', diagnose).reverse()) parts.push(child);
  }
  return ids;
}

function addControl(item: LocatedNode, controls: Map<string, WorkspaceCatalogControl>, diagnose: Diagnose): void {
  const id = item.node.id;
  if (typeof id !== 'string' || id.length === 0) {
    diagnose(`${item.path}/id`);
  } else if (controls.has(id)) {
    diagnose(`${item.path}/id`, 'OSCAL_WORKSPACE_CATALOG_CONTROL_AMBIGUOUS');
  } else {
    controls.set(id, { id, statementIds: statementIds(item, diagnose) });
  }
}

function indexControls(root: JsonObject, diagnose: Diagnose): ReadonlyMap<string, WorkspaceCatalogControl> {
  const controls = new Map<string, WorkspaceCatalogControl>();
  const pending = [{ node: root, path: '/catalog', control: false }];
  while (pending.length > 0) {
    const item = pending.pop()!;
    if (item.control) addControl(item, controls, diagnose);
    for (const entry of children(item, 'groups', diagnose).reverse()) pending.push({ ...entry, control: false });
    for (const entry of children(item, 'controls', diagnose).reverse()) pending.push({ ...entry, control: true });
  }
  return controls;
}

/** Reads validated local or resolved OSCAL sources without BSI-specific UI assumptions. */
export function buildWorkspaceCatalog(source: unknown): WorkspaceCatalogResult {
  const diagnostics: OscalDiagnostic[] = [];
  const diagnose: Diagnose = (path, code = 'OSCAL_WORKSPACE_CATALOG_STRUCTURE_INVALID') => {
    diagnostics.push(createOscalDiagnostic({
      code, path, stage: 'domain', artifact: { rootType: 'catalog' },
      validator: { name: 'workspace-catalog', version: '1' },
    }));
  };
  if (!isJsonObject(source) || !isJsonObject(source.catalog)) {
    diagnose('/catalog');
    return { status: 'failure', diagnostics };
  }
  const controlsById = indexControls(source.catalog, diagnose);
  return diagnostics.length > 0
    ? { status: 'failure', diagnostics }
    : { status: 'success', catalog: { controlsById } };
}
