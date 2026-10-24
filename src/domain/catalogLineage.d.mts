import type { CatalogKey } from './sourceRegistry.mjs';

export type CatalogLineageState =
  | 'complete'
  | 'import-href-missing'
  | 'import-href-not-fragment'
  | 'resource-missing'
  | 'resource-ambiguous'
  | 'rlink-missing'
  | 'rlink-ambiguous'
  | 'artifact-unregistered'
  | 'import-duplicate';

export interface CatalogLineageDocument {
  readonly artifactKey: string;
  readonly title: string | null;
  readonly documentUuid: string | null;
  readonly oscalVersion: string | null;
  readonly version: string | null;
  readonly upstreamPath: string | null;
  readonly gitBlobSha: string | null;
  readonly contentSha256: string | null;
}

export interface CatalogLineageImport {
  readonly index: number;
  readonly state: CatalogLineageState;
  readonly importHref: string | null;
  readonly resourceUuid: string | null;
  readonly rlinkHref: string | null;
  readonly source: CatalogLineageDocument | null;
}

export interface CatalogLineageProjection {
  readonly catalogKey: CatalogKey;
  readonly profile: CatalogLineageDocument;
  readonly imports: readonly CatalogLineageImport[];
}

export interface ValidatedLineageArtifact {
  readonly document: unknown;
  readonly manifestFile: {
    readonly artifactKey: string;
    readonly path: string;
    readonly gitBlobSha?: string;
    readonly contentSha256?: string;
  };
}

export declare function resolveRelativeRepoPath(baseFilePath: string, href: string): string | null;

export declare function projectCatalogLineage(input: {
  readonly catalogKey: CatalogKey;
  readonly profileArtifact: ValidatedLineageArtifact;
  readonly artifactsByPath: ReadonlyMap<string, ValidatedLineageArtifact>;
}): CatalogLineageProjection;
