import { describe, expect, it } from 'vitest';
import type { ParamMeta } from '@/domain/models';
import { segmentStatement } from './statementSegments';

describe('segmentStatement: Überlappungen und Platzhalter in Satzteilen', () => {
  it('meldet ein vom Ergebnis verdecktes Handlungswort als missing', () => {
    const result = segmentStatement({
      statementRaw: 'Detektion MUSS Schwachstellen erkennen.',
      params: {},
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'erkennen',
      ergebnis: 'Schwachstellen erkennen',
    });

    expect(result.missing).toContain('handlungsworte');
    expect(result.segments.map((segment) => segment.role)).toEqual([
      'practice',
      'text',
      'modalverb',
      'text',
      'ergebnis',
      'text',
    ]);
  });

  it('sucht Ergebnis und Praezisierung erst hinter dem Praktik-Praefix', () => {
    const result = segmentStatement({
      statementRaw: 'Tests MUSS die Tests dokumentieren.',
      params: {},
      practiceTitle: 'Tests',
      modalverb: 'MUSS',
      handlungsworte: 'dokumentieren',
      ergebnis: 'Tests',
    });

    expect(result.missing).not.toContain('ergebnis');
    expect(result.segments).toContainEqual({ role: 'practice', text: 'Tests' });
    expect(result.segments).toContainEqual({ role: 'ergebnis', text: 'Tests' });
  });

  it('markiert einen Platzhalter als Teil der Praezisierung, die er vollstaendig bildet', () => {
    const params: Record<string, ParamMeta> = {
      frist: { value: 'innerhalb einer Frist', hasValue: false },
    };
    const result = segmentStatement({
      statementRaw: 'Detektion MUSS Meldungen {{ insert: param, frist }} prüfen.',
      params,
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'prüfen',
      praezisierung: 'innerhalb einer Frist',
    });

    expect(result.missing).not.toContain('praezisierung');
    expect(result.segments).toContainEqual({
      role: 'param',
      text: 'innerhalb einer Frist',
      paramId: 'frist',
      partOf: 'praezisierung',
    });
  });

  it('ordnet einen Platzhalter ueber zwei Satzteilen keinem zu und meldet die verdeckten als missing', () => {
    const params: Record<string, ParamMeta> = {
      p: { value: 'Bericht innerhalb einer Frist', hasValue: false },
    };
    const result = segmentStatement({
      statementRaw: 'Detektion MUSS einen {{ insert: param, p }} erstellen.',
      params,
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'erstellen',
      ergebnis: 'Bericht',
      praezisierung: 'innerhalb einer Frist',
    });

    expect(result.missing).toEqual(expect.arrayContaining(['ergebnis', 'praezisierung']));
    expect(result.segments).toContainEqual({
      role: 'param',
      text: 'Bericht innerhalb einer Frist',
      paramId: 'p',
    });
  });

  it('ordnet einen Platzhalter, der einen Satzteil samt weiterem Text umschliesst, keinem zu', () => {
    const params: Record<string, ParamMeta> = {
      p: { value: 'innerhalb einer Frist von 30 Tagen', hasValue: false },
    };
    const result = segmentStatement({
      statementRaw: 'Detektion MUSS Meldungen {{ insert: param, p }} prüfen.',
      params,
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'prüfen',
      praezisierung: 'innerhalb einer Frist',
    });

    expect(result.missing).toContain('praezisierung');
    expect(result.segments).toContainEqual({
      role: 'param',
      text: 'innerhalb einer Frist von 30 Tagen',
      paramId: 'p',
    });
  });

  it('meldet einen Satzteil, der einen Platzhalter nur anschneidet, als missing', () => {
    const params: Record<string, ParamMeta> = {
      p: { value: 'Frist von 30 Tagen', hasValue: false },
    };
    const result = segmentStatement({
      statementRaw: 'Detektion MUSS Meldungen innerhalb einer {{ insert: param, p }} prüfen.',
      params,
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'prüfen',
      praezisierung: 'innerhalb einer Frist',
    });

    // Sonst trüge nur „innerhalb einer “ die Beschriftung, und die Restzeile fehlte.
    expect(result.missing).toContain('praezisierung');
    expect(result.segments.some((segment) => segment.role === 'praezisierung')).toBe(false);
    expect(result.segments).toContainEqual({ role: 'param', text: 'Frist von 30 Tagen', paramId: 'p' });
  });

  it('verankert ein vom Ergebnis verdecktes Handlungswort an seiner nächsten Fundstelle dahinter', () => {
    // Greptile-Befund im Release-PR #313: Die erste Fundstelle liegt im
    // Ergebnis, die zweite steht frei; ohne Weitersuchen erschiene eine Restzeile.
    const statementRaw = 'Die Institution MUSS das Risiko prüfen und den Befund prüfen.';
    const result = segmentStatement({
      statementRaw,
      params: {},
      modalverb: 'MUSS',
      handlungsworte: 'prüfen',
      ergebnis: 'das Risiko prüfen',
    });

    expect(result.missing).not.toContain('handlungsworte');
    expect(result.segments.filter((segment) => segment.role !== 'text')).toEqual([
      { role: 'modalverb', text: 'MUSS' },
      { role: 'ergebnis', text: 'das Risiko prüfen' },
      { role: 'handlungswort', text: 'prüfen' },
    ]);
    expect(result.segments.map((segment) => segment.text).join('')).toBe(statementRaw);
  });

  it('verankert einen verdeckten Satzteil hinter dem früheren und meldet ihn nur ohne weitere Fundstelle', () => {
    const result = segmentStatement({
      statementRaw: 'Die Institution MUSS Berichte fristgerecht erstellen und fristgerecht prüfen.',
      params: {},
      modalverb: 'MUSS',
      handlungsworte: 'erstellen',
      ergebnis: 'Berichte fristgerecht erstellen',
      praezisierung: 'fristgerecht',
    });

    expect(result.missing).toEqual(['handlungsworte']);
    expect(result.segments.filter((segment) => segment.role !== 'text')).toEqual([
      { role: 'modalverb', text: 'MUSS' },
      { role: 'ergebnis', text: 'Berichte fristgerecht erstellen' },
      { role: 'praezisierung', text: 'fristgerecht' },
    ]);
  });
});
