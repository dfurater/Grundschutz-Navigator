import { describe, expect, it } from 'vitest';
import {
  analyzeTopicVocabularyCoverage,
  assertTopicVocabularyCoverage,
} from './taxonomy-coverage.mjs';

const PINNED_SHA = '12abb438fcdb4f4b63fb3e751e89d7c526e647b5';
const FUTURE_SHA = 'f'.repeat(40);

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
  it('measures and accepts the exact pinned 139-to-119 coverage', () => {
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
    expect(() => assertTopicVocabularyCoverage(PINNED_SHA, coverage)).not.toThrow();
  });

  it('reports both mismatch directions and rejects drift on the pinned snapshot', () => {
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
    expect(() => assertTopicVocabularyCoverage(PINNED_SHA, coverage)).toThrow(
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
