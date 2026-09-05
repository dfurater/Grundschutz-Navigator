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
  deriveNodeLimit,
  parseNodeCounts,
  MEMORY_BUDGET_BYTES,
  UI_BLOCKING_BUDGET_MS,
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
    endToEnd: { ms: 30, submitMs: 2, blockingMs: 0, longestTaskMs: 0, ok: true, code: null },
    heap: { retainedBytes: 100, identitySetBytes: 50, inputBytes: 1_000, peakBytes: 1_150 },
    ...overrides,
  };
}

describe('parseArguments', () => {
  it('setzt die Voreinstellungen ohne Argumente', () => {
    expect(parseArguments([])).toEqual({
      throttleRates: [1, 4], repeat: 3, jsonPath: null, scaleNodes: null, skipGlob: false,
    });
  });

  it('liest Drosselung, Wiederholungen und Ausgabepfad', () => {
    expect(parseArguments([
      '--throttle', '1,2,4', '--repeat', '5', '--json', 'out.json',
      '--scale', '125000,250000', '--skip-glob',
    ])).toEqual({
      throttleRates: [1, 2, 4],
      repeat: 5,
      jsonPath: 'out.json',
      scaleNodes: [125_000, 250_000],
      skipGlob: true,
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

  it('nimmt die Blockierzeit als Maximum, nicht als Median', () => {
    // Bedienbarkeit bemisst sich am schlechtesten beobachteten Lauf. Ein
    // Median versteckte genau den Ausreißer, der das Budget reißt.
    const blocking = (ms: number) => ({
      endToEnd: { ms: 30, submitMs: 1, blockingMs: ms, longestTaskMs: ms, ok: true, code: null },
    });
    const summary = summarizeSamples([
      sample(blocking(10)),
      sample(blocking(320)),
      sample(blocking(12)),
    ]);

    expect(summary.endToEnd.blockingMs).toBe(320);
    expect(summary.endToEnd.longestTaskMs).toBe(320);
  });

  it('weist eine leere Messreihe zurück', () => {
    expect(() => summarizeSamples([])).toThrow(RangeError);
  });
});

describe('parseNodeCounts', () => {
  it('liest gerade Knotenzahlen', () => {
    expect(parseNodeCounts('62500,125000,1000000')).toEqual([62_500, 125_000, 1_000_000]);
  });

  it('weist ungerade Zahlen zurück', () => {
    // `heap-bound` besteht aus Knotenpaaren und würde bei einer ungeraden
    // Vorgabe werfen — besser hier, mit lesbarer Begründung.
    expect(() => parseNodeCounts('999999')).toThrow(RangeError);
  });

  it('weist unlesbare und zu kleine Werte zurück', () => {
    expect(() => parseNodeCounts('abc')).toThrow(RangeError);
    expect(() => parseNodeCounts('2')).toThrow(RangeError);
  });
});

describe('Budgetkonstanten', () => {
  it('hält das Speicherbudget über dem gemessenen Worst Case', () => {
    // 89,14 MiB kostet `heap-bound` an der heutigen Knotengrenze. Ein Budget
    // auf oder unter diesem Wert wäre kein Budget, sondern eine Nacherzählung
    // der Messung.
    expect(MEMORY_BUDGET_BYTES).toBeGreaterThan(90 * 1024 * 1024);
  });

  it('hält das UI-Budget auf der Long-Task-Schwelle', () => {
    // Die Plattform meldet Tasks ab 50 ms. Läge das Budget darunter, könnte
    // die Messung eine Verletzung nicht mehr sehen.
    expect(UI_BLOCKING_BUDGET_MS).toBe(50);
  });
});

describe('deriveNodeLimit', () => {
  const row = (id: string, totalNodes: number, peakBytes: number, blockingMs: number) => ({
    id,
    totalNodes,
    heap: { retainedBytes: 0, identitySetBytes: 0, peakBytes },
    endToEnd: { ms: 0, submitMs: 0, blockingMs, longestTaskMs: blockingMs, ok: true, code: null },
  });

  it('nimmt den größten Stützpunkt, der beide Budgetposten hält', () => {
    expect(deriveNodeLimit([
      row('heap-bound', 125_000, MEMORY_BUDGET_BYTES - 1, 10),
      row('heap-bound', 250_000, MEMORY_BUDGET_BYTES - 1, 20),
      row('heap-bound', 500_000, MEMORY_BUDGET_BYTES + 1, 20),
    ])).toBe(250_000);
  });

  it('lässt sich vom UI-Budget deckeln, auch wenn der Speicher hielte', () => {
    // Beide Posten binden unabhängig voneinander. Ein Grenzwert, der nur den
    // Speicher prüft, wäre genau der Fehler, den der Codex-Befund aufgedeckt hat.
    expect(deriveNodeLimit([
      row('node-bound', 125_000, 1_000, UI_BLOCKING_BUDGET_MS),
      row('node-bound', 250_000, 1_000, UI_BLOCKING_BUDGET_MS + 1),
    ])).toBe(125_000);
  });

  it('richtet sich nach dem ungünstigsten Fixture, nicht nach dem freundlichsten', () => {
    expect(deriveNodeLimit([
      row('node-bound', 500_000, 1_000, 10),
      row('heap-bound', 500_000, MEMORY_BUDGET_BYTES + 1, 10),
      row('heap-bound', 125_000, 1_000, 10),
    ])).toBe(125_000);
  });

  it('gibt null zurück, wenn ein Fixture an keinem Stützpunkt hält', () => {
    // Fail-closed: Trägt die Messreihe keine Aussage, darf der Bericht auch
    // keine treffen — eine stillschweigend weggelassene Zeile hätte sonst
    // einen zu hohen Grenzwert begründet.
    expect(deriveNodeLimit([
      row('node-bound', 125_000, 1_000, 10),
      row('heap-bound', 125_000, MEMORY_BUDGET_BYTES + 1, 10),
    ])).toBeNull();
    expect(deriveNodeLimit([row('heap-bound', 125_000, 1_000, 999)])).toBeNull();
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
        observability: { probeMs: 120, observedMs: 121 },
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

  it('fällt das Budgeturteil selbst, statt es der Zahlenkolonne zu überlassen', () => {
    const render = (blockingMs: number) => renderReport({
      generatedAt: '2026-09-05T00:00:00.000Z',
      browserVersion: '151.0.0.0',
      runs: [{
        throttleRate: 4,
        repeat: 1,
        environment: { userAgent: 'HeadlessChrome' },
        observability: { probeMs: 120, observedMs: 121 },
        fixtures: [summarizeSamples([sample({
          endToEnd: { ms: 1_000, submitMs: 3, blockingMs, longestTaskMs: blockingMs, ok: true, code: null },
        })])],
        glob: [],
      }],
    });

    expect(render(UI_BLOCKING_BUDGET_MS)).toContain('| gehalten |');
    expect(render(UI_BLOCKING_BUDGET_MS + 0.1)).toContain('| GERISSEN |');
  });

  it('verweigert den Bericht, wenn der Messweg nicht belegt ist', () => {
    // Eine Blockierzeit von null ist ohne diesen Beleg zweideutig: freier
    // Main Thread oder blinde Instrumentierung. Der erste Messlauf dieser
    // Auflage hat für jedes Fixture null gemeldet, weil die Long-Task-API den
    // Task des Messtreibers nicht attribuiert. Ein Bericht darf daraus nie
    // wieder ein eingehaltenes Budget machen.
    expect(() => renderReport({
      generatedAt: '2026-09-05T00:00:00.000Z',
      browserVersion: '151.0.0.0',
      runs: [{
        throttleRate: 1,
        repeat: 1,
        environment: { userAgent: 'HeadlessChrome' },
        fixtures: [summarizeSamples([sample()])],
        glob: [],
      }],
    })).toThrow(/Long-Task-Beobachtbarkeit/);
  });

  it('urteilt fail-closed, wenn eine Messreihe keine Blockierzeit trägt', () => {
    // Ein Messlauf ohne die Felder erzeugt in der Verdichtung `NaN`. Der
    // Vergleich gegen das Budget ist dann falsch, und das Urteil muss
    // GERISSEN lauten — eine nicht erhobene Blockierzeit darf nie als
    // eingehaltenes Budget durchgehen.
    const markdown = renderReport({
      generatedAt: '2026-09-05T00:00:00.000Z',
      browserVersion: '151.0.0.0',
      runs: [{
        throttleRate: 1,
        repeat: 1,
        environment: { userAgent: 'HeadlessChrome' },
        observability: { probeMs: 120, observedMs: 121 },
        fixtures: [summarizeSamples([sample({ endToEnd: { ms: 30, ok: true, code: null } })])],
        glob: [],
      }],
    });

    expect(markdown).toContain('| GERISSEN |');
  });
});
