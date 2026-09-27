import { describe, expect, it } from 'vitest';
import { paramValues, resolveParams } from '@/adapters/oscalAdapter';
import type { ParamMeta } from '@/domain/models';
import { segmentStatement } from './statementSegments';

/**
 * Parität mit `resolveParams`: Aneinandergereiht ergeben die Segmente genau
 * den Text, den Suche und CSV aus `Control.statement` verwenden.
 */
describe('segmentStatement – Parität mit resolveParams', () => {
  it('entfernt eine Auswahlklammer um einen Platzhalter wie der Adapter', () => {
    const statementRaw = 'Die Institution muss {{vor {{ insert: param, p }} nach}} umsetzen.';
    const params: Record<string, ParamMeta> = { p: { value: 'Wert', hasValue: true } };
    const result = segmentStatement({
      statementRaw,
      params,
      modalverb: 'muss',
      handlungsworte: 'umsetzen',
    });

    expect(result.segments.map((segment) => segment.text).join('')).toBe(
      'Die Institution muss vor Wert nach umsetzen.',
    );
    expect(result.segments.find((segment) => segment.role === 'param')).toEqual({
      role: 'param',
      text: 'Wert',
      paramId: 'p',
    });
  });

  it.each([
    ['Klammer um Platzhalter', '{{ vor {{ insert: param, p }} nach }} muss umsetzen.'],
    ['Klammer im Wert und im Text', 'Die Institution muss {{eine}} {{ insert: param, k }} umsetzen.'],
    ['Klammer endet im Wert', 'Die Institution muss {{ vor {{ insert: param, z }} umsetzen.'],
    ['unbekannte ID in Klammer', 'Die Institution muss {{ vor {{ insert: param, fehlt }} }} umsetzen.'],
    ['Platzhalter ohne Klammer', '{{ insert: param, p }} muss {{ insert: param, q }}'],
  ])('ergibt aneinandergereiht exakt den Text von resolveParams (%s)', (_name, statementRaw) => {
    const params: Record<string, ParamMeta> = {
      p: { value: 'Wert', hasValue: true },
      q: { value: 'Stufe', hasValue: false },
      k: { value: '{{Alternative}}', hasValue: true },
      z: { value: 'Ende }}', hasValue: true },
    };
    const result = segmentStatement({ statementRaw, params, modalverb: 'muss' });

    expect(result.segments.map((segment) => segment.text).join('')).toBe(
      resolveParams(statementRaw, paramValues(params)),
    );
  });

  it('behält einen Platzhalter ohne Wert und ohne Label als leeres Segment', () => {
    const result = segmentStatement({
      statementRaw: 'Die Institution muss {{ insert: param, leer }} umsetzen.',
      params: { leer: { value: '', hasValue: false } },
      modalverb: 'muss',
      handlungsworte: 'umsetzen',
    });

    expect(result.segments.filter((segment) => segment.role === 'param')).toEqual([
      { role: 'param', text: '', paramId: 'leer' },
    ]);
    expect(result.segments.map((segment) => segment.text).join('')).toBe(
      'Die Institution muss  umsetzen.',
    );
  });
});
