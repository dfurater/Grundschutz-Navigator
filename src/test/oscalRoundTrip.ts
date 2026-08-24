// =============================================================================
// Modellübergreifender No-op-Round-trip-Harnisch (GSPP-298, ADR-2)
//
// Testwerkzeug, keine Produktionsschnittstelle. Ein Lauf beweist für ein
// OSCAL-Dokument: Ein Round-trip ohne fachlichen Schreibvorgang verändert
// nichts — weder auf der Serialisierung noch auf dem geparsten Graphen.
//
// Der Harnisch definiert nichts Neuem, was der Validierungsvertrag bereits
// entscheidet: Ressourcenlimits kommen aus `oscalResourceLimits.ts`
// (Stufe 1), Root-Erkennung und Versionsbindung aus `dispatchOscalDocument()`
// beziehungsweise `resolveSchemaBinding()` (Stufe 2), Schemaprüfung aus
// `validateAgainstPinnedSchema()` (Stufe 3) und Referenzklassifikation aus
// `referenceResolution.ts` (Stufe 5, nur Katalogpfad).
//
// Zwei Vergleichsebenen (Befund 7): Die byte-identische Serialisierung ist
// blind für `Infinity` und `-0`; deshalb läuft zusätzlich ein Vergleich auf
// dem geparsten Graphen mit `Object.is`-Semantik. Beide Ebenen verbindlich.
// =============================================================================

import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { OscalDocumentContext } from '@/domain/models';
import { enforceClass2ResourceLimits } from '@/domain/oscalResourceLimits';
import {
  CLASS_2_IMPORT_LIMITS,
  createClass2ByteLimitDiagnostic,
} from '@/domain/oscalImportContract';
import {
  dispatchOscalDocument,
  type OscalRootDispatchSuccess,
} from '@/adapters/oscalRootDispatch';
import { MAPPING_RELATIONSHIPS } from '@/domain/mappingModel';
import {
  createReferenceDocument,
  resolveCatalogControlReferences,
  resolveCatalogMetadataReferences,
  resolveCatalogResources,
  type ReferenceDocument,
} from '@/domain/referenceResolution';
import { validateAgainstPinnedSchema } from '@/domain/oscalSchemaValidation';
import type { CatalogKey } from '@/domain/sourceRegistry';
import type { OscalSchemaPin } from '@/domain/oscalVersionMatrix';
import { compareJsonGraphs, type JsonGraphDifference } from './oscalGraphCompare';

/**
 * Vertrauensklasse des Harnischs. Die Fixtures sind projekteigene Testdaten;
 * sie durchlaufen bewusst denselben fail-closed Dispatch wie lokale
 * Klasse-2-Eingaben.
 */
const HARNESS_TRUST_CLASS = 'class-2-local-user' as const;

/** Die Laufart dieses Moduls. Das Edit-Folge-Issue ergänzt hier additiv. */
export const ROUND_TRIP_RUN_MODES = Object.freeze(['no-op'] as const);

export type OscalRoundTripRunMode = (typeof ROUND_TRIP_RUN_MODES)[number];

export interface OscalRoundTripStatusPassed {
  readonly status: 'passed';
}
export interface OscalRoundTripStatusFailed {
  readonly status: 'failed';
  readonly diagnostic?: OscalDiagnostic;
}
export interface OscalRoundTripStatusNotRun {
  readonly status: 'not-run';
}

export type OscalRoundTripBinding =
  | { readonly ok: true; readonly pin: OscalSchemaPin }
  | { readonly ok: false; readonly reason: 'limits-not-run' }
  | {
    readonly ok: false;
    readonly reason: 'dispatch-rejected';
    readonly diagnostic: OscalDiagnostic;
  };

/** Terminale Laufzustände der Vergleichs- und Identitätsebene. */
export type OscalRoundTripOutcome = 'passed' | 'failed' | 'not-run';

export interface OscalRoundTripGraphReport {
  readonly status: OscalRoundTripOutcome;
  readonly differences: readonly JsonGraphDifference[];
}

