// =============================================================================
// Domain Models — Grundschutz++ Navigator
//
// Two layers:
//   1. Raw OSCAL 1.1.3 types (prefixed with Raw*) — mirror the JSON structure
//   2. Enriched domain types — flattened, typed, ready for UI consumption
// =============================================================================

import type {
  ArtifactLifecycle,
  CatalogKey,
  ManifestRootType,
} from '@/domain/sourceRegistry';
import type { CatalogDocumentContext } from '@/domain/oscalDocumentContext';
import type { CatalogLineageProjection } from '@/domain/catalogLineage';

/* ------------------------------------------------------------------ */
/*  Raw OSCAL 1.1.3 Types                                             */
/* ------------------------------------------------------------------ */

export interface RawOscalProp {
  name: string;
  value: string;
  uuid?: string;
  ns?: string;
  class?: string;
  group?: string;
  remarks?: string;
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
  /**
   * Optional laut OSCAL 1.1.3: `group` verlangt nur `title`. Eine Gruppe ohne
   * `id` ist nicht referenzierbar — Routing und Anker dürfen sie deshalb nicht
   * voraussetzen (GSPP-242).
   */
  id?: string;
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
  /**
   * Controls direkt am Katalog-Root. Laut OSCAL 1.1.3 zulässig — `catalog`
   * verlangt nur `uuid` und `metadata`, und `controls` steht gleichberechtigt
   * neben `groups`. Solche Controls gehören zu keiner Gruppe und tragen
   * deshalb weder `groupId` noch `practiceId` (GSPP-242).
   */
  controls?: RawOscalControl[];
  params?: RawOscalParam[];
  'back-matter'?: {
    resources?: RawOscalResource[];
  };
}

// Der Root-Envelope ist nicht mehr auf `{ catalog: ... }` verdrahtet: Die
// diskriminierte Union über alle acht Root-Keys steht in
// `@/domain/oscalRootDocument` (GSPP-285).

/* ------------------------------------------------------------------ */
/*  Domain Types — Enriched, flattened, UI-ready                      */
/* ------------------------------------------------------------------ */

/** Sicherheitsniveau */
export type SecurityLevel = 'normal-SdT' | 'erhöht';

/** Aufwandsstufe (0–5) */
export type EffortLevel = '0' | '1' | '2' | '3' | '4' | '5';

/** Schutzziel-Relevanz (0–2) */
export type SecurityTargetRelevance = '0' | '1' | '2';

/** Modalverb / Verpflichtungsgrad */
export type Modalverb = 'MUSS' | 'SOLLTE' | 'KANN';

/** Link relationship type */
export type LinkRelation = 'related' | 'required';

/** OSCAL-Catalog-Dokumentationsstatus des originalen optionalen `link.rel`. */
export type LinkRelationStatus = 'documented' | 'custom' | 'missing';

/** A resolved catalog-internal control link with lossless source semantics. */
export interface ControlLink {
  targetId: string;
  href: string;
  rel?: string;
  relStatus: LinkRelationStatus;
  resourceFragment?: string;
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
  /** Parent group ID (Thema), e.g. "GC.1"; fehlt bei einer Quellgruppe ohne `id` */
  groupId?: string;
  /** Root practice ID (Praktik), e.g. "GC"; fehlt bei einer Quellgruppe ohne `id` */
  practiceId?: string;

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

  /** Ordered WLAN taxonomy props (`Taxonomy-L1` through `Taxonomy-L4`) */
  taxonomy: PropValue[];

  /** Relevanz für das Schutzziel Vertraulichkeit (0–2) */
  confidentiality?: SecurityTargetRelevance;
  /** Structured confidentiality prop with the canonical relevance vocabulary namespace */
  confidentialityProp?: PropValue;
  /** Relevanz für das Schutzziel Integrität (0–2) */
  integrity?: SecurityTargetRelevance;
  /** Structured integrity prop with the canonical relevance vocabulary namespace */
  integrityProp?: PropValue;
  /** Relevanz für das Schutzziel Verfügbarkeit (0–2) */
  availability?: SecurityTargetRelevance;
  /** Structured availability prop with the canonical relevance vocabulary namespace */
  availabilityProp?: PropValue;
  /** Relevanz für das Schutzziel Authentizität (0–2) */
  authenticity?: SecurityTargetRelevance;
  /** Structured authenticity prop with the canonical relevance vocabulary namespace */
  authenticityProp?: PropValue;

