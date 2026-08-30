import type { RawOscalProp } from '@/domain/models';
import {
  createOscalDiagnostic,
  type OscalDiagnostic,
} from '@/domain/oscalDiagnostics';
import { isCatalogKey } from '@/domain/sourceRegistry';

export const PROJECT_PROPS_NAMESPACE =
  'https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props' as const;

export const PROJECT_PROP_NAMES = Object.freeze([
  'implementation-priority',
  'effort-estimate-hours',
  'custom-tag',
  'protection-need-level',
  'assessed-against-catalog-key',
  'assessed-against-catalog-commit',
] as const);

export type ProjectPropName = (typeof PROJECT_PROP_NAMES)[number];

export const PROJECT_PROP_CARRIERS = Object.freeze([
  'metadata',
  'poam-item',
  'remediation',
  'implemented-requirement',
  'system-component',
  'inventory-item',
  'information-type',
] as const);

export type ProjectPropCarrier = (typeof PROJECT_PROP_CARRIERS)[number];

export interface ProjectPropRegistryEntry {
  readonly name: ProjectPropName;
  readonly meaning: string;
  readonly carriers: readonly ProjectPropCarrier[];
  readonly cardinality: Readonly<{ minimum: 0; maximum: 1 | null }>;
  readonly valueContract:
    | 'implementation-priority'
    | 'effort-estimate-hours'
    | 'custom-tag'
    | 'protection-need-level'
    | 'catalog-key'
    | 'catalog-commit';
  readonly canonicalization: 'identity' | 'decimal-comma-to-point';
}

function registryEntry(
  name: ProjectPropName,
  carriers: readonly ProjectPropCarrier[],
  maximum: 1 | null,
  meaning: string,
  valueContract: ProjectPropRegistryEntry['valueContract'],
  canonicalization: ProjectPropRegistryEntry['canonicalization'] = 'identity',
): Readonly<ProjectPropRegistryEntry> {
  return Object.freeze({
    name,
    meaning,
    carriers: Object.freeze([...carriers]),
    cardinality: Object.freeze({ minimum: 0 as const, maximum }),
    valueContract,
    canonicalization,
  });
}

export const PROJECT_PROP_REGISTRY = Object.freeze({
  'implementation-priority': registryEntry(
    'implementation-priority',
    ['poam-item', 'remediation'],
    1,
    'Fachliche Priorität einer Umsetzungsmaßnahme',
    'implementation-priority',
  ),
  'effort-estimate-hours': registryEntry(
    'effort-estimate-hours',
    ['poam-item', 'remediation'],
    1,
    'Optionale Aufwandsschätzung in Stunden',
    'effort-estimate-hours',
    'decimal-comma-to-point',
  ),
  'custom-tag': registryEntry(
    'custom-tag',
    ['implemented-requirement'],
    null,
    'Lokales Schlagwort einer implementierten Anforderung',
    'custom-tag',
  ),
  'protection-need-level': registryEntry(
    'protection-need-level',
    ['system-component', 'inventory-item', 'information-type'],
    1,
    'Projektbezogener Schutzbedarf eines Zielobjekts',
    'protection-need-level',
  ),
  'assessed-against-catalog-key': registryEntry(
    'assessed-against-catalog-key',
    ['metadata'],
    1,
    'Stabiler Katalogschlüssel einer Bewertung',
    'catalog-key',
  ),
  'assessed-against-catalog-commit': registryEntry(
    'assessed-against-catalog-commit',
    ['metadata'],
    1,
    'Exakter Katalogstand einer Bewertung',
    'catalog-commit',
  ),
} satisfies Record<ProjectPropName, Readonly<ProjectPropRegistryEntry>>);

const UNICODE_LETTER = /^\p{L}$/u;
const UNICODE_NUMBER = /^\p{N}$/u;

export function isOscalToken(value: string): boolean {
  let position = 0;
  for (const character of value) {
    if (position === 0) {
      if (character !== '_' && !UNICODE_LETTER.test(character)) return false;
    } else if (
      character !== '.'
      && character !== '-'
      && character !== '_'
      && !UNICODE_LETTER.test(character)
      && !UNICODE_NUMBER.test(character)
    ) {
      return false;
    }
    position += 1;
  }
  return position > 0;
}

function isAsciiDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}

function containsOnlyAsciiDigits(value: string): boolean {
  if (value.length === 0) return false;
  for (const character of value) {
    if (!isAsciiDigit(character)) return false;
  }
  return true;
}

