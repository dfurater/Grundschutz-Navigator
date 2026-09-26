import { describe, expect, it } from 'vitest';
import { getVocabularyTermLabel, getVocabularyTitle } from './vocabularyTitle';

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

describe('getVocabularyTermLabel', () => {
  it('names the criteria like the table column headers', () => {
    expect(getVocabularyTermLabel('modal_verbs.csv')).toBe('Modalverb');
    expect(getVocabularyTermLabel('security_level.csv')).toBe('Sicherheitsniveau');
    expect(getVocabularyTermLabel('effort_level.csv')).toBe('Aufwand');
  });

  it('uses the singular for a single entry', () => {
    expect(getVocabularyTermLabel('basethreats.csv')).toBe('Elementare Gefährdung');
    expect(getVocabularyTermLabel('target_object_categories.csv')).toBe('Zielobjekt-Kategorie');
  });

  it('falls back to the vocabulary title for uncurated files', () => {
    expect(getVocabularyTermLabel('custom-security_topic.csv')).toBe('Custom Security Topic');
  });
});
