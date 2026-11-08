import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import { isOscalUuid } from '@/domain/identifierQuery';
import { BUSINESS_PROCESS_COMPONENT_TYPE, PROJECT_PROPS_NAMESPACE, readProjectProps, type ProjectPropCarrier } from '@/domain/projectProps';
import { readSspValue } from '@/domain/sspAuthoring';
import type { RawOscalProp } from '@/domain/models';

const OBJECTIVES = ['confidentiality', 'integrity', 'availability'] as const;
type Objective = (typeof OBJECTIVES)[number];
type ContextState = 'unclassified' | 'context-open' | 'context-complete' | 'invalid';
type CiaState = 'unknown' | 'partial' | 'complete' | 'conflict';
type RiskConsideration = 'required' | 'no-high-trigger' | 'unknown';

export interface ProcessProtectionDiagnostic { readonly code: string; readonly path: string }
export interface EffectiveProcessObjective {
  readonly value: 'normal' | 'hoch' | 'unknown' | 'conflict';
  readonly remarks?: string;
  readonly category?: string;
  readonly mappingRemarks?: string;
}
export interface ProcessProtection {
  readonly uuid?: string;
  readonly path: string;
  readonly context: ContextState;
  readonly cia: CiaState;
  readonly riskConsideration: RiskConsideration;
  readonly objectives: Readonly<Record<Objective, EffectiveProcessObjective>>;
  readonly diagnostics: readonly ProcessProtectionDiagnostic[];
}
export interface SspProcessProtection {
  readonly processes: readonly ProcessProtection[];
  readonly context: ContextState;
  readonly cia: CiaState;
  readonly riskConsideration: RiskConsideration;
}

const COMPONENT_PATH = '/system-security-plan/system-implementation/components';
const METADATA_PATH = '/system-security-plan/metadata';
const CONTEXT_PROPS = new Set(['process-id', 'process-application-uuid', 'process-applications-none']);

function hasText(value: unknown): value is string { return typeof value === 'string' && value.trim() !== ''; }
function textKey(value: string): string { return value.normalize('NFC').trim().toLowerCase(); }
function uuid(value: unknown): string | undefined { return typeof value === 'string' && isOscalUuid(value) ? value.toLowerCase() : undefined; }
function objects(value: unknown): readonly JsonObject[] { return readArray(value).filter(isJsonObject); }

function indexBy<T>(items: readonly T[], keyOf: (item: T) => string | undefined): ReadonlyMap<string, readonly T[]> {
  const index = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === undefined) continue;
    const matches = index.get(key);
    if (matches) matches.push(item);
    else index.set(key, [item]);
  }
  return index;
}

interface ContextIndex {
  readonly components: ReadonlyMap<string, readonly JsonObject[]>;
  readonly roles: ReadonlyMap<string, readonly JsonObject[]>;
  readonly parties: ReadonlyMap<string, readonly JsonObject[]>;
  readonly categoryLabels: ReadonlyMap<string, readonly RawOscalProp[]>;
}

/** Die Registry prüft nur die für diese Achse ausgewählten Properties. */
function selectedProps(node: JsonObject, carrier: ProjectPropCarrier, select: (prop: RawOscalProp) => boolean) {
  const raw = node.props;
  const collectionValid = raw === undefined || (Array.isArray(raw) && raw.every(isJsonObject));
  return readProjectProps(collectionValid ? readArray<RawOscalProp>(raw).filter(prop => prop.ns === PROJECT_PROPS_NAMESPACE && select(prop)) : raw, carrier);
}

function findings(read: ReturnType<typeof readProjectProps>, path: string): ProcessProtectionDiagnostic[] {
  return read.diagnostics.map(({ code }) => ({ code, path: `${path}/props` }));
}

interface ContextCheck {
  missing: boolean;
  invalid: boolean;
  diagnostics: ProcessProtectionDiagnostic[];
}
function contextFinding(check: ContextCheck, kind: 'missing' | 'invalid', path: string): void {
  check[kind] = true;
  check.diagnostics.push({ code: kind === 'missing' ? 'SSP_PROCESS_CONTEXT_REQUIRED' : 'SSP_PROCESS_CONTEXT_INVALID', path });
}

function requiredText(check: ContextCheck, node: JsonObject, key: string, path: string): void {
  if (node[key] === undefined) contextFinding(check, 'missing', `${path}/${key}`);
  else if (!hasText(node[key])) contextFinding(check, 'invalid', `${path}/${key}`);
}