function isCanonicalEffortInteger(value: string): boolean {
  return containsOnlyAsciiDigits(value)
    && (value.length === 1 || !value.startsWith('0'));
}

function isCanonicalEffortFraction(value: string): boolean {
  return value.length <= 2
    && containsOnlyAsciiDigits(value)
    && !value.endsWith('0');
}

export function parseCanonicalEffortEstimate(value: string): string | null {
  const decimalPosition = value.indexOf('.');
  if (decimalPosition !== value.lastIndexOf('.')) return null;

  const integer = decimalPosition === -1 ? value : value.slice(0, decimalPosition);
  if (!isCanonicalEffortInteger(integer)) return null;

  if (decimalPosition === -1) {
    return value.startsWith('0') ? null : value;
  }

  const fraction = value.slice(decimalPosition + 1);
  if (!isCanonicalEffortFraction(fraction)) return null;

  return value;
}

export function normalizeEffortEstimateInput(value: string): string | null {
  const commaPosition = value.indexOf(',');
  if (commaPosition !== value.lastIndexOf(',')) return null;
  if (commaPosition !== -1 && value.includes('.')) return null;

  const normalized = commaPosition === -1
    ? value
    : `${value.slice(0, commaPosition)}.${value.slice(commaPosition + 1)}`;
  return parseCanonicalEffortEstimate(normalized);
}

export const PROJECT_PROP_DIAGNOSTIC_CODES = Object.freeze({
  UNKNOWN: 'OSCAL_PROJECT_PROP_UNKNOWN',
  NAME_INVALID: 'OSCAL_PROJECT_PROP_NAME_INVALID',
  GROUP_INVALID: 'OSCAL_PROJECT_PROP_GROUP_INVALID',
  CARRIER_INVALID: 'OSCAL_PROJECT_PROP_CARRIER_INVALID',
  CARDINALITY_INVALID: 'OSCAL_PROJECT_PROP_CARDINALITY_INVALID',
  VALUE_INVALID: 'OSCAL_PROJECT_PROP_VALUE_INVALID',
  REMARKS_REQUIRED: 'OSCAL_PROJECT_PROP_REMARKS_REQUIRED',
  DUPLICATE_VALUE: 'OSCAL_PROJECT_PROP_DUPLICATE_VALUE',
  MEASURE_CARRIER_CONFLICT: 'OSCAL_PROJECT_PROP_MEASURE_CARRIER_CONFLICT',
  CATALOG_PAIR_INCOMPLETE: 'OSCAL_PROJECT_PROP_CATALOG_PAIR_INCOMPLETE',
  CATALOG_PAIR_DUPLICATE: 'OSCAL_PROJECT_PROP_CATALOG_PAIR_DUPLICATE',
  CATALOG_GROUP_MISMATCH: 'OSCAL_PROJECT_PROP_CATALOG_GROUP_MISMATCH',
  CATALOG_KEY_INVALID: 'OSCAL_PROJECT_PROP_CATALOG_KEY_INVALID',
  CATALOG_COMMIT_INVALID: 'OSCAL_PROJECT_PROP_CATALOG_COMMIT_INVALID',
} as const);

export type ProjectPropDiagnosticCode =
  (typeof PROJECT_PROP_DIAGNOSTIC_CODES)[keyof typeof PROJECT_PROP_DIAGNOSTIC_CODES];

const PROJECT_PROP_VALIDATOR = Object.freeze({ name: 'gspp-project-props', version: '1' });

const PROJECT_PROP_PATHS: Readonly<Record<ProjectPropCarrier, string>> = Object.freeze({
  metadata: '/metadata/props',
  'poam-item': '/plan-of-action-and-milestones/poam-items/*/props',
  remediation: '/plan-of-action-and-milestones/risks/*/remediations/*/props',
  'implemented-requirement': '/system-security-plan/control-implementation/implemented-requirements/*/props',
  'system-component': '/system-security-plan/system-implementation/components/*/props',
  'inventory-item': '/system-security-plan/system-implementation/inventory-items/*/props',
  'information-type': '/system-security-plan/system-characteristics/system-information/information-types/*/props',
});
const PROJECT_PROP_BOUNDARY_PATH = '/project-props';

const EMPTY_PROPS: readonly RawOscalProp[] = Object.freeze([]);
const EMPTY_DIAGNOSTICS: readonly OscalDiagnostic[] = Object.freeze([]);

