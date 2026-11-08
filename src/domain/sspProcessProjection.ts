import { isJsonObject, readArray, type JsonObject } from '@/domain/jsonGuards';
import { isOscalUuid } from '@/domain/identifierQuery';
import { PROJECT_PROPS_NAMESPACE as ns } from '@/domain/projectProps';
import { readSspValue } from '@/domain/sspAuthoring';
import { serializeWorkspaceJsonSorted } from '@/domain/workspaceJson';
import { computeSHA256 } from '@/domain/integrity';
import { compareStringsByCodeUnit } from '@/domain/codeUnitOrder.mjs';

export const PROCESS_HASH_PATTERN = /^process-cia\/3:sha-256:[0-9a-f]{64}$/;
const EXCLUDED = new Set(['protection-need-level', 'target-object-category', 'effective-target-object-category']);
const CATEGORY_NAMES = new Set(['process-category-label', 'process-category-definition', 'process-category-mapping']);

export function processBindingError(): never { throw new Error('SSP_PROCESS_BINDING_INVALID'); }
export function processObjects(value: unknown): readonly JsonObject[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isJsonObject)) return processBindingError();
  return value;
}
export function processUuidKey(value: unknown): string {
  if (typeof value !== 'string' || !isOscalUuid(value)) return processBindingError();
  return value.toLowerCase();
}
export function processProps(node: JsonObject, name: string): readonly JsonObject[] {
  return processObjects(node.props).filter(prop => prop.ns === ns && prop.name === name);
}
function one(items: readonly JsonObject[], key: string, value: unknown, uuid = false): JsonObject {
  const matches = items.filter(item => uuid ? processUuidKey(item[key]) === processUuidKey(value) : item[key] === value);
  if (matches.length !== 1) return processBindingError();
  return matches[0];
}
function filtered(node: JsonObject, process = false): JsonObject {
  const copy = structuredClone(node);
  const props = processObjects(copy.props).filter(prop => prop.ns !== ns || (!EXCLUDED.has(prop.name as string) && !(process && prop.name === 'process-priority')));
  if (props.length) copy.props = props;
  else delete copy.props;
  return copy;
}
function text(value: unknown): boolean { return typeof value === 'string' && value.trim().length > 0; }

/** Eindeutiger transitiver Abschluss; ein Zyklus oder fehlendes Ziel bricht ab. */
function referenceClosure(metadata: JsonObject, assignments: readonly JsonObject[]) {
  const roles = processObjects(metadata.roles);
  const parties = processObjects(metadata.parties);
  const selectedRoles = new Map<string, JsonObject>();
  const selectedParties = new Map<string, JsonObject>();
  const visiting = new Set<string>();
  const visit = (ref: unknown): void => {
    const key = processUuidKey(ref);
    if (visiting.has(key)) return processBindingError();
    if (selectedParties.has(key)) return;
    const party = one(parties, 'uuid', key, true);
    if (!text(party.name) || !['person', 'organization'].includes(party.type as string)) return processBindingError();
    visiting.add(key);
    if (party['member-of-organizations'] !== undefined && !Array.isArray(party['member-of-organizations'])) return processBindingError();
    for (const parent of readArray(party['member-of-organizations'])) {
      if (one(parties, 'uuid', parent, true).type !== 'organization') return processBindingError();
      visit(parent);
    }
    visiting.delete(key);
    selectedParties.set(key, party);
  };
  for (const assignment of assignments) {
    const id = assignment['role-id'];
    if (!text(id)) return processBindingError();
    const role = one(roles, 'id', id);
    if (!text(role.title)) return processBindingError();
    selectedRoles.set(id as string, role);
    const refs = assignment['party-uuids'] ?? [];
    if (!Array.isArray(refs) || new Set(refs.map(processUuidKey)).size !== refs.length) return processBindingError();
    refs.forEach(visit);
  }
  return {
    roles: [...selectedRoles].sort(([a], [b]) => compareStringsByCodeUnit(a, b)).map(([, value]) => value),
    parties: [...selectedParties].sort(([a], [b]) => compareStringsByCodeUnit(a, b)).map(([, value]) => value),
  };
}

/** Prozessvertrag §5: nur explizit ausgewählte Knoten; Arrays behalten Quellreihenfolge. */
export function processProjection(source: unknown, processUuid: string, decisionParties: unknown): JsonObject {
  const metadata = readSspValue(source, ['metadata']);
  const scope = readSspValue(source, ['system-characteristics']);
  const sspUuid = readSspValue(source, ['uuid']);
  if (!isJsonObject(metadata) || !isJsonObject(scope) || !text(metadata['oscal-version'])) return processBindingError();
  processUuidKey(sspUuid);
  const components = processObjects(readSspValue(source, ['system-implementation', 'components']));
  const process = one(components, 'uuid', processUuid, true);
  if (process.type !== 'business-process') return processBindingError();
  const applications = processProps(process, 'process-application-uuid').map(prop => one(components, 'uuid', prop.value, true));
  if (applications.some(app => app.type === 'business-process') || new Set(applications.map(app => processUuidKey(app.uuid))).size !== applications.length) return processBindingError();
  applications.sort((a, b) => compareStringsByCodeUnit(processUuidKey(a.uuid), processUuidKey(b.uuid)));
  const decisions = processObjects(decisionParties);
  if (decisions.length !== 1 || decisions[0]['role-id'] !== 'institution-management' || !readArray(decisions[0]['party-uuids']).length) return processBindingError();
  const refs = [...processObjects(process['responsible-roles']), ...applications.flatMap(app => processObjects(app['responsible-roles'])), ...decisions];
  const closure = referenceClosure(metadata, refs);
  const usedCategories = new Set(processProps(process, 'process-protection-category').map(prop => prop.value));
  const categoryProps = processObjects(metadata.props).filter(prop => prop.ns === ns && CATEGORY_NAMES.has(prop.name as string) && usedCategories.has(prop.group));
  const boundScope = structuredClone(scope);
  const information = boundScope['system-information'];
  if (isJsonObject(information) && information['information-types'] !== undefined) information['information-types'] = processObjects(information['information-types']).map(item => filtered(item));
  return { contract: 'process-cia/3', sspUuid, oscalVersion: metadata['oscal-version'], scope: boundScope, process: filtered(process, true), applications: applications.map(app => filtered(app)), categoryProps, ...closure, decisionParties: decisions };
}

export async function processContentHash(source: unknown, processUuid: string, decisionParties: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(serializeWorkspaceJsonSorted(processProjection(source, processUuid, decisionParties)));
  return `process-cia/3:sha-256:${await computeSHA256(bytes.buffer as ArrayBuffer)}`;
}
