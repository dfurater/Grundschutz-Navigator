import type { CatalogState } from '@/domain/models';
import type { TargetCategoryContext } from '@/domain/sspTargetObjects';
import { BSI_NAMESPACE_DIRECTORY } from '@/domain/vocabularyNamespaces';

/** Ausgelieferte Hashprüfung und Provenienz beider Artefakte; der aktive Viewer-Katalog wählt keinen Kontext. */
export function sspCategoryContext(catalog: CatalogState): TargetCategoryContext | undefined {
  const gspp = catalog.catalogs?.get('gspp');
  const registry = catalog.vocabularyRegistry;
  const provenance = catalog.vocabularyProvenance;
  const verification = catalog.vocabularyVerification;
  const commit = gspp?.verification?.sourceCommit;
  if (!gspp?.catalogDocument || gspp.verification?.valid !== true || !commit || !/^[0-9a-f]{40}$/.test(commit)
    || verification?.valid !== true || verification.sourceCommit !== commit || registry?.sourceCommitSha !== commit
    || provenance?.source.snapshotCommitSha !== commit) return undefined;
  const path = `${BSI_NAMESPACE_DIRECTORY}/target_object_categories.csv`;
  const namespaces = registry.namespaces.filter(namespace => namespace.source.path === path);
  const files = provenance.files.filter(file => file.path === path);
  if (namespaces.length !== 1 || files.length !== 1) return undefined;
  const namespace = namespaces[0];
  const file = files[0];
  if (file.namespace !== namespace.source.namespace || file.gitBlobSha !== namespace.source.gitBlobSha
    || !/^[0-9a-f]{40}$/.test(file.gitBlobSha) || !/^[0-9a-f]{64}$/.test(file.sha256)) return undefined;
  return { commit, namespace };
}