export interface ProjectPropReadResult {
  readonly preservedProps: readonly RawOscalProp[];
  readonly projectProps: readonly RawOscalProp[];
  readonly foreignProps: readonly RawOscalProp[];
  readonly diagnostics: readonly OscalDiagnostic[];
  readonly writeAllowed: boolean;
}

export type ProjectPropCreationResult =
  | { readonly ok: true; readonly prop: Readonly<RawOscalProp> }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

function diagnostic(
  code: ProjectPropDiagnosticCode,
  carrier: ProjectPropCarrier,
): OscalDiagnostic {
  return diagnosticAtPath(code, PROJECT_PROP_PATHS[carrier]);
}

function diagnosticAtPath(
  code: ProjectPropDiagnosticCode,
  path: string,
): OscalDiagnostic {
  return createOscalDiagnostic({
    code,
    stage: 'domain',
    validator: PROJECT_PROP_VALIDATOR,
    path,
  });
}

function isProjectPropName(name: string): name is ProjectPropName {
  return Object.hasOwn(PROJECT_PROP_REGISTRY, name);
}

function isProjectPropCarrier(value: unknown): value is ProjectPropCarrier {
  return PROJECT_PROP_CARRIERS.includes(value as ProjectPropCarrier);
}

function validateProjectPropGroup(
  prop: RawOscalProp,
  carrier: ProjectPropCarrier,
): OscalDiagnostic[] {
  return prop.group !== undefined
    && (typeof prop.group !== 'string' || !isOscalToken(prop.group))
    ? [diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.GROUP_INVALID, carrier)]
    : [];
}

function invalidProjectPropValue(carrier: ProjectPropCarrier): OscalDiagnostic[] {
  return [diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.VALUE_INVALID, carrier)];
}

function validateProtectionNeedValue(
  prop: RawOscalProp,
  carrier: ProjectPropCarrier,
): OscalDiagnostic[] {
  if (prop.value !== 'normal' && prop.value !== 'hoch') {
    return invalidProjectPropValue(carrier);
  }
  return prop.remarks === undefined || prop.remarks.trim().length === 0
    ? [diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.REMARKS_REQUIRED, carrier)]
    : [];
}

function validateCatalogKeyValue(
  prop: RawOscalProp,
  carrier: ProjectPropCarrier,
): OscalDiagnostic[] {
  return prop.group === undefined
    || !isCatalogKey(prop.value)
    || prop.value !== prop.group
    ? [diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_KEY_INVALID, carrier)]
    : [];
}

function isLowerHexSha(value: string): boolean {
  if (value.length !== 40) return false;
  for (const character of value) {
    const isDigit = character >= '0' && character <= '9';
    const isLowerHexLetter = character >= 'a' && character <= 'f';
    if (!isDigit && !isLowerHexLetter) return false;
  }
  return true;
}

function validateCatalogCommitValue(
  prop: RawOscalProp,
  carrier: ProjectPropCarrier,
): OscalDiagnostic[] {
  const diagnostics: OscalDiagnostic[] = [];
  if (prop.group === undefined) {
    diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.GROUP_INVALID, carrier));
  }
  if (!isLowerHexSha(prop.value)) {
    diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_COMMIT_INVALID, carrier));
  }
  return diagnostics;
}

function validateProjectPropValue(
  prop: RawOscalProp,
  valueContract: ProjectPropRegistryEntry['valueContract'],
  carrier: ProjectPropCarrier,
): OscalDiagnostic[] {
  switch (valueContract) {
    case 'implementation-priority':
      return ['high', 'medium', 'low'].includes(prop.value)
        ? []
        : invalidProjectPropValue(carrier);
    case 'effort-estimate-hours':
      return parseCanonicalEffortEstimate(prop.value) === null
        ? invalidProjectPropValue(carrier)
        : [];
    case 'custom-tag':
      return prop.value.length === 0 || prop.value.trim() !== prop.value
        ? invalidProjectPropValue(carrier)
        : [];
    case 'protection-need-level':
      return validateProtectionNeedValue(prop, carrier);
    case 'catalog-key':
      return validateCatalogKeyValue(prop, carrier);
    case 'catalog-commit':
      return validateCatalogCommitValue(prop, carrier);
  }
}

function validateProjectPropCarrier(
  name: ProjectPropName,
  carrier: ProjectPropCarrier,
): OscalDiagnostic[] {
  const entry = PROJECT_PROP_REGISTRY[name];
  return entry.carriers.includes(carrier)
    ? []
    : [diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CARRIER_INVALID, carrier)];
}

