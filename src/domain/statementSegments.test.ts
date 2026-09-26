import { describe, expect, it } from 'vitest';
import type { ParamMeta } from '@/domain/models';
import type { SentenceSegment } from './statementSegments';
import { segmentStatement } from './statementSegments';

/** Lückenlosigkeits-Mapping (GSPP-303 T10): Segmente → aufgelöste Aussage. */
function joinedResolvedText(
  segments: readonly SentenceSegment[],
  params: Record<string, ParamMeta>,
): string {
  return segments
    .map((s) =>
      s.role === 'param' && s.paramId !== undefined
        ? params[s.paramId].value
        : s.text,
    )
    .join('');
}

describe('segmentStatement', () => {
  it('findet Ergebnis und Praezisierung auch vor dem Handlungswort im Satz', () => {
    const statementRaw =
      'Detektion KANN erkannte Schwachstellen anhand von risikobasierten Kriterien innerhalb einer Frist überprüfen.';
    const result = segmentStatement({
      statementRaw,
      params: {},
      practiceTitle: 'Detektion',
      modalverb: 'KANN',
      handlungsworte: 'überprüfen',
      ergebnis: 'erkannte Schwachstellen',
      praezisierung:
        'anhand von risikobasierten Kriterien innerhalb einer Frist',
    });

    expect(result.missing).toEqual([]);
    expect(result.segments.map((segment) => segment.role)).toEqual([
      'practice',
      'text',
      'modalverb',
      'text',
      'ergebnis',
      'text',
      'praezisierung',
      'text',
      'handlungswort',
      'text',
    ]);
    expect(joinedResolvedText(result.segments, {})).toBe(statementRaw);
  });

  it('segmentiert Praktik-Praefix, Modalverb, Ergebnis und Praezisierung; Handlungswort als Teilwort missing', () => {
    const statementRaw =
      'GC: Die Institution muss das Ergebnis in der Praezisierung trotz Verankerung beachten.';
    const params: Record<string, ParamMeta> = {};
    const result = segmentStatement({
      statementRaw,
      params,
      practiceTitle: 'GC',
      modalverb: 'muss',
      handlungsworte: 'verankern',
      ergebnis: 'Ergebnis',
      praezisierung: 'Praezisierung',
    });

    // "verankern" kommt nur als Teilwort in "Verankerung" vor (Grossschreibung
    // plus fehlende Wortgrenze) und darf daher nicht segmentiert werden.
    expect(result.missing).toEqual(['handlungsworte']);
    expect(result.segments.map((s) => s.role)).toEqual([
      'practice',
      'text',
      'modalverb',
      'text',
      'ergebnis',
      'text',
      'praezisierung',
      'text',
    ]);
    expect(joinedResolvedText(result.segments, params)).toBe(statementRaw);
  });

  it('laesst ein kleingeschriebenes Teilwort (verankerte) unsegmentiert', () => {
    const params: Record<string, ParamMeta> = {};
    const result = segmentStatement({
      statementRaw: 'Die Institution muss die verankerte Leitlinie beachten.',
      params,
      modalverb: 'muss',
      handlungsworte: 'verankern',
    });

    // "verankern" ist exakter Substring von "verankerte", aber kein ganzes Wort.
    expect(result.missing).toContain('handlungsworte');
    expect(
      result.segments.some((s) => s.text.includes('verankerte')),
    ).toBe(true);
    expect(result.segments.some((s) => s.role === 'handlungswort')).toBe(
      false,
    );
  });

  it('loest Ergebnis/Praezisierung nach Parameter-Aufloesung mit gemischten hasValue-Flags', () => {
    const statementRaw =
      'Die Institution muss umsetzen: {{ insert: param, a }} gilt innerhalb von {{ insert: param, b }}.';
    const params: Record<string, ParamMeta> = {
      a: { value: 'Wert', hasValue: true },
      b: { value: 'Frist', hasValue: false },
    };
    const result = segmentStatement({
      statementRaw,
      params,
      modalverb: 'muss',
      handlungsworte: 'umsetzen',
      ergebnis: 'Wert',
      praezisierung: 'Frist',
    });

    expect(result.missing).toEqual([]);
    const paramSegments = result.segments.filter((s) => s.role === 'param');
    expect(paramSegments).toHaveLength(2);
    expect(paramSegments[0]).toMatchObject({ paramId: 'a', text: 'Wert' });
    expect(paramSegments[1]).toMatchObject({ paramId: 'b', text: 'Frist' });
    expect(joinedResolvedText(result.segments, params)).toBe(
      'Die Institution muss umsetzen: Wert gilt innerhalb von Frist.',
    );
  });

  it('meldet ein abwesendes Ergebnis als missing', () => {
    const result = segmentStatement({
      statementRaw: 'Die Institution muss dokumentieren.',
      params: {},
      modalverb: 'muss',
      ergebnis: 'Bericht',
    });

    expect(result.missing).toContain('ergebnis');
  });

  it('faellt bei unbekannter Parameter-ID auf [id] zurueck (wie resolveParams)', () => {
    const statementRaw =
      'Die Institution muss {{ insert: param, unbekannt }} beachten.';
    const result = segmentStatement({
      statementRaw,
      params: {},
      modalverb: 'muss',
    });

    const paramSegments = result.segments.filter((s) => s.role === 'param');
    expect(paramSegments).toHaveLength(1);
    expect(paramSegments[0]).toMatchObject({
      paramId: 'unbekannt',
      text: '[unbekannt]',
    });
    expect(result.segments.map((s) => s.text).join('')).toBe(
      'Die Institution muss [unbekannt] beachten.',
    );
  });

  it('zeigt BSI-Auswahlklammern wie der Adapter ohne geschweifte Klammern', () => {
    const result = segmentStatement({
      statementRaw: 'Die Institution muss {{eine Option}} umsetzen.',
      params: {},
      modalverb: 'muss',
      handlungsworte: 'umsetzen',
    });

    expect(result.segments.map((segment) => segment.text).join('')).toBe(
      'Die Institution muss eine Option umsetzen.',
    );
  });

  it('deckt Platzhalter am Satzanfang und -ende ab; abwesende Praktik bleibt ohne missing', () => {
    const statementRaw = '{{ insert: param, p }} muss {{ insert: param, q }}';
    const params: Record<string, ParamMeta> = {
      p: { value: 'Zu Beginn', hasValue: true },
      q: { value: 'Beachtung', hasValue: true },
    };
    const result = segmentStatement({
      statementRaw,
      params,
      practiceTitle: 'YY',
      modalverb: 'muss',
      ergebnis: 'Beachtung',
    });

    // Praktik/Modalverb kennen kein missing: Abwesenheit wird still uebergangen.
    expect(result.missing).toEqual(['handlungsworte', 'praezisierung']);
    expect(result.segments.map((s) => s.role)).toEqual([
      'param',
      'text',
      'modalverb',
      'text',
      'param',
    ]);
    expect(joinedResolvedText(result.segments, params)).toBe(
      'Zu Beginn muss Beachtung',
    );
  });

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
});