function ownerContext(process: JsonObject, index: ContextIndex, path: string, check: ContextCheck): void {
  const assignments = process['responsible-roles'];
  if (assignments !== undefined && (!Array.isArray(assignments) || !assignments.every(isJsonObject))) {
    contextFinding(check, 'invalid', `${path}/responsible-roles`);
    return;
  }
  const owners = objects(assignments).filter(row => row['role-id'] === 'process-owner');
  if (owners.length === 0) { contextFinding(check, 'missing', `${path}/responsible-roles`); return; }
  const roles = index.roles.get('process-owner') ?? [];
  const refs = readArray(owners[0]['party-uuids']);
  const keys = refs.map(uuid);
  const valid = owners.length === 1 && roles.length === 1 && hasText(roles[0].title)
    && refs.length > 0 && new Set(keys).size === keys.length
    && keys.every(key => {
      if (key === undefined) return false;
      const matches = index.parties.get(key) ?? [];
      return matches.length === 1 && hasText(matches[0].name) && ['person', 'organization'].includes(matches[0].type as string);
    });
  if (!valid) contextFinding(check, 'invalid', `${path}/responsible-roles`);
}

function applicationsContext(process: JsonObject, components: ContextIndex['components'], path: string, check: ContextCheck): void {
  const read = selectedProps(process, 'business-process', prop => CONTEXT_PROPS.has(prop.name));
  if (!read.writeAllowed) {
    check.invalid = true;
    check.diagnostics.push(...findings(read, path));
  }
  if (!read.projectProps.some(prop => prop.name === 'process-id')) contextFinding(check, 'missing', `${path}/props`);
  const apps = read.projectProps.filter(prop => prop.name === 'process-application-uuid');
  if (!apps.length && !read.projectProps.some(prop => prop.name === 'process-applications-none')) contextFinding(check, 'missing', `${path}/props`);
  for (const app of apps) {
    const key = uuid(app.value);
    const matches = key === undefined ? [] : components.get(key) ?? [];
    if (key === undefined || key === uuid(process.uuid) || matches.length !== 1
      || matches[0].type === BUSINESS_PROCESS_COMPONENT_TYPE || !hasText(matches[0].title)) {
      contextFinding(check, 'invalid', `${path}/props`);
    }
  }
}

function categoryContext(process: JsonObject, metadata: JsonObject, labels: ContextIndex['categoryLabels'], check: ContextCheck): void {
  const uses = selectedProps(process, 'business-process', prop => prop.name === 'process-protection-category');
  // Ungültige Verwendungen sind CIA-Konflikte; nur auflösbare Kategorien haben Kontextfelder.
  for (const use of uses.projectProps) {
    if (typeof use.value !== 'string') continue;
    const contextRead = selectedProps(metadata, 'metadata', prop => ['process-category-label', 'process-category-definition'].includes(prop.name) && prop.group === use.value);
    if (!contextRead.writeAllowed) { check.invalid = true; check.diagnostics.push(...findings(contextRead, METADATA_PATH)); }
    const labelFindings = contextRead.projectProps
      .filter(prop => prop.name === 'process-category-label' && hasText(prop.value))
      .flatMap(prop => findings(readProjectProps(labels.get(textKey(prop.value)), 'metadata'), METADATA_PATH));
    if (labelFindings.length) { check.invalid = true; check.diagnostics.push(...labelFindings); }
    if (!contextRead.projectProps.some(prop => prop.name === 'process-category-definition')) contextFinding(check, 'missing', `${METADATA_PATH}/props`);
  }
}

function processContext(process: JsonObject, index: ContextIndex, metadata: JsonObject, path: string, duplicateIds: ReadonlySet<string>): { state: ContextState; diagnostics: readonly ProcessProtectionDiagnostic[] } {
  const check: ContextCheck = { missing: false, invalid: false, diagnostics: [] };
  const key = uuid(process.uuid);
  if (key === undefined || index.components.get(key)?.length !== 1) contextFinding(check, 'invalid', `${path}/uuid`);
  for (const field of ['title', 'description', 'purpose']) requiredText(check, process, field, path);
  const ids = selectedProps(process, 'business-process', prop => prop.name === 'process-id').projectProps;
  if (ids.some(prop => hasText(prop.value) && duplicateIds.has(textKey(prop.value)))) contextFinding(check, 'invalid', `${path}/props`);
  ownerContext(process, index, path, check);
  applicationsContext(process, index.components, path, check);
  categoryContext(process, metadata, index.categoryLabels, check);
  let state: ContextState = check.missing ? 'context-open' : 'context-complete';
  if (check.invalid) state = 'invalid';
  return { state, diagnostics: check.diagnostics };
}