function validateKnownProjectProp(
  prop: RawOscalProp,
  name: ProjectPropName,
  carrier: ProjectPropCarrier,
): OscalDiagnostic[] {
  return [
    ...validateProjectPropCarrier(name, carrier),
    ...validateProjectPropValue(prop, PROJECT_PROP_REGISTRY[name].valueContract, carrier),
  ];
}

interface CatalogPairGroup {
  readonly keys: RawOscalProp[];
  readonly commits: RawOscalProp[];
}

interface CatalogPairCollection {
  readonly groups: Map<unknown, CatalogPairGroup>;
  readonly keyGroups: unknown[];
  readonly commitGroups: unknown[];
}

function getCatalogPairGroup(
  groups: Map<unknown, CatalogPairGroup>,
  groupName: unknown,
): CatalogPairGroup {
  const existing = groups.get(groupName);
  if (existing) return existing;
  const created = { keys: [], commits: [] };
  groups.set(groupName, created);
  return created;
}

function collectCatalogPairProp(
  collection: CatalogPairCollection,
  prop: RawOscalProp,
): void {
  if (prop.name === 'assessed-against-catalog-key') {
    getCatalogPairGroup(collection.groups, prop.group).keys.push(prop);
    collection.keyGroups.push(prop.group);
  } else if (prop.name === 'assessed-against-catalog-commit') {
    getCatalogPairGroup(collection.groups, prop.group).commits.push(prop);
    collection.commitGroups.push(prop.group);
  }
}

function validateCatalogPairs(
  props: readonly RawOscalProp[],
  carrier: ProjectPropCarrier,
): OscalDiagnostic[] {
  const collection: CatalogPairCollection = {
    groups: new Map(),
    keyGroups: [],
    commitGroups: [],
  };
  for (const prop of props) {
    collectCatalogPairProp(collection, prop);
  }

  const diagnostics: OscalDiagnostic[] = [];
  for (const group of collection.groups.values()) {
    if (group.keys.length === 0 || group.commits.length === 0) {
      diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_PAIR_INCOMPLETE, carrier));
    }
    if (group.keys.length > 1 || group.commits.length > 1) {
      diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_PAIR_DUPLICATE, carrier));
    }
  }

  if (
    collection.keyGroups.length === 1
    && collection.commitGroups.length === 1
    && collection.keyGroups[0] !== collection.commitGroups[0]
  ) {
    diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_GROUP_MISMATCH, carrier));
  }

  return diagnostics;
}

interface ProjectPropReadAccumulator {
  readonly projectProps: RawOscalProp[];
  readonly foreignProps: RawOscalProp[];
  readonly diagnostics: OscalDiagnostic[];
  readonly counts: Map<ProjectPropName, number>;
  readonly customTags: Set<string>;
}

function hasValidRuntimeValueFields(
  prop: RawOscalProp,
  carrier: ProjectPropCarrier,
  diagnostics: OscalDiagnostic[],
): boolean {
  const runtimeProp = prop as unknown as Readonly<Record<string, unknown>>;
  const valid = typeof runtimeProp.value === 'string'
    && (runtimeProp.remarks === undefined || typeof runtimeProp.remarks === 'string');
  if (!valid) {
    diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.VALUE_INVALID, carrier));
  }
  return valid;
}

function collectCustomTag(
  prop: RawOscalProp,
  accumulator: ProjectPropReadAccumulator,
  carrier: ProjectPropCarrier,
): void {
  if (prop.name !== 'custom-tag' || prop.value.length === 0 || prop.value.trim() !== prop.value) {
    return;
  }
  const normalizedTag = prop.value.toLowerCase();
  if (accumulator.customTags.has(normalizedTag)) {
    accumulator.diagnostics.push(
      diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.DUPLICATE_VALUE, carrier),
    );
  } else {
    accumulator.customTags.add(normalizedTag);
  }
}

