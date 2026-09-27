import { describe, expect, it } from 'vitest';
import { deriveRouteId } from './vocabularyRouteId';

describe('deriveRouteId', () => {
  it('bildet die Kennung aus dem ganzen Pfad ohne Dateiendung, klein geschrieben', () => {
    expect(deriveRouteId('documentation/namespaces/Security_Targets.csv'))
      .toBe('documentation-namespaces-security-targets');
  });

  it('entfernt nur die letzte Dateiendung', () => {
    expect(deriveRouteId('a/b.c.csv')).toBe('a-b-c');
    expect(deriveRouteId('ohne-endung')).toBe('ohne-endung');
  });

  it('fasst jede Folge von Zeichen außerhalb von a-z und 0-9 zu einem Trenner zusammen', () => {
    expect(deriveRouteId('a__b  c--d/ä.csv')).toBe('a-b-c-d');
  });

  it('entfernt führende und nachlaufende Trennzeichen separat', () => {
    expect(deriveRouteId('-leading.csv')).toBe('leading');
    expect(deriveRouteId('trailing-.md')).toBe('trailing');
    expect(deriveRouteId('-both-.md')).toBe('both');
  });

  it('liefert eine leere Kennung für reinen Trenner-Inhalt', () => {
    expect(deriveRouteId('---.csv')).toBe('');
  });

  it('bildet verschiedene Dateinamen auf dieselbe Kennung ab, wenn sie nur im Trenner abweichen', () => {
    // Die Kollision ist beabsichtigt dokumentiert; buildVocabularyRegistry wirft dann.
    expect(deriveRouteId('a_b.csv')).toBe(deriveRouteId('a-b.csv'));
  });
});
