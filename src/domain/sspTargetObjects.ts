import type { RawOscalProp, VocabularyNamespaceData } from '@/domain/models';
import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import { createCatalogReferenceProjectProps, createProjectProp, readProjectProps, PROJECT_PROPS_NAMESPACE as ns, type ProjectPropCarrier } from '@/domain/projectProps';
import { readSspValue, sspBody, SspPatchError, type SspPath } from '@/domain/sspAuthoring';
import { readCatalogPins } from '@/domain/workspaceCatalogPin';
import { closeTargetCategories, type CategoryClosure } from '@/domain/targetObjectCategories';

export interface TargetCategoryContext { readonly commit: string; readonly namespace: VocabularyNamespaceData }
export const TARGET_LISTS = [
  { path: ['system-implementation', 'components'], carrier: 'system-component' },
  { path: ['system-implementation', 'inventory-items'], carrier: 'inventory-item' },
  { path: ['system-characteristics', 'system-information', 'information-types'], carrier: 'information-type' },
] as const;

export function sspTargets(source: unknown) {
  return TARGET_LISTS.flatMap(({ path, carrier }) => readArray(readSspValue(source, path)).flatMap((item, index) =>
    isJsonObject(item) ? [{ item, path: [...path, index] as SspPath, carrier }] : []));
}

export function targetProps(item: unknown, name: string): readonly RawOscalProp[] {
  return readArray<RawOscalProp>(isJsonObject(item) ? item.props : undefined).filter(prop => isJsonObject(prop) && prop.ns === ns && prop.name === name);
}

export function targetCoverage(source: unknown): { assessed: number; total: number; value: 'complete' | 'incomplete' } {
  const targets = sspTargets(source);
  const assessed = targets.filter(({ item, carrier }) => readProjectProps(item.props, carrier).writeAllowed && targetProps(item, 'protection-need-level').length === 1).length;
  return { assessed, total: targets.length, value: targets.length > 0 && assessed === targets.length ? 'complete' : 'incomplete' };
}

function replaceProps(item: JsonObject, names: readonly string[], added: readonly RawOscalProp[]): void {
  // Unberührte Properties und Erweiterungsfelder bearbeiteter Properties bleiben erhalten.
  const previous = readArray<RawOscalProp>(item.props);
  const props = previous.filter(prop => prop.ns !== ns || !names.includes(prop.name));
  for (const prop of added) {
    const old = previous.find(old => old.ns === ns && old.name === prop.name && old.group === prop.group && (names.length === 1 || old.value === prop.value));
    props.push({ ...old, ...prop });
  }
  if (props.length) item.props = props;
  else delete item.props;
}

function targetAt(source: unknown, path: SspPath): { item: JsonObject; carrier: ProjectPropCarrier } {
  const target = sspTargets(source).find(target => JSON.stringify(target.path) === JSON.stringify(path));
  if (!target) throw new SspPatchError('SSP_ITEM_NOT_FOUND');
  return target;
}

export function setTargetProtection(source: unknown, path: SspPath, level: 'normal' | 'hoch' | undefined, remarks?: string): unknown {
  const copy = structuredClone(source);
  const { item, carrier } = targetAt(copy, path);
  if (!readProjectProps(item.props, carrier).writeAllowed) throw new SspPatchError('SSP_TARGET_PROPS_INVALID');
  const created = level === undefined ? undefined : createProjectProp({ name: 'protection-need-level', value: level, remarks, carrier });
  if (created && !created.ok) throw new SspPatchError(created.diagnostic.code);
  replaceProps(item, ['protection-need-level'], created?.ok ? [created.prop] : []);
  return copy;
}

export function bindSspCategories(source: unknown, context: TargetCategoryContext): unknown {
  const pins = readCatalogPins(source, 'system-security-plan');
  if (pins === null || (pins.has('gspp') && pins.get('gspp') !== context.commit)) throw new SspPatchError('SSP_CATEGORY_CONTEXT_UNAVAILABLE');
  if (pins.has('gspp')) return source;
  const pair = createCatalogReferenceProjectProps({ catalogKey: 'gspp', commit: context.commit });
  const copy = structuredClone(source);
  const metadata = sspBody(copy)?.metadata;
  if (!pair.ok || !isJsonObject(metadata)) throw new SspPatchError('SSP_CATEGORY_CONTEXT_UNAVAILABLE');
  metadata.props = [...readArray(metadata.props), ...pair.props];
  return copy;
}

export function targetCategoryClosure(source: unknown, path: SspPath, context?: TargetCategoryContext, objectId = ''): CategoryClosure | { status: 'unavailable'; code: string } {
  if (!context || readCatalogPins(source, 'system-security-plan')?.get('gspp') !== context.commit) return { status: 'unavailable', code: 'SSP_CATEGORY_CONTEXT_UNAVAILABLE' };
  const item = readSspValue(source, path);
  return closeTargetCategories(context.namespace, targetProps(item, 'target-object-category').map(prop => prop.value), isJsonObject(item) ? readString(item.uuid) ?? objectId : objectId, context.commit);
}