function collectProjectProp(
  prop: RawOscalProp,
  carrier: ProjectPropCarrier,
  accumulator: ProjectPropReadAccumulator,
): void {
  const runtimeProp = prop as unknown as Readonly<Record<string, unknown>>;
  if (runtimeProp.ns !== PROJECT_PROPS_NAMESPACE) {
    accumulator.foreignProps.push(prop);
    return;
  }
  if (typeof runtimeProp.name !== 'string' || !isOscalToken(runtimeProp.name)) {
    accumulator.diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.NAME_INVALID, carrier));
    return;
  }

  accumulator.diagnostics.push(...validateProjectPropGroup(prop, carrier));
  if (!isProjectPropName(runtimeProp.name)) {
    accumulator.diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.UNKNOWN, carrier));
    return;
  }

  const name = runtimeProp.name;
  accumulator.projectProps.push(prop);
  accumulator.counts.set(name, (accumulator.counts.get(name) ?? 0) + 1);
  accumulator.diagnostics.push(...validateProjectPropCarrier(name, carrier));
  if (!hasValidRuntimeValueFields(prop, carrier, accumulator.diagnostics)) return;

  accumulator.diagnostics.push(
    ...validateProjectPropValue(prop, PROJECT_PROP_REGISTRY[name].valueContract, carrier),
  );
  collectCustomTag(prop, accumulator, carrier);
}

function validateProjectPropCardinalities(
  counts: ReadonlyMap<ProjectPropName, number>,
  carrier: ProjectPropCarrier,
): OscalDiagnostic[] {
  const diagnostics: OscalDiagnostic[] = [];
  for (const name of PROJECT_PROP_NAMES) {
    if (
      name === 'assessed-against-catalog-key'
      || name === 'assessed-against-catalog-commit'
    ) {
      continue;
    }
    const maximum = PROJECT_PROP_REGISTRY[name].cardinality.maximum;
    if (maximum !== null && (counts.get(name) ?? 0) > maximum) {
      diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CARDINALITY_INVALID, carrier));
    }
  }
  return diagnostics;
}

function isRuntimeProjectPropObject(value: unknown): value is RawOscalProp {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRuntimeProjectPropCollection(value: unknown): value is readonly RawOscalProp[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || !isRuntimeProjectPropObject(value[index])) {
      return false;
    }
  }
  return true;
}

function invalidProjectPropCollectionResult(
  carrier: ProjectPropCarrier,
): ProjectPropReadResult {
  return Object.freeze({
    preservedProps: EMPTY_PROPS,
    projectProps: EMPTY_PROPS,
    foreignProps: EMPTY_PROPS,
    diagnostics: Object.freeze([
      diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.VALUE_INVALID, carrier),
    ]),
    writeAllowed: false,
  });
}

function invalidProjectPropCarrierResult(): ProjectPropReadResult {
  return Object.freeze({
    preservedProps: EMPTY_PROPS,
    projectProps: EMPTY_PROPS,
    foreignProps: EMPTY_PROPS,
    diagnostics: Object.freeze([
      diagnosticAtPath(
        PROJECT_PROP_DIAGNOSTIC_CODES.CARRIER_INVALID,
        PROJECT_PROP_BOUNDARY_PATH,
      ),
    ]),
    writeAllowed: false,
  });
}

export function readProjectProps(
  props: unknown,
  carrier: ProjectPropCarrier,
): ProjectPropReadResult;
export function readProjectProps(
  props: unknown,
  carrier: unknown,
): ProjectPropReadResult {
  if (!isProjectPropCarrier(carrier)) {
    return invalidProjectPropCarrierResult();
  }
  if (props !== undefined && !isRuntimeProjectPropCollection(props)) {
    return invalidProjectPropCollectionResult(carrier);
  }
  const preservedProps = props ?? EMPTY_PROPS;
  if (preservedProps.length === 0) {
    return Object.freeze({
      preservedProps,
      projectProps: EMPTY_PROPS,
      foreignProps: EMPTY_PROPS,
      diagnostics: EMPTY_DIAGNOSTICS,
      writeAllowed: true,
    });
  }

  const accumulator: ProjectPropReadAccumulator = {
    projectProps: [],
    foreignProps: [],
    diagnostics: [],
    counts: new Map(),
    customTags: new Set(),
  };

  for (const prop of preservedProps) {
    collectProjectProp(prop, carrier, accumulator);
  }

  accumulator.diagnostics.push(...validateProjectPropCardinalities(accumulator.counts, carrier));

  if (carrier === 'metadata') {
    accumulator.diagnostics.push(...validateCatalogPairs(accumulator.projectProps, carrier));
  }

  return Object.freeze({
    preservedProps,
    projectProps: Object.freeze(accumulator.projectProps),
    foreignProps: Object.freeze(accumulator.foreignProps),
    diagnostics: Object.freeze(accumulator.diagnostics),
    writeAllowed: accumulator.diagnostics.length === 0,
  });
}