  /** Elementare Gefährdungen, aus der kommaseparierten OSCAL-Prop geparst */
  threats: string[];
  /** Structured threats prop with namespace provenance */
  threatsProp?: PropValue;

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
  /**
   * Topic ID, e.g. "GC.1". Fehlt, wenn die Quellgruppe keine `id` trägt
   * (OSCAL 1.1.3: optional). Ein Topic ohne `id` ist nicht adressierbar und
   * erzeugt weder Route noch Anker (GSPP-242).
   */
  id?: string;
  /** Human-readable title */
  title: string;
  /** Short label, e.g. "1" */
  label: string;
  /** UUID alternate identifier */
  altIdentifier?: string;
  /** Parent practice ID; fehlt, wenn die übergeordnete Gruppe keine `id` trägt */
  practiceId?: string;
  /** Number of controls in this topic */
  controlCount: number;
  /** Control IDs belonging to this topic */
  controlIds: string[];
}

/** A practice (Praktik) — top-level group */
export interface Practice {
  /**
   * Practice ID, e.g. "GC". Fehlt, wenn die Quellgruppe keine `id` trägt
   * (OSCAL 1.1.3: optional) — dann ist die Praktik nicht adressierbar.
   */
  id?: string;
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
  /** Stable catalog key from the source registry (ADR-1), e.g. "gspp" */
  catalogKey: CatalogKey;
  /** OSCAL document UUID */
  uuid: string;
  /** Catalog metadata */
  metadata: CatalogMetadataInfo;
  /** All 19 practices */
  practices: Practice[];
  /** All controls, indexed by ID for O(1) lookup (catalog-internal identity) */
  controlsById: Map<string, Control>;
  /**
   * All controls indexed by their alt-identifier (canonical URL identity,
   * ADR-1). Missing or duplicate alt-identifiers within one catalog are
   * rejected at parse time, so this map always covers every control.
   */
  controlsByAltIdentifier: Map<string, Control>;
  /** All controls as flat array */
  controls: Control[];
  /** Referenced catalog resources from OSCAL back-matter */
  backMatter: CatalogResource[];
  /** Total control count */
  totalControls: number;
}

/**
 * Catalog-scoped internal control reference (ADR-1).
 * URLs use catalogKey + altIdentifier instead; this pair is the
 * OSCAL/reference identity for lookups and relations.
 */
export interface ControlRef {
  catalogKey: CatalogKey;
  controlId: string;
}

/* ------------------------------------------------------------------ */
/*  Verlustfreies Dokumentmodell (ADR-2)                              */
/* ------------------------------------------------------------------ */

// Vertrauensklasse und Ableitungskontext stehen in
// `@/domain/oscalDocumentContext` und werden hier weiterexportiert, damit
// `@/domain/models` die gewohnte Einstiegsstelle für Domänentypen bleibt.
export type {
  TrustClass,
  OscalDocumentContext,
  CatalogDocumentContext,
} from '@/domain/oscalDocumentContext';

/**
 * Ein geparstes OSCAL-Katalogdokument nach dem verlustfreien Vertrag.
 *
 * `source` ist die Wahrheit, `view` eine Projektion darauf:
 * `view = derive(source, context)`. Ein Export wird nie aus `view` neu
 * aufgebaut (§7).
 */
