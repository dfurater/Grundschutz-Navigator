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

  it('ordnet einen Platzhalter, der nur teilweise in einem Satzteil liegt, keinem zu', () => {
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

    expect(result.missing).not.toContain('praezisierung');
    expect(result.segments).toContainEqual({ role: 'praezisierung', text: 'innerhalb einer ' });
    expect(result.segments).toContainEqual({ role: 'param', text: 'Frist von 30 Tagen', paramId: 'p' });
  });
});

describe('segmentStatement: Satzteile im eingesetzten Parameterwert', () => {
  const setValue = (value: string): ParamMeta => ({ value, hasValue: true });

  /** Jeder gefundene Satzteil braucht ein Segment, das seine Rolle trägt. */
  function expectFoundPartsReachable(input: Parameters<typeof segmentStatement>[0]) {
    const result = segmentStatement(input);
    const parts = [
      ['handlungsworte', 'handlungswort'],
      ['ergebnis', 'ergebnis'],
      ['praezisierung', 'praezisierung'],
    ] as const;
    for (const [key, role] of parts) {
      if (!input[key] || result.missing.includes(key)) continue;
      expect(result.segments.some((segment) => segment.role === role || segment.partOf === role)).toBe(true);
    }
    return result;
  }

  it('meldet ein Handlungswort, das nur als Parameterwert vorkommt, als missing', () => {
    const result = expectFoundPartsReachable({
      statementRaw: 'Detektion MUSS die Regeln {{ insert: param, p }}.',
      params: { p: setValue('verschärfen') },
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'verschärfen',
    });

    expect(result.missing).toContain('handlungsworte');
    expect(result.segments).toContainEqual({ role: 'param', text: 'verschärfen', paramId: 'p' });
  });

  it('verankert das Handlungswort an der ersten Fundstelle außerhalb eines Parameterwerts', () => {
    const result = expectFoundPartsReachable({
      statementRaw: 'Detektion MUSS {{ insert: param, p }} und Regeln prüfen.',
      params: { p: setValue('Protokolle prüfen') },
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'prüfen',
    });

    expect(result.missing).not.toContain('handlungsworte');
    expect(result.segments.at(-2)).toEqual({ role: 'handlungswort', text: 'prüfen' });
  });

  it('verankert das Modalverb nicht im Parameterwert', () => {
    const result = expectFoundPartsReachable({
      statementRaw: 'Detektion {{ insert: param, p }} MUSS Regeln prüfen.',
      params: { p: setValue('für MUSS-Vorgaben') },
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'prüfen',
    });

    expect(result.segments).toContainEqual({ role: 'modalverb', text: 'MUSS' });
    expect(result.segments).toContainEqual({ role: 'param', text: 'für MUSS-Vorgaben', paramId: 'p' });
  });

  it('verankert die Praktik nicht in einem Parameterwert am Satzanfang', () => {
    const result = expectFoundPartsReachable({
      statementRaw: '{{ insert: param, p }} MUSS Regeln prüfen.',
      params: { p: setValue('Detektion') },
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'prüfen',
    });

    expect(result.segments[0]).toEqual({ role: 'param', text: 'Detektion', paramId: 'p' });
    expect(result.segments.some((segment) => segment.role === 'practice')).toBe(false);
  });

  it('verankert ein Ergebnis im Text, wenn es zuerst im Inneren eines Parameterwerts steht', () => {
    const result = expectFoundPartsReachable({
      statementRaw: 'Detektion MUSS {{ insert: param, p }} und einen Bericht erstellen.',
      params: { p: setValue('den Bericht prüfen') },
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'erstellen',
      ergebnis: 'Bericht',
    });

    expect(result.missing).not.toContain('ergebnis');
    expect(result.segments).toContainEqual({ role: 'ergebnis', text: 'Bericht' });
  });

  it('meldet ein Ergebnis über zwei Parameterwerte ohne eigenen Text als missing', () => {
    const result = expectFoundPartsReachable({
      statementRaw: 'Detektion MUSS {{ insert: param, a }}{{ insert: param, b }} erstellen.',
      params: { a: setValue('einen Be'), b: setValue('richt heute') },
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'erstellen',
      ergebnis: 'Bericht',
    });

    expect(result.missing).toContain('ergebnis');
  });

  it('ordnet einen leeren Platzhalter an der Grenze eines Satzteils diesem nicht zu', () => {
    const result = expectFoundPartsReachable({
      statementRaw: 'Detektion MUSS {{ insert: param, p }}{{ insert: param, leer }} erstellen.',
      params: { p: setValue('einen Bericht'), leer: { value: '', hasValue: false } },
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'erstellen',
      ergebnis: 'Bericht',
    });

    expect(result.missing).toContain('ergebnis');
    expect(result.segments).toContainEqual({ role: 'param', text: '', paramId: 'leer' });
  });
});
