/**
 * Typdeklarationen für die OSCAL-Versionsmatrix (GSPP-283).
 * Muss mit oscalVersionMatrix.mjs übereinstimmen; die Laufzeitkonsistenz der
 * Unions sichert oscalVersionMatrix.test.ts ab.
 */

export type OscalRootKey =
  | 'catalog'
  | 'profile'
  | 'mapping-collection'
  | 'component-definition'
  | 'system-security-plan'
  | 'assessment-plan'
  | 'assessment-results'
  | 'plan-of-action-and-milestones';

export type PinnedOscalVersion = '1.1.2' | '1.1.3' | '1.2.1' | '1.2.2';

export interface OscalSchemaPin {
  readonly rootKey: OscalRootKey;
  readonly oscalVersion: PinnedOscalVersion;
  /** Asset-Name im NIST-Release. */
  readonly schemaFileName: string;
  /** Herkunft: das NIST-Release-Tag, z. B. `v1.2.2`. */
  readonly releaseTag: string;
  readonly releaseUrl: string;
  /** Erwartete `$id` des Schemas — sein Selbstnachweis. */
  readonly schemaId: string;
  /** Repo-relativer Ablageort der gepinnten Datei. */
  readonly vendorPath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export type VersionMatrixDiagnosticCode =
  | 'OSCAL_ROOT_TYPE_UNKNOWN'
  | 'OSCAL_VERSION_MISSING'
  | 'OSCAL_VERSION_MALFORMED'
  | 'OSCAL_ROOT_VERSION_IMPOSSIBLE'
  | 'OSCAL_ROOT_VERSION_UNSUPPORTED'
  | 'OSCAL_SCHEMA_ID_MISMATCH'
  | 'OSCAL_SCHEMA_HASH_MISMATCH'
  | 'OSCAL_SCHEMA_DIRECTIVE_CONFLICT';

export interface SchemaBindingFailure {
  readonly ok: false;
  readonly code: VersionMatrixDiagnosticCode;
  readonly rootType: OscalRootKey | null;
  readonly oscalVersion: string | null;
  readonly expected?: string;
}

export interface SchemaBindingSuccess {
  readonly ok: true;
  readonly pin: OscalSchemaPin;
}

export type SchemaBindingResult = SchemaBindingSuccess | SchemaBindingFailure;

export declare const OSCAL_ROOT_KEYS: readonly OscalRootKey[];
export declare const PINNED_OSCAL_VERSIONS: readonly PinnedOscalVersion[];
export declare const SCHEMA_VENDOR_DIRECTORY: string;
export declare const VERSION_MATRIX_DIAGNOSTIC_CODES: Readonly<
  Record<
    | 'ROOT_TYPE_UNKNOWN'
    | 'VERSION_MISSING'
    | 'VERSION_MALFORMED'
    | 'ROOT_VERSION_IMPOSSIBLE'
    | 'ROOT_VERSION_UNSUPPORTED'
    | 'SCHEMA_ID_MISMATCH'
    | 'SCHEMA_HASH_MISMATCH'
    | 'SCHEMA_DIRECTIVE_CONFLICT',
    VersionMatrixDiagnosticCode
  >
>;

export declare function isKnownOscalRootKey(value: string): value is OscalRootKey;
export declare function isPinnedOscalVersion(value: string): value is PinnedOscalVersion;
export declare function buildSchemaReleaseUrl(rootKey: string, version: string): string | null;
export declare function buildSchemaId(rootKey: string, version: string): string | null;
export declare function buildSchemaVendorPath(rootKey: string, version: string): string | null;
export declare function getSchemaPin(rootKey: string, version: string): OscalSchemaPin | null;
export declare function getModelIntroducedIn(rootKey: string): string | null;
export declare function isImpossibleCombination(rootKey: string, version: string): boolean;
export declare function listSchemaPins(): readonly OscalSchemaPin[];
export declare function resolveSchemaBinding(input?: {
  rootType?: string;
  oscalVersion?: string;
  /**
   * Der Top-Level-`$schema`-Wert des Dokuments. Nur `undefined` bedeutet
   * „nicht vorhanden"; jeder andere Wert wird als vorhandene Direktive
   * geprüft und muss exakt der `$id` der gewählten Zelle entsprechen.
   */
  schemaDirective?: string;
}): SchemaBindingResult;
export declare function verifySchemaArtifact(input: {
  rootKey: string;
  version: string;
  sha256: string;
  schemaId: string;
}): SchemaBindingResult;
export declare function validateVersionMatrix(): void;
