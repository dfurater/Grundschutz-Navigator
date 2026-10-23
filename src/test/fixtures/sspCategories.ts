import type { CatalogState, VocabularyNamespaceData } from '@/domain/models';
import { BSI_NAMESPACE_DIRECTORY } from '@/domain/vocabularyNamespaces';
import { buildVocabularyRegistry } from '@/domain/vocabulary';

export const SSP_CATEGORY_IDS = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002'] as const;
export const SSP_CATEGORY_COMMIT = 'a'.repeat(40);

/** Synthetischer, zusammengehöriger Katalog-/Vokabularstand für UI- und Worker-Vertragstests. */
export function withSspCategories(state: CatalogState): CatalogState {
  const path = `${BSI_NAMESPACE_DIRECTORY}/target_object_categories.csv`;
  const namespace: VocabularyNamespaceData = {
    source: { namespace: `https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/${path}`, repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek', path, fileName: 'target_object_categories.csv', routeId: 'target-object-categories', gitBlobSha: 'b'.repeat(40) },
    columnOrder: ['Zielobjekt', 'UUID', 'ChildOfUUID', 'Typ'], valueColumn: 'Zielobjekt', identifierColumns: ['UUID'], identifierReferenceColumns: ['ChildOfUUID'],
    entries: [
      { value: 'Synthetische Elternkategorie', columns: { UUID: SSP_CATEGORY_IDS[0], ChildOfUUID: '', Typ: '' } },
      { value: 'Synthetische Unterkategorie', columns: { UUID: SSP_CATEGORY_IDS[1], ChildOfUUID: SSP_CATEGORY_IDS[0], Typ: '' } },
    ],
  };
  const loaded = state.catalogs.get('gspp') ?? { catalog: state.catalog, loading: false, error: null };
  const verification = { valid: true, sourceCommit: SSP_CATEGORY_COMMIT, computedHash: 'c'.repeat(64), expectedHash: 'c'.repeat(64), fetchedAt: '2026-10-23T00:00:00Z' };
  return { ...state,
    catalogs: new Map([['gspp', { ...loaded, catalogDocument: { source: { catalog: { uuid: 'bbbbbbbb-0000-4000-8000-000000000001' } }, view: state.catalog! }, verification }]]),
    vocabularyRegistry: buildVocabularyRegistry({ sourceCommitSha: SSP_CATEGORY_COMMIT, namespaces: [namespace] }),
    vocabularyVerification: verification,
    vocabularyProvenance: { source: { snapshotCommitSha: SSP_CATEGORY_COMMIT }, files: [{ ...namespace.source, sha256: 'c'.repeat(64), sizeBytes: 1 }] } as unknown as CatalogState['vocabularyProvenance'],
  } as unknown as CatalogState;
}
