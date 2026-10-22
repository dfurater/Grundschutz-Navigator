// =============================================================================
// Evidenz-Read-Model für Assessment Results und POA&M (GSPP-313): reine Ableitung
// aus dem Dokument — kein Speicher, kein Netz, keine base64-Dekodierung. Hrefs
// klassifiziert der einzige Klassifikator aus `referenceResolution.ts`, die
// Beobachtungsreferenzen aus `evidenceObservationReferences.ts`.
// =============================================================================

import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  classifyLocalReference,
  deriveObservationReferences,
  lowerCaseSet,
  objectsAt,
  type ObjectAt,
} from '@/domain/evidenceObservationReferences';
import {
  createOscalReferenceClassifier,
  createReferenceDocument,
  resolveCatalogResources,
  type ResolvedResource,
} from '@/domain/referenceResolution';

export const EVIDENCE_READ_MODEL_VALIDATOR = Object.freeze({
  name: 'evidence-read-model',
  version: '1',
});

export type EvidenceRootType = 'assessment-results' | 'plan-of-action-and-milestones';

/** Dokumentiertes Spektrum laut Schema v1.2.2; das Schema akzeptiert daneben jeden String. */
const DOCUMENTED_METHODS = new Set(['EXAMINE', 'INTERVIEW', 'TEST', 'UNKNOWN']);
const DOCUMENTED_OBSERVATION_TYPES = new Set([
  'ssp-statement-issue',
  'control-objective',
  'mitigation',
  'finding',
  'discovery',
  'historic',
]);

/** Ergebnis des gemeinsamen Klassifikators; ohne Control-Lookup nie `local-control`. */
export type EvidenceReference = ReturnType<ReturnType<typeof createOscalReferenceClassifier>>;

export interface VocabularyValue {
  readonly value: string;
  readonly status: 'documented' | 'undocumented';
}

/** `no-expiry-declared` heißt „ohne deklariertes Ablaufdatum", nicht „unbegrenzt gültig". */
export type EvidenceValidity = 'current' | 'expired' | 'no-expiry-declared' | 'not-evaluable';

export type UuidReferenceState =
  | 'resolved'
  | 'resolved-in-context'
  | 'not-resolvable-in-context'
  | 'ambiguous-in-document'
  | 'ambiguous-in-context'
  | 'missing-in-context'
  | 'type-mismatch'
  | 'missing-in-document';

export interface UuidReference {
  readonly path: string;
  readonly uuid: string;
  readonly state: UuidReferenceState;
}

export interface EvidenceSubject extends UuidReference {
  readonly type: string;
}

export interface EvidenceEntry {
  readonly path: string;
  /** `descriptive`: nur `description`, ohne `href` — gültige Evidenz ohne Ressource. */
  readonly kind: 'descriptive' | 'referenced';
  readonly href?: EvidenceReference;
  readonly links: readonly EvidenceReference[];
}

export interface EvidenceObservation {
  readonly path: string;
  readonly uuid?: string;
  readonly methods: readonly VocabularyValue[];
  readonly types: readonly VocabularyValue[];
  readonly collected?: string;
  readonly expires?: string;
  readonly validity: EvidenceValidity;
  readonly evidence: readonly EvidenceEntry[];
  readonly subjects: readonly EvidenceSubject[];
}

export interface EvidenceReadModel {
  readonly rootType: EvidenceRootType;
  readonly observations: readonly EvidenceObservation[];
  readonly resources: readonly ResolvedResource[];
  readonly observationReferences: readonly UuidReference[];
  readonly diagnostics: readonly OscalDiagnostic[];
}

export interface EvidenceReadModelInput {
  readonly source: unknown;
  readonly rootType: EvidenceRootType;
  readonly oscalVersion: string;
  /** Bewertungszeitpunkt der Gültigkeit. */
  readonly at: Date;
  /** UUIDs, die der Aufrufer aus anderen Workspace-Dokumenten bereitstellt. */
  readonly contextUuids?: ReadonlySet<string>;
  /** Typisierte AR-Trefferzahlen mit explizitem Bindungszustand. */
  readonly observationContext?: {
    readonly counts: ReadonlyMap<string, number>;
    readonly available: boolean;
  };
  /** Normalisierte Häufigkeiten aller lokalen UUID-Identitäten für typisierte POA&M-Verweise. */
  readonly documentUuidCounts?: ReadonlyMap<string, number>;
}

