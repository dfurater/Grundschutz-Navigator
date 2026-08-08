// =============================================================================
// Root-Dispatch — Stufe 2 des OSCAL-Validierungsvertrags (GSPP-285)
//
// Genau **eine** Stelle bestimmt den Root-Typ eines OSCAL-Dokuments. Vorher gab
// es keine: `parseCatalog` deutete mit `doc.catalog ? doc.catalog : doc` jedes
// Dokument ohne `catalog`-Key direkt als Katalog — die stille
// Katalog-Interpretation, die docs/OSCAL_VALIDATION.md in Stufe 2 ausdrücklich
// verbietet.
//
// Fail-closed ist die Grundhaltung: im Zweifel ablehnen, nie „bestmöglich"
// interpretieren. Der Dispatch wählt den Schema-Pin aus, **wendet** ihn aber
// nicht an — die Schema-Validierung ist Stufe 3 und nicht Teil dieses Moduls.
// Ebenso wenig ersetzt er Stufe 1: doppelte Member-Namen sind auf einem
// `JSON.parse`-Ergebnis grundsätzlich nicht mehr erkennbar (GSPP-289).
// =============================================================================

import type { OscalDiagnostic, OscalDiagnosticValidator } from '@/domain/oscalDiagnostics';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { OscalDocumentContext } from '@/domain/models';
import type {
  OscalRootKey,
  OscalSchemaPin,
  PinnedOscalVersion,
} from '@/domain/oscalVersionMatrix';
import {
  isKnownOscalRootKey,
  isPinnedOscalVersion,
  resolveSchemaBinding,
  VERSION_MATRIX_DIAGNOSTIC_CODES,
} from '@/domain/oscalVersionMatrix';
import { OSCAL_SCHEMA_DIRECTIVE_KEY } from '@/domain/oscalRootDocument';
import {
  getArtifactByUpstreamPath,
  getExpectedRootType,
} from '@/domain/sourceRegistry';

/** Stufe dieses Prüfers im Validierungsvertrag. */
export const ROOT_DISPATCH_STAGE = 'root-dispatch' as const;

/**
 * Der Prüfer selbst ist projekteigen — Stufe 2 verwendet kein externes
 * Werkzeug. Die Version ist die Vertragsversion dieses Moduls und geht in
 * jede Diagnosesignatur ein; sie wird erhöht, wenn sich Codes, Pfade oder
 * Parameter einer bestehenden Diagnose ändern.
 */
export const ROOT_DISPATCH_VALIDATOR: OscalDiagnosticValidator = Object.freeze({
  name: 'gspp-root-dispatch',
  version: '1',
});

/**
 * Diagnosen, die ausschließlich in der Root-Erkennung entstehen.
 *
 * Die Codes der Versionsmatrix stehen bewusst **nicht** hier: Sie gehören
 * `VERSION_MATRIX_DIAGNOSTIC_CODES` und werden unverändert durchgereicht. Eine
 * Kopie würde zwei Orte für denselben Vertrag schaffen.
 */
export const ROOT_DISPATCH_DIAGNOSTIC_CODES = Object.freeze({
  /** Top-Level ist kein JSON-Objekt — `null`, Array, String oder Zahl. */
  DOCUMENT_NOT_OBJECT: 'OSCAL_DOCUMENT_NOT_OBJECT',
  /** Kein Root-Key vorhanden. */
  ROOT_KEY_MISSING: 'OSCAL_ROOT_KEY_MISSING',
  /** Mehr als ein Root-Key — auch dann, wenn einer davon bekannt ist. */
  ROOT_KEY_AMBIGUOUS: 'OSCAL_ROOT_KEY_AMBIGUOUS',
  /** Gefundener Root widerspricht der Erwartung des Quellregisters. */
  ROOT_TYPE_MISMATCH: 'OSCAL_ROOT_TYPE_MISMATCH',
  /** Root ist bekannt, aber kein Modelladapter ist registriert. */
  ROOT_TYPE_UNSUPPORTED: 'OSCAL_ROOT_TYPE_UNSUPPORTED',
});