export interface OscalRoundTripIdentityReport {
  readonly status: OscalRoundTripOutcome;
  /** Stabile Befundkennungen, keine Dokumentwerte. */
  readonly findings: readonly string[];
}

/**
 * Stufe 3 — JSON-Schema gegen die von Stufe 2 gebundene Matrixzelle.
 * Die Begriffe folgen der verbindlichen Kette in docs/OSCAL_VALIDATION.md.
 */
export interface OscalStageSchemaValidationReport {
  readonly stage: 'json-schema';
  readonly status: OscalRoundTripOutcome;
  readonly diagnostic?: OscalDiagnostic;
}

/** Verweis auf den Vertragstext der dokumentierten Lücke. */
const CONSTRAINT_STAGE_REFERENCE = 'docs/OSCAL_VALIDATION.md';

/** Stabile Kennung des bekannten pendierenden Constraint-Falls. */
const PENDING_CASE_MAP_RELATIONSHIP = 'map-relationship-token';

/**
 * Stufe 4 — zusätzliche OSCAL-Constraints.
 *
 * Es gibt keinen zugelassenen Constraint-Validator (GSPP-282, ADR-5,
 * GSPP-336). Die Stufe ist daher terminally `not-checked`, sobald Stufe 3
 * gelaufen ist — niemals `passed`. `pendingCases` benennt Fälle im Dokument,
 * die genau diese Lücke betreffen; ein erfundener `map/relationship`-Token
 * ist schema-valide und würde nur hier sichtbar.
 */
export interface OscalStageConstraintsReport {
  readonly stage: 'oscal-constraint';
  readonly status: 'not-checked' | 'not-run';
  readonly documentedGap: true;
  readonly reference: string;
  readonly pendingCases: readonly string[];
}

/** Stufe 5 — Referenzen; heute ausschließlich am Katalogpfad umgesetzt. */
export interface OscalStageReferencesReport {
  readonly stage: 'reference';
  readonly status: 'passed' | 'failed' | 'not-run' | 'not-available';
  readonly reason?: string;
  readonly diagnostic?: OscalDiagnostic;
}

export interface OscalRoundTripStages {
  readonly schemaValidation: OscalStageSchemaValidationReport;
  readonly constraints: OscalStageConstraintsReport;
  readonly references: OscalStageReferencesReport;
}

/**
 * Erzwingt die dokumentierte Constraint-Lücke gegen stille Erosion
 * (GSPP-282): Ein Ergebnis, das die Constraint-Stufe als geprüft meldet,
 * ist fehlerhaft — es gibt keinen zugelassenen Validator.
 */
export function assertConstraintGapDocumented(
  result: { readonly stages?: { readonly constraints?: { readonly status?: string } } },
): void {
  const status = result.stages?.constraints?.status;
  if (status !== 'not-checked') {
    throw new Error(
      `Die Constraint-Stufe bleibt terminal "not-checked"; gemeldet wurde "${String(status)}". Es existiert kein zugelassener Constraint-Validator (GSPP-282, ADR-5, GSPP-336).`,
    );
  }
}

/**
 * Findet Fälle im Dokument, deren Prüfung ausschließlich der fehlenden
 * Constraint-Stufe obläge. Der bekannte Fall ist ein `map/relationship`-Token
 * außerhalb des Vokabulars — nach Schema valide, inhaltlich aber unbeprüft.
 */
function collectConstraintPendingCases(source: unknown): string[] {
  if (!isJsonObject(source)) return [];
  const body = Object.values(source).find(isJsonObject);
  if (!body || !Array.isArray(body.mappings)) return [];

  const pending = new Set<string>();
  for (const mapping of body.mappings) {
    if (!isJsonObject(mapping) || !Array.isArray(mapping.maps)) continue;
    for (const map of mapping.maps) {
      if (!isJsonObject(map)) continue;
      const relationship = map.relationship;
      if (typeof relationship === 'string'
        && !MAPPING_RELATIONSHIPS.includes(relationship as never)) {
        pending.add(PENDING_CASE_MAP_RELATIONSHIP);
      }
    }
  }
  return [...pending];
}

