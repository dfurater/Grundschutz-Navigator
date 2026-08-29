import { describe, expect, it } from 'vitest';
import { getVocabularyTitle } from './vocabularyTitle';

describe('getVocabularyTitle', () => {
  it('returns the curated German title for registered vocabulary files', () => {
    expect(getVocabularyTitle('security_targets_levels.csv')).toBe('Schutzziel-Relevanz');
  });

  it('humanizes an uncurated vocabulary file name', () => {
    expect(getVocabularyTitle('custom-security_topic.csv')).toBe('Custom Security Topic');
  });

  it('keeps umlauts inside words lowercase', () => {
    // `\w` wuerde den Umlaut als Wortgrenze werten und „GefäHrdungen“ erzeugen.
    expect(getVocabularyTitle('gefährdungen.csv')).toBe('Gefährdungen');
    expect(getVocabularyTitle('öffentliche_werte.csv')).toBe('Öffentliche Werte');
  });
});
