/**
 * Typdeklarationen für das Quellregister (ADR-0001).
 * Muss mit sourceRegistry.mjs übereinstimmen; die Laufzeitkonsistenz der
 * CatalogKey-Union sichert sourceRegistry.test.ts ab.
 */

export type ArtifactLifecycle = 'supported' | 'preview' | 'draft' | 'blocked-by-upstream';

export type OscalRootType = 'catalog' | 'profile' | 'mapping-collection' | 'component-definition';

export type CatalogKey =
  | 'gspp'
  | 'lieferkette'
  | 'wlan'
  | 'iso27001-annex-a'
  | 'mindeststandard-tls';

export interface OscalArtifactEntry {
  readonly artifactKey: string;
  readonly kind: 'oscal';
  readonly expectedRootType: OscalRootType;
  /** Nur gesetzt, wenn expectedRootType 'catalog' ist. */
  readonly catalogKey?: CatalogKey;
  readonly upstreamPath: string;
  readonly lifecycle: ArtifactLifecycle;
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

export declare const SOURCE_REGISTRY: readonly SourceRegistryEntry[];
export declare const SUPPORTED_CATALOG: OscalArtifactEntry & { readonly catalogKey: CatalogKey };
export declare const SUPPORTED_CATALOG_KEY: CatalogKey;

export declare function validateSourceRegistry(entries?: readonly SourceRegistryEntry[]): void;
export declare function listArtifacts(filter?: {
  lifecycle?: ArtifactLifecycle;
}): readonly SourceRegistryEntry[];
export declare function getArtifactByUpstreamPath(path: string): SourceRegistryEntry | null;
export declare function getExpectedRootType(path: string): OscalRootType | null;
export declare function getCatalogByKey(catalogKey: string): OscalArtifactEntry | null;
export declare function listCatalogKeys(): readonly CatalogKey[];
export declare function isCatalogKey(value: string): value is CatalogKey;
