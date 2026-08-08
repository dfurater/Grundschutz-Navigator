import type { OscalRootKey } from './oscalVersionMatrix.d.mts';

export declare const OSCAL_DIAGNOSTIC_STAGES: readonly [
  'resource-limit',
  'json-syntax',
  'root-dispatch',
  'json-schema',
  'oscal-constraint',
  'reference',
  'domain',
];

export type OscalDiagnosticStage = (typeof OSCAL_DIAGNOSTIC_STAGES)[number];

export interface OscalDiagnosticValidator {
  readonly name: string;
  readonly version: string;
}

export interface OscalDiagnosticArtifact {
  readonly key: string | null;
  readonly rootType: OscalRootKey | null;
  readonly oscalVersion: string | null;
}

export type OscalDiagnosticParams = Readonly<Record<string, string | number>>;

export interface OscalDiagnostic {
  readonly code: string;
  readonly severity: 'error';
  readonly stage: OscalDiagnosticStage;
  readonly artifact: OscalDiagnosticArtifact;
  readonly path: string;
  readonly validator: OscalDiagnosticValidator;
  readonly signature: string;
  readonly messageKey: string;
  readonly params: OscalDiagnosticParams;
}

export declare function toDiagnosticMessageKey(stage: OscalDiagnosticStage, code: string): string;
export declare function toDiagnosticSignature(
  validator: OscalDiagnosticValidator,
  code: string,
  path: string,
  signatureParts?: readonly string[],
): string;
export declare function createOscalDiagnostic(input: {
  code: string;
  stage: OscalDiagnosticStage;
  validator: OscalDiagnosticValidator;
  path: string;
  artifact?: Partial<OscalDiagnosticArtifact>;
  params?: OscalDiagnosticParams;
  signatureParts?: readonly string[];
}): OscalDiagnostic;