/**
 * Alle Referenzziele des Katalogdokuments als einen Strom — Metadaten-Links,
 * Control-Links und Rlinks der Back-matter-Ressourcen.
 */
function* iterateCatalogReferenceTargets(
  referenceDocument: ReferenceDocument,
): Generator<unknown> {
  yield* resolveCatalogMetadataReferences({ document: referenceDocument });
  for (const references of resolveCatalogControlReferences({
    document: referenceDocument,
  }).values()) {
    yield* references;
  }
  for (const resource of resolveCatalogResources({ document: referenceDocument })) {
    for (const rlink of resource.rlinks) yield rlink.target;
  }
}

type UnsafeProtocolTarget = { readonly diagnostic?: OscalDiagnostic };

function isUnsafeProtocolTarget(target: unknown): target is UnsafeProtocolTarget {
  return typeof target === 'object' && target !== null && 'reason' in target
    && (target as { reason?: unknown }).reason === 'unsafe-protocol';
}

/** Sammelt Stufe 5 über die drei Katalogauflösungen; fail-closed bei unsicheren Protokollen. */
function evaluateCatalogReferences(
  referenceDocument: ReferenceDocument,
): OscalStageReferencesReport {
  for (const target of iterateCatalogReferenceTargets(referenceDocument)) {
    if (isUnsafeProtocolTarget(target)) {
      return target.diagnostic
        ? { stage: 'reference', status: 'failed', diagnostic: target.diagnostic }
        : { stage: 'reference', status: 'failed' };
    }
  }
  return { stage: 'reference', status: 'passed' };
}

export interface OscalNoOpRunResult {
  readonly mode: OscalRoundTripRunMode;
  /**
   * Der **abgeleitete** Root-Typ aus Stufe 2 — nie der vom Aufrufer behauptete.
   * Solange die Kette keinen gebundenen Root kennt (Limits, unbekannter Root),
   * ist er `null`.
   */
  readonly rootType: string | null;
  readonly resourceLimit: OscalRoundTripStatusPassed | OscalRoundTripStatusFailed
  | OscalRoundTripStatusNotRun;
  readonly binding: OscalRoundTripBinding;
  readonly serialization:
  | OscalRoundTripStatusPassed
  | OscalRoundTripStatusFailed
  | OscalRoundTripStatusNotRun;
  readonly graph: OscalRoundTripGraphReport;
  readonly identities: OscalRoundTripIdentityReport;
  readonly stages: OscalRoundTripStages;
}

export interface OscalNoOpRunInput {
  /**
   * Der Fixture als JSON-Quelltext. Nur so existiert eine Byte-Ebene, deren
   * Grenze vor dem Parsen greift; verglichen wird gegen die Quellbytes nie.
   */
  readonly fixtureText: string;
  /**
   * Exportiert das geparste Original in sein Ausgabeartefakt. Vorgabe ist die
   * Identität — der heutige Zustand ohne Exportpfad. Künftige Serializer
   * reichen ihre Funktion hier ein, ohne den No-op-Pfad zu ändern. Die
   * Validierungsstufen 3–5 prüfen das **reimportierte Exportartefakt**, nicht
   * die Eingabe.
   */
  readonly exportDocument?: (parsed: unknown) => unknown;
  /**
   * Optionaler Registry-Pfad für eine artefaktscharfe Stufe 2: Der Dispatch
   * prüft dann den gefundenen Root gegen die Registry-Erwartung
   * (`OSCAL_ROOT_TYPE_MISMATCH`) und benennt den Artefaktschlüssel in
   * Diagnosen.
   */
  readonly upstreamPath?: string;
  /** Katalogidentität — fließt in Stufe 2 und die kataloggescopte Zuordnung ein. */
  readonly catalogKey?: CatalogKey;
}

