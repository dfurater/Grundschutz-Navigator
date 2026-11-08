import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import { PROCESS_CIA_ACTIONS_SYSTEM, PROJECT_PROPS_NAMESPACE as ns, readProjectProps } from '@/domain/projectProps';
import { readSspValue } from '@/domain/sspAuthoring';
import { deriveSspProcessProtection } from '@/domain/sspProcessProtection';
import { processBindingError, processContentHash, processObjects, processProjection, processProps, processUuidKey, PROCESS_HASH_PATTERN } from '@/domain/sspProcessProjection';
import { parseTimestamp } from '@/domain/evidenceReadModel';

export type ProcessApprovalState = 'missing' | 'current' | 'stale' | 'withdrawn' | 'invalid';
export interface ProcessApproval {
  readonly state: ProcessApprovalState;
  readonly sequence: number;
  readonly actionUuid?: string;
  readonly hash?: string;
}
export interface ProcessDecisionInput {
  readonly processUuid: string;
  readonly type: 'approved' | 'withdrawn';
  readonly uuid: string;
  readonly date: string;
  readonly partyUuids: readonly string[];
  readonly remarks: string;
}

function property(action: JsonObject, name: string): string | undefined {
  const props = processProps(action, name);
  return props.length === 1 ? readString(props[0].value) : undefined;
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(parseTimestamp(value));
}
function uuidCounts(source: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  const visit = (node: unknown): void => {
    if (!isJsonObject(node) && !Array.isArray(node)) return;
    if (isJsonObject(node) && typeof node.uuid === 'string') {
      const key = node.uuid.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    Object.values(node).forEach(visit);
  };
  visit(source);
  return counts;
}

/** Sequenzen wählen die Kette; ein fehlerhafter Beleg wird niemals übersprungen. */
export function processActionChain(source: unknown, processUuid: string): { sequence: number; action?: JsonObject } {
  const target = processUuidKey(processUuid);
  const all = processObjects(readSspValue(source, ['metadata', 'actions']));
  const own = all.filter(action => action.system === PROCESS_CIA_ACTIONS_SYSTEM);
  // Ein Beleg ohne eindeutigen Gegenstand kann keinem Prozess sicher zugeordnet werden.
  const selected = own.filter(action => processUuidKey(property(action, 'process-cia-process-uuid')) === target);
  const counts = uuidCounts(source);
  for (const action of selected) {
    if (counts.get(processUuidKey(action.uuid)) !== 1 || !validDate(action.date) || typeof action.remarks !== 'string' || !action.remarks.trim()) return processBindingError();
    if (!readProjectProps(action.props, 'metadata-action').writeAllowed || !['approved', 'withdrawn'].includes(action.type as string)) return processBindingError();
    processProjection(source, processUuid, action['responsible-parties']);
    const hash = property(action, 'process-cia-content-hash');
    const withdraws = property(action, 'process-cia-withdraws');
    if (action.type === 'approved' ? !hash || !PROCESS_HASH_PATTERN.test(hash) || withdraws !== undefined : hash !== undefined || withdraws === undefined) return processBindingError();
    const seq = property(action, 'process-cia-sequence');
    if (!seq || !/^[1-9]\d{0,15}$/.test(seq) || !Number.isSafeInteger(Number(seq))) return processBindingError();
  }
  selected.sort((a, b) => Number(property(a, 'process-cia-sequence')) - Number(property(b, 'process-cia-sequence')));
  let previous: JsonObject | undefined;
  selected.forEach((action, index) => {
    if (Number(property(action, 'process-cia-sequence')) !== index + 1) return processBindingError();
    if (action.type === 'withdrawn' && (previous?.type !== 'approved' || processUuidKey(property(action, 'process-cia-withdraws')) !== processUuidKey(previous.uuid))) return processBindingError();
    previous = action;
  });
  return { sequence: selected.length, action: previous };
}

export function processActionFailure(source: unknown): { code: string; path: string } | undefined {
  try {
    const actions = processObjects(readSspValue(source, ['metadata', 'actions'])).filter(action => action.system === PROCESS_CIA_ACTIONS_SYSTEM);
    const targets = new Set(actions.map(action => processUuidKey(property(action, 'process-cia-process-uuid'))));
    for (const target of targets) processActionChain(source, target);
    return undefined;
  } catch { return { code: 'SSP_PROCESS_BINDING_INVALID', path: '/system-security-plan/metadata/actions' }; }
}

function protection(source: unknown, processUuid: string, ignoreDuplicateId = false) {
  let input = source;
  if (ignoreDuplicateId) {
    input = structuredClone(source);
    const implementation = readSspValue(input, ['system-implementation']);
    if (isJsonObject(implementation)) implementation.components = processObjects(implementation.components).filter(component => component.type !== 'business-process' || processUuidKey(component.uuid) === processUuidKey(processUuid));
  }
  return deriveSspProcessProtection(input).processes.find(process => process.uuid?.toLowerCase() === processUuidKey(processUuid));
}

export async function deriveProcessApproval(source: unknown, processUuid: string): Promise<ProcessApproval> {
  try {
    const chain = processActionChain(source, processUuid);
    if (!chain.action) return { state: 'missing', sequence: 0 };
    const actionUuid = chain.action.uuid as string;
    if (chain.action.type === 'withdrawn') return { state: 'withdrawn', sequence: chain.sequence, actionUuid };
    const hash = property(chain.action, 'process-cia-content-hash')!;
    const current = await processContentHash(source, processUuid, chain.action['responsible-parties']);
    const axes = protection(source, processUuid, true);
    return { state: hash === current && axes?.context === 'context-complete' && axes.cia === 'complete' ? 'current' : 'stale', sequence: chain.sequence, actionUuid, hash };
  } catch { return { state: 'invalid', sequence: 0 }; }
}

/** Hängt eine erklärte Entscheidung an; Identität und Leitungsvollmacht sind nicht geprüft. */
export function appendProcessDecision(source: unknown, input: ProcessDecisionInput, hash?: string): unknown {
  const chain = processActionChain(source, input.processUuid);
  const axes = protection(source, input.processUuid);
  processUuidKey(input.uuid);
  if (!validDate(input.date) || !input.date.endsWith('Z') || !input.remarks.trim() || uuidCounts(source).has(input.uuid.toLowerCase()) || chain.sequence === Number.MAX_SAFE_INTEGER) return processBindingError();
  if (input.type === 'approved') {
    if (axes?.context !== 'context-complete' || axes.cia !== 'complete' || !hash || !PROCESS_HASH_PATTERN.test(hash)) return processBindingError();
  } else if (input.type !== 'withdrawn' || chain.action?.type !== 'approved') return processBindingError();
  const decisionParties = [{ 'role-id': 'institution-management', 'party-uuids': [...input.partyUuids] }];
  processProjection(source, input.processUuid, decisionParties);
  const props = [
    { ns, name: 'process-cia-process-uuid', value: input.processUuid },
    { ns, name: 'process-cia-sequence', value: String(chain.sequence + 1) },
    input.type === 'approved' ? { ns, name: 'process-cia-content-hash', value: hash } : { ns, name: 'process-cia-withdraws', value: chain.action!.uuid },
  ];
  const copy = structuredClone(source);
  const metadata = readSspValue(copy, ['metadata']);
  if (!isJsonObject(metadata)) return processBindingError();
  metadata.actions = [...readArray(metadata.actions), { uuid: input.uuid, type: input.type, system: PROCESS_CIA_ACTIONS_SYSTEM, date: input.date, 'responsible-parties': decisionParties, props, remarks: input.remarks }];
  return copy;
}

/** Übergabe je SSP; die scopeweite Reihenfolge bleibt ein eigener Entscheidungsgegenstand. */
export function processHandoff(source: unknown, processUuid: string, approval: ProcessApproval, order?: { readonly state: string; readonly decision?: unknown }) {
  const axes = protection(source, processUuid);
  const component = processObjects(readSspValue(source, ['system-implementation', 'components'])).find(item => processUuidKey(item.uuid) === processUuidKey(processUuid));
  const gaps = [axes?.context !== 'context-complete' ? 'context' : undefined, axes?.cia !== 'complete' ? 'cia' : undefined, approval.state !== 'current' ? 'approval' : undefined].filter((value): value is string => value !== undefined);
  return {
    status: gaps.length ? 'provisional' : 'approved', sspUuid: readSspValue(source, ['uuid']), processUuid, context: axes?.context, cia: axes?.cia,
    id: component && processProps(component, 'process-id')[0]?.value, name: component?.title,
    objectives: axes?.objectives, responsibleRoles: readArray(component?.['responsible-roles']),
    categories: component ? processProps(component, 'process-protection-category') : [],
    categoryMappings: processObjects(readSspValue(source, ['metadata', 'props'])).filter(prop => prop.ns === ns && prop.name === 'process-category-mapping' && component && processProps(component, 'process-protection-category').some(use => use.value === prop.group)),
    approval, order: { ...order, state: order?.state ?? 'open', priority: component && processProps(component, 'process-priority')[0]?.value }, riskConsideration: axes?.riskConsideration ?? 'unknown', gaps,
  };
}
