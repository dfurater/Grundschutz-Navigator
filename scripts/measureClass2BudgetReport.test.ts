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
    ...overrides,
  };
}

/**
 * Eine Fixture-Zeile, wie der Messlauf sie zusammensetzt: verdichtete Zeiten
 * plus der getrennt erhobene Speicherabdruck.
 */
function fixtureRow(
  overrides: Record<string, unknown> = {},
  heap: Record<string, number> = {
    stage1PeakBytes: 100, chainPeakBytes: 80, mainThreadBytes: 50, inputBytes: 1_000, peakBytes: 1_150,
  },
) {
  return { ...summarizeSamples([sample(overrides)]), heap, live: {} };
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
  it('nimmt den größeren Kettenhöchststand, nicht die Summe beider', () => {
    // Parse-Stufe und Objektkette halten VERSCHIEDENE Bestände: die eine die
    // dekodierte Zeichenkette, die andere das Paar-Array des breitesten
    // Records. Sie bestehen nacheinander, nicht gleichzeitig — eine Summe
    // würde die Spitze erfinden.
    expect(composeHeapFootprint({
      stage1PeakBytes: 10,
      chainPeakBytes: 40,
      mainThreadBytes: 20,
      inputBytes: 30,
    })).toEqual({
      stage1PeakBytes: 10,
      chainPeakBytes: 40,
      mainThreadBytes: 20,
      inputBytes: 30,
      peakBytes: 90,
    });
  });

  it('lässt einen negativen Main-Thread-Anteil die Spitze nicht kleinrechnen', () => {
    // Ein abgewiesenes Dokument schickt nur eine Diagnose zurück; der
    // gemessene Anteil liegt dann um null und kann knapp negativ ausfallen.
    expect(composeHeapFootprint({
      stage1PeakBytes: 100, chainPeakBytes: 0, mainThreadBytes: -7, inputBytes: 5,
    })).toMatchObject({ mainThreadBytes: 0, peakBytes: 105 });
  });

  it('schlägt den Main-Thread-Anteil und einen zweiten Eingabepuffer zu', () => {
    // Der Main-Thread-Anteil kommt HINZU statt zu konkurrieren: Der Worker
    // wird erst nach Eintreffen der Antwort beendet, sein Bestand lebt also
    // noch, während der Hauptkontext den Ergebnisklon aufbaut. Und die
    // Eingabebytes liegen doppelt, weil `copyForTransfer` eine vollständige
    // Kopie für die Übergabe anlegt — die Kettenmessung hält davon nur eine.
    expect(composeHeapFootprint({
      stage1PeakBytes: 100,
      chainPeakBytes: 0,
      mainThreadBytes: 7,
      inputBytes: 5,
    }).peakBytes).toBe(112);
  });
});