const FINDING_DOCUMENT_UUID_CHANGED = 'document-uuid-changed';
const FINDING_LAST_MODIFIED_CHANGED = 'last-modified-changed';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Liest die Identitätsfelder eines Dokuments ohne sie zu verändern. */
export function readDocumentIdentities(parsed: unknown): {
  documentUuid: string | null;
  lastModified: string | null;
} {
  if (!isJsonObject(parsed)) return { documentUuid: null, lastModified: null };
  const body = Object.values(parsed).find(isJsonObject);
  if (!body) return { documentUuid: null, lastModified: null };
  const metadata = isJsonObject(body.metadata) ? body.metadata : null;
  return {
    documentUuid: typeof body.uuid === 'string' ? body.uuid : null,
    lastModified: metadata && typeof metadata['last-modified'] === 'string'
      ? metadata['last-modified']
      : null,
  };
}

/**
 * Identitäten eines Katalogdokuments mit ihrer OSCAL-Eindeutigkeitsregel.
 *
 * `control/@id` ist nur lokal eindeutig (`identifier-uniqueness="local"`);
 * eine Control ist deshalb ausschließlich als Paar aus Katalog und ID
 * adressierbar. `group/@id` folgt der Instanzregel — sie wird ohne
 * Katalogbezug gesammelt, weil sie ohnehin nur innerhalb einer Instanz
 * eindeutig ist.
 */
export interface ScopedControlIdentity {
  readonly scope: 'catalog';
  readonly catalogKey: string;
  readonly controlId: string;
}

export interface ScopedGroupIdentity {
  readonly scope: 'instance';
  readonly groupId: string;
}

export interface ScopedIdentities {
  readonly documentUuid: string | null;
  readonly lastModified: string | null;
  readonly controls: readonly ScopedControlIdentity[];
  readonly groups: readonly ScopedGroupIdentity[];
}

function readControlId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function visitControlsForIdentities(
  controls: readonly unknown[],
  catalogKey: string,
  identities: { controls: ScopedControlIdentity[] },
): void {
  for (const control of controls) {
    if (!isJsonObject(control)) continue;
    const controlId = readControlId(control.id);
    if (controlId !== null) {
      identities.controls.push({ scope: 'catalog', catalogKey, controlId });
    }
    if (Array.isArray(control.controls)) {
      visitControlsForIdentities(control.controls, catalogKey, identities);
    }
  }
}

function visitGroupsForIdentities(
  groups: readonly unknown[],
  catalogKey: string,
  identities: { controls: ScopedControlIdentity[]; groups: ScopedGroupIdentity[] },
): void {
  for (const group of groups) {
    if (!isJsonObject(group)) continue;
    const groupId = readControlId(group.id);
    if (groupId !== null) {
      identities.groups.push({ scope: 'instance', groupId });
    }
    if (Array.isArray(group.controls)) {
      visitControlsForIdentities(group.controls, catalogKey, identities);
    }
    if (Array.isArray(group.groups)) {
      visitGroupsForIdentities(group.groups, catalogKey, identities);
    }
  }
}

/** Sammelt die kataloggescopten Control- und instanzlokalen Gruppen-Identitäten. */
export function collectScopedIdentities(
  parsed: unknown,
  { catalogKey }: { catalogKey?: string } = {},
): ScopedIdentities {
  const base = readDocumentIdentities(parsed);
  const collected: { controls: ScopedControlIdentity[]; groups: ScopedGroupIdentity[] } = {
    controls: [],
    groups: [],
  };

  if (catalogKey !== undefined && isJsonObject(parsed)) {
    const body = Object.values(parsed).find(isJsonObject);
    if (body) {
      if (Array.isArray(body.controls)) {
        visitControlsForIdentities(body.controls, catalogKey, collected);
      }
      if (Array.isArray(body.groups)) {
        visitGroupsForIdentities(body.groups, catalogKey, collected);
      }
    }
  }

  return Object.freeze({
    ...base,
    controls: Object.freeze(collected.controls),
    groups: Object.freeze(collected.groups),
  });
}