export interface CatalogDocument {
  /**
   * Originalknoten (§1): das unveränderte Ergebnis von `JSON.parse`,
   * einschließlich unbekannter Felder, Extensions, nicht ausgewerteter
   * `props`/`links` und des vollständigen `back-matter`. Wird nie mutiert.
   *
   * Bewusst `unknown`: `JSON.parse` liefert keine geprüfte Struktur, und der
   * Vertrag filtert den Quellgraphen ausdrücklich nicht nach bekannten
   * Feldern. Wer ihn liest, grenzt selbst ein.
   */
  readonly source: unknown;
  /** Ableitungskontext, aus dem `view` zusammen mit `source` reproduzierbar ist */
  readonly context: CatalogDocumentContext;
  /** Projektion für die UI; trägt keine Information außerhalb von `source` und `context` */
  readonly view: Catalog;
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
  /**
   * Header, die die eigene Kennung einer Zeile tragen (Spaltenname exakt
   * `uuid`, Groß-/Kleinschreibung egal). Vom Build-Skript aus den CSV-Headern
   * abgeleitet; fehlt das Feld in einem älteren Artefakt, gilt es als leer.
   */
  identifierColumns?: string[];
  /**
   * Header, die auf die Kennung einer anderen Zeile verweisen (z. B.
   * `ChildOfUUID`). Sie identifizieren den eigenen Eintrag nicht und dürfen
   * seine Controls deshalb nicht unter diesem Wert auffindbar machen.
   */
  identifierReferenceColumns?: string[];
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
  /** Eigene Kennung (kleingeschrieben) → Eintrag; Verweisspalten bleiben außen vor */
  entriesByIdentifier: Map<string, VocabularyEntry>;
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
  artifactKey: string;
  rootType: ManifestRootType;
  lifecycle: ArtifactLifecycle;
  path: string;
  gitBlobSha: string;
  contentSha256: string;
}

/** Persisted manifest/signature basis for update-catalog workflow */
export interface UpstreamManifest {
  schemaVersion: 2;
  repository: string;
  snapshotCommitSha: string;
  files: UpstreamManifestFile[];
  signatureSha256: string;
}

/* ------------------------------------------------------------------ */
/*  Provenance / Integrity Types                                       */
/* ------------------------------------------------------------------ */

/** Per-file provenance for a fetched vocabulary namespace file */
export interface VocabularyFileProvenance {
  namespace: string;
  path: string;
  fileName: string;
  routeId: string;
  gitBlobSha: string;
  sha256: string;
  sizeBytes: number;
}

export interface TopicVocabularyCoverage {
  catalogTopicCount: number;
  distinctCatalogUuidCount: number;
  csvEntryCount: number;
  matchedCatalogTopicCount: number;
  unmatchedCatalogTopicCount: number;
  orphanCsvEntryCount: number;
  missingCatalogUuidCount: number;
  duplicateCsvUuidCount: number;
  unmatchedCatalogTopics: Array<{
    id?: string;
    practiceId?: string;
    uuid?: string;
  }>;
  orphanCsvEntries: Array<{
    value?: string;
    uuid?: string;
  }>;
  duplicateCsvUuids: Array<{
    value: string;
    count: number;
  }>;
}

export interface PracticeVocabularyIntegrity {
  catalogPracticeCount: number;
  distinctCatalogUuidCount: number;
  csvEntryCount: number;
  matchedCatalogPracticeCount: number;
  unmatchedCatalogPracticeCount: number;
  orphanCsvEntryCount: number;
  toleratedOrphanCsvEntryCount: number;
  missingCatalogUuidCount: number;
  missingUuidCount: number;
  duplicateCatalogUuidCount: number;
  duplicateUuidCount: number;
  unmatchedCatalogPractices: Array<{
    id?: string;
    uuid?: string;
  }>;
  orphanCsvEntries: Array<{
    value?: string;
    uuid?: string;
  }>;
  toleratedOrphanCsvEntries: Array<{
    value?: string;
    uuid?: string;
  }>;
  entriesWithoutUuid: string[];
  duplicateCatalogUuids: Array<{
    value: string;
    count: number;
  }>;
  duplicateUuids: Array<{
    value: string;
    count: number;
  }>;
}

/** Integrity record shared by every shipped artifact (ADR-1) */
export interface ArtifactIntegrity {
  sha256: string;
  size_bytes: number;
  fetched_at: string;
}

