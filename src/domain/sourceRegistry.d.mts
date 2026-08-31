/**
 * Typdeklarationen für das Quellregister (ADR-1).
 * Muss mit sourceRegistry.mjs übereinstimmen; die Laufzeitkonsistenz der
 * CatalogKey-Union sichert sourceRegistry.test.ts ab.
 */

import type { OscalSchemaPin, PinnedOscalVersion } from './oscalVersionMatrix.d.mts';

export type ArtifactLifecycle = 'supported' | 'preview' | 'draft' | 'blocked-by-upstream';

export type OscalRootType = 'catalog' | 'profile' | 'mapping-collection' | 'component-definition';

export type ManifestRootType = OscalRootType | 'vocabulary';

export type CatalogKey =
  | 'gspp'
  | 'lieferkette'
  | 'wlan'
  | 'iso27001-annex-a'
  | 'mindeststandard-tls';

export interface OscalArtifactEntry {
  readonly artifactKey: string;
  readonly kind: 'oscal';
  /**
   * Die vom Upstream-Artefakt deklarierte `metadata.oscal-version` (GSPP-283).
   * Wird beim Import gegen die Versionsmatrix gekreuzt.
   */
  readonly oscalVersion: PinnedOscalVersion;
  readonly expectedRootType: OscalRootType;
  /** Nur gesetzt, wenn expectedRootType 'catalog' ist. */
  readonly catalogKey?: CatalogKey;
  readonly upstreamPath: string;
  readonly lifecycle: ArtifactLifecycle;
  /**
   * Auszeichnung des Einstiegskatalogs (GSPP-284). Nur auf genau einem
   * `supported`-Katalog zulässig; sein Auslieferungsvertrag bleibt
   * `catalog.json` / `catalog-metadata.json`.
   */
  readonly entryCatalog?: true;
  /** Pflichtreferenz bei lifecycle 'blocked-by-upstream'. */
  readonly upstreamIssue?: string;
  readonly title: string;
}

export interface VocabularyCollectionEntry {
  readonly artifactKey: string;
  readonly kind: 'vocabulary-collection';
  readonly upstreamDirectory: string;
  readonly fileSuffix: string;
  readonly lifecycle: ArtifactLifecycle;
  readonly title: string;
}

export type SourceRegistryEntry = OscalArtifactEntry | VocabularyCollectionEntry;

export interface CatalogLineageImport {
  readonly href: string;
  readonly artifactKey: string;
}

export interface CatalogLineage {
  readonly catalogKey: CatalogKey;
  readonly profileArtifactKey: string;
  readonly imports: readonly CatalogLineageImport[];
}

export declare const SOURCE_REGISTRY: readonly SourceRegistryEntry[];
export declare const CATALOG_LINEAGES: readonly CatalogLineage[];
export declare const MONITORED_UPSTREAM_ROOTS: readonly string[];
export type SupportedCatalogEntry = OscalArtifactEntry & {
  readonly expectedRootType: 'catalog';
  readonly lifecycle: 'supported';
  readonly catalogKey: CatalogKey;
};

export declare const SUPPORTED_CATALOGS: readonly SupportedCatalogEntry[];
export declare const SUPPORTED_CATALOG_KEYS: readonly CatalogKey[];
export declare const ENTRY_CATALOG: SupportedCatalogEntry;
export declare const ENTRY_CATALOG_KEY: CatalogKey;

export declare function validateSourceRegistry(entries?: readonly SourceRegistryEntry[]): void;
export declare function validateCatalogLineages(
  lineages?: readonly CatalogLineage[],
  entries?: readonly SourceRegistryEntry[],
): void;
export declare function hasRegistryKeyGrammar(value: unknown): value is string;
export declare function isSafeRepoPath(path: string): boolean;
export declare function isPathWithinMonitoredRoot(path: string): boolean;
export declare function listArtifacts(filter?: {
  lifecycle?: ArtifactLifecycle;
}): readonly SourceRegistryEntry[];
export declare function getArtifactByUpstreamPath(path: string): SourceRegistryEntry | null;
export declare function getExpectedRootType(path: string): OscalRootType | null;
export declare function listOscalArtifacts(): readonly OscalArtifactEntry[];
export declare function getExpectedOscalVersion(path: string): PinnedOscalVersion | null;
export declare function getSchemaPinForArtifact(artifactKey: string): OscalSchemaPin | null;
export declare function getCatalogByKey(catalogKey: string): OscalArtifactEntry | null;
export declare function listCatalogKeys(): readonly CatalogKey[];
export declare function isCatalogKey(value: string): value is CatalogKey;
export declare function listSupportedCatalogs(
  entries?: readonly SourceRegistryEntry[],
): readonly SupportedCatalogEntry[];
export declare function resolveEntryCatalog(
  entries?: readonly SourceRegistryEntry[],
): SupportedCatalogEntry;
export declare function catalogDataFileName(entry: SupportedCatalogEntry): string;
export declare function catalogMetadataFileName(entry: SupportedCatalogEntry): string;
export declare function listCatalogArtifactFileNames(
  entries?: readonly SourceRegistryEntry[],
): readonly string[];