export interface OscalDocumentIdentityEntry {
  readonly parsed: unknown;
  readonly catalogKey?: string;
}

/**
 * Index über mehreren Dokumentinstanzen.
 *
 * Die Control-Auflösung überschreitet nie die Kataloggrenze: identische
 * `control/@id` in zwei Katalogen bleiben zwei getrennte Einträge. Gruppen
 * werden je Instanz geführt; ihre IDs dürfen über Instanzen kollidieren.
 */
export interface ScopedIdentityIndex {
  resolveControlIdentity(
    catalogKey: string,
    controlId: string,
  ): ScopedControlIdentity | null;
  listControlIdentities(): readonly ScopedControlIdentity[];
  listGroupIdentities(): readonly ScopedGroupIdentity[];
}

export function buildScopedIdentityIndex(
  entries: readonly OscalDocumentIdentityEntry[],
): ScopedIdentityIndex {
  const perDocument = entries.map((entry) => ({
    catalogKey: entry.catalogKey,
    identities: collectScopedIdentities(entry.parsed, { catalogKey: entry.catalogKey }),
  }));

  return Object.freeze({
    resolveControlIdentity(catalogKey: string, controlId: string): ScopedControlIdentity | null {
      for (const document of perDocument) {
        if (document.catalogKey !== catalogKey) continue;
        const match = document.identities.controls.find(
          (identity) => identity.controlId === controlId,
        );
        if (match) return match;
      }
      return null;
    },
    listControlIdentities(): readonly ScopedControlIdentity[] {
      return perDocument.flatMap((document) => document.identities.controls);
    },
    listGroupIdentities(): readonly ScopedGroupIdentity[] {
      return perDocument.flatMap((document) => document.identities.groups);
    },
  });
}

function compareIdentities(
  before: ReturnType<typeof readDocumentIdentities>,
  after: ReturnType<typeof readDocumentIdentities>,
): string[] {
  const findings: string[] = [];
  if (before.documentUuid !== after.documentUuid) {
    findings.push(FINDING_DOCUMENT_UUID_CHANGED);
  }
  if (before.lastModified !== after.lastModified) {
    findings.push(FINDING_LAST_MODIFIED_CHANGED);
  }
  return findings;
}

function deepFreeze<T>(node: T): T {
  if (Array.isArray(node)) {
    for (const entry of node) deepFreeze(entry);
    return Object.freeze(node);
  }
  if (isPlainObjectRecord(node)) {
    for (const key of Object.keys(node)) deepFreeze((node as Record<string, unknown>)[key]);
  }
  return Object.freeze(node);
}

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** Alle Stufen unterhalb eines Fehlers erhalten den terminalen Status `not-run`. */
function stagesNotRun(): OscalRoundTripStages {
  return {
    schemaValidation: { stage: 'json-schema', status: 'not-run' },
    constraints: {
      stage: 'oscal-constraint',
      status: 'not-run',
      documentedGap: true,
      reference: CONSTRAINT_STAGE_REFERENCE,
      pendingCases: [],
    },
    references: { stage: 'reference', status: 'not-run' },
  };
}

/**
 * Formatiert Graph-Differenzen für die CI-Ausgabe.
 *
 * Redaction nach dem Diagnosevertrag: Pfade und Wertarten sind zulässig,
 * Dokumentwerte niemals — ein Marker-Wert aus dem Dokument kann in einer
 * fehlschlagenden Ausgabe nicht erscheinen.
 */
export function formatRoundTripDifferences(
  differences: readonly JsonGraphDifference[],
): string[] {
  return differences.map((difference) =>
    `${difference.path}: ${difference.kind} (${difference.leftKind} → ${difference.rightKind})`,
  );
}

/** Ergebnisrahmen eines Laufs, dessen Kette vor Stufe 2 endet. */
function rejectionBeforeBinding(
  resourceLimit: OscalRoundTripStatusFailed,
): OscalNoOpRunResult {
  return deepFreeze({
    mode: 'no-op',
    rootType: null,
    resourceLimit,
    binding: { ok: false, reason: 'limits-not-run' },
    serialization: { status: 'not-run' },
    graph: { status: 'not-run', differences: [] },
    identities: { status: 'not-run', findings: [] },
    stages: stagesNotRun(),
  });
}

