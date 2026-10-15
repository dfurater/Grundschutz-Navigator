import { describe, expect, it } from 'vitest';
import { buildVocabularyEntryPath, buildVocabularyNamespacePath } from '@/features/vocabulary/routes';

describe('vocabulary routes', () => {
  it('preserves the active links percent encoding for selected values', () => {
    expect(buildVocabularyEntryPath('terms', "ä +&#/?'"))
      .toBe("/vokabular/terms?wert=%C3%A4%20%2B%26%23%2F%3F'");
  });

  it('distinguishes an omitted selection from an explicitly empty value', () => {
    expect(buildVocabularyNamespacePath('terms')).toBe('/vokabular/terms');
    expect(buildVocabularyEntryPath('terms')).toBe('/vokabular/terms');
    expect(buildVocabularyEntryPath('terms', '')).toBe('/vokabular/terms?wert=');
  });
});
