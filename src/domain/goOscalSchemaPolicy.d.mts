import type { OscalDiagnostic, OscalDiagnosticValidator } from './oscalDiagnostics.d.mts';
import type { OscalRootKey, PinnedOscalVersion } from './oscalVersionMatrix.d.mts';

export declare const GO_OSCAL_VALIDATOR: Readonly<OscalDiagnosticValidator>;

export interface KnownBsiSchemaException {
  readonly artifactKey: string;
  readonly rootType: OscalRootKey;
  readonly oscalVersion: PinnedOscalVersion;
  readonly path: string;
  readonly signature: string;
  readonly continuationEligible: boolean;
  readonly reason: string;
  readonly recordedAt: string;
}

export declare const KNOWN_BSI_SCHEMA_EXCEPTIONS: readonly KnownBsiSchemaException[];

export declare function normalizeGoOscalSchemaErrors(
  validationResult: unknown,
  artifact: {
    artifactKey: string;
    rootType: OscalRootKey;
    oscalVersion: PinnedOscalVersion;
  },
): readonly OscalDiagnostic[];

export declare function evaluateSchemaExceptionPolicy(diagnostics: readonly OscalDiagnostic[]): Readonly<{
  schemaStatus: 'passed' | 'failed';
  continuationAllowed: boolean;
  policyAccepted: boolean;
}>;