/** Ergebnisrahmen eines Laufs, den Stufe 2 abgewiesen hat. */
function dispatchRejectionResult(
  diagnostic: OscalDiagnostic,
): OscalNoOpRunResult {
  return deepFreeze({
    mode: 'no-op',
    rootType: null,
    resourceLimit: { status: 'passed' },
    binding: { ok: false, reason: 'dispatch-rejected', diagnostic },
    serialization: { status: 'not-run' },
    graph: { status: 'not-run', differences: [] },
    identities: { status: 'not-run', findings: [] },
    stages: stagesNotRun(),
  });
}

/**
 * Stufen 3–5 gegen das **reimportierte Exportartefakt** — nicht gegen die
 * Eingabe. Nur so certifieren die Status tatsächlich das Dokument, das den
 * Prozess verlässt. Stufe 4 bleibt terminal `not-checked`; Stufe 5 läuft nur
 * nach bestandener Stufe 3 und ausschließlich am Katalogpfad.
 */
async function evaluateStages(
  reBound: OscalRootDispatchSuccess,
  catalogKey: CatalogKey | undefined,
): Promise<OscalRoundTripStages> {
  const schemaResult = await validateAgainstPinnedSchema(reBound.source, reBound.pin);

  let referencesReport: OscalStageReferencesReport;
  if (!schemaResult.ok) {
    referencesReport = { stage: 'reference', status: 'not-run' };
  } else if (reBound.rootType !== 'catalog') {
    referencesReport = {
      stage: 'reference',
      status: 'not-available',
      reason: 'catalog-only-implementation',
    };
  } else {
    referencesReport = evaluateCatalogReferences(createReferenceDocument({
      source: reBound.source,
      context: catalogKey === undefined
        ? { trustClass: HARNESS_TRUST_CLASS }
        : { trustClass: HARNESS_TRUST_CLASS, catalogKey },
      rootType: 'catalog',
      oscalVersion: reBound.pin.oscalVersion,
    }));
  }

  return {
    schemaValidation: schemaResult.ok
      ? { stage: 'json-schema', status: 'passed' }
      : { stage: 'json-schema', status: 'failed', diagnostic: schemaResult.diagnostic },
    constraints: {
      stage: 'oscal-constraint',
      status: 'not-checked',
      documentedGap: true,
      reference: CONSTRAINT_STAGE_REFERENCE,
      pendingCases: collectConstraintPendingCases(reBound.source),
    },
    references: referencesReport,
  };
}

/**
 * Export, beide Vergleichsebenen, Identitätsprüfung und anschließende
 * Stufenprüfung des reimportierten Exportartefakts nach bestandener Bindung.
 */
