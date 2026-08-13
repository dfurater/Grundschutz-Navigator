import type { Plugin } from 'vite';

export type CatalogFreshnessState = 'fresh' | 'stale' | 'missing' | 'malformed';

export interface CatalogFreshnessOptions {
  readonly manifestPath?: string;
  readonly metadataPath?: string;
}

export interface CatalogFreshnessResult {
  readonly state: CatalogFreshnessState;
  readonly source: 'tracked-manifest' | 'local-metadata';
  readonly expectedSnapshotSha: string | null;
  readonly foundSnapshotSha: string | null;
  readonly expectedSignatureSha256: string | null;
  readonly foundSignatureSha256: string | null;
}

export declare function checkCatalogFreshness(
  options?: CatalogFreshnessOptions,
): Promise<CatalogFreshnessResult>;

export declare function assertCatalogFreshness(
  options?: CatalogFreshnessOptions,
): Promise<CatalogFreshnessResult>;

export declare function formatCatalogFreshnessMessage(result: CatalogFreshnessResult): string;

export declare function catalogFreshnessPlugin(options?: CatalogFreshnessOptions): Plugin;

export default function setupCatalogFreshness(): Promise<void>;