describe('summarizeSamples', () => {
  it('nimmt Zeiten als Median und trägt keinen Speicher', () => {
    const summary = summarizeSamples([
      sample({ stage1: { ms: 10, ok: true, code: null } }),
      sample({ stage1: { ms: 90, ok: true, code: null } }),
      sample({ stage1: { ms: 20, ok: true, code: null } }),
    ]);

    expect(summary.stage1.ms).toBe(20);
    // Der Speicher wird getrennt und nur einmal erhoben — eine Verdichtung
    // über Wiederholungen gibt es für ihn nicht.
    expect(summary).not.toHaveProperty('heap');
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
    // 112,93 MiB kostet `heap-bound` an der heutigen Knotengrenze, gemessen
    // mit einem Messweg, der Puffer und externe Strings einschließt. Ein
    // Budget auf oder unter diesem Wert wäre kein Budget, sondern eine
    // Nacherzählung der Messung.
    expect(MEMORY_BUDGET_BYTES).toBeGreaterThan(113 * 1024 * 1024);
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
    heap: { stage1PeakBytes: 0, chainPeakBytes: 0, mainThreadBytes: 0, peakBytes },
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

  it('verlangt an jedem Stützpunkt jedes Fixture der Reihe', () => {
    // Regression zum Codex-Befund zu 84ca1f6: Die erste Fassung bildete das
    // Minimum der je Fixture größten bestandenen Knotenzahl und nannte damit
    // 125 000, obwohl `node-bound` dort überhaupt nicht gemessen war. Eine
    // fehlende Zeile ist keine bestandene.
    expect(deriveNodeLimit([
      row('node-bound', 500_000, 1_000, 10),
      row('heap-bound', 500_000, MEMORY_BUDGET_BYTES + 1, 10),
      row('heap-bound', 125_000, 1_000, 10),
    ])).toBeNull();
  });

  it('nennt keinen Stützpunkt, an dem ein Fixture das Budget reißt', () => {
    // Die Zahlen des Codex-Befunds zu 84ca1f6, unverändert: Der Speicher hält
    // überall, aber `combined-bound` reißt bei 125 000 das UI-Budget, während
    // `node-bound` erst bei 250 000 reißt. Das Minimum der je Fixture größten
    // bestandenen Knotenzahl ergab 125 000 — einen Stützpunkt, an dem gemessen
    // wurde, dass er nicht hält. Es gibt hier keinen gemeinsamen Stützpunkt.
    expect(deriveNodeLimit([
      row('node-bound', 125_000, 1_000, 0),
      row('node-bound', 250_000, 1_000, 61),
      row('combined-bound', 125_000, 1_000, 65),
      row('combined-bound', 250_000, 1_000, 49),
      row('heap-bound', 125_000, 1_000, 0),
      row('heap-bound', 250_000, 1_000, 0),
    ])).toBeNull();
  });

  it('lässt einen gerissenen Stützpunkt von einem größeren nicht aufheben', () => {
    // Browsermessungen sind nicht monoton. Hält 125 000 nicht, ist 250 000
    // kein tragfähiger Grenzwert, auch wenn dort zufällig alles hält: Ein
    // Grenzwert deckt alles unter sich mit ab.
    expect(deriveNodeLimit([
      row('node-bound', 62_500, 1_000, 0),
      row('node-bound', 125_000, 1_000, UI_BLOCKING_BUDGET_MS + 1),
      row('node-bound', 250_000, 1_000, 0),
    ])).toBe(62_500);
  });

  it('gibt null zurück, wenn schon der kleinste Stützpunkt nicht hält', () => {
    // Fail-closed: Trägt die Messreihe keine Aussage, darf der Bericht auch
    // keine treffen.
    expect(deriveNodeLimit([
      row('node-bound', 125_000, 1_000, 10),
      row('heap-bound', 125_000, MEMORY_BUDGET_BYTES + 1, 10),
    ])).toBeNull();
    expect(deriveNodeLimit([row('heap-bound', 125_000, 1_000, 999)])).toBeNull();
    expect(deriveNodeLimit([])).toBeNull();
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
        memoryObservability: { probeBytes: 16_777_216, observedBytes: 16_800_000 },
        memoryThrottleRate: 1,
        fixtures: [fixtureRow()],
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
        memoryObservability: { probeBytes: 16_777_216, observedBytes: 16_800_000 },
        memoryThrottleRate: 1,
        fixtures: [fixtureRow({
          endToEnd: { ms: 1_000, submitMs: 3, blockingMs, longestTaskMs: blockingMs, ok: true, code: null },
        })],
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
        fixtures: [fixtureRow()],
        glob: [],
      }],
    })).toThrow(/Long-Task-Beobachtbarkeit/);
  });

  it('verweigert den Bericht, wenn der Speichermessweg nicht belegt ist', () => {
    // Derselbe Grund wie beim Long-Task-Beleg, nur für die andere Achse: Der
    // Vorgänger dieser Messung las `Runtime.getHeapUsage` und sah damit weder
    // `ArrayBuffer`-Backing-Stores noch externe Blink-Strings — zweistellige
    // MiB-Beträge im Tab. Ein Bericht ohne Beleg für den Messweg dürfte daraus
    // nie ein eingehaltenes Speicherbudget machen.
    expect(() => renderReport({
      generatedAt: '2026-09-05T00:00:00.000Z',
      browserVersion: '151.0.0.0',
      runs: [{
        throttleRate: 1,
        repeat: 1,
        environment: { userAgent: 'HeadlessChrome' },
        observability: { probeMs: 120, observedMs: 121 },
        fixtures: [fixtureRow()],
        glob: [],
      }],
    })).toThrow(/Speicher-Beobachtbarkeit/);
  });

  it('fällt auch über dem Speicherbudget ein Urteil', () => {
    const render = (peakBytes: number) => renderReport({
      generatedAt: '2026-09-05T00:00:00.000Z',
      browserVersion: '151.0.0.0',
      runs: [{
        throttleRate: 1,
        repeat: 1,
        environment: { userAgent: 'HeadlessChrome' },
        observability: { probeMs: 120, observedMs: 121 },
        memoryObservability: { probeBytes: 16_777_216, observedBytes: 16_800_000 },
        memoryThrottleRate: 1,
        fixtures: [fixtureRow({}, {
          stage1PeakBytes: peakBytes, chainPeakBytes: 0, mainThreadBytes: 0, inputBytes: 0, peakBytes,
        })],
        glob: [],
      }],
    });

    expect(render(MEMORY_BUDGET_BYTES)).toContain('| gehalten |');
    expect(render(MEMORY_BUDGET_BYTES + 1)).toContain('| GERISSEN |');
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
        memoryObservability: { probeBytes: 16_777_216, observedBytes: 16_800_000 },
        memoryThrottleRate: 1,
        fixtures: [fixtureRow({ endToEnd: { ms: 30, ok: true, code: null } })],
        glob: [],
      }],
    });

    expect(markdown).toContain('| GERISSEN |');
  });
});
