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

export function parseCanonicalEffortEstimate(value: string): string | null {
  let decimalPosition = -1;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '.') {
      if (decimalPosition !== -1) return null;
      decimalPosition = index;
      continue;
    }
    if (!isAsciiDigit(character)) return null;
  }

  const integerLength = decimalPosition === -1 ? value.length : decimalPosition;
  if (integerLength === 0) return null;
  if (integerLength > 1 && value[0] === '0') return null;

  if (decimalPosition === -1) {
    return value[0] === '0' ? null : value;
  }

  const fractionLength = value.length - decimalPosition - 1;
  if (fractionLength < 1 || fractionLength > 2) return null;
  if (value[value.length - 1] === '0') return null;

  return value;
}

export function normalizeEffortEstimateInput(value: string): string | null {
  let commaPosition = -1;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== ',') continue;
    if (commaPosition !== -1 || value.includes('.')) return null;
    commaPosition = index;
  }

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

function validateProjectPropGroup(
  prop: RawOscalProp,
  carrier: ProjectPropCarrier,
): OscalDiagnostic[] {
  return prop.group !== undefined && !isOscalToken(prop.group)
    ? [diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.GROUP_INVALID, carrier)]
    : [];
}

function validateKnownProjectProp(
  prop: RawOscalProp,
  name: ProjectPropName,
  carrier: ProjectPropCarrier,
): OscalDiagnostic[] {
  const diagnostics: OscalDiagnostic[] = [];
  const entry = PROJECT_PROP_REGISTRY[name];

  if (!entry.carriers.includes(carrier)) {
    diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CARRIER_INVALID, carrier));
  }

  if (
    entry.valueContract === 'implementation-priority'
    && !['high', 'medium', 'low'].includes(prop.value)
  ) {
    diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.VALUE_INVALID, carrier));
  } else if (
    entry.valueContract === 'effort-estimate-hours'
    && parseCanonicalEffortEstimate(prop.value) === null
  ) {
    diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.VALUE_INVALID, carrier));
  } else if (
    entry.valueContract === 'custom-tag'
    && (prop.value.length === 0 || prop.value.trim() !== prop.value)
  ) {
    diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.VALUE_INVALID, carrier));
  } else if (entry.valueContract === 'protection-need-level') {
    if (prop.value !== 'normal' && prop.value !== 'hoch') {
      diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.VALUE_INVALID, carrier));
    } else if (prop.remarks === undefined || prop.remarks.trim().length === 0) {
      diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.REMARKS_REQUIRED, carrier));
    }
  } else if (entry.valueContract === 'catalog-key') {
    if (
      prop.group === undefined
      || !isCatalogKey(prop.value)
      || prop.value !== prop.group
    ) {
      diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_KEY_INVALID, carrier));
    }
  } else if (entry.valueContract === 'catalog-commit') {
    if (prop.group === undefined) {
      diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.GROUP_INVALID, carrier));
    }
    if (!isLowerHexSha(prop.value)) {
      diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_COMMIT_INVALID, carrier));
    }
  }

  return diagnostics;
}

function isLowerHexSha(value: string): boolean {
  if (value.length !== 40) return false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const isDigit = character >= '0' && character <= '9';
    const isLowerHexLetter = character >= 'a' && character <= 'f';
    if (!isDigit && !isLowerHexLetter) return false;
  }
  return true;
}

interface CatalogPairGroup {
  readonly keys: RawOscalProp[];
  readonly commits: RawOscalProp[];
}

