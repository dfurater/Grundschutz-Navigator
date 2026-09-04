import { describe, expect, it } from 'vitest';
import type { Topic } from './models';
import { resolveTopicVocabulary } from './taxonomyVocabulary';
import {
  VOCABULARY_IDENTIFIERS,
  createTestVocabularyRegistry,
} from '@/test/fixtures/vocabulary';

describe('taxonomy vocabulary', () => {
  it('joins shared topic definitions only by altIdentifier UUID', () => {
    const topic: Topic = {
      id: 'GC.2',
      title: 'Organisation',
      label: '2',
      altIdentifier: VOCABULARY_IDENTIFIERS.topicOrganisation,
      practiceId: 'GC',
      controlCount: 0,
      controlIds: [],
    };
    const registry = createTestVocabularyRegistry();

    expect(resolveTopicVocabulary(registry, topic)?.entry.definition).toBe(
      'Offizielle Themen-Definition.',
    );
    expect(resolveTopicVocabulary(registry, {
      ...topic,
      id: 'ASST.2',
      practiceId: 'ASST',
    })?.entry).toBe(resolveTopicVocabulary(registry, topic)?.entry);
    expect(resolveTopicVocabulary(registry, {
      ...topic,
      altIdentifier: undefined,
    })).toBeNull();
    expect(resolveTopicVocabulary(registry, {
      ...topic,
      altIdentifier: 'unbekannte-uuid',
    })).toBeNull();
  });
});
