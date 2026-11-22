import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import type { RawOscalProp } from '@/domain/models';
import { BUSINESS_PROCESS_COMPONENT_TYPE, PROJECT_PROPS_NAMESPACE as ns, type ProjectPropName } from '@/domain/projectProps';
import { readSspValue, SspPatchError, type SspPath } from '@/domain/sspAuthoring';
import { targetProps } from '@/domain/sspTargetObjects';

export const SSP_COMPONENT_PATH = ['system-implementation', 'components'] as const;
export const PROCESS_OWNER_ROLE = 'process-owner';
export const PROCESS_GOALS = {
  confidentiality: 'Vertraulichkeit',
  integrity: 'Integrität',
  availability: 'Verfügbarkeit',
} as const;
export type ProcessGoal = keyof typeof PROCESS_GOALS;
export const PROCESS_GOAL_KEYS = Object.keys(PROCESS_GOALS) as ProcessGoal[];

export interface ProcessCategoryDraft {
  readonly id: string;
  readonly label: string;
  readonly definition: string;
  readonly level: string;
  readonly reason: string;
}

interface GoalDraft {
  readonly level: string;
  readonly reason: string;
  readonly category: string;
}

export interface ProcessDraft {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly purpose: string;
  readonly status: string;
  readonly owners: readonly string[];
  readonly applications: readonly string[];
  readonly noApplications: boolean;
  readonly noApplicationsReason: string;
  readonly objectives: Readonly<Record<ProcessGoal, GoalDraft>>;
  readonly categories: readonly ProcessCategoryDraft[];
}

export function readProcessCategories(source: unknown): ProcessCategoryDraft[] {
  const metadata = readSspValue(source, ['metadata']);
  const labels = targetProps(metadata, 'process-category-label');
  const definitions = targetProps(metadata, 'process-category-definition');
  const mappings = targetProps(metadata, 'process-category-mapping');
  const ids = new Set([...labels, ...definitions, ...mappings].flatMap(prop => typeof prop.group === 'string' ? [prop.group] : []));
  return [...ids].map(id => {
    const mapping = mappings.find(prop => prop.group === id);
    return {
      id, label: readString(labels.find(prop => prop.group === id)?.value) ?? '',
      definition: readString(definitions.find(prop => prop.group === id)?.value) ?? '',
      level: readString(mapping?.value) ?? '', reason: readString(mapping?.remarks) ?? '',
    };
  });
}

function readGoal(item: JsonObject, goal: ProcessGoal): GoalDraft {
  const direct = targetProps(item, `process-protection-${goal}`)[0];
  const category = targetProps(item, 'process-protection-category').find(prop => prop.group === goal);
  return { level: readString(direct?.value) ?? '', reason: readString(direct?.remarks) ?? '', category: readString(category?.value) ?? '' };
}

function owners(item: JsonObject): JsonObject[] {
  return readArray(item['responsible-roles']).filter(isJsonObject);
}

export function readProcessDraft(source: unknown, path: SspPath): ProcessDraft {
  const item = readSspValue(source, path);
  if (!isJsonObject(item) || item.type !== BUSINESS_PROCESS_COMPONENT_TYPE) throw new SspPatchError('SSP_ITEM_NOT_FOUND');
  const none = targetProps(item, 'process-applications-none')[0];
  const owner = owners(item).find(role => role['role-id'] === PROCESS_OWNER_ROLE);
  return {
    id: readString(targetProps(item, 'process-id')[0]?.value) ?? '',
    title: readString(item.title) ?? '',
    description: readString(item.description) ?? '',
    purpose: readString(item.purpose) ?? '',
    status: readString(readSspValue(source, [...path, 'status', 'state'])) ?? '',
    owners: readArray(owner?.['party-uuids']).filter((party): party is string => typeof party === 'string'),
    applications: targetProps(item, 'process-application-uuid').map(prop => prop.value).filter(value => typeof value === 'string'),
    noApplications: none !== undefined,
    noApplicationsReason: readString(none?.remarks) ?? '',
    objectives: {
      confidentiality: readGoal(item, 'confidentiality'),
      integrity: readGoal(item, 'integrity'),
      availability: readGoal(item, 'availability'),
    },
    categories: readProcessCategories(source),
  };
}

function setProp(node: JsonObject, name: ProjectPropName, value: string, options: { group?: string; remarks?: string; repeat?: boolean } = {}): void {
  const props = [...readArray<RawOscalProp>(node.props)];
  const { group, remarks, repeat } = options;
  const index = props.findIndex(prop => prop.ns === ns && prop.name === name && (group === undefined || group === prop.group) && (!repeat || prop.value === value));
  if (value === '') {
    if (index < 0) return;
    props.splice(index, 1);
  } else {
    const next = { ...props[index], ns, name, value, ...(group && { group }), ...(remarks !== undefined && { remarks }) };
    if (index < 0) props.push(next);
    else props[index] = next;
  }
  if (props.length) node.props = props;
  else delete node.props;
}

function writeOwners(item: JsonObject, metadata: JsonObject, refs: readonly string[]): void {
  const roles = owners(item);
  const index = roles.findIndex(role => role['role-id'] === PROCESS_OWNER_ROLE);
  if (refs.length) {
    const role = { ...roles[index], 'role-id': PROCESS_OWNER_ROLE, 'party-uuids': refs };
    if (index === -1) roles.push(role);
    else roles[index] = role;
    const definitions = readArray(metadata.roles);
    if (!definitions.some(row => isJsonObject(row) && row.id === PROCESS_OWNER_ROLE)) {
      metadata.roles = [...definitions, { id: PROCESS_OWNER_ROLE, title: 'Fachliche Prozessverantwortung' }];
    }
  } else if (index >= 0) {
    roles.splice(index, 1);
  }
  if (roles.length) item['responsible-roles'] = roles;
  else delete item['responsible-roles'];
}

