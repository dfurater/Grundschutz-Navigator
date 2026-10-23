import { describe, expect, it } from 'vitest';
import { sspCategoryContext } from '@/domain/sspCategoryContext';
import type { CatalogState } from '@/domain/models';

function fixture() {
  const commit = 'a'.repeat(40);
  const source = { namespace: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/target_object_categories.csv', path: 'documentation/namespaces/target_object_categories.csv', gitBlobSha: 'b'.repeat(40) };
  const namespace = { source, entries: [] };
  return {
    catalogs: new Map([['gspp', { catalogDocument: {}, verification: { valid: true, sourceCommit: commit } }]]),
    vocabularyRegistry: { sourceCommitSha: commit, namespaces: [namespace], namespacesByUrl: new Map([[source.namespace, namespace]]) },
    vocabularyVerification: { valid: true, sourceCommit: commit },
    vocabularyProvenance: { source: { snapshotCommitSha: commit }, files: [{ ...source, sha256: 'c'.repeat(64) }] },
  };
}
describe('Verifizierter SSP-Kategorienkontext', () => {
  it('bindet Vokabular und Katalog an genau denselben verifizierten Commit', () => {
    expect(sspCategoryContext(fixture() as unknown as CatalogState)).toMatchObject({ commit: 'a'.repeat(40) });
  });
  it.each(['catalog', 'verification', 'registry', 'provenance', 'blob', 'hash'])('sperrt bei fehlendem oder manipuliertem %s', field => {
    const data = fixture();
    if (field === 'catalog') data.catalogs.get('gspp')!.verification.valid = false;
    if (field === 'verification') data.vocabularyVerification.valid = false;
    if (field === 'registry') data.vocabularyRegistry.sourceCommitSha = 'd'.repeat(40);
    if (field === 'provenance') data.vocabularyProvenance.source.snapshotCommitSha = 'd'.repeat(40);
    if (field === 'blob') data.vocabularyProvenance.files[0].gitBlobSha = 'e'.repeat(40);
    if (field === 'hash') data.vocabularyProvenance.files[0].sha256 = '';
    expect(sspCategoryContext(data as unknown as CatalogState)).toBeUndefined();
  });
});
