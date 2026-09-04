// =============================================================================
// Die reine Logik des Kostenmesswerkzeugs aus GSPP-382. Verdichtung und
// Speicherzusammensetzung bestimmen die Zahlen, die in
// `docs/OSCAL_VALIDATION.md` das Ressourcenbudget begründen — ein Fehler hier
// macht das Protokoll unwahr, ohne dass ein Messlauf davon etwas merkt.
// =============================================================================

import { describe, expect, it } from 'vitest';
import {
  composeHeapFootprint,
  formatMiB,
  formatMs,
  median,
  parseArguments,
  parseThrottleRates,
  renderReport,
  summarizeSamples,
} from './measureClass2BudgetReport.mjs';

function sample(overrides: Record<string, unknown> = {}) {
  return {
    id: 'node-bound',
    limit: 'maxNodes',
    label: 'Knotengrenze',
    reachesSchemaStage: true,
    bytes: 1_000,
    stage1: { ms: 10, ok: true, code: null },
    objectChain: { ms: 20, ok: true, code: null },
    endToEnd: { ms: 30, ok: true, code: null },
    heap: { retainedBytes: 100, identitySetBytes: 50, inputBytes: 1_000, peakBytes: 1_150 },
    ...overrides,
  };
}

describe('parseArguments', () => {
  it('setzt die Voreinstellungen ohne Argumente', () => {
    expect(parseArguments([])).toEqual({ throttleRates: [1, 4], repeat: 3, jsonPath: null });
  });

  it('liest Drosselung, Wiederholungen und Ausgabepfad', () => {
    expect(parseArguments(['--throttle', '1,2,4', '--repeat', '5', '--json', 'out.json'])).toEqual({
      throttleRates: [1, 2, 4],
      repeat: 5,
      jsonPath: 'out.json',
    });
  });

  it('weist ein unbekanntes Argument zurück', () => {
    expect(() => parseArguments(['--unbekannt'])).toThrow(/Unbekanntes Argument/);
  });

  it('weist eine Wiederholungszahl unter eins zurück', () => {
    expect(() => parseArguments(['--repeat', '0'])).toThrow(RangeError);
  });

  it('weist eine nicht lesbare Wiederholungszahl zurück, statt mit NaN zu laufen', () => {
    expect(() => parseArguments(['--repeat', 'viele'])).toThrow(RangeError);
  });

  it('weist --json ohne Pfad zurück', () => {
    expect(() => parseArguments(['--json'])).toThrow(RangeError);
  });
});

describe('parseThrottleRates', () => {
  it('liest kommagetrennte Faktoren', () => {
    expect(parseThrottleRates('1,4')).toEqual([1, 4]);
  });

  it.each(['0', '-2', 'schnell', ''])('weist den Faktor %s zurück', (value) => {
    // Ein Faktor unter 1 wäre eine Beschleunigung, ein unlesbarer Wert würde
    // die ganze Messreihe stillschweigend mit NaN durchlaufen.
    expect(() => parseThrottleRates(value)).toThrow(RangeError);
  });
});

describe('median', () => {
  it('nimmt bei ungerader Länge den mittleren Wert', () => {
    expect(median([30, 10, 20])).toBe(20);
  });

  it('mittelt bei gerader Länge die beiden mittleren Werte', () => {
    expect(median([40, 10, 30, 20])).toBe(25);
  });

  it('weist eine leere Reihe zurück', () => {
    expect(() => median([])).toThrow(RangeError);
  });
});

describe('composeHeapFootprint', () => {
  it('summiert Gehaltenes, Identitätsmenge und Eingabepuffer zur Spitze', () => {
    // Der Eingabepuffer liegt als externer Speicher neben dem JS-Heap und
    // erscheint in `Runtime.getHeapUsage` nicht; die Identitätsmenge ist nach
    // dem Lauf der Invariante unerreichbar. Beides muss zugeschlagen werden,
    // sonst unterschätzt die Spitze den tatsächlichen Abdruck.
    expect(composeHeapFootprint({
      retainedBytes: 10,
      identitySetBytes: 20,
      inputBytes: 30,
    })).toEqual({
      retainedBytes: 10,
      identitySetBytes: 20,
      inputBytes: 30,
      peakBytes: 60,
    });
  });
});

describe('summarizeSamples', () => {
  it('nimmt Zeiten als Median und Speicher als Maximum', () => {
    const summary = summarizeSamples([
      sample({ stage1: { ms: 10, ok: true, code: null }, heap: { retainedBytes: 1, identitySetBytes: 1, inputBytes: 0, peakBytes: 2 } }),
      sample({ stage1: { ms: 90, ok: true, code: null }, heap: { retainedBytes: 5, identitySetBytes: 3, inputBytes: 0, peakBytes: 8 } }),
      sample({ stage1: { ms: 20, ok: true, code: null }, heap: { retainedBytes: 2, identitySetBytes: 2, inputBytes: 0, peakBytes: 4 } }),
    ]);

    expect(summary.stage1.ms).toBe(20);
    expect(summary.heap).toEqual({ retainedBytes: 5, identitySetBytes: 3, peakBytes: 8 });
    expect(summary.samples).toBe(3);
  });

  it('weist eine leere Messreihe zurück', () => {
    expect(() => summarizeSamples([])).toThrow(RangeError);
  });
});

describe('Formatierung', () => {
  it('schaltet ab einer Sekunde auf Sekunden um', () => {
    expect(formatMs(999.4)).toBe('999.4 ms');
    expect(formatMs(1000)).toBe('1.00 s');
  });

  it('rechnet Bytes in MiB um', () => {
    expect(formatMiB(1024 * 1024)).toBe('1.00 MiB');
  });
});

describe('renderReport', () => {
  it('rendert je Lauf eine Fixture- und eine Glob-Tabelle', () => {
    const markdown = renderReport({
      generatedAt: '2026-09-04T00:00:00.000Z',
      browserVersion: '151.0.0.0',
      runs: [{
        throttleRate: 4,
        repeat: 3,
        environment: { userAgent: 'HeadlessChrome' },
        fixtures: [summarizeSamples([sample()])],
        glob: [{ stars: 6, patternBytes: 13, subjectLength: 40, ms: 14 }],
      }],
    });

    expect(markdown).toContain('CPU-Drosselung 4x');
    expect(markdown).toContain('| node-bound | maxNodes |');
    expect(markdown).toContain('| 6 | 13 | 40 | 14.0 ms |');
    // Ob ein Fixture die Schemastufe erreicht, gehört in den Bericht: sonst
    // liest sich ein Wert ohne Ajv-Kosten wie ein vollständiger.
    expect(markdown).toContain('| ja |');
  });
});
