// =============================================================================
// Domain Models — Grundschutz++ Navigator
//
// Two layers:
//   1. Raw OSCAL 1.1.3 types (prefixed with Raw*) — mirror the JSON structure
//   2. Enriched domain types — flattened, typed, ready for UI consumption
// =============================================================================

/* ------------------------------------------------------------------ */
/*  Raw OSCAL 1.1.3 Types                                             */
/* ------------------------------------------------------------------ */

export interface RawOscalProp {
  name: string;
  value: string;
  ns?: string;
  class?: string;
}

export interface RawOscalLink {
  href: string;
  rel?: string;
  text?: string;
}

export interface RawOscalParam {
  id: string;
  props?: RawOscalProp[];
  label?: string;
  values?: string[];
}

export interface RawOscalPart {
  id?: string;
  name: string;
  prose?: string;
  props?: RawOscalProp[];
  parts?: RawOscalPart[];
}

export interface RawOscalControl {
  id: string;
  class?: string;
  title: string;
  params?: RawOscalParam[];
  props?: RawOscalProp[];
  parts?: RawOscalPart[];
  links?: RawOscalLink[];
  /** Nested sub-controls / enhancements */
  controls?: RawOscalControl[];
}

export interface RawOscalGroup {
  id: string;
  title: string;
  props?: RawOscalProp[];
  groups?: RawOscalGroup[];
  controls?: RawOscalControl[];
}

export interface RawOscalResource {
  uuid: string;
  title?: string;
  rlinks?: Array<{
    href: string;
    hashes?: Array<{ algorithm: string; value: string }>;
  }>;
}

export interface RawOscalMetadata {
  title: string;
  'last-modified': string;
  version: string;
  'oscal-version': string;
  props?: RawOscalProp[];
  links?: RawOscalLink[];
  roles?: Array<{ id: string; title: string }>;
  parties?: Array<{
    uuid: string;
    type: string;
    name: string;
    'email-addresses'?: string[];
  }>;
  'responsible-parties'?: Array<{
    'role-id': string;
    'party-uuids': string[];
  }>;
  remarks?: string;
}

export interface RawOscalCatalog {
  uuid: string;
  metadata: RawOscalMetadata;
  groups?: RawOscalGroup[];
  params?: RawOscalParam[];
  'back-matter'?: {
    resources?: RawOscalResource[];
  };
}

/** Root wrapper — OSCAL files wrap the catalog in { catalog: ... } */
export interface RawOscalDocument {
  catalog: RawOscalCatalog;
}

/* ------------------------------------------------------------------ */
/*  Domain Types — Enriched, flattened, UI-ready                      */
/* ------------------------------------------------------------------ */

/** Sicherheitsniveau */
export type SecurityLevel = 'normal-SdT' | 'erhöht';

/** Aufwandsstufe (0–5) */
export type EffortLevel = '0' | '1' | '2' | '3' | '4' | '5';

/** Modalverb / Verpflichtungsgrad */
export type Modalverb = 'MUSS' | 'SOLLTE' | 'KANN';

/** Link relationship type */
export type LinkRelation = 'related' | 'required';

/** A parsed control link */
export interface ControlLink {
  targetId: string;
  relation: LinkRelation;
}

/** A prop value with retained OSCAL provenance */
export interface PropValue {
  name: string;
  value: string;
  ns?: string;
}

/** A single enriched control */
export interface Control {
  /** Control ID, e.g. "GC.1.1" */
  id: string;
  /** Parent control ID for nested sub-controls, e.g. "GC.5.1" for "GC.5.1.1" */
  parentId?: string;
  /** Human-readable title */
  title: string;
  /** UUID alternate identifier */
  altIdentifier?: string;
  /** Parent group ID (Thema), e.g. "GC.1" */
  groupId: string;
  /** Root practice ID (Praktik), e.g. "GC" */
  practiceId: string;

