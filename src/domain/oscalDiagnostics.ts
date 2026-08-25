// =============================================================================
// Diagnosemodell des OSCAL-Validierungsvertrags (GSPP-282, GSPP-285)
//
// Der Vertrag in docs/OSCAL_VALIDATION.md schreibt ein maschinenlesbares
// Diagnoseformat vor, das alle fünf Stufen teilen — es entsteht ausdrücklich
// kein zweites Diagnosemodell je Stufe.
//
// Zentral ist die Redaction-Regel: Eine Diagnose wird aus einer Positivliste
// **konstruiert**, nicht aus einem rohen Befund gefiltert. Deshalb nimmt
// `createOscalDiagnostic` keine freien Objekte entgegen, sondern genau die
// freigegebenen Felder — stabiler Code, bekannter Registry-Schlüssel,
// Root/Version, struktureller JSON Pointer, Validatorpin, Signatur,
// Message-Key und ausdrücklich strukturelle Parameter.
// =============================================================================

import type { OscalRootKey } from '@/domain/oscalVersionMatrix';

/**
 * Die stabilen Stufenkennungen des Vertrags. Sie sind Teil der öffentlichen
 * Diagnosesignatur und dürfen sich nicht stillschweigend ändern: die
 * CI-Policy bindet Diagnosen unter anderem über die Stufe.
 */
export const OSCAL_DIAGNOSTIC_STAGES = [
  'resource-limit',
  'json-syntax',
  'object-structure',
  'root-dispatch',
  'json-schema',
  'oscal-constraint',
  'reference',
  'domain',
] as const;

export type OscalDiagnosticStage = (typeof OSCAL_DIAGNOSTIC_STAGES)[number];

/**
 * Der Validator, der die Diagnose erzeugt hat, mit seinem Pin. Für externe
 * Werkzeuge ist das ihre Release-Version; für projekteigene Stufen die
 * Vertragsversion des jeweiligen Prüfers.
 */
export interface OscalDiagnosticValidator {
  readonly name: string;
  readonly version: string;
}

/**
 * Artefaktkontext einer Diagnose. Alle drei Felder stammen aus geschlossenen
 * Mengen — Registry-Schlüssel, bekannter Root-Key, gepinnte Version — und nie
 * aus unvertrauenswürdigem Dokumentinhalt. Unbekanntes wird `null`, nicht
 * durchgereicht.
 */
export interface OscalDiagnosticArtifact {
  readonly key: string | null;
  readonly rootType: OscalRootKey | null;
  readonly oscalVersion: string | null;
}

/** Freigegebene strukturelle Parameter — niemals Dokumentwerte. */
export type OscalDiagnosticParams = Readonly<Record<string, string | number>>;

export interface OscalDiagnostic {
  /** Stabiler Code, z. B. `OSCAL_ROOT_KEY_AMBIGUOUS`. */
  readonly code: string;
  readonly severity: 'error';
  readonly stage: OscalDiagnosticStage;
  readonly artifact: OscalDiagnosticArtifact;
  /** Struktureller JSON Pointer; enthält nie unvertrauenswürdige Segmente. */
  readonly path: string;
  readonly validator: OscalDiagnosticValidator;
  /** `name@version|code|path` — der Matchschlüssel der CI-Policy. */
  readonly signature: string;
  readonly messageKey: string;
  readonly params: OscalDiagnosticParams;
}

/** `root-dispatch` → `rootDispatch`, `OSCAL_VERSION_MISSING` → `versionMissing`. */
function toCamelCase(value: string): string {
  return value.toLowerCase().replace(/[-_](.)/g, (_match, char: string) => char.toUpperCase());
}

/**
 * Leitet den Message-Key deterministisch aus Stufe und Code ab, statt eine
 * zweite Tabelle zu führen: Eine Tabelle würde die Codes duplizieren und
 * könnte von ihnen abdriften.
 */
export function toDiagnosticMessageKey(stage: OscalDiagnosticStage, code: string): string {
  return `oscal.${toCamelCase(stage)}.${toCamelCase(code.replace(/^OSCAL_/, ''))}`;
}

/** `name@version|code|path` — stabil über Läufe und Plattformen hinweg. */
export function toDiagnosticSignature(
  validator: OscalDiagnosticValidator,
  code: string,
  path: string,
): string {
  return `${validator.name}@${validator.version}|${code}|${path}`;
}

/**
 * Baut eine Diagnose aus den freigegebenen Feldern. Message-Key und Signatur
 * werden abgeleitet, damit sie nicht je Aufrufstelle neu erfunden werden.
 */
export function createOscalDiagnostic(input: {
  code: string;
  stage: OscalDiagnosticStage;
  validator: OscalDiagnosticValidator;
  path: string;
  artifact?: Partial<OscalDiagnosticArtifact>;
  params?: OscalDiagnosticParams;
}): OscalDiagnostic {
  return Object.freeze({
    code: input.code,
    severity: 'error' as const,
    stage: input.stage,
    artifact: Object.freeze({
      key: input.artifact?.key ?? null,
      rootType: input.artifact?.rootType ?? null,
      oscalVersion: input.artifact?.oscalVersion ?? null,
    }),
    path: input.path,
    validator: input.validator,
    signature: toDiagnosticSignature(input.validator, input.code, input.path),
    messageKey: toDiagnosticMessageKey(input.stage, input.code),
    params: Object.freeze({ ...input.params }),
  });
}