/** Abgelaufene oder nicht bewertbare Beobachtungen tragen keine positive Nachweisaussage. */
export function blocksPositiveFinding(validity: EvidenceValidity): boolean {
  return validity === 'expired' || validity === 'not-evaluable';
}

function vocabulary(value: unknown, documented: ReadonlySet<string>): VocabularyValue[] {
  return readArray(value)
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => ({ value: entry, status: documented.has(entry) ? 'documented' : 'undocumented' }));
}

/** OSCAL `dateTime-with-timezone`: ohne Offset wäre der Zeitpunkt von der Gerätezeitzone abhängig. */
const DATE_TIME_WITH_TIMEZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const hours = (from: number, to: number, sign: string): string[] =>
  Array.from({ length: to - from + 1 }, (_, hour) => `${sign}${String(from + hour).padStart(2, '0')}:00`);

/** Offsets, die `DateTimeWithTimezoneDatatype` in den gepinnten AR- und POA&M-Schemas (v1.1.2 bis v1.2.2) zulässt. */
const ALLOWED_OFFSETS = new Set([
  'Z',
  ...hours(0, 12, '-'),
  '-03:30',
  '-09:30',
  ...hours(0, 14, '+'),
  ...['03', '04', '05', '06', '09', '10'].map((hour) => `+${hour}:30`),
  ...['05', '08', '12'].map((hour) => `+${hour}:45`),
]);

/** `Date.parse` normalisiert unmögliche Angaben wie `2026-02-30`; deshalb vorher jede Komponente prüfen. */
export function parseTimestamp(value: unknown): number {
  const match = typeof value === 'string' ? DATE_TIME_WITH_TIMEZONE.exec(value) : null;
  if (match === null) return Number.NaN;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const calendarDay = new Date(Date.UTC(year, month - 1, day));
  const valid =
    calendarDay.getUTCFullYear() === year &&
    calendarDay.getUTCMonth() === month - 1 &&
    calendarDay.getUTCDate() === day &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    ALLOWED_OFFSETS.has(match[8]);
  return valid ? Date.parse(match[0]) : Number.NaN;
}

/** Nimmt die Rohwerte: ein vorhandenes, aber nicht lesbares `expires` ist kein fehlendes. */
function validityOf(collected: unknown, expires: unknown, at: Date): EvidenceValidity {
  if (Number.isNaN(parseTimestamp(collected))) return 'not-evaluable';
  if (expires === undefined) return 'no-expiry-declared';
  const expiresAt = parseTimestamp(expires);
  if (Number.isNaN(expiresAt) || typeof expires !== 'string' || Number.isNaN(at.getTime())) return 'not-evaluable';
  if (expiresAt !== at.getTime()) return expiresAt > at.getTime() ? 'current' : 'expired';
  // `Date.parse` kappt unter der Millisekunde; ein Rest > 0 liegt noch nach `at`.
  const subMillisecond = /\.\d{3}(\d+)/.exec(expires)?.[1] ?? '';
  return /[1-9]/.test(subMillisecond) ? 'current' : 'expired';
}