  /** Security level: normal-SdT or erhöht */
  securityLevel?: SecurityLevel;
  /** Structured security-level prop with namespace provenance */
  securityLevelProp?: PropValue;
  /** Effort level: 0–5 */
  effortLevel?: EffortLevel;
  /** Structured effort-level prop with namespace provenance */
  effortLevelProp?: PropValue;
  /** Obligation level: MUSS, SOLLTE, KANN */
  modalverb?: Modalverb;
  /** Structured modal verb prop with namespace provenance */
  modalverbProp?: PropValue;

  /** Tags (from props, comma-separated in source) */
  tags: string[];
  /** Structured tags prop with namespace provenance */
  tagsProp?: PropValue;

  /** Statement prose (with params resolved) */
  statement: string;
  /** Raw statement prose (with {{ insert: param, ... }} placeholders) */
  statementRaw: string;
  /** Guidance prose */
  guidance: string;

  /** Statement metadata */
  statementProps: {
    ergebnis?: string;
    ergebnisProp?: PropValue;
    praezisierung?: string;
    praezisierungProp?: PropValue;
    handlungsworte?: string;
    handlungsworteProp?: PropValue;
    /** Guidance/documentation prose from documentation prop */
    dokumentation?: string;
    dokumentationProp?: PropValue;
    /** Target object categories (e.g. "Server", "Client") */
    zielobjektKategorien: string[];
    zielobjektKategorienProp?: PropValue;
  };

  /** Related/required control links */
  links: ControlLink[];

  /** Inline parameter values for template resolution */
  params: Record<string, string>;
}

/** A topic (Thema) — second-level group */
export interface Topic {
  /** Topic ID, e.g. "GC.1" */
  id: string;
  /** Human-readable title */
  title: string;
  /** Short label, e.g. "1" */
  label: string;
  /** UUID alternate identifier */
  altIdentifier?: string;
  /** Parent practice ID */
  practiceId: string;
  /** Number of controls in this topic */
  controlCount: number;
  /** Control IDs belonging to this topic */
  controlIds: string[];
}

/** A practice (Praktik) — top-level group */
export interface Practice {
  /** Practice ID, e.g. "GC" */
  id: string;
  /** Human-readable title */
  title: string;
  /** Short label, e.g. "GC" */
  label: string;
  /** UUID alternate identifier */
  altIdentifier?: string;
  /** Topics within this practice */
  topics: Topic[];
  /** Total number of controls across all topics */
  controlCount: number;
}

export interface CatalogMetadataLink {
  href: string;
  rel?: string;
  text?: string;
}

export interface CatalogMetadataProp {
  name: string;
  value: string;
  ns?: string;
}

export interface CatalogRole {
  id: string;
  title: string;
}

export interface CatalogParty {
  uuid: string;
  type: string;
  name: string;
  email?: string;
}

export interface CatalogResponsibleParty {
  roleId: string;
  partyUuids: string[];
}

export interface CatalogResourceHash {
  algorithm: string;
  value: string;
}

export interface CatalogResourceLink {
  href: string;
  hashes: CatalogResourceHash[];
}

export interface CatalogResource {
  uuid: string;
  title?: string;
  rlinks: CatalogResourceLink[];
}

/** Catalog metadata */
export interface CatalogMetadataInfo {
  title: string;
  lastModified: string;
  version: string;
  oscalVersion: string;
  remarks?: string;
  publisherName?: string;
  publisherEmail?: string;
  props: CatalogMetadataProp[];
  links: CatalogMetadataLink[];
  roles: CatalogRole[];
  parties: CatalogParty[];
  responsibleParties: CatalogResponsibleParty[];
}

/** The fully parsed catalog */
export interface Catalog {
  /** OSCAL document UUID */
  uuid: string;
  /** Catalog metadata */
  metadata: CatalogMetadataInfo;
  /** All 19 practices */
  practices: Practice[];
  /** All controls, indexed by ID for O(1) lookup */
  controlsById: Map<string, Control>;
  /** All controls as flat array */
  controls: Control[];
  /** Referenced catalog resources from OSCAL back-matter */
  backMatter: CatalogResource[];
  /** Total control count */
  totalControls: number;
}

/* ------------------------------------------------------------------ */
/*  Official Vocabulary Types                                          */
/* ------------------------------------------------------------------ */

