import { describe, expect, it } from 'vitest';
import type { ParamMeta } from '@/domain/models';
import { segmentStatement } from './statementSegments';

describe('segmentStatement: Satzteile im eingesetzten Parameterwert', () => {
  const setValue = (value: string): ParamMeta => ({ value, hasValue: true });

  /**
   * Jeder gefundene Satzteil wird von aufeinanderfolgenden Segmenten mit seiner
   * Rolle (oder als `partOf`) vollständig getragen, nicht nur als Wortteil.
   */
  function expectFoundPartsReachable(input: Parameters<typeof segmentStatement>[0]) {
    const result = segmentStatement(input);
    const parts = [
      ['handlungsworte', 'handlungswort'],
      ['ergebnis', 'ergebnis'],
      ['praezisierung', 'praezisierung'],
    ] as const;
    for (const [key, role] of parts) {
      if (!input[key] || result.missing.includes(key)) continue;
      const runs: string[] = [];
      let previousCarries = false;
      for (const segment of result.segments) {
        const carries = segment.role === role || segment.partOf === role;
        if (carries && previousCarries) runs[runs.length - 1] += segment.text;
        else if (carries) runs.push(segment.text);
        previousCarries = carries;
      }
      expect(runs).toContain(input[key]);
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

  it('meldet ein Ergebnis als missing, dessen spätere Fundstelle einen Parameterwert anschneidet', () => {
    const result = expectFoundPartsReachable({
      statementRaw: 'Detektion MUSS {{ insert: param, p }} und das Risi{{ insert: param, suffix }} bewerten.',
      params: { p: setValue('das Risiko'), suffix: setValue('ko') },
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'bewerten',
      ergebnis: 'Risiko',
    });

    expect(result.missing).toContain('ergebnis');
    expect(result.segments.some((segment) => segment.role === 'ergebnis')).toBe(false);
  });

  it('meldet ein Ergebnis als missing, das zwei Parameterwerte mitten im Wort teilen', () => {
    const result = expectFoundPartsReachable({
      statementRaw: 'Detektion MUSS eine {{ insert: param, a }}{{ insert: param, b }} erstellen.',
      params: { a: setValue('Risiko'), b: setValue('analyse') },
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'erstellen',
      ergebnis: 'Risikoanalyse',
    });

    expect(result.missing).toContain('ergebnis');
    expect(result.segments.filter((segment) => segment.role === 'param')).toEqual([
      { role: 'param', text: 'Risiko', paramId: 'a' },
      { role: 'param', text: 'analyse', paramId: 'b' },
    ]);
  });

  it.each([
    ['einen Parameterwert anschneidet', 'Detektion MUSS Regeln verschär{{ insert: param, p }}.', 'fen'],
    ['einen Parameterwert umschließt', 'Detektion MUSS Regeln ver{{ insert: param, p }}en.', 'schärf'],
  ])('meldet ein Handlungswort als missing, das %s', (_, statementRaw, value) => {
    const result = expectFoundPartsReachable({
      statementRaw,
      params: { p: setValue(value) },
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'verschärfen',
    });

    expect(result.missing).toContain('handlungsworte');
    expect(result.segments.some((segment) => segment.role === 'handlungswort')).toBe(false);
  });

  it('verankert ein Handlungswort, in dem nur ein gesetzter leerer Wert steht, als ein Wort', () => {
    const result = expectFoundPartsReachable({
      statementRaw: 'Detektion MUSS Regeln prü{{ insert: param, leer }}fen.',
      params: { leer: { value: '', hasValue: true } },
      practiceTitle: 'Detektion',
      modalverb: 'MUSS',
      handlungsworte: 'prüfen',
    });

    expect(result.missing).not.toContain('handlungsworte');
    expect(result.segments).toContainEqual({ role: 'handlungswort', text: 'prüfen' });
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
