import type { RawOscalProp } from '@/domain/models';
import {
  createOscalDiagnostic,
  type OscalDiagnostic,
} from '@/domain/oscalDiagnostics';
import { enforceClass2ObjectGraphInvariants } from '@/domain/oscalObjectGraph';
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

export interface ProjectPropDocumentation {
  readonly valueSpace: string;
  readonly validation: string;
  readonly introducedBy: Readonly<{
    identifier: `GSPP-${number}`;
    url: `https://linear.app/grundschutz-plus-plus/issue/GSPP-${number}`;
  }>;
}

export interface ProjectPropRegistryEntry {
  readonly name: ProjectPropName;
  readonly meaning: string;
  readonly carriers: readonly ProjectPropCarrier[];
  readonly cardinality: Readonly<{
    minimum: 0;
    maximum: 1 | null;
    scope: 'carrier' | 'group';
  }>;
  readonly valueContract:
    | 'implementation-priority'
    | 'effort-estimate-hours'
    | 'custom-tag'
    | 'protection-need-level'
    | 'catalog-key'
    | 'catalog-commit';
  readonly canonicalization: 'identity' | 'decimal-comma-to-point';
  readonly documentation: Readonly<ProjectPropDocumentation>;
}

function registryEntry(entry: ProjectPropRegistryEntry): Readonly<ProjectPropRegistryEntry> {
  return Object.freeze({
    ...entry,
    carriers: Object.freeze([...entry.carriers]),
    cardinality: Object.freeze({ ...entry.cardinality }),
    documentation: Object.freeze({
      ...entry.documentation,
      introducedBy: Object.freeze({ ...entry.documentation.introducedBy }),
    }),
  });
}