export function deriveEvidenceReadModel(input: EvidenceReadModelInput): EvidenceReadModel {
  const { rootType, oscalVersion, at } = input;
  const contextUuids = lowerCaseSet(input.contextUuids ?? []);
  const rootPath = `/${rootType}`;
  const body = isJsonObject(input.source) ? input.source[rootType] : undefined;
  if (!isJsonObject(body)) {
    return { rootType, observations: [], resources: [], observationReferences: [], diagnostics: [] };
  }

  const document = createReferenceDocument({ source: input.source, context: {}, rootType, oscalVersion });
  const classify = createOscalReferenceClassifier({ document });
  const resources = resolveCatalogResources({ document });
  const resourceUuids = lowerCaseSet(resources.map((resource) => resource.uuid));
  const diagnostics: OscalDiagnostic[] = [];

  const diagnose = (code: string, path: string) =>
    diagnostics.push(
      createOscalDiagnostic({
        code,
        stage: 'reference',
        validator: EVIDENCE_READ_MODEL_VALIDATOR,
        path,
        artifact: { rootType, oscalVersion },
      }),
    );

  // Beobachtungen und ihre Bezugsstellen liegen in AR je `result`, im POA&M am Root.
  const containers: ObjectAt[] =
    rootType === 'assessment-results' ? objectsAt(body, 'results', rootPath) : [{ node: body, path: rootPath }];
  const observationNodes = containers.flatMap((container) => objectsAt(container.node, 'observations', container.path));
  const observationUuids = lowerCaseSet(observationNodes.flatMap(({ node }) => readString(node.uuid) ?? []));
  const observationCounts = new Map<string, number>();
  for (const { node } of observationNodes) {
    const uuid = readString(node.uuid)?.toLowerCase();
    if (uuid !== undefined) observationCounts.set(uuid, (observationCounts.get(uuid) ?? 0) + 1);
  }

  const classifyLink = (link: JsonObject, path: string): EvidenceReference[] => {
    const href = readString(link.href);
    if (href === undefined) return [];
    return [
      classify({
        href,
        path: `${path}/href`,
        rel: readString(link.rel),
        text: readString(link.text),
        resourceFragment: readString(link['resource-fragment']),
      }),
    ];
  };

  const observations = observationNodes.map(({ node, path }): EvidenceObservation => {
    const collected = readString(node.collected);
    const expires = readString(node.expires);
    const evidence = objectsAt(node, 'relevant-evidence', path).map(({ node: entry, path: entryPath }) => {
      const href = classifyLink(entry, entryPath)[0];
      return {
        path: entryPath,
        kind: href === undefined ? ('descriptive' as const) : ('referenced' as const),
        href,
        links: objectsAt(entry, 'links', entryPath).flatMap((link) => classifyLink(link.node, link.path)),
      };
    });
    const subjects = objectsAt(node, 'subjects', path).flatMap(({ node: subject, path: subjectPath }): EvidenceSubject[] => {
      const uuid = readString(subject['subject-uuid']);
      const type = readString(subject.type);
      if (uuid === undefined || type === undefined) return [];
      const uuidPath = `${subjectPath}/subject-uuid`;
      // Ressourcen-Subjekte sind dokumentintern; andere Subjekte liegen im SSP oder in local-definitions.
      const state = type === 'resource'
        ? classifyLocalReference(uuid, uuidPath, resourceUuids, new Set(), 'OSCAL_EVIDENCE_RESOURCE_NOT_FOUND', diagnose)
        : classifyLocalReference(uuid, uuidPath, new Set(), contextUuids, null, diagnose);
      return [{ path: uuidPath, uuid, type, state }];
    });
    return {
      path,
      uuid: readString(node.uuid),
      methods: vocabulary(node.methods, DOCUMENTED_METHODS),
      types: vocabulary(node.types, DOCUMENTED_OBSERVATION_TYPES),
      collected,
      expires,
      validity: validityOf(node.collected, node.expires, at),
      evidence,
      subjects,
    };
  });

  // In AR ist `observation-uuid` dokumentintern, der Kontext darf ein fehlendes Ziel nicht verdecken;
  // im POA&M ist sie eine fachliche UUID-Übernahme aus Assessment Results.
  const observationReferences = deriveObservationReferences({
    rootType,
    containers,
    observationCounts,
    observationUuids,
    resourceUuids,
    documentUuidCounts: input.documentUuidCounts,
    observationContext: input.observationContext,
    contextUuids,
    missingObservationCode: 'OSCAL_EVIDENCE_OBSERVATION_NOT_FOUND',
    diagnose,
  });

  return { rootType, observations, resources, observationReferences, diagnostics };
}
