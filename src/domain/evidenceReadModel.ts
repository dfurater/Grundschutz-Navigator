// =============================================================================
// Evidenz-Read-Model für Assessment Results und POA&M (GSPP-313)
//
// Reine Ableitung aus dem Dokument: kein Speicher, kein Netz, keine Dekodierung
// von base64-Nutzlasten. Gültigkeit kommt ausschließlich aus `collected` und
// `expires`; Referenzen klassifiziert der einzige href-Klassifikator aus
// `referenceResolution.ts`.
// =============================================================================

import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
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
const DATE_TIME_WITH_TIMEZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;

/** Offset-Minuten, die `DateTimeWithTimezoneDatatype` in den gepinnten AR- und POA&M-Schemas zulässt. */
const OFFSET_MINUTES = new Set([0, 30, 45]);

/** `Date.parse` normalisiert unmögliche Angaben wie `2026-02-30`; deshalb vorher jede Komponente prüfen. */
function parseTimestamp(value: unknown): number {
  const match = typeof value === 'string' ? DATE_TIME_WITH_TIMEZONE.exec(value) : null;
  if (match === null) return Number.NaN;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offsetHour = Number(match[9] ?? 0);
  const offsetMinute = Number(match[10] ?? 0);
  const calendarDay = new Date(Date.UTC(year, month - 1, day));
  const valid =
    calendarDay.getUTCFullYear() === year &&
    calendarDay.getUTCMonth() === month - 1 &&
    calendarDay.getUTCDate() === day &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 14 &&
    OFFSET_MINUTES.has(offsetMinute);
  return valid ? Date.parse(match[0]) : Number.NaN;
}

/** Nimmt die Rohwerte: ein vorhandenes, aber nicht lesbares `expires` ist kein fehlendes. */
function validityOf(collected: unknown, expires: unknown, at: Date): EvidenceValidity {
  if (Number.isNaN(parseTimestamp(collected))) return 'not-evaluable';
  if (expires === undefined) return 'no-expiry-declared';
  const expiresAt = parseTimestamp(expires);
  if (Number.isNaN(expiresAt) || typeof expires !== 'string') return 'not-evaluable';
  if (expiresAt !== at.getTime()) return expiresAt > at.getTime() ? 'current' : 'expired';
  // `Date.parse` kappt unter der Millisekunde; ein Rest > 0 liegt noch nach `at`.
  const subMillisecond = /\.\d{3}(\d+)/.exec(expires)?.[1] ?? '';
  return /[1-9]/.test(subMillisecond) ? 'current' : 'expired';
}

/** OSCAL-UUIDs erlauben beide Schreibweisen der Hexziffern. */
function lowerCaseSet(uuids: Iterable<string>): ReadonlySet<string> {
  return new Set(Array.from(uuids, (uuid) => uuid.toLowerCase()));
}

interface ObjectAt {
  readonly node: JsonObject;
  readonly path: string;
}

function objectsAt(parent: JsonObject, key: string, path: string): ObjectAt[] {
  return readArray(parent[key]).flatMap((node, index) =>
    isJsonObject(node) ? [{ node, path: `${path}/${key}/${index}` }] : [],
  );
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

  /** `missingCode` gesetzt: das Ziel muss im Dokument liegen, sein Fehlen ist ein Datenbefund. */
  const uuidState = (
    uuid: string,
    path: string,
    local: ReadonlySet<string>,
    context: ReadonlySet<string>,
    missingCode: string | null,
  ): UuidReferenceState => {
    const key = uuid.toLowerCase();
    if (local.has(key)) return 'resolved';
    if (context.has(key)) return 'resolved-in-context';
    if (missingCode === null) return 'not-resolvable-in-context';
    diagnose(missingCode, path);
    return 'missing-in-document';
  };

  // Beobachtungen und ihre Bezugsstellen liegen in AR je `result`, im POA&M am Root.
  const containers: ObjectAt[] =
    rootType === 'assessment-results' ? objectsAt(body, 'results', rootPath) : [{ node: body, path: rootPath }];
  const observationNodes = containers.flatMap((container) => objectsAt(container.node, 'observations', container.path));
  const observationUuids = lowerCaseSet(observationNodes.flatMap(({ node }) => readString(node.uuid) ?? []));

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
        ? uuidState(uuid, uuidPath, resourceUuids, new Set(), 'OSCAL_EVIDENCE_RESOURCE_NOT_FOUND')
        : uuidState(uuid, uuidPath, new Set(), contextUuids, null);
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

  // In AR ist `observation-uuid` dokumentintern, der Kontext darf ein fehlendes Ziel nicht verdecken.
  // Im POA&M ist sie eine fachliche UUID-Übernahme aus Assessment Results.
  const isAssessmentResults = rootType === 'assessment-results';
  const observationContext = isAssessmentResults ? new Set<string>() : contextUuids;
  const missingObservationCode = isAssessmentResults ? 'OSCAL_EVIDENCE_OBSERVATION_NOT_FOUND' : null;
  const referrerKeys = isAssessmentResults ? ['findings', 'risks'] : ['poam-items', 'findings', 'risks'];
  const observationReferences = containers.flatMap((container) =>
    referrerKeys.flatMap((key) =>
      objectsAt(container.node, key, container.path).flatMap((referrer) =>
        objectsAt(referrer.node, 'related-observations', referrer.path).flatMap(({ node, path }): UuidReference[] => {
          const uuid = readString(node['observation-uuid']);
          if (uuid === undefined) return [];
          const uuidPath = `${path}/observation-uuid`;
          return [{ path: uuidPath, uuid, state: uuidState(uuid, uuidPath, observationUuids, observationContext, missingObservationCode) }];
        }),
      ),
    ),
  );

  return { rootType, observations, resources, observationReferences, diagnostics };
}
