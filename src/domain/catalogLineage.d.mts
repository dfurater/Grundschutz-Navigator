import type { CatalogKey, CatalogLineage as RegistryCatalogLineage } from './sourceRegistry.mjs';

export type CatalogLineageState =
  | 'complete'
  | 'import-href-missing'
  | 'import-href-not-fragment'
  | 'resource-missing'
  | 'resource-ambiguous'
  | 'rlink-missing'
  | 'rlink-ambiguous'
  | 'artifact-unregistered'
  | 'configured-import-missing';

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
  /** `null`, wenn allein der konfigurierte Import im Profil fehlt. */
  readonly index: number | null;
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
    readonly path?: string;
    readonly gitBlobSha?: string;
    readonly contentSha256?: string;
  };
}

export declare function projectCatalogLineage(input: {
  readonly lineage: RegistryCatalogLineage;
  readonly artifactsByKey: ReadonlyMap<string, ValidatedLineageArtifact>;
}): CatalogLineageProjection;
