/** Stable, redacted diagnostic codes of the workspace graph, its admission and its projections. */
export const WORKSPACE_DIAGNOSTIC_CODES = Object.freeze({
  /** Members of one snapshot carry different `verbundId` values. */
  verbundMismatch: 'OSCAL_WORKSPACE_VERBUND_MISMATCH',
  /** A member or admitted document is not class-2 local user data. */
  trustClassRejected: 'OSCAL_WORKSPACE_TRUST_CLASS_REJECTED',
  /** The root model cannot be a member of an information network. */
  rootNotAllowed: 'OSCAL_WORKSPACE_ROOT_NOT_ALLOWED',
  /** Envelope root type or version disagrees with the validated source. */
  documentInvalid: 'OSCAL_WORKSPACE_DOCUMENT_INVALID',
  /** Two snapshot documents share one document identity. */
  documentDuplicate: 'OSCAL_WORKSPACE_DOCUMENT_DUPLICATE',
  /** A class-1 artifact is not a supported, verified registry entry with matching root and version. */
  artifactUnsupported: 'OSCAL_WORKSPACE_ARTIFACT_UNSUPPORTED',
  /** More than one binding matches the same source pointer and href. */
  bindingAmbiguous: 'OSCAL_WORKSPACE_BINDING_AMBIGUOUS',
  /** A binding exists for the source pointer, but its stored href differs from the current value. */
  bindingStale: 'OSCAL_WORKSPACE_BINDING_STALE',
  /** An import object without `href`; the Profile metaschema requires it in every pinned version. */
  importSourceMissing: 'OSCAL_GRAPH_IMPORT_SOURCE_MISSING',
  /** A requirement depends on a bound baseline edge that ended in a reference error. */
  contextInvalid: 'OSCAL_GRAPH_CONTEXT_INVALID',
  /** A profile import edge failed without a diagnostic of its own. */
  profileReferenceInvalid: 'OSCAL_WORKSPACE_PROFILE_REFERENCE_INVALID',
  /** Profile resolution aborted outside its own diagnostic paths. */
  profileResolutionFailed: 'OSCAL_WORKSPACE_PROFILE_RESOLUTION_FAILED',
  /** A catalog projection met a structure it cannot index. */
  catalogStructureInvalid: 'OSCAL_WORKSPACE_CATALOG_STRUCTURE_INVALID',
  /** A catalog projection met a duplicate control ID. */
  catalogControlAmbiguous: 'OSCAL_WORKSPACE_CATALOG_CONTROL_AMBIGUOUS',
  /** A catalog projection met a duplicate part ID within one control. */
  catalogStatementAmbiguous: 'OSCAL_WORKSPACE_CATALOG_STATEMENT_AMBIGUOUS',
  /** The explicitly replaced member is absent or belongs to another information network. */
  replacementTargetInvalid: 'OSCAL_WORKSPACE_REPLACEMENT_TARGET_INVALID',
  /** Admission rejects a `mapping-collection`. */
  membershipRootRejected: 'OSCAL_WORKSPACE_MEMBERSHIP_ROOT_REJECTED',
  /** Another member of the same information network carries the same root UUID. */
  rootUuidDuplicate: 'OSCAL_WORKSPACE_ROOT_UUID_DUPLICATE',
  /** A document is bound to a BSI catalog but carries no catalog reference pair. */
  catalogPinMissing: 'OSCAL_WORKSPACE_CATALOG_PIN_MISSING',
  /** The pinned catalog commit is not the delivered stand. */
  catalogPinNotDelivered: 'OSCAL_WORKSPACE_CATALOG_PIN_NOT_DELIVERED',
  /** The delivered catalog failed its manifest or integrity check. */
  catalogPinUnverified: 'OSCAL_WORKSPACE_CATALOG_PIN_UNVERIFIED',
  /** The catalog reference pairs on `metadata.props` lock the write path. */
  catalogPinInvalid: 'OSCAL_WORKSPACE_CATALOG_PIN_INVALID',
} as const);