export const PROJECT_PROP_REGISTRY = Object.freeze({
  'implementation-priority': registryEntry({
    name: 'implementation-priority',
    carriers: ['poam-item', 'remediation'],
    cardinality: { minimum: 0, maximum: 1, scope: 'carrier' },
    meaning: 'Fachliche Priorität einer Umsetzungsmaßnahme',
    valueContract: 'implementation-priority',
    canonicalization: 'identity',
    documentation: {
      valueSpace: '`high`, `medium`, `low`',
      validation: 'Exakter Token; keine Aliaswerte',
      introducedBy: {
        identifier: 'GSPP-356',
        url: 'https://linear.app/grundschutz-plus-plus/issue/GSPP-356',
      },
    },
  }),
  'effort-estimate-hours': registryEntry({
    name: 'effort-estimate-hours',
    carriers: ['poam-item', 'remediation'],
    cardinality: { minimum: 0, maximum: 1, scope: 'carrier' },
    meaning: 'Optionale Aufwandsschätzung in Stunden',
    valueContract: 'effort-estimate-hours',
    canonicalization: 'decimal-comma-to-point',
    documentation: {
      valueSpace: 'Positive, endliche kanonische Dezimalzahl mit höchstens zwei Nachkommastellen',
      validation: 'Dezimalpunkt, keine Einheit, kein Vorzeichen, keine Exponentialschreibweise; UI-Komma wird vor dem Schreiben normalisiert',
      introducedBy: {
        identifier: 'GSPP-356',
        url: 'https://linear.app/grundschutz-plus-plus/issue/GSPP-356',
      },
    },
  }),
  'custom-tag': registryEntry({
    name: 'custom-tag',
    carriers: ['implemented-requirement'],
    cardinality: { minimum: 0, maximum: null, scope: 'carrier' },
    meaning: 'Lokales Schlagwort einer implementierten Anforderung',
    valueContract: 'custom-tag',
    canonicalization: 'identity',
    documentation: {
      valueSpace: 'Getrimmter, nichtleerer Klasse-2-Text',
      validation: 'NFC-normalisiert und case-insensitiv je Träger eindeutig; Wert wird nicht umgedeutet oder extern ergänzt',
      introducedBy: {
        identifier: 'GSPP-312',
        url: 'https://linear.app/grundschutz-plus-plus/issue/GSPP-312',
      },
    },
  }),
  'protection-need-level': registryEntry({
    name: 'protection-need-level',
    carriers: ['system-component', 'inventory-item', 'information-type'],
    cardinality: { minimum: 0, maximum: 1, scope: 'carrier' },
    meaning: 'Projektbezogener Schutzbedarf eines Zielobjekts',
    valueContract: 'protection-need-level',
    canonicalization: 'identity',
    documentation: {
      valueSpace: '`normal`, `hoch`',
      validation: 'Nichtleere `remarks` sind Pflicht; keine Ableitung aus OSCAL-CIA-Werten',
      introducedBy: {
        identifier: 'GSPP-355',
        url: 'https://linear.app/grundschutz-plus-plus/issue/GSPP-355',
      },
    },
  }),
  'assessed-against-catalog-key': registryEntry({
    name: 'assessed-against-catalog-key',
    carriers: ['metadata'],
    cardinality: { minimum: 0, maximum: 1, scope: 'group' },
    meaning: 'Stabiler Katalogschlüssel einer Bewertung',
    valueContract: 'catalog-key',
    canonicalization: 'identity',
    documentation: {
      valueSpace: 'Registrierter `catalogKey`',
      validation: '`group` ist NCName-konform und exakt gleich dem Property-Wert',
      introducedBy: {
        identifier: 'GSPP-361',
        url: 'https://linear.app/grundschutz-plus-plus/issue/GSPP-361',
      },
    },
  }),
  'assessed-against-catalog-commit': registryEntry({
    name: 'assessed-against-catalog-commit',
    carriers: ['metadata'],
    cardinality: { minimum: 0, maximum: 1, scope: 'group' },
    meaning: 'Exakter Katalogstand einer Bewertung',
    valueContract: 'catalog-commit',
    canonicalization: 'identity',
    documentation: {
      valueSpace: 'Vollständiger Git-Commit-SHA',
      validation: 'Genau 40 kleingeschriebene Hex-Zeichen; Partner-Key mit identischer `group` ist Pflicht',
      introducedBy: {
        identifier: 'GSPP-361',
        url: 'https://linear.app/grundschutz-plus-plus/issue/GSPP-361',
      },
    },
  }),
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
    return value.startsWith('0') || !Number.isFinite(Number(value)) ? null : value;
  }

  const fraction = value.slice(decimalPosition + 1);
  if (!isCanonicalEffortFraction(fraction)) return null;

  return Number.isFinite(Number(value)) ? value : null;
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

const PROJECT_PROP_BOUNDARY_PATHS: Readonly<Record<ProjectPropCarrier, string>> = Object.freeze({
  metadata: '/metadata/props',
  'poam-item': '/project-props/poam-item',
  remediation: '/project-props/remediation',
  'implemented-requirement': '/project-props/implemented-requirement',
  'system-component': '/project-props/system-component',
  'inventory-item': '/project-props/inventory-item',
  'information-type': '/project-props/information-type',
});
const PROJECT_PROP_BOUNDARY_PATH = '/project-props';

export type ProjectPropLocation =
  | Readonly<{ carrier: 'metadata' }>
  | Readonly<{ carrier: 'poam-item'; poamItemIndex: number }>
  | Readonly<{ carrier: 'remediation'; riskIndex: number; remediationIndex: number }>
  | Readonly<{
    carrier: 'implemented-requirement';
    implementedRequirementIndex: number;
  }>
  | Readonly<{ carrier: 'system-component'; componentIndex: number }>
  | Readonly<{ carrier: 'inventory-item'; inventoryItemIndex: number }>
  | Readonly<{ carrier: 'information-type'; informationTypeIndex: number }>;

type ProjectPropDiagnosticContext = ProjectPropCarrier | ProjectPropLocation;

function isStructuralIndex(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isProjectPropLocation(value: unknown): value is ProjectPropLocation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  switch (candidate.carrier) {
    case 'metadata':
      return true;
    case 'poam-item':
      return isStructuralIndex(candidate.poamItemIndex);
    case 'remediation':
      return isStructuralIndex(candidate.riskIndex)
        && isStructuralIndex(candidate.remediationIndex);
    case 'implemented-requirement':
      return isStructuralIndex(candidate.implementedRequirementIndex);
    case 'system-component':
      return isStructuralIndex(candidate.componentIndex);
    case 'inventory-item':
      return isStructuralIndex(candidate.inventoryItemIndex);
    case 'information-type':
      return isStructuralIndex(candidate.informationTypeIndex);
    default:
      return false;
  }
}

function projectPropCarrier(context: ProjectPropDiagnosticContext): ProjectPropCarrier {
  return typeof context === 'string' ? context : context.carrier;
}

function projectPropPath(context: ProjectPropDiagnosticContext): string {
  if (typeof context === 'string') return PROJECT_PROP_BOUNDARY_PATHS[context];
  switch (context.carrier) {
    case 'metadata':
      return '/metadata/props';
    case 'poam-item':
      return `/plan-of-action-and-milestones/poam-items/${context.poamItemIndex}/props`;
    case 'remediation':
      return `/plan-of-action-and-milestones/risks/${context.riskIndex}/remediations/${context.remediationIndex}/props`;
    case 'implemented-requirement':
      return `/system-security-plan/control-implementation/implemented-requirements/${context.implementedRequirementIndex}/props`;
    case 'system-component':
      return `/system-security-plan/system-implementation/components/${context.componentIndex}/props`;
    case 'inventory-item':
      return `/system-security-plan/system-implementation/inventory-items/${context.inventoryItemIndex}/props`;
    case 'information-type':
      return `/system-security-plan/system-characteristics/system-information/information-types/${context.informationTypeIndex}/props`;
  }
}

const EMPTY_PROPS: readonly RawOscalProp[] = Object.freeze([]);
const EMPTY_DIAGNOSTICS: readonly OscalDiagnostic[] = Object.freeze([]);

export interface ProjectPropReadResult {
  /** Exakte Eingabe für No-op-Export und Backup, unabhängig von der Schreibfreigabe. */
  readonly preservedProps: unknown;
  /** Zeigt separat, ob `preservedProps` eine strukturell gültige Props-Liste ist. */
  readonly collectionValid: boolean;
  readonly projectProps: readonly RawOscalProp[];
  readonly foreignProps: readonly RawOscalProp[];
  readonly unknownProjectProps: readonly RawOscalProp[];
  readonly carrier: ProjectPropCarrier | null;
  readonly diagnostics: readonly OscalDiagnostic[];
  readonly writeAllowed: boolean;
}

export type ProjectPropCreationResult =
  | { readonly ok: true; readonly prop: Readonly<RawOscalProp> }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

function diagnostic(
  code: ProjectPropDiagnosticCode,
  context: ProjectPropDiagnosticContext,
): OscalDiagnostic {
  return diagnosticAtPath(code, projectPropPath(context));
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

const IMPLEMENTATION_PRIORITY_VALUES = Object.freeze(['high', 'medium', 'low'] as const);

function isCanonicalCustomTag(value: string): boolean {
  return value.length > 0 && value.trim() === value;
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
  return /^[0-9a-f]{40}$/.test(value);
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
      return IMPLEMENTATION_PRIORITY_VALUES.includes(
        prop.value as (typeof IMPLEMENTATION_PRIORITY_VALUES)[number],
      )
        ? []
        : invalidProjectPropValue(carrier);
    case 'effort-estimate-hours':
      return parseCanonicalEffortEstimate(prop.value) === null
        ? invalidProjectPropValue(carrier)
        : [];
    case 'custom-tag':
      return !isCanonicalCustomTag(prop.value)
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
  } else if (prop.name === 'assessed-against-catalog-commit') {
    getCatalogPairGroup(collection.groups, prop.group).commits.push(prop);
  }
}

function validateCatalogPairs(
  props: readonly RawOscalProp[],
  carrier: ProjectPropCarrier,
): OscalDiagnostic[] {
  const collection: CatalogPairCollection = {
    groups: new Map(),
  };
  for (const prop of props) {
    collectCatalogPairProp(collection, prop);
  }

  const diagnostics: OscalDiagnostic[] = [];
  const keyOnlyGroups: unknown[] = [];
  const commitOnlyGroups: unknown[] = [];
  for (const group of collection.groups.values()) {
    if (group.keys.length > 0 && group.commits.length === 0) keyOnlyGroups.push(group);
    if (group.commits.length > 0 && group.keys.length === 0) commitOnlyGroups.push(group);
    if (group.keys.length > 1 || group.commits.length > 1) {
      diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_PAIR_DUPLICATE, carrier));
    }
  }

  if (keyOnlyGroups.length > 0 && commitOnlyGroups.length > 0) {
    diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_GROUP_MISMATCH, carrier));
  } else {
    const incompletePairCount = keyOnlyGroups.length + commitOnlyGroups.length;
    for (let index = 0; index < incompletePairCount; index += 1) {
      diagnostics.push(diagnostic(
        PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_PAIR_INCOMPLETE,
        carrier,
      ));
    }
  }

  return diagnostics;
}