function effectiveObjective(process: JsonObject, metadata: JsonObject, objective: Objective, path: string): { result: EffectiveProcessObjective; diagnostics: readonly ProcessProtectionDiagnostic[] } {
  const name = `process-protection-${objective}`;
  const read = selectedProps(process, 'business-process', prop => prop.name === name || (prop.name === 'process-protection-category'
    && (prop.group === objective || !OBJECTIVES.includes(prop.group as Objective))));
  const diagnostics = findings(read, path);
  if (!read.writeAllowed) return { result: { value: 'conflict' }, diagnostics };
  const direct = read.projectProps.find(prop => prop.name === name);
  const use = read.projectProps.find(prop => prop.name === 'process-protection-category');
  let mapping: RawOscalProp | undefined;
  if (use) {
    const category = selectedProps(metadata, 'metadata', prop => prop.name === 'process-category-mapping' && prop.group === use.value);
    diagnostics.push(...findings(category, METADATA_PATH));
    if (!category.writeAllowed) return { result: { value: 'conflict', category: use.value }, diagnostics };
    mapping = category.projectProps[0];
    if (direct && mapping && direct.value !== mapping.value) {
      diagnostics.push({ code: 'SSP_PROCESS_CATEGORY_CONFLICT', path: `${path}/props` });
      return { result: { value: 'conflict', category: use.value }, diagnostics };
    }
  }
  const value = !direct || (use && !mapping) ? 'unknown' : direct.value as 'normal' | 'hoch';
  if (!direct) diagnostics.push({ code: 'SSP_PROCESS_OBJECTIVE_REQUIRED', path: `${path}/props` });
  if (use && !mapping) diagnostics.push({ code: 'SSP_PROCESS_CATEGORY_MAPPING_REQUIRED', path: `${METADATA_PATH}/props` });
  return { result: { value, ...(direct && { remarks: direct.remarks }), ...(use && { category: use.value }), ...(mapping && { mappingRemarks: mapping.remarks }) }, diagnostics };
}

function ciaState(values: readonly EffectiveProcessObjective['value'][]): CiaState {
  if (values.includes('conflict')) return 'conflict';
  const known = values.filter(value => value === 'normal' || value === 'hoch').length;
  if (known === 0) return 'unknown';
  return known === values.length ? 'complete' : 'partial';
}
function riskConsideration(values: readonly EffectiveProcessObjective['value'][]): RiskConsideration {
  if (values.includes('hoch')) return 'required';
  return values.length > 0 && values.every(value => value === 'normal') ? 'no-high-trigger' : 'unknown';
}

function duplicateProcessIds(components: readonly JsonObject[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const component of components) {
    if (component.type !== BUSINESS_PROCESS_COMPONENT_TYPE) continue;
    const read = selectedProps(component, 'business-process', prop => prop.name === 'process-id');
    for (const prop of read.projectProps) {
      if (!hasText(prop.value)) continue;
      const key = textKey(prop.value);
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
  }
  return duplicates;
}

/** Liest eine SSP-Quelle; die fachlichen Achsen ersetzen weder Schema- noch Freigabeprüfung. */
export function deriveSspProcessProtection(source: unknown): SspProcessProtection {
  const rawComponents = readArray(readSspValue(source, ['system-implementation', 'components']));
  const components = rawComponents.filter(isJsonObject);
  const metadataValue = readSspValue(source, ['metadata']);
  const metadata = isJsonObject(metadataValue) ? metadataValue : {};
  const duplicateIds = duplicateProcessIds(components);
  const labels = selectedProps(metadata, 'metadata', prop => prop.name === 'process-category-label');
  const contextIndex: ContextIndex = {
    components: indexBy(components, item => uuid(item.uuid)),
    roles: indexBy(objects(metadata.roles), item => readString(item.id)),
    parties: indexBy(objects(metadata.parties), item => uuid(item.uuid)),
    categoryLabels: indexBy(labels.projectProps, prop => hasText(prop.value) ? textKey(prop.value) : undefined),
  };
  const processes = rawComponents.flatMap((process, index): ProcessProtection[] => {
    if (!isJsonObject(process) || process.type !== BUSINESS_PROCESS_COMPONENT_TYPE) return [];
    const path = `${COMPONENT_PATH}/${index}`;
    const context = processContext(process, contextIndex, metadata, path, duplicateIds);
    const confidentiality = effectiveObjective(process, metadata, 'confidentiality', path);
    const integrity = effectiveObjective(process, metadata, 'integrity', path);
    const availability = effectiveObjective(process, metadata, 'availability', path);
    const objectives = { confidentiality: confidentiality.result, integrity: integrity.result, availability: availability.result };
    const values = Object.values(objectives).map(result => result.value);
    return [{ uuid: readString(process.uuid), path, context: context.state, cia: ciaState(values), riskConsideration: riskConsideration(values), objectives,
      diagnostics: [...context.diagnostics, ...confidentiality.diagnostics, ...integrity.diagnostics, ...availability.diagnostics] }];
  });
  const values = processes.flatMap(process => Object.values(process.objectives).map(result => result.value));
  let context: ContextState = processes.length > 0 ? 'context-complete' : 'unclassified';
  if (processes.some(process => process.context === 'context-open')) context = 'context-open';
  if (processes.some(process => process.context === 'invalid')) context = 'invalid';
  return { processes, context, cia: ciaState(values), riskConsideration: riskConsideration(values) };
}