export function setTargetCategories(source: unknown, path: SspPath, selected: readonly string[], context: TargetCategoryContext): unknown {
  const copy = structuredClone(source);
  const { item, carrier } = targetAt(copy, path);
  if (!readProjectProps(item.props, carrier).writeAllowed || readCatalogPins(source, 'system-security-plan')?.get('gspp') !== context.commit) throw new SspPatchError('SSP_CATEGORY_CONTEXT_UNAVAILABLE');
  const closure = closeTargetCategories(context.namespace, selected, readString(item.uuid) ?? '', context.commit);
  if (closure.status !== 'ready') throw new SspPatchError(closure.code);
  replaceProps(item, ['target-object-category', 'effective-target-object-category'], [
    ...closure.direct.map(value => ({ ns, name: 'target-object-category', value, group: 'gspp' })),
    ...closure.effective.map(value => ({ ns, name: 'effective-target-object-category', value, group: 'gspp' })),
  ]);
  return copy;
}

export interface TargetFailure { readonly code: string; readonly path: string }

function misplacedProjectProps(source: unknown): TargetFailure | undefined {
  const carriers = new Map<string, ProjectPropCarrier>([['/system-security-plan/metadata', 'metadata']]);
  for (const target of sspTargets(source)) carriers.set(`/system-security-plan/${target.path.join('/')}`, target.carrier);
  readArray(readSspValue(source, ['control-implementation', 'implemented-requirements'])).forEach((_, index) => carriers.set(`/system-security-plan/control-implementation/implemented-requirements/${index}`, 'implemented-requirement'));
  const walk = (node: unknown, path: string): TargetFailure | undefined => {
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index++) { const found = walk(node[index], `${path}/${index}`); if (found) return found; }
    } else if (isJsonObject(node)) {
      if (readArray<RawOscalProp>(node.props).some(prop => isJsonObject(prop) && prop.ns === ns)) {
        const carrier = carriers.get(path);
        if (!carrier) return { code: 'OSCAL_PROJECT_PROP_CARRIER_INVALID', path: '/system-security-plan' };
        const read = readProjectProps(node.props, carrier);
        if (!read.writeAllowed) return { code: read.diagnostics[0].code, path: `${path}/props` };
      }
      for (const [key, child] of Object.entries(node)) { if (key === 'props') continue; const found = walk(child, `${path}/${key}`); if (found) return found; }
    }
    return undefined;
  };
  return walk(source, '');
}

/** Importprüfung verändert keine Quelle; Ableitungen werden ausschließlich beim Speichern geschrieben. */
export function validateSspTargets(source: unknown, context?: TargetCategoryContext, checkDerived = true): TargetFailure | undefined {
  const misplaced = misplacedProjectProps(source);
  if (misplaced) return misplaced;
  const metadata = sspBody(source)?.metadata;
  const metadataRead = readProjectProps(isJsonObject(metadata) ? metadata.props : undefined, 'metadata');
  if (!metadataRead.writeAllowed) return metadataRead.diagnostics[0];
  const coverage = targetProps(metadata, 'protection-need-coverage')[0];
  if (checkDerived && coverage && coverage.value !== targetCoverage(source).value) return { code: 'SSP_COVERAGE_MISMATCH', path: '/system-security-plan/metadata/props' };
  for (const { item, path, carrier } of sspTargets(source)) {
    const pointer = `/system-security-plan/${path.join('/')}/props`;
    const read = readProjectProps(item.props, carrier);
    if (!read.writeAllowed) return { code: read.diagnostics[0].code, path: pointer };
    const direct = targetProps(item, 'target-object-category');
    const effective = targetProps(item, 'effective-target-object-category');
    if (!direct.length && !effective.length) continue;
    const closure = targetCategoryClosure(source, path, context);
    if (closure.status !== 'ready') return { code: closure.code, path: pointer };
    if (checkDerived && JSON.stringify(effective.map(prop => prop.value).sort()) !== JSON.stringify(closure.effective)) return { code: 'SSP_CATEGORY_MISMATCH', path: pointer };
  }
  return undefined;
}

export function prepareSspTargets(source: unknown, context?: TargetCategoryContext): { ok: true; source: unknown } | ({ ok: false } & TargetFailure) {
  const failure = validateSspTargets(source, context, false);
  if (failure) return { ok: false, ...failure };
  let copy = structuredClone(source);
  for (const { item, path } of sspTargets(copy)) {
    if (targetProps(item, 'target-object-category').length || targetProps(item, 'effective-target-object-category').length) {
      if (!context) return { ok: false, code: 'SSP_CATEGORY_CONTEXT_UNAVAILABLE', path: '/system-security-plan' };
      copy = setTargetCategories(copy, path, targetProps(item, 'target-object-category').map(prop => prop.value), context);
    }
  }
  const metadata = sspBody(copy)?.metadata;
  if (!isJsonObject(metadata)) return { ok: false, code: 'SSP_TARGET_PROPS_INVALID', path: '/system-security-plan/metadata' };
  replaceProps(metadata, ['protection-need-coverage'], [{ ns, name: 'protection-need-coverage', value: targetCoverage(copy).value }]);
  return { ok: true, source: copy };
}