interface ProjectPropReadAccumulator {
  readonly projectProps: RawOscalProp[];
  readonly foreignProps: RawOscalProp[];
  readonly unknownProjectProps: RawOscalProp[];
  readonly diagnostics: OscalDiagnostic[];
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
  if (prop.name !== 'custom-tag' || !isCanonicalCustomTag(prop.value)) {
    return;
  }
  const normalizedTag = prop.value.normalize('NFC').toLowerCase();
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
    accumulator.unknownProjectProps.push(prop);
    accumulator.diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.UNKNOWN, carrier));
    return;
  }

  const name = runtimeProp.name;
  accumulator.projectProps.push(prop);
  accumulator.diagnostics.push(...validateProjectPropCarrier(name, carrier));
  if (!hasValidRuntimeValueFields(prop, carrier, accumulator.diagnostics)) return;

  accumulator.diagnostics.push(
    ...validateProjectPropValue(prop, PROJECT_PROP_REGISTRY[name].valueContract, carrier),
  );
  collectCustomTag(prop, accumulator, carrier);
}

function validateProjectPropCardinalities(
  props: readonly RawOscalProp[],
  carrier: ProjectPropCarrier,
): OscalDiagnostic[] {
  const carrierCounts = new Map<ProjectPropName, number>();
  const groupCounts = new Map<ProjectPropName, Map<unknown, number>>();
  const invalidNames = new Set<ProjectPropName>();

  for (const prop of props) {
    if (!isProjectPropName(prop.name)) continue;
    const { maximum, scope } = PROJECT_PROP_REGISTRY[prop.name].cardinality;
    if (maximum === null) continue;

    if (scope === 'carrier') {
      const count = (carrierCounts.get(prop.name) ?? 0) + 1;
      carrierCounts.set(prop.name, count);
      if (count > maximum) invalidNames.add(prop.name);
      continue;
    }

    let countsByGroup = groupCounts.get(prop.name);
    if (countsByGroup === undefined) {
      countsByGroup = new Map<unknown, number>();
      groupCounts.set(prop.name, countsByGroup);
    }
    const count = (countsByGroup.get(prop.group) ?? 0) + 1;
    countsByGroup.set(prop.group, count);
    if (count > maximum) invalidNames.add(prop.name);
  }

  return PROJECT_PROP_NAMES
    .filter((name) => invalidNames.has(name))
    .map(() => diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CARDINALITY_INVALID, carrier));
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
  props: unknown,
  context: ProjectPropDiagnosticContext,
  boundaryDiagnostic = diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.VALUE_INVALID, context),
): ProjectPropReadResult {
  return Object.freeze({
    preservedProps: props,
    collectionValid: false,
    projectProps: EMPTY_PROPS,
    foreignProps: EMPTY_PROPS,
    unknownProjectProps: EMPTY_PROPS,
    carrier: projectPropCarrier(context),
    diagnostics: Object.freeze([boundaryDiagnostic]),
    writeAllowed: false,
  });
}

