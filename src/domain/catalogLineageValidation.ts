import type {
  CatalogLineageDocument,
  CatalogLineageImport,
  CatalogLineageProjection,
  CatalogLineageState,
} from '@/domain/catalogLineage';
import type { CatalogKey } from '@/domain/sourceRegistry';

const lineageStates = new Set<CatalogLineageState>([
  'complete',
  'import-href-missing',
  'import-href-not-fragment',
  'resource-missing',
  'resource-ambiguous',
  'rlink-missing',
  'rlink-ambiguous',
  'artifact-unregistered',
  'import-duplicate',
  'configured-import-missing',
]);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCatalogLineageDocument(value: unknown): value is CatalogLineageDocument {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.artifactKey === 'string' &&
    isNullableString(document.title) &&
    isNullableString(document.documentUuid) &&
    isNullableString(document.oscalVersion) &&
    isNullableString(document.version) &&
    isNullableString(document.upstreamPath) &&
    isNullableString(document.gitBlobSha) &&
    isNullableString(document.contentSha256)
  );
}

function isCatalogLineageImport(value: unknown): value is CatalogLineageImport {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const importedCatalog = value as Record<string, unknown>;
  const state = importedCatalog.state;
  if (typeof state !== 'string' || !lineageStates.has(state as CatalogLineageState)) return false;

  const hasValidIndex =
    state === 'configured-import-missing'
      ? importedCatalog.index === null
      : Number.isSafeInteger(importedCatalog.index) && (importedCatalog.index as number) >= 0;
  if (
    !hasValidIndex ||
    !isNullableString(importedCatalog.importHref) ||
    !isNullableString(importedCatalog.resourceUuid) ||
    !isNullableString(importedCatalog.rlinkHref)
  ) {
    return false;
  }

  return importedCatalog.state === 'complete'
    ? isCatalogLineageDocument(importedCatalog.source)
    : importedCatalog.source === null;
}

function isCatalogLineageProjection(value: unknown): value is CatalogLineageProjection {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const lineage = value as Record<string, unknown>;
  return (
    typeof lineage.catalogKey === 'string' &&
    lineage.catalogKey.length > 0 &&
    isCatalogLineageDocument(lineage.profile) &&
    Array.isArray(lineage.imports) &&
    lineage.imports.every(isCatalogLineageImport)
  );
}

/** Prüft die Sidecar-Struktur des aktiven Katalogs, ohne Quellen aufzulösen. */
export function resolveActiveCatalogLineage(
  lineages: unknown,
  activeCatalogKey: CatalogKey,
): { lineage: CatalogLineageProjection | null; invalid: boolean } {
  if (lineages === undefined) return { lineage: null, invalid: false };
  if (!Array.isArray(lineages)) return { lineage: null, invalid: true };

  const candidates = lineages.filter(
    (candidate) =>
      candidate !== null &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      (candidate as { catalogKey?: unknown }).catalogKey === activeCatalogKey,
  );
  if (candidates.length === 0) return { lineage: null, invalid: false };
  if (candidates.length !== 1 || !isCatalogLineageProjection(candidates[0])) {
    return { lineage: null, invalid: true };
  }
  return { lineage: candidates[0], invalid: false };
}
