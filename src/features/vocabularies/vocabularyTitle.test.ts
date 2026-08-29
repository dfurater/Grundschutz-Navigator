import { describe, expect, it } from 'vitest';
import { getVocabularyTitle } from './vocabularyTitle';

describe('getVocabularyTitle', () => {
  it('returns the curated German title for registered vocabulary files', () => {
    expect(getVocabularyTitle('security_targets_levels.csv')).toBe('Schutzziel-Relevanz');
  });

  it('humanizes an uncurated vocabulary file name', () => {
    expect(getVocabularyTitle('custom-security_topic.csv')).toBe('Custom Security Topic');
  });
});