/** A single official BSI vocabulary row, addressed by exact value */
export interface VocabularyEntry {
  /** Exact raw value from the catalog prop that resolves this entry */
  value: string;
  /** Optional convenience field for the official definition column */
  definition?: string;
  /** All official columns with unchanged upstream headers */
  columns: Record<string, string>;
}

/** Stable source identity for one namespace file */
export interface VocabularyNamespaceSource {
  /** Original namespace URL as referenced from OSCAL props */
  namespace: string;
  /** Upstream repository URL */
  repository: string;
  /** Repository-relative CSV path */
  path: string;
  /** Basename of the namespace file, e.g. "security_level.csv" */
  fileName: string;
  /** Stable route slug derived from the repository path */
  routeId: string;
  /** Git blob SHA for exact upstream provenance */
  gitBlobSha: string;
}

/** Serialized namespace payload written to public/data/vocabularies.json */
export interface VocabularyNamespaceData {
  source: VocabularyNamespaceSource;
  /** Preserves the official CSV column order for UI rendering */
  columnOrder: string[];
  /** Header name used for exact value lookup */
  valueColumn: string;
  /** Optional header that contains the authoritative definition */
  definitionColumn?: string;
  entries: VocabularyEntry[];
}

/** Serialized vocabulary artifact written at build time */
export interface VocabularyRegistryData {
  /** Shared upstream snapshot commit for catalog + namespaces */
  sourceCommitSha: string;
  namespaces: VocabularyNamespaceData[];
}

/** Runtime namespace model with exact lookup index */
export interface VocabularyNamespace extends VocabularyNamespaceData {
  entriesByValue: Map<string, VocabularyEntry>;
}

/** Runtime registry used by the app */
export interface VocabularyRegistry {
  sourceCommitSha: string;
  namespaces: VocabularyNamespace[];
  namespacesByUrl: Map<string, VocabularyNamespace>;
  namespacesByRouteId: Map<string, VocabularyNamespace>;
}

/** One file monitored as part of the upstream contract */
export interface UpstreamManifestFile {
  kind: 'catalog' | 'namespace';
  path: string;
  namespace?: string;
  gitBlobSha: string;
}

/** Persisted manifest/signature basis for update-catalog workflow */
export interface UpstreamManifest {
  repository: string;
  snapshotCommitSha: string;
  catalogPath: string;
  files: UpstreamManifestFile[];
  signatureSha256: string;
}

/* ------------------------------------------------------------------ */
/*  Provenance / Integrity Types                                       */
/* ------------------------------------------------------------------ */

export interface VocabularyProvenance {
  source: UpstreamManifest;
  integrity: {
    sha256: string;
    size_bytes: number;
    fetched_at: string;
  };
  build: {
    workflow_run_id: string;
    workflow_run_url: string | null;
    runner_environment: string;
  };
}

export interface CatalogProvenance {
  source: {
    repository: string;
    file: string;
    commit_sha: string;
    commit_date?: string;
    git_blob_sha: string;
    upstream_sha256?: string;
    upstream_size_bytes?: number;
  };
  integrity: {
    sha256: string;
    size_bytes: number;
    fetched_at: string;
  };
  build: {
    workflow_run_id: string;
    workflow_run_url: string | null;
    runner_environment: string;
  };
}

export interface VerificationResult {
  /** Whether the computed hash matches the expected hash */
  valid: boolean;
  /** SHA-256 computed from the loaded catalog */
  computedHash: string;
  /** SHA-256 from the metadata file */
  expectedHash: string;
  /** BSI repository commit SHA */
  sourceCommit: string;
  /** When the catalog was fetched */
  fetchedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Application State Types                                            */
/* ------------------------------------------------------------------ */

export interface CatalogState {
  catalog: Catalog | null;
  provenance: CatalogProvenance | null;
  verification: VerificationResult | null;
  vocabularyRegistry: VocabularyRegistry | null;
  vocabularyProvenance: VocabularyProvenance | null;
  vocabularyVerification: VerificationResult | null;
  loading: boolean;
  error: string | null;
}
