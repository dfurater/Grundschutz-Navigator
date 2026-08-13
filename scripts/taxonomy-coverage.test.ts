import { describe, expect, it } from 'vitest';
import {
  analyzePracticeVocabularyIntegrity,
  analyzeTopicVocabularyCoverage,
  assertPracticeVocabularyIntegrity,
  assertTopicVocabularyCoverage,
} from './taxonomy-coverage.mjs';

const ARBITRARY_SHA = '12abb438fcdb4f4b63fb3e751e89d7c526e647b5';
const FUTURE_SHA = 'f'.repeat(40);

function makePracticeCoverageFixture() {
  return {
    catalog: {
      catalog: {
        groups: [
          {
            id: 'GC',
            props: [{ name: 'alt-identifier', value: 'practice-uuid-1' }],
          },
          {
            id: 'ISMS',
            props: [{ name: 'alt-identifier', value: 'practice-uuid-2' }],
          },
        ],
      },
    },
    namespace: {
      entries: [
        { value: 'GC', columns: { UUID: 'practice-uuid-1' } },
        { value: 'ISMS', columns: { UUID: 'practice-uuid-2' } },
      ],
    },
  };
}

describe('practice taxonomy integrity', () => {
  it('accepts complete bidirectional Practice UUID coverage', () => {
    const fixture = makePracticeCoverageFixture();

    const integrity = analyzePracticeVocabularyIntegrity(
      fixture.catalog,
      fixture.namespace,
    );

    expect(integrity).toMatchObject({
      catalogPracticeCount: 2,
      distinctCatalogUuidCount: 2,
      csvEntryCount: 2,
      matchedCatalogPracticeCount: 2,
      unmatchedCatalogPracticeCount: 0,
      orphanCsvEntryCount: 0,
      missingCatalogUuidCount: 0,
      duplicateCatalogUuidCount: 0,
      duplicateUuidCount: 0,
    });
    expect(() => assertPracticeVocabularyIntegrity(FUTURE_SHA, integrity)).not.toThrow();
  });

  it('rejects missing, duplicate, and bidirectionally unmatched Practice UUIDs', () => {
    const fixture = makePracticeCoverageFixture();
    const duplicateNamespace = {
      entries: [
        ...fixture.namespace.entries,
        { value: 'ORP', columns: { UUID: 'practice-uuid-1' } },
      ],
    };
    const missingUuidNamespace = {
      entries: [{ value: 'DER', columns: {} }],
    };

    const duplicateIntegrity = analyzePracticeVocabularyIntegrity(
      fixture.catalog,
      duplicateNamespace,
    );
    expect(duplicateIntegrity.duplicateUuidCount).toBe(1);
    expect(() => assertPracticeVocabularyIntegrity(
      FUTURE_SHA,
      duplicateIntegrity,
    )).toThrow('Practice-UUID-Integrität');
    expect(() => assertPracticeVocabularyIntegrity(
      FUTURE_SHA,
      analyzePracticeVocabularyIntegrity(fixture.catalog, missingUuidNamespace),
    )).toThrow('Einträge ohne UUID');

    fixture.namespace.entries[1].columns.UUID = 'orphan-practice-uuid';
    const mismatchedIntegrity = analyzePracticeVocabularyIntegrity(
      fixture.catalog,
      fixture.namespace,
    );
    expect(mismatchedIntegrity.unmatchedCatalogPractices).toContainEqual({
      id: 'ISMS',
      uuid: 'practice-uuid-2',
    });
    expect(mismatchedIntegrity.orphanCsvEntries).toContainEqual({
      value: 'ISMS',
      uuid: 'orphan-practice-uuid',
    });
    expect(() => assertPracticeVocabularyIntegrity(
      FUTURE_SHA,
      mismatchedIntegrity,
    )).toThrow('Practice-UUID-Integrität');
    expect(() => assertPracticeVocabularyIntegrity(FUTURE_SHA, null)).toThrow(
      'practices.csv fehlt',
    );
  });
});

function makeCoverageFixture() {
  const entries = Array.from({ length: 119 }, (_, index) => ({
    value: `Thema ${index}`,
    columns: { UUID: `uuid-${index}` },
  }));
  const groups = Array.from({ length: 139 }, (_, index) => ({
    id: `GC.${index + 1}`,
    props: [{
      name: 'alt-identifier',
      value: `uuid-${index < 119 ? index : 0}`,
    }],
  }));

  return {
    catalog: { catalog: { groups: [{ id: 'GC', groups }] } },
    namespace: { entries },
  };
}

describe('topic taxonomy coverage', () => {
  it('measures and accepts complete 139-to-119 coverage', () => {
    const fixture = makeCoverageFixture();
    const coverage = analyzeTopicVocabularyCoverage(
      fixture.catalog,
      fixture.namespace,
    );

    expect(coverage).toMatchObject({
      catalogTopicCount: 139,
      distinctCatalogUuidCount: 119,
      csvEntryCount: 119,
      matchedCatalogTopicCount: 139,
      unmatchedCatalogTopicCount: 0,
      orphanCsvEntryCount: 0,
      missingCatalogUuidCount: 0,
      duplicateCsvUuidCount: 0,
    });
    expect(() => assertTopicVocabularyCoverage(ARBITRARY_SHA, coverage)).not.toThrow();
  });

  it('accepts a strongly different but fully resolved topic quantity', () => {
    const coverage = {
      catalogTopicCount: 2,
      distinctCatalogUuidCount: 2,
      csvEntryCount: 2,
      matchedCatalogTopicCount: 2,
      unmatchedCatalogTopicCount: 0,
      orphanCsvEntryCount: 0,
      missingCatalogUuidCount: 0,
      duplicateCsvUuidCount: 0,
      unmatchedCatalogTopics: [],
      orphanCsvEntries: [],
      duplicateCsvUuids: [],
    };

    expect(() => assertTopicVocabularyCoverage(ARBITRARY_SHA, coverage)).not.toThrow();
  });

  it('reports both mismatch directions and rejects drift on every snapshot', () => {
    const fixture = makeCoverageFixture();
    fixture.namespace.entries[118].columns.UUID = 'uuid-orphan';
    const coverage = analyzeTopicVocabularyCoverage(
      fixture.catalog,
      fixture.namespace,
    );

    expect(coverage.unmatchedCatalogTopics).toContainEqual({
      id: 'GC.119',
      practiceId: 'GC',
      uuid: 'uuid-118',
    });
    expect(coverage.orphanCsvEntries).toContainEqual({
      value: 'Thema 118',
      uuid: 'uuid-orphan',
    });
    expect(() => assertTopicVocabularyCoverage(ARBITRARY_SHA, coverage)).toThrow(
      'Topic-Coverage',
    );
  });

  it('rejects bidirectional UUID drift on every future snapshot', () => {
    const fixture = makeCoverageFixture();
    fixture.namespace.entries[118].columns.UUID = 'uuid-orphan';
    const coverage = analyzeTopicVocabularyCoverage(
      fixture.catalog,
      fixture.namespace,
    );

    expect(() => assertTopicVocabularyCoverage(FUTURE_SHA, coverage)).toThrow(
      'Topic-Coverage',
    );
    expect(() => assertTopicVocabularyCoverage(FUTURE_SHA, null)).toThrow(
      'topics.csv fehlt',
    );
  });
});