async function successfulNoOpResult(
  input: OscalNoOpRunInput,
  success: OscalRootDispatchSuccess,
): Promise<OscalNoOpRunResult> {
  // Export — Identität als Vorgabe, einspeisbar für künftige Serializer.
  const exported = input.exportDocument ? input.exportDocument(success.source) : success.source;

  // Ebene 1 — byte-identische Serialisierung.
  const exportBytes = JSON.stringify(exported);
  const serializationEqual = exportBytes === JSON.stringify(success.source);

  // Ebene 2 — geparster Graph mit Object.is-Semantik.
  const imported = JSON.parse(exportBytes);
  const differences = compareJsonGraphs(success.source, imported);

  const identityFindings = compareIdentities(
    readDocumentIdentities(success.source),
    readDocumentIdentities(imported),
  );

  // Stufen 3–5 gegen die **erneut gebundene** Exportartefakt-Bindung: Ein
  // Export darf das Modell wechseln — dann muss auch Root-, Versions- und
  // Schema-Kontext dem Exportartefakt folgen, nicht der Eingabe.
  const exportContext: OscalDocumentContext = {
    trustClass: HARNESS_TRUST_CLASS,
    ...(input.upstreamPath !== undefined ? { upstreamPath: input.upstreamPath } : {}),
    ...(input.catalogKey !== undefined ? { catalogKey: input.catalogKey } : {}),
  };
  const reBound = dispatchOscalDocument(imported, exportContext);
  let stages: OscalRoundTripStages;
  if (!reBound.ok) {
    // Die Re-Bindung ist Teil des Exportnachweises: Ihre Ablehnung fällt in
    // die Stufe vor dem Schema und hält Stufe 5 not-run.
    stages = {
      schemaValidation: {
        stage: 'json-schema',
        status: 'failed',
        diagnostic: reBound.diagnostic,
      },
      constraints: {
        stage: 'oscal-constraint',
        status: 'not-checked',
        documentedGap: true,
        reference: CONSTRAINT_STAGE_REFERENCE,
        pendingCases: collectConstraintPendingCases(imported),
      },
      references: { stage: 'reference', status: 'not-run' },
    };
  } else {
    stages = await evaluateStages(reBound, input.catalogKey);
  }

  return deepFreeze({
    mode: 'no-op',
    rootType: success.rootType,
    resourceLimit: { status: 'passed' },
    binding: { ok: true, pin: success.pin },
    serialization: serializationEqual ? { status: 'passed' } : { status: 'failed' },
    graph: differences.length === 0
      ? ({ status: 'passed', differences } satisfies OscalRoundTripGraphReport)
      : ({ status: 'failed', differences } satisfies OscalRoundTripGraphReport),
    identities: {
      status: identityFindings.length === 0 ? 'passed' : 'failed',
      findings: identityFindings,
    },
    stages,
  });
}

/**
 * Führt genau einen No-op-Round-trip aus.
 *
 * Reihenfolge nach docs/OSCAL_VALIDATION.md: Bytelimit vor dem Parsen,
 * strukturelle Limits auf dem geparsten Wert, dann Root-Erkennung und
 * Versionsbindung. Erst nach bestandener Bindung laufen Export, beide
 * Vergleichsebenen und die Identitätsprüfung.
 */
export async function runNoOpRoundTrip(input: OscalNoOpRunInput): Promise<OscalNoOpRunResult> {
  // Stufe 1a — Byte-Eingangsgrenze vor dem Parsen.
  if (utf8ByteLength(input.fixtureText) > CLASS_2_IMPORT_LIMITS.maxBytes) {
    return rejectionBeforeBinding({
      status: 'failed',
      diagnostic: createClass2ByteLimitDiagnostic(),
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.fixtureText);
  } catch {
    // Ein nicht parsbarer Fixture ist ein Fehler des Testautors, kein
    // Dokumentbefund: Stufe 1 (Token-Scanner) gehört zur Importpipeline,
    // nicht zum Harnisch.
    throw new SyntaxError('Fixture ist kein wohlgeformtes JSON');
  }

  // Stufe 1b — strukturelle Limits auf dem geparsten Wert.
  const limitViolation = enforceClass2ResourceLimits(parsed);
  if (limitViolation !== null) {
    return rejectionBeforeBinding({ status: 'failed', diagnostic: limitViolation });
  }

  // Stufe 2 — Root-Erkennung und Versionsbindung, bezogen statt nachgebaut.
  // Die Katalogidentität wird mitgeführt und in Stufe 5 konsumiert; ein
  // optionaler Registry-Pfad erzwingt die artefaktscharfe Root-Erwartung.
  const dispatched = dispatchOscalDocument(parsed, {
    trustClass: HARNESS_TRUST_CLASS,
    ...(input.upstreamPath !== undefined ? { upstreamPath: input.upstreamPath } : {}),
    ...(input.catalogKey !== undefined ? { catalogKey: input.catalogKey } : {}),
  });
  if (!dispatched.ok) {
    return dispatchRejectionResult(dispatched.diagnostic);
  }

  return successfulNoOpResult(input, dispatched);
}