function validateCatalogPairs(
  props: readonly RawOscalProp[],
  carrier: ProjectPropCarrier,
): OscalDiagnostic[] {
  const groups = new Map<string | undefined, CatalogPairGroup>();
  let keyGroup: string | undefined;
  let commitGroup: string | undefined;
  let totalKeys = 0;
  let totalCommits = 0;

  for (const prop of props) {
    const isKey = prop.name === 'assessed-against-catalog-key';
    const isCommit = prop.name === 'assessed-against-catalog-commit';
    if (!isKey && !isCommit) continue;

    let group = groups.get(prop.group);
    if (!group) {
      group = { keys: [], commits: [] };
      groups.set(prop.group, group);
    }
    if (isKey) {
      group.keys.push(prop);
      keyGroup = prop.group;
      totalKeys += 1;
    } else {
      group.commits.push(prop);
      commitGroup = prop.group;
      totalCommits += 1;
    }
  }

  const diagnostics: OscalDiagnostic[] = [];
  for (const group of groups.values()) {
    if (group.keys.length === 0 || group.commits.length === 0) {
      diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_PAIR_INCOMPLETE, carrier));
    }
    if (group.keys.length > 1 || group.commits.length > 1) {
      diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_PAIR_DUPLICATE, carrier));
    }
  }

  if (totalKeys === 1 && totalCommits === 1 && keyGroup !== commitGroup) {
    diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.CATALOG_GROUP_MISMATCH, carrier));
  }

  return diagnostics;
}

export function readProjectProps(
  props: readonly RawOscalProp[] | undefined,
  carrier: ProjectPropCarrier,
): ProjectPropReadResult {
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

  const projectProps: RawOscalProp[] = [];
  const foreignProps: RawOscalProp[] = [];
  const diagnostics: OscalDiagnostic[] = [];
  const counts = new Map<ProjectPropName, number>();
  const customTags = new Set<string>();

  for (const prop of preservedProps) {
    if (prop.ns !== PROJECT_PROPS_NAMESPACE) {
      foreignProps.push(prop);
      continue;
    }
    if (!isOscalToken(prop.name)) {
      diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.NAME_INVALID, carrier));
      continue;
    }
    diagnostics.push(...validateProjectPropGroup(prop, carrier));
    if (!isProjectPropName(prop.name)) {
      diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.UNKNOWN, carrier));
      continue;
    }

    projectProps.push(prop);
    counts.set(prop.name, (counts.get(prop.name) ?? 0) + 1);
    diagnostics.push(...validateKnownProjectProp(prop, prop.name, carrier));

    if (prop.name === 'custom-tag' && prop.value.length > 0 && prop.value.trim() === prop.value) {
      const normalizedTag = prop.value.toLowerCase();
      if (customTags.has(normalizedTag)) {
        diagnostics.push(diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.DUPLICATE_VALUE, carrier));
      } else {
        customTags.add(normalizedTag);
      }
    }
  }

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

  if (carrier === 'metadata') {
    diagnostics.push(...validateCatalogPairs(projectProps, carrier));
  }

  return Object.freeze({
    preservedProps,
    projectProps: Object.freeze(projectProps),
    foreignProps: Object.freeze(foreignProps),
    diagnostics: Object.freeze(diagnostics),
    writeAllowed: diagnostics.length === 0,
  });
}

export function createProjectProp(input: {
  readonly name: ProjectPropName;
  readonly value: string;
  readonly carrier: ProjectPropCarrier;
  readonly group?: string;
  readonly remarks?: string;
}): ProjectPropCreationResult {
  if (typeof input.name !== 'string' || !isOscalToken(input.name)) {
    return Object.freeze({
      ok: false,
      diagnostic: diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.NAME_INVALID, input.carrier),
    });
  }
  if (!isProjectPropName(input.name)) {
    return Object.freeze({
      ok: false,
      diagnostic: diagnostic(PROJECT_PROP_DIAGNOSTIC_CODES.UNKNOWN, input.carrier),
    });
  }

  const prop = Object.freeze({
    name: input.name,
    value: input.value,
    ns: PROJECT_PROPS_NAMESPACE,
    ...(input.group === undefined ? {} : { group: input.group }),
    ...(input.remarks === undefined ? {} : { remarks: input.remarks }),
  });
  const diagnostics = [
    ...validateProjectPropGroup(prop, input.carrier),
    ...validateKnownProjectProp(prop, input.name, input.carrier),
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
  const planningNames: readonly ProjectPropName[] = [
    'implementation-priority',
    'effort-estimate-hours',
  ];

  const hasPoamPlanningProp = poamItemResult.projectProps.some((prop) =>
    planningNames.includes(prop.name as ProjectPropName),
  );
  const hasRemediationPlanningProp = remediationResult.projectProps.some((prop) =>
    planningNames.includes(prop.name as ProjectPropName),
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