export interface ProjectPropCreationInput {
  readonly name: ProjectPropName;
  readonly value: string;
  readonly carrier: ProjectPropCarrier;
  readonly group?: string;
  readonly remarks?: string;
}

export function createProjectProp(input: ProjectPropCreationInput): ProjectPropCreationResult;
export function createProjectProp(input: unknown): ProjectPropCreationResult {
  if (typeof input !== 'object' || input === null) {
    return Object.freeze({
      ok: false,
      diagnostic: diagnosticAtPath(
        PROJECT_PROP_DIAGNOSTIC_CODES.VALUE_INVALID,
        PROJECT_PROP_BOUNDARY_PATH,
      ),
    });
  }

  const candidate = input as Readonly<Record<string, unknown>>;
  if (!isProjectPropCarrier(candidate.carrier)) {
    return Object.freeze({
      ok: false,
      diagnostic: diagnosticAtPath(
        PROJECT_PROP_DIAGNOSTIC_CODES.CARRIER_INVALID,
        PROJECT_PROP_BOUNDARY_PATH,
      ),
    });
  }
  const carrier = candidate.carrier;

  if (typeof candidate.name !== 'string' || !isOscalToken(candidate.name)) {
    return Object.freeze({
      ok: false,
      diagnostic: diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.NAME_INVALID, carrier),
    });
  }
  if (!isProjectPropName(candidate.name)) {
    return Object.freeze({
      ok: false,
      diagnostic: diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.UNKNOWN, carrier),
    });
  }
  if (typeof candidate.value !== 'string') {
    return Object.freeze({
      ok: false,
      diagnostic: diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.VALUE_INVALID, carrier),
    });
  }
  if (candidate.group !== undefined && typeof candidate.group !== 'string') {
    return Object.freeze({
      ok: false,
      diagnostic: diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.GROUP_INVALID, carrier),
    });
  }
  if (candidate.remarks !== undefined && typeof candidate.remarks !== 'string') {
    return Object.freeze({
      ok: false,
      diagnostic: diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.VALUE_INVALID, carrier),
    });
  }

  const prop = Object.freeze({
    name: candidate.name,
    value: candidate.value,
    ns: PROJECT_PROPS_NAMESPACE,
    ...(candidate.group === undefined ? {} : { group: candidate.group }),
    ...(candidate.remarks === undefined ? {} : { remarks: candidate.remarks }),
  });
  const diagnostics = [
    ...validateProjectPropGroup(prop, carrier),
    ...validateKnownProjectProp(prop, candidate.name, carrier),
  ];
  if (diagnostics.length > 0) {
    return Object.freeze({ ok: false, diagnostic: diagnostics[0] });
  }
  return Object.freeze({ ok: true, prop });
}

export interface PlanningMeasureProjectPropsInput {
  readonly poamItemProps?: readonly RawOscalProp[];
  readonly remediationProps?: readonly RawOscalProp[];
}

export interface ProjectPropValidationResult {
  readonly diagnostics: readonly OscalDiagnostic[];
  readonly writeAllowed: boolean;
}

export function validatePlanningMeasureProjectProps(
  input: PlanningMeasureProjectPropsInput,
): ProjectPropValidationResult {
  const poamItemResult = readProjectProps(input.poamItemProps, 'poam-item');
  const remediationResult = readProjectProps(input.remediationProps, 'remediation');
  const diagnostics = [...poamItemResult.diagnostics, ...remediationResult.diagnostics];
  const planningNames = new Set<ProjectPropName>([
    'implementation-priority',
    'effort-estimate-hours',
  ]);

  const hasPoamPlanningProp = poamItemResult.projectProps.some((prop) =>
    planningNames.has(prop.name as ProjectPropName),
  );
  const hasRemediationPlanningProp = remediationResult.projectProps.some((prop) =>
    planningNames.has(prop.name as ProjectPropName),
  );
  const hasCarrierConflict = hasPoamPlanningProp && hasRemediationPlanningProp;
  if (hasCarrierConflict) {
    diagnostics.push(diagnosticAtPath(
      PROJECT_PROP_DIAGNOSTIC_CODES.MEASURE_CARRIER_CONFLICT,
      '/plan-of-action-and-milestones',
    ));
  }

  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    writeAllowed: diagnostics.length === 0,
  });
}