function writeApplications(item: JsonObject, before: ProcessDraft, after: ProcessDraft): void {
  const previous = before.applications;
  const next = after.applications;
  if (previous.some(value => !next.includes(value))) {
    const props = readArray<RawOscalProp>(item.props).filter(prop => prop.ns !== ns || prop.name !== 'process-application-uuid' || next.includes(prop.value));
    if (props.length) item.props = props;
    else delete item.props;
  }
  for (const app of next) {
    if (!previous.includes(app)) setProp(item, 'process-application-uuid', app, { repeat: true });
  }
  if (before.noApplications !== after.noApplications || before.noApplicationsReason !== after.noApplicationsReason) {
    setProp(item, 'process-applications-none', after.noApplications ? 'true' : '', { remarks: after.noApplicationsReason });
  }
}

const CATEGORY_FIELDS = ['label', 'definition', 'level', 'reason'] as const;

function mergeCategory(current: ProcessCategoryDraft, before: ProcessCategoryDraft, draft: ProcessCategoryDraft): ProcessCategoryDraft | undefined {
  const next = { ...current };
  for (const field of CATEGORY_FIELDS) {
    if (draft[field] === before[field]) continue;
    if (current[field] !== before[field] && current[field] !== draft[field]) return undefined;
    next[field] = draft[field];
  }
  return next;
}

/** Führt unabhängige Änderungen an derselben Kategorie zusammen und erkennt konkurrierende Eingaben. */
export function rebaseProcessCategories(
  current: readonly ProcessCategoryDraft[],
  before: readonly ProcessCategoryDraft[],
  draft: readonly ProcessCategoryDraft[],
): ProcessCategoryDraft[] | undefined {
  const merged = new Map(current.map(category => [category.id, category]));
  for (const proposed of draft) {
    const previous = before.find(category => category.id === proposed.id);
    if (previous && CATEGORY_FIELDS.every(field => previous[field] === proposed[field])) continue;
    const live = merged.get(proposed.id);
    if (!previous && !live) { merged.set(proposed.id, proposed); continue; }
    if (!previous || !live) return undefined;
    const next = mergeCategory(live, previous, proposed);
    if (!next) return undefined;
    merged.set(proposed.id, next);
  }
  return [...merged.values()];
}

function writeCategory(metadata: JsonObject, category: ProcessCategoryDraft, previous?: ProcessCategoryDraft): void {
  const group = category.id;
  if (category.label !== previous?.label) setProp(metadata, 'process-category-label', category.label.trim(), { group });
  if (category.definition !== previous?.definition) setProp(metadata, 'process-category-definition', category.definition, { group });
  if (category.level !== previous?.level || category.reason !== previous?.reason) {
    setProp(metadata, 'process-category-mapping', category.level, { group, remarks: category.reason });
  }
}

function writeObjectives(item: JsonObject, before: ProcessDraft['objectives'], after: ProcessDraft['objectives']): void {
  for (const goal of PROCESS_GOAL_KEYS) {
    const previous = before[goal];
    const next = after[goal];
    if (previous.level !== next.level || previous.reason !== next.reason) {
      setProp(item, `process-protection-${goal}`, next.level, { remarks: next.reason });
    }
    if (previous.category !== next.category) setProp(item, 'process-protection-category', next.category, { group: goal });
  }
}

function writeStatus(item: JsonObject, state: string): void {
  const status = isJsonObject(item.status) ? item.status : {};
  if (state) {
    item.status = { ...status, state };
    return;
  }
  delete status.state;
  if (Object.keys(status).length) item.status = status;
  else delete item.status;
}

function writeCategories(source: unknown, metadata: JsonObject, before: ProcessDraft, draft: ProcessDraft): void {
  const current = readProcessCategories(source);
  const categories = rebaseProcessCategories(current, before.categories, draft.categories);
  if (!categories) throw new SspPatchError('SSP_PROCESS_CATEGORY_EDIT_CONFLICT');
  for (const category of categories) {
    writeCategory(metadata, category, current.find(previous => previous.id === category.id));
  }
}

/** Gezielter Quellpatch. Die Vorschau und der Schreibpfad prüfen denselben Quellgraphen. */
export function writeProcessDraft(source: unknown, path: SspPath, draft: ProcessDraft, before = readProcessDraft(source, path)): unknown {
  if (JSON.stringify(before) === JSON.stringify(draft)) return source;
  const copy = structuredClone(source);
  const item = readSspValue(copy, path);
  const metadata = readSspValue(copy, ['metadata']);
  if (!isJsonObject(item) || item.type !== BUSINESS_PROCESS_COMPONENT_TYPE || !isJsonObject(metadata)) throw new SspPatchError('SSP_ITEM_NOT_FOUND');

  for (const field of ['title', 'description', 'purpose'] as const) {
    if (before[field] === draft[field]) continue;
    if (draft[field].trim()) item[field] = draft[field];
    else delete item[field];
  }
  if (before.status !== draft.status) writeStatus(item, draft.status);
  if (before.id !== draft.id) setProp(item, 'process-id', draft.id.normalize('NFC').trim());
  if (JSON.stringify(before.owners) !== JSON.stringify(draft.owners)) writeOwners(item, metadata, draft.owners);
  writeApplications(item, before, draft);
  writeObjectives(item, before.objectives, draft.objectives);
  writeCategories(source, metadata, before, draft);
  return copy;
}