function invalidProjectPropCarrierResult(props: unknown): ProjectPropReadResult {
  const collectionValid = props === undefined || (
    enforceClass2ObjectGraphInvariants(props) === null
    && isRuntimeProjectPropCollection(props)
  );

  return Object.freeze({
    preservedProps: props,
    collectionValid,
    projectProps: EMPTY_PROPS,
    foreignProps: EMPTY_PROPS,
    unknownProjectProps: EMPTY_PROPS,
    carrier: null,
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
  context: ProjectPropDiagnosticContext,
): ProjectPropReadResult;
export function readProjectProps(
  props: unknown,
  context: unknown,
): ProjectPropReadResult {
  if (!isProjectPropCarrier(context) && !isProjectPropLocation(context)) {
    return invalidProjectPropCarrierResult(props);
  }
  const carrier = projectPropCarrier(context);
  if (props !== undefined) {
    const graphDiagnostic = enforceClass2ObjectGraphInvariants(props);
    if (graphDiagnostic !== null) {
      return invalidProjectPropCollectionResult(props, context, graphDiagnostic);
    }
  }
  if (props !== undefined && !isRuntimeProjectPropCollection(props)) {
    return invalidProjectPropCollectionResult(props, context);
  }
  const preservedProps = props ?? EMPTY_PROPS;
  if (preservedProps.length === 0) {
    return Object.freeze({
      preservedProps,
      collectionValid: true,
      projectProps: EMPTY_PROPS,
      foreignProps: EMPTY_PROPS,
      unknownProjectProps: EMPTY_PROPS,
      carrier,
      diagnostics: EMPTY_DIAGNOSTICS,
      writeAllowed: true,
    });
  }

  const accumulator: ProjectPropReadAccumulator = {
    projectProps: [],
    foreignProps: [],
    unknownProjectProps: [],
    diagnostics: [],
    customTags: new Set(),
  };

  for (const prop of preservedProps) {
    collectProjectProp(prop, carrier, accumulator);
  }

  accumulator.diagnostics.push(...validateProjectPropCardinalities(
    accumulator.projectProps,
    carrier,
  ));

  if (carrier === 'metadata') {
    accumulator.diagnostics.push(...validateCatalogPairs(accumulator.projectProps, carrier));
  }

  const scopedDiagnostics = accumulator.diagnostics.map(({ code }) =>
    diagnosticAtPath(code as ProjectPropDiagnosticCode, projectPropPath(context)),
  );

  return Object.freeze({
    preservedProps,
    collectionValid: true,
    projectProps: Object.freeze(accumulator.projectProps),
    foreignProps: Object.freeze(accumulator.foreignProps),
    unknownProjectProps: Object.freeze(accumulator.unknownProjectProps),
    carrier,
    diagnostics: Object.freeze(scopedDiagnostics),
    writeAllowed: scopedDiagnostics.length === 0,
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
  return createSingleProjectProp(input, false);
}

function createSingleProjectProp(
  input: unknown,
  allowCatalogReferencePart: boolean,
): ProjectPropCreationResult {
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
  if (
    !allowCatalogReferencePart
    && (
      candidate.name === 'assessed-against-catalog-key'
      || candidate.name === 'assessed-against-catalog-commit'
    )
  ) {
    return Object.freeze({
      ok: false,
      diagnostic: diagnostic(
        PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_PAIR_INCOMPLETE,
        carrier,
      ),
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

  const prop = {
    name: candidate.name,
    value: candidate.value,
    ns: PROJECT_PROPS_NAMESPACE,
    ...(candidate.group === undefined ? {} : { group: candidate.group }),
    ...(candidate.remarks === undefined ? {} : { remarks: candidate.remarks }),
  };
  const diagnostics = [
    ...validateProjectPropGroup(prop, carrier),
    ...validateKnownProjectProp(prop, candidate.name, carrier),
  ];
  if (diagnostics.length > 0) {
    return Object.freeze({ ok: false, diagnostic: diagnostics[0] });
  }
  return Object.freeze({ ok: true, prop });
}

export interface CatalogReferenceProjectPropsInput {
  readonly catalogKey: string;
  readonly commit: string;
}

export type CatalogReferenceProjectPropsCreationResult =
  | {
    readonly ok: true;
    readonly props: readonly [Readonly<RawOscalProp>, Readonly<RawOscalProp>];
  }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

export function createCatalogReferenceProjectProps(
  input: CatalogReferenceProjectPropsInput,
): CatalogReferenceProjectPropsCreationResult;
export function createCatalogReferenceProjectProps(
  input: unknown,
): CatalogReferenceProjectPropsCreationResult {
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
  if (typeof candidate.catalogKey !== 'string' || typeof candidate.commit !== 'string') {
    return Object.freeze({
      ok: false,
      diagnostic: diagnostic(
        PROJECT_PROP_DIAGNOSTIC_CODES.VALUE_INVALID,
        'metadata',
      ),
    });
  }

  const keyResult = createSingleProjectProp({
    name: 'assessed-against-catalog-key',
    value: candidate.catalogKey,
    carrier: 'metadata',
    group: candidate.catalogKey,
  }, true);
  if (!keyResult.ok) return keyResult;

  const commitResult = createSingleProjectProp({
    name: 'assessed-against-catalog-commit',
    value: candidate.commit,
    carrier: 'metadata',
    group: candidate.catalogKey,
  }, true);
  if (!commitResult.ok) return commitResult;

  return Object.freeze({
    ok: true,
    props: [keyResult.prop, commitResult.prop] as const,
  });
}

export interface PlanningMeasureProjectPropsInput {
  readonly poamItemResult?: ProjectPropReadResult;
  readonly remediationResult?: ProjectPropReadResult;
}

export interface ProjectPropValidationResult {
  readonly diagnostics: readonly OscalDiagnostic[];
  readonly writeAllowed: boolean;
}

const PLANNING_PROP_NAMES = Object.freeze([
  'implementation-priority',
  'effort-estimate-hours',
] as const);

function isPlanningProjectProp(prop: RawOscalProp): boolean {
  return PLANNING_PROP_NAMES.includes(prop.name as (typeof PLANNING_PROP_NAMES)[number]);
}

export function validatePlanningMeasureProjectProps(
  input: PlanningMeasureProjectPropsInput,
): ProjectPropValidationResult {
  const { poamItemResult, remediationResult } = input;
  const carrierDiagnostics = [
    ...(poamItemResult !== undefined && poamItemResult.carrier !== 'poam-item'
      ? [diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CARRIER_INVALID, 'poam-item')]
      : EMPTY_DIAGNOSTICS),
    ...(remediationResult !== undefined && remediationResult.carrier !== 'remediation'
      ? [diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CARRIER_INVALID, 'remediation')]
      : EMPTY_DIAGNOSTICS),
  ];
  const diagnostics = [
    ...carrierDiagnostics,
    ...(poamItemResult?.diagnostics ?? EMPTY_DIAGNOSTICS),
    ...(remediationResult?.diagnostics ?? EMPTY_DIAGNOSTICS),
  ];

  const hasPoamPlanningProp = poamItemResult?.projectProps.some(isPlanningProjectProp) ?? false;
  const hasRemediationPlanningProp = remediationResult?.projectProps.some(
    isPlanningProjectProp,
  ) ?? false;
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