/** Build context shared by every shipped artifact (ADR-1) */
export interface ArtifactBuildInfo {
  workflow_run_id: string;
  workflow_run_url: string | null;
  runner_environment: string;
}

export interface VocabularyProvenance {
  /** Source-registry artifact key; written by the multi-artifact fetch (GSPP-249) */
  artifactKey?: string;
  source: {
    repository: string;
    catalogPath: string;
    snapshotCommitSha: string;
    snapshotCommitDate?: string;
  };
  manifest: UpstreamManifest;
  /** Rein lesende, profilbasierte Dokumentkette; bei älteren Deployments nicht vorhanden. */
  catalogLineages?: readonly CatalogLineageProjection[];
  files: VocabularyFileProvenance[];
  dataQualityFindings?: string[];
  taxonomyCoverage?: {
    topics: TopicVocabularyCoverage | null;
    practices: PracticeVocabularyIntegrity | null;
  };
  integrity: ArtifactIntegrity;
  build: ArtifactBuildInfo;
}

export interface CatalogProvenance {
  /** Source-registry artifact key; written by the multi-artifact fetch (GSPP-249) */
  artifactKey?: string;
  source: {
    repository: string;
    file: string;
    commit_sha: string;
    commit_date?: string;
    git_blob_sha: string;
    upstream_sha256?: string;
    upstream_size_bytes?: number;
  };
  integrity: ArtifactIntegrity;
  build: ArtifactBuildInfo;
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

/**
 * Ladezustand genau eines Katalogs (GSPP-284).
 *
 * Jeder ausgelieferte Katalog trägt seine eigene Provenienz, sein eigenes
 * Verifikationsergebnis und seinen eigenen Fehlerzustand. Die Vertrauensklasse
 * hängt damit am einzelnen Katalog statt global am Zustand: ein Katalog mit
 * abweichendem Hash wird auf `class-1-unverified-public` herabgestuft, ohne die
 * Vertrauensklasse eines anderen geladenen Katalogs zu berühren.
 */
export interface LoadedCatalogState {
  readonly catalogKey: CatalogKey;
  /**
   * Das geladene Katalogdokument mit erhaltenem Quellgraphen (ADR-2).
   * Definierte Zugriffsstelle für alles, was das Domänenmodell nicht abbildet.
   */
  readonly catalogDocument: CatalogDocument | null;
  /**
   * Projektion des Dokuments für die UI — identisch mit
   * `catalogDocument.view`. Bequemer Zugriff, kein zweiter Zustand.
   */
  readonly catalog: Catalog | null;
  readonly provenance: CatalogProvenance | null;
  readonly verification: VerificationResult | null;
  readonly loading: boolean;
  readonly error: string | null;
}

export interface CatalogState {
  /**
   * Alle angeforderten Kataloge, je Katalog isoliert. Der Einstiegskatalog ist
   * ab dem ersten Rendern enthalten; weitere kommen bedarfsgerecht dazu, sobald
   * eine Route sie auswählt.
   */
  catalogs: ReadonlyMap<CatalogKey, LoadedCatalogState>;
  /** Der eager geladene Einstiegskatalog aus dem Quellregister. */
  entryCatalogKey: CatalogKey;
  /** Der aktuell ausgewählte Katalog; speist die Projektionen unten. */
  activeCatalogKey: CatalogKey;
  /**
   * Wählt einen ausgelieferten Katalog aus und stößt ihn bei Bedarf an.
   * Ein nicht ausgelieferter `catalogKey` wird ignoriert — die Auswahl bleibt
   * fail-closed beim zuletzt gültigen Katalog.
   */
  selectCatalog: (catalogKey: CatalogKey) => void;

  /* Projektionen des aktiven Katalogs — unveränderte Zugriffsform. */
  catalogDocument: CatalogDocument | null;
  catalog: Catalog | null;
  provenance: CatalogProvenance | null;
  verification: VerificationResult | null;
  loading: boolean;
  error: string | null;

  vocabularyRegistry: VocabularyRegistry | null;
  vocabularyProvenance: VocabularyProvenance | null;
  vocabularyVerification: VerificationResult | null;
}