export interface OscalRootDispatchSuccess {
  readonly ok: true;
  readonly rootType: OscalRootKey;
  readonly oscalVersion: PinnedOscalVersion;
  /** Der ausgewählte, noch nicht angewandte Schema-Pin (Stufe 3). */
  readonly pin: OscalSchemaPin;
  /** Der unveränderte Root-Körper — Einstieg des Modelladapters. */
  readonly body: unknown;
  /** Das unveränderte Gesamtdokument (ADR-2 §1). */
  readonly source: unknown;
  /** Der übergebene Kontext, unverändert mitgeführt. */
  readonly context: OscalDocumentContext;
  /** Registry-Schlüssel des Artefakts, sofern der Kontext ihn auflöst. */
  readonly artifactKey: string | null;
}

export interface OscalRootDispatchFailure {
  readonly ok: false;
  readonly diagnostic: OscalDiagnostic;
}

export type OscalRootDispatchResult = OscalRootDispatchSuccess | OscalRootDispatchFailure;

/** Fehler mit angehängter Diagnose; die Meldung nennt nur den stabilen Code. */
export class OscalRootDispatchError extends Error {
  readonly diagnostic: OscalDiagnostic;

  constructor(diagnostic: OscalDiagnostic) {
    super(`OSCAL-Root-Dispatch abgewiesen: ${diagnostic.code}`);
    this.name = 'OscalRootDispatchError';
    this.diagnostic = diagnostic;
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Liest `metadata.oscal-version` aus einem Root-Körper.
 *
 * Nur ein String zählt als Angabe. Ein Nicht-String wird nicht nach String
 * konvertiert — eine Koerzierung würde unvertrauenswürdige Eingabe in eine
 * scheinbare Versionsangabe verwandeln. Er führt deshalb wie ein fehlendes
 * Feld zu `OSCAL_VERSION_MISSING`.
 */
function readDeclaredOscalVersion(body: unknown): string | undefined {
  if (!isJsonObject(body)) return undefined;
  const metadata = body.metadata;
  if (!isJsonObject(metadata)) return undefined;
  const declared = metadata['oscal-version'];
  return typeof declared === 'string' ? declared : undefined;
}

/**
 * Struktureller JSON Pointer je Versionsdiagnose. Der Root-Key ist hier immer
 * bereits als bekannt geprüft und damit kein unvertrauenswürdiges Segment.
 */
function pathForBindingFailure(code: string, rootType: OscalRootKey): string {
  return code === VERSION_MATRIX_DIAGNOSTIC_CODES.SCHEMA_DIRECTIVE_CONFLICT
    ? `/${OSCAL_SCHEMA_DIRECTIVE_KEY}`
    : `/${rootType}/metadata/oscal-version`;
}

/**
 * `resolveSchemaBinding()` liefert bei `OSCAL_ROOT_VERSION_IMPOSSIBLE` und
 * `OSCAL_ROOT_VERSION_UNSUPPORTED` den rohen, nur gegen die Versionsform
 * geprüften Dokumentwert zurück — er kann jede syntaktisch gültige, aber
 * nicht gepinnte Zahl sein. `artifact.oscalVersion` darf laut Redaction-Regel
 * ausschließlich aus einer geschlossenen Menge stammen; hier ist das
 * `PINNED_OSCAL_VERSIONS`. Kein Mitglied dieser Menge wird durch `null`
 * ersetzt, statt den Dokumentwert durchzureichen.
 */
function toRedactedOscalVersion(oscalVersion: string | null): PinnedOscalVersion | null {
  return oscalVersion !== null && isPinnedOscalVersion(oscalVersion) ? oscalVersion : null;
}

/**
 * Erkennt den Root-Typ eines geparsten OSCAL-Dokuments und bindet ihn
 * gemeinsam mit der deklarierten `oscal-version` an einen gepinnten
 * Schema-Vertrag.
 *
 * Prüfreihenfolge: Top-Level-Objekt, Root-Key-Anzahl, bekannter Root,
 * Registry-Erwartung, dann Versionsbindung. Sie ist bewusst festgelegt, damit
 * ein Dokument die inhaltlich engste Diagnose erhält.
 *
 * @param source Ergebnis von `JSON.parse` über das OSCAL-Dokument
 * @param context Ableitungskontext; trägt unter anderem die Vertrauensklasse
 */
export function dispatchOscalDocument(
  source: unknown,
  context: OscalDocumentContext,
): OscalRootDispatchResult {
  const artifactKey = context.upstreamPath
    ? (getArtifactByUpstreamPath(context.upstreamPath)?.artifactKey ?? null)
    : null;

  const reject = (
    code: string,
    path: string,
    artifact?: { rootType?: OscalRootKey | null; oscalVersion?: string | null },
    params?: Readonly<Record<string, string | number>>,
  ): OscalRootDispatchFailure => ({
    ok: false,
    diagnostic: createOscalDiagnostic({
      code,
      stage: ROOT_DISPATCH_STAGE,
      validator: ROOT_DISPATCH_VALIDATOR,
      path,
      artifact: { key: artifactKey, ...artifact },
      params,
    }),
  });

  const codes = ROOT_DISPATCH_DIAGNOSTIC_CODES;

  if (!isJsonObject(source)) {
    return reject(codes.DOCUMENT_NOT_OBJECT, '/');
  }

  // `$schema` ist die einzige zusätzlich zulässige Top-Level-Property und
  // zählt deshalb nicht als zweiter Root.
  const rootKeys = Object.keys(source).filter((key) => key !== OSCAL_SCHEMA_DIRECTIVE_KEY);

  if (rootKeys.length === 0) {
    return reject(codes.ROOT_KEY_MISSING, '/');
  }
  if (rootKeys.length > 1) {
    // Die Anzahl ist strukturell und damit zulässig; die Keys selbst sind
    // unvertrauenswürdige Eingabe und werden nicht genannt.
    return reject(codes.ROOT_KEY_AMBIGUOUS, '/', undefined, { rootKeyCount: rootKeys.length });
  }

  const rootKey = rootKeys[0];

  if (!isKnownOscalRootKey(rootKey)) {
    // Der Code gehört der Versionsmatrix und wird von dort bezogen, nicht
    // nachgebaut. Der unbekannte Key ist selbst unvertrauenswürdige Eingabe
    // und bleibt deshalb aus Pfad, Artefaktkontext und Parametern heraus.
    return reject(VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_TYPE_UNKNOWN, '/');
  }

  const expectedRootType = context.upstreamPath
    ? getExpectedRootType(context.upstreamPath)
    : null;
  if (expectedRootType !== null && expectedRootType !== rootKey) {
    // Beide Werte stammen aus geschlossenen Mengen: Registry-Erwartung und
    // bekannter Root-Key.
    return reject(codes.ROOT_TYPE_MISMATCH, '/', { rootType: rootKey }, {
      expected: expectedRootType,
      found: rootKey,
    });
  }

  const body = source[rootKey];
  const schemaDirective = Object.hasOwn(source, OSCAL_SCHEMA_DIRECTIVE_KEY)
    // Bewusster Cast: Die Direktive ist unvalidierte Eingabe. Nur `undefined`
    // bedeutet „nicht vorhanden"; jeden anderen Wert prüft
    // `resolveSchemaBinding` selbst und lehnt ihn fail-closed ab.
    ? (source[OSCAL_SCHEMA_DIRECTIVE_KEY] as string)
    : undefined;

  const binding = resolveSchemaBinding({
    rootType: rootKey,
    oscalVersion: readDeclaredOscalVersion(body),
    schemaDirective,
  });

  if (!binding.ok) {
    // `expected` stammt aus der Matrix — gepinnte Versionsliste, Schema-`$id`
    // oder Mindestversion — und ist damit projekteigene Konstante, kein
    // Dokumentwert.
    return reject(
      binding.code,
      pathForBindingFailure(binding.code, rootKey),
      { rootType: binding.rootType, oscalVersion: toRedactedOscalVersion(binding.oscalVersion) },
      binding.expected === undefined ? undefined : { expected: binding.expected },
    );
  }

  return {
    ok: true,
    rootType: rootKey,
    oscalVersion: binding.pin.oscalVersion,
    pin: binding.pin,
    body,
    source,
    context,
    artifactKey,
  };
}

/** Wie `dispatchOscalDocument`, wirft aber statt ein Ergebnis zurückzugeben. */
export function dispatchOscalDocumentOrThrow(
  source: unknown,
  context: OscalDocumentContext,
): OscalRootDispatchSuccess {
  const result = dispatchOscalDocument(source, context);
  if (!result.ok) {
    throw new OscalRootDispatchError(result.diagnostic);
  }
  return result;
}
