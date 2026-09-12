// =============================================================================
// Die reine Logik des Kostenmesswerkzeugs aus GSPP-382. Verdichtung und
// Speicherzusammensetzung bestimmen die Zahlen, die in
// `docs/OSCAL_VALIDATION.md` das Ressourcenbudget begründen — ein Fehler hier
// macht das Protokoll unwahr, ohne dass ein Messlauf davon etwas merkt.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  composeHeapFootprint,
  formatMiB,
  formatMs,
  median,
  parseArguments,
  parseThrottleRates,
  renderReport as renderRawReport,
  summarizeSamples,
  deriveNodeLimit,
  deriveSeriesWorkUnitLimit,
  deriveWorkUnitLimit,
  evaluateWorkUnitSeries,
  assertWorkLimitRun,
  seriesIsDocumentCapped,
  parseNodeCounts,
  MEMORY_BUDGET_BYTES,
  UI_BLOCKING_BUDGET_MS,
} from './measureClass2BudgetReport.mjs';
import { WORK_UNIT_LIMIT } from '../src/domain/profileResolutionBudgetLimits.mjs';
import { WORK_UNIT_CATEGORIES } from './profileResolutionWorstCaseFixtures.mjs';
import { workLimitProvenance } from './measureWorkLimitProvenance.mjs';

const source = { commit: 'a'.repeat(40), sha256: 'b'.repeat(64), files: 1 };
function renderReport(report: Record<string, unknown>) {
  return renderRawReport({ sourceBefore: source, sourceAfter: source, ...report });
}

function sample(overrides: Record<string, unknown> = {}) {
  return {
    id: 'node-bound',
    expectedCode: null,
    limit: 'maxNodes',
    label: 'Knotengrenze',
    reachesSchemaStage: true,
    bytes: 1_000,
    stage1: { ms: 10, ok: true, code: null },
    objectChain: { ms: 20, ok: true, code: null },
    endToEnd: { longTasks: [], ms: 30, submitMs: 2, blockingMs: 0, longestTaskMs: 0, ok: true, code: null },
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
    stage1PeakBytes: 100, chainPeakBytes: 80, mainThreadBytes: 50, inputBytes: 1_000, transportInventoryBytes: 0, peakBytes: 1_150,
  },
) {
  return { ...summarizeSamples([sample(overrides)]), heap, live: {} };
}

describe('parseArguments', () => {
  it('setzt die Voreinstellungen ohne Argumente', () => {
    expect(parseArguments([])).toEqual({
      throttleRates: [1, 4], repeat: 3, jsonPath: null, scaleNodes: null, skipGlob: false,
      skipProfileResolution: false, skipFixtures: false, calibrate: false,
      searchWorkLimit: false, printSourceFingerprint: false,
    });
  });

  it('liest Drosselung, Wiederholungen und Ausgabepfad', () => {
    expect(parseArguments([
      '--throttle', '1,2,4', '--repeat', '5', '--json', 'out.json',
      '--scale', '125000,250000', '--skip-glob', '--skip-profile-resolution', '--skip-fixtures',
    ])).toEqual({
      throttleRates: [1, 2, 4],
      repeat: 5,
      jsonPath: 'out.json',
      scaleNodes: [125_000, 250_000],
      skipGlob: true,
      skipProfileResolution: true,
      skipFixtures: true,
      calibrate: false,
      searchWorkLimit: false,
      printSourceFingerprint: false,
    });
  });

  it('erklärt mit --search-work-limit den Lauf als Herleitung', () => {
    // Ohne dieses Flag ist jeder Lauf eine BESTÄTIGUNG und bricht ab, sobald
    // eine Reihe unterhalb des einkompilierten Werts reißt. Ein Herleitungslauf
    // sucht den Riss gerade — er muss sich deshalb ausdrücklich als solcher
    // erklären, statt dass der Bericht beide Fälle stillschweigend vermischt.
    expect(parseArguments(['--search-work-limit']).searchWorkLimit).toBe(true);
  });

  it('druckt mit --print-source-fingerprint nur den Quellfingerprint', () => {
    expect(parseArguments(['--print-source-fingerprint']).printSourceFingerprint).toBe(true);
  });

  it('schaltet mit --calibrate jede Messreihe ab', () => {
    // Ein Kalibrierlauf erhebt allein die Raten der Fixtures. Liefe er
    // zusätzlich die Stützpunkte, wären seine Zahlen an Fixtures gemessen,
    // die er gerade erst neu vermisst.
    expect(parseArguments(['--calibrate'])).toEqual({
      throttleRates: [1],
      repeat: 3,
      jsonPath: null,
      scaleNodes: null,
      skipGlob: true,
      skipProfileResolution: true,
      skipFixtures: true,
      calibrate: true,
      searchWorkLimit: false,
      printSourceFingerprint: false,
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
    heap: { stage1PeakBytes: 0, chainPeakBytes: 0, mainThreadBytes: 0, inputBytes: 0, transportInventoryBytes: 0, peakBytes },
    endToEnd: { valid: true, longTasks: [], ms: 0, maxMs: 0, submitMs: 0, blockingMs, longestTaskMs: blockingMs, ok: true, code: null },
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
          stage1PeakBytes: peakBytes, chainPeakBytes: 0, mainThreadBytes: 0, inputBytes: 0, transportInventoryBytes: 0, peakBytes,
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


describe('GSPP-386 transport evidence', () => {
  it('rendert das eingecheckte Messartefakt mit vollständigen Wartezeithöchstwerten', () => {
    const report = JSON.parse(readFileSync(
      resolve(process.cwd(), 'docs/measurements/gspp386-worker-transport.json'),
      'utf8',
    ));

    for (const run of report.runs) {
      for (const fixture of run.fixtures) {
        expect(fixture.endToEnd).toEqual(summarizeSamples(fixture.repetitions).endToEnd);
      }
    }

    const markdown = renderRawReport(report);

    expect(markdown).not.toContain('NaN ms');
    expect(markdown).not.toContain('GERISSEN');
    expect(markdown).toContain('2.65 s');
  });

  it('keeps every repetition and fails a later unexpected rejection', () => {
    const first = sample();
    const failed = sample({ endToEnd: { ...first.endToEnd, ok: false, code: 'OSCAL_IMPORT_WORKER_FAILURE' } });
    const summary = summarizeSamples([first, failed]);
    expect(summary.endToEnd.valid).toBe(false);
    expect(summary.endToEnd.ok).toBe(false);
    expect(summary.repetitions).toHaveLength(2);
  });

  it('does not treat missing long tasks or timings as a passing run', () => {
    const entry = sample();
    for (const field of ['longTasks', 'submitMs', 'ms', 'blockingMs', 'longestTaskMs']) {
      const endToEnd: Record<string, unknown> = { ...entry.endToEnd };
      delete endToEnd[field];
      expect(summarizeSamples([sample({ endToEnd })]).endToEnd.valid).toBe(false);
    }
  });

  it('includes the transport inventory plus the caller input', () => {
    expect(composeHeapFootprint({
      stage1PeakBytes: 10, chainPeakBytes: 20, mainThreadBytes: 5,
      inputBytes: 10, transportInventoryBytes: 100,
    }).peakBytes).toBe(110);
  });
});


describe('GSPP-386 measurement validation', () => {
  it('accepts an expected domain rejection but not an unrelated failure', () => {
    const entry = sample({
      expectedCode: 'OSCAL_SCHEMA_INVALID',
      objectChain: { ms: 1, ok: false, code: 'OSCAL_SCHEMA_INVALID' },
      endToEnd: { ms: 2, submitMs: 1, blockingMs: 0, longestTaskMs: 0,
        longTasks: [], ok: false, code: 'OSCAL_SCHEMA_INVALID' },
    });
    expect(summarizeSamples([entry]).endToEnd.valid).toBe(true);
    expect(summarizeSamples([sample({
      ...entry, endToEnd: { ...entry.endToEnd, code: 'OSCAL_IMPORT_WORKER_FAILURE' },
    })]).endToEnd.valid).toBe(false);
  });

  it('rejects a task list inconsistent with its summary or a nonfinite time', () => {
    const entry = sample();
    for (const changed of [{ longTasks: [90] }, { ms: NaN }, { submitMs: -1 }]) {
      expect(summarizeSamples([sample({
        endToEnd: { ...entry.endToEnd, ...changed },
      })]).endToEnd.valid).toBe(false);
    }
  });

  it('does not derive a limit from absent memory or invalid timing evidence', () => {
    const row = { ...fixtureRow(), totalNodes: 1_000 };
    expect(deriveNodeLimit([{ ...row, heap: { peakBytes: NaN } }])).toBeNull();
    expect(deriveNodeLimit([{ ...row, endToEnd: { ...row.endToEnd, valid: false } }])).toBeNull();
  });

  it('rejects present but unproven observability records', () => {
    const run = {
      throttleRate: 1, repeat: 1, environment: { userAgent: 'test' },
      fixtures: [fixtureRow()], glob: [],
      observability: { probeMs: 120, observedMs: 121 },
      memoryObservability: { probeBytes: 16_777_216, observedBytes: 16_800_000 },
    };
    const render = (override: Record<string, unknown>) => renderReport({
      generatedAt: 'test', browserVersion: 'test', runs: [{ ...run, ...override }],
    });
    expect(() => render({ observability: {} })).toThrow(/Long-Task-Beobachtbarkeit/);
    expect(() => render({ observability: { probeMs: 120, observedMs: 0 } })).toThrow(/Long-Task-Beobachtbarkeit/);
    expect(() => render({ memoryObservability: {} })).toThrow(/Speicher-Beobachtbarkeit/);
    expect(() => render({ memoryObservability: { probeBytes: 100, observedBytes: 1 } })).toThrow(/Speicher-Beobachtbarkeit/);
  });
});


it('rejects a matching direct and worker rejection when the fixture should pass', () => {
  expect(summarizeSamples([sample({
    objectChain: { ms: 1, ok: false, code: 'OSCAL_SCHEMA_ADDITIONAL_PROPERTY' },
    endToEnd: { ms: 2, submitMs: 1, blockingMs: 0, longestTaskMs: 0,
      longTasks: [], ok: false, code: 'OSCAL_SCHEMA_ADDITIONAL_PROPERTY' },
  })]).endToEnd.valid).toBe(false);
});


it('refuses a passing report for missing or changed source fingerprints', () => {
  const report = { generatedAt: 'test', browserVersion: 'test', runs: [] };
  expect(() => renderRawReport(report)).toThrow(/Quellfingerprint/);
  expect(() => renderReport({ ...report, sourceAfter: { ...source, sha256: 'c'.repeat(64) } })).toThrow(/Quellfingerprint/);
  expect(() => renderReport({ ...report, sourceBefore: {}, sourceAfter: {} })).toThrow(/Quellfingerprint/);
});


it('invalidates missing stage timings and missing transport inventory', () => {
  expect(summarizeSamples([sample({ stage1: { ok: true, code: null } })]).endToEnd.valid).toBe(false);
  const report = {
    generatedAt: 'test', browserVersion: 'test', runs: [{
      throttleRate: 1, repeat: 1, environment: { userAgent: 'test' },
      observability: { probeMs: 120, observedMs: 121 },
      memoryObservability: { probeBytes: 100, observedBytes: 100 },
      fixtures: [fixtureRow()], glob: [],
    }],
  };
  const heap = report.runs[0].fixtures[0].heap;
  delete heap.transportInventoryBytes;
  expect(renderReport(report)).toContain('GERISSEN');
});


describe('Wartezeitbudget', () => {
  function timedRow(times: number[]) {
    return {
      ...fixtureRow(), totalNodes: 1_000,
      ...summarizeSamples(times.map((ms) => sample({
        endToEnd: { ...sample().endToEnd, ms },
      }))),
    };
  }

  it.each([[5_000, 1_000], [5_001, null], [8_000, null]])(
    'prüft %i ms gegen die Grenze einschließlich Gleichheit', (ms, expected) => {
      expect(deriveNodeLimit([timedRow([ms as number])])).toBe(expected);
    },
  );

  it('verlangt einen endlichen nichtnegativen Wartezeithöchstwert', () => {
    for (const maxMs of [undefined, Number.NaN, Infinity, -1]) {
      const row = timedRow([20]);
      row.endToEnd.maxMs = maxMs;
      expect(deriveNodeLimit([row])).toBeNull();
    }
  });

  it('verweigert einen Bericht ohne erhobenen Wartezeithöchstwert', () => {
    const row = timedRow([20]);
    delete row.endToEnd.maxMs;

    expect(() => renderReport({
      generatedAt: 'test', browserVersion: 'test', runs: [{
        throttleRate: 1, repeat: 1, environment: { userAgent: 'test' },
        observability: { probeMs: 120, observedMs: 120 },
        memoryObservability: { probeBytes: 100, observedBytes: 100 },
        fixtures: [row], glob: [],
      }],
    })).toThrow(/Wartezeithöchstwert/);
  });

  it('verweigert auch eine Skalierungsreihe ohne erhobenen Wartezeithöchstwert', () => {
    const scaleRow = timedRow([20]);
    delete scaleRow.endToEnd.maxMs;

    expect(() => renderReport({
      generatedAt: 'test', browserVersion: 'test', runs: [{
        throttleRate: 1, repeat: 1, environment: { userAgent: 'test' },
        observability: { probeMs: 120, observedMs: 120 },
        memoryObservability: { probeBytes: 100, observedBytes: 100 },
        fixtures: [timedRow([20])], scale: [scaleRow], glob: [],
      }],
    })).toThrow(/Wartezeithöchstwert/);
  });

  it('verwirft einen langsamen Einzelimport auch bei schnellem Median', () => {
    const row = timedRow([20, 8_000, 30]);
    expect(row.endToEnd.ms).toBe(30);
    expect(deriveNodeLimit([row])).toBeNull();
    const markdown = renderReport({
      generatedAt: 'test', browserVersion: 'test', runs: [{
        throttleRate: 1, repeat: 3, environment: { userAgent: 'test' },
        observability: { probeMs: 120, observedMs: 120 },
        memoryObservability: { probeBytes: 100, observedBytes: 100 },
        fixtures: [row], glob: [],
      }],
    });
    expect(markdown).toContain('| GERISSEN |');
    expect(markdown).toContain('8.00 s');
  });
});

describe('deriveSeriesWorkUnitLimit', () => {
  const row = (target: number, workUnits: number, maxMs: number) => ({
    targetWorkUnits: target, ok: true, workUnits, nodes: 8, medianMs: maxMs, maxMs,
  });

  it('nennt den größten Stützpunkt, der die sichtbare Wartezeit hält', () => {
    expect(deriveSeriesWorkUnitLimit([
      row(1_000, 990, 100),
      row(2_000, 1_980, 900),
      row(4_000, 3_960, 4_800),
    ])).toBe(3_960);
  });

  it('gibt die GEMESSENE Zahl zurück, nicht den Stützpunkt', () => {
    // Das Fixture trifft seinen Zielwert nie exakt. Ein Grenzwert, der auf dem
    // Ziel statt auf der Messung stünde, wäre eine Behauptung.
    expect(deriveSeriesWorkUnitLimit([row(1_000, 843, 50)])).toBe(843);
  });

  it('endet an der ersten Reißstelle und lässt sich von einem späteren Halten nicht aufheben', () => {
    // Browsermessungen sind nicht monoton. Ein größerer Stützpunkt, der
    // zufällig wieder hält, hebt einen kleineren gerissenen nicht auf.
    expect(deriveSeriesWorkUnitLimit([
      row(1_000, 990, 100),
      row(2_000, 1_980, 6_000),
      row(4_000, 3_960, 200),
    ])).toBe(990);
  });

  it('trägt keinen Grenzwert, wenn schon der kleinste Stützpunkt reißt', () => {
    expect(deriveSeriesWorkUnitLimit([row(1_000, 990, 5_001)])).toBeNull();
  });

  it('behandelt einen abgebrochenen Stützpunkt als fehlend, nicht als bestanden', () => {
    expect(deriveSeriesWorkUnitLimit([
      row(1_000, 990, 100),
      { targetWorkUnits: 2_000, ok: false, code: 'OSCAL_RESOLUTION_WORK_BUDGET_EXCEEDED' },
      row(4_000, 3_960, 100),
    ])).toBe(990);
  });

  it('behandelt einen Stützpunkt ohne erhobene Wartezeit als fehlend', () => {
    // Derselbe Fehler, den GSPP-386 an `maxMs` gefunden hat: Ein fehlender
    // Wert darf nicht als NaN in einen Vergleich laufen und dort als
    // „gehalten" erscheinen.
    expect(deriveSeriesWorkUnitLimit([
      row(1_000, 990, 100),
      { targetWorkUnits: 2_000, ok: true, workUnits: 1_980, nodes: 8, medianMs: 10 },
    ])).toBe(990);
  });

  it('trägt keinen Grenzwert ohne Reihe', () => {
    expect(deriveSeriesWorkUnitLimit([])).toBeNull();
    expect(deriveSeriesWorkUnitLimit(undefined as never)).toBeNull();
  });
});

describe('deriveWorkUnitLimit über alle Kategoriereihen', () => {
  const row = (target: number, workUnits: number, maxMs: number) => ({
    targetWorkUnits: target, ok: true, workUnits, nodes: 8, medianMs: maxMs, maxMs,
  });

  it('nimmt das Minimum der Reihen — die langsamste Kategorie entscheidet', () => {
    // Alle Kategorien verbrauchen denselben Zähler, kosten aber je Einheit
    // unterschiedlich viel Zeit. Ein Grenzwert auf der schnellsten Reihe
    // bräche das Zeitbudget, sobald ein Dokument die langsamste treibt.
    expect(deriveWorkUnitLimit([
      { category: 'selector-compare', rows: [row(1_000, 990, 100), row(2_000, 1_980, 900)] },
      { category: 'merge-step', rows: [row(1_000, 990, 100), row(2_000, 1_980, 6_000)] },
    ])).toBe(990);
  });

  it('übergeht eine durch die Dokumentgrenze gedeckelte Reihe', () => {
    // Eine Kategorie, deren ungünstigstes Steuerdokument die Arbeitsgrenze
    // gar nicht erreichen kann, schränkt sie auch nicht ein. Ohne diese
    // Ausnahme senkte ihr niedriger Deckel den Grenzwert für alle anderen.
    expect(deriveWorkUnitLimit([
      { category: 'selector-compare', rows: [row(1_000, 990, 100), row(2_000, 1_980, 900)] },
      {
        category: 'alter-target-lookup',
        rows: [
          row(1_000, 990, 20),
          { targetWorkUnits: 2_000, ok: false, code: 'FIXTURE_DOKUMENTGRENZE', reachableWorkUnits: 1_100 },
        ],
      },
    ])).toBe(1_980);
  });

  it('trägt keinen Grenzwert, wenn eine nicht gedeckelte Reihe keinen trägt', () => {
    expect(deriveWorkUnitLimit([
      { category: 'selector-compare', rows: [row(1_000, 990, 100)] },
      { category: 'merge-step', rows: [row(1_000, 990, 5_001)] },
    ])).toBeNull();
  });

  it('trägt keinen Grenzwert ohne Reihen', () => {
    expect(deriveWorkUnitLimit([])).toBeNull();
    expect(deriveWorkUnitLimit(undefined as never)).toBeNull();
  });
});

describe('seriesIsDocumentCapped', () => {
  it('erkennt eine terminale Deckelung mit Erreichbarkeitszahl', () => {
    expect(seriesIsDocumentCapped([
      { targetWorkUnits: 1_000, ok: false, code: 'FIXTURE_DOKUMENTGRENZE', reachableWorkUnits: 700 },
    ])).toBe(true);
    expect(seriesIsDocumentCapped([{ code: 'OSCAL_RESOLUTION_WORK_BUDGET_EXCEEDED' }])).toBe(false);
    expect(seriesIsDocumentCapped([])).toBe(false);
    expect(seriesIsDocumentCapped(undefined as never)).toBe(false);
  });

  it('erkennt eine Deckelzeile OHNE Erreichbarkeitszahl nicht als Deckelung', () => {
    // Ein Deckel ohne Zahl belegt keine Obergrenze. Ihn trotzdem als
    // Deckelung zu führen, nähme die Kategorie aus der Herleitung, ohne dass
    // irgendetwas ihre Unschädlichkeit belegt.
    expect(seriesIsDocumentCapped([
      { targetWorkUnits: 1_000, ok: false, code: 'FIXTURE_DOKUMENTGRENZE' },
    ])).toBe(false);
  });
});


describe('evaluateWorkUnitSeries — warum eine Reihe endet', () => {
  const row = (target: number, workUnits: number, maxMs: number) => ({
    targetWorkUnits: target, ok: true, workUnits, nodes: 8, medianMs: maxMs, maxMs,
  });
  const cap = (target: number, reachableWorkUnits: number | undefined = undefined) => ({
    targetWorkUnits: target, ok: false, code: 'FIXTURE_DOKUMENTGRENZE', reachableWorkUnits,
  });

  it('trennt einen Zeitriss von einer Deckelung', () => {
    expect(evaluateWorkUnitSeries([row(1_000, 990, 100), row(2_000, 1_980, 6_000)]))
      .toEqual({ held: 990, capped: false, ceiling: null, breach: 'time' });
    expect(evaluateWorkUnitSeries([row(1_000, 990, 100), cap(2_000, 1_500)]))
      .toEqual({ held: 990, capped: true, ceiling: 1_500, breach: 'none' });
  });

  it('wertet einen Riss UNTERHALB einer späteren Deckelzeile zuerst aus', () => {
    // Der Riss liegt im erreichbaren Bereich; die Kategorie ist nicht
    // gedeckelt, sondern langsam. Die Reihenfolge ist die ganze Aussage.
    expect(evaluateWorkUnitSeries([row(1_000, 995, 6_000), cap(2_000, 1_500)]))
      .toEqual({ held: null, capped: false, ceiling: null, breach: 'time' });
  });

  it('verwirft eine nichtterminale Deckelzeile', () => {
    expect(evaluateWorkUnitSeries([cap(1_000, 700), row(2_000, 1_980, 100)]))
      .toEqual({ held: null, capped: false, ceiling: null, breach: 'broken-cap' });
  });

  it('verwirft eine Deckelzeile ohne endliche Erreichbarkeitszahl', () => {
    expect(evaluateWorkUnitSeries([row(1_000, 990, 100), cap(2_000)]))
      .toEqual({ held: 990, capped: false, ceiling: null, breach: 'broken-cap' });
  });

  it('meldet eine vollständig gehaltene Reihe ohne Riss', () => {
    expect(evaluateWorkUnitSeries([row(1_000, 990, 100), row(2_000, 1_980, 200)]))
      .toEqual({ held: 1_980, capped: false, ceiling: null, breach: 'none' });
  });
});

describe('deriveWorkUnitLimit — Deckelung hebt keinen Riss auf', () => {
  const row = (target: number, workUnits: number, maxMs: number) => ({
    targetWorkUnits: target, ok: true, workUnits, nodes: 8, medianMs: maxMs, maxMs,
  });
  const cap = (target: number, reachableWorkUnits: number | undefined = undefined) => ({
    targetWorkUnits: target, ok: false, code: 'FIXTURE_DOKUMENTGRENZE', reachableWorkUnits,
  });

  it('trägt keinen Grenzwert, wenn eine Reihe VOR ihrer Deckelung reißt', () => {
    // Der Befund zu 10338f3: Die Vorgängerfassung prüfte die Deckelung zuerst
    // und nahm die gerissene Kategorie vollständig aus der Herleitung. Sie gab
    // damit einen Grenzwert aus der anderen Reihe frei, obwohl eine
    // erreichbare Last die sichtbare Wartezeit bereits riss — fail-open.
    expect(deriveWorkUnitLimit([
      { category: 'selector-compare', rows: [row(1_000, 990, 100)] },
      { category: 'merge-step', rows: [row(1_000, 995, 6_000), cap(2_000, 1_500)] },
    ])).toBeNull();
  });

  it('nimmt eine gedeckelte Reihe nur aus, wenn ihr Deckel UNTER dem Grenzwert liegt', () => {
    expect(deriveWorkUnitLimit([
      { category: 'selector-compare', rows: [row(1_000, 990, 100)] },
      { category: 'alter-target-lookup', rows: [row(500, 480, 100), cap(1_000, 700)] },
    ])).toBe(990);
  });

  it('lässt eine gedeckelte Reihe mit Deckel ÜBER dem Grenzwert eingehen', () => {
    // Zwischen ihrem letzten gemessenen Stützpunkt (480) und ihrem Deckel
    // (5 000) ist nichts gemessen. Ungemessene Strecke trägt keinen Grenzwert.
    expect(deriveWorkUnitLimit([
      { category: 'selector-compare', rows: [row(1_000, 990, 100)] },
      { category: 'alter-target-lookup', rows: [row(500, 480, 100), cap(1_000, 5_000)] },
    ])).toBe(480);
  });

  it('trägt keinen Grenzwert bei nichtterminaler Deckelzeile', () => {
    expect(deriveWorkUnitLimit([
      { category: 'selector-compare', rows: [row(1_000, 990, 100)] },
      { category: 'merge-step', rows: [cap(500, 400), row(1_000, 980, 100)] },
    ])).toBeNull();
  });

  it('trägt keinen Grenzwert, wenn ALLE Reihen gedeckelt sind', () => {
    // Ohne eine einzige gemessene Zeitaussage steht kein Grenzwert auf einer
    // Messung — auch dann nicht, wenn jede Reihe für sich harmlos aussieht.
    expect(deriveWorkUnitLimit([
      { category: 'alter-target-lookup', rows: [row(500, 480, 100), cap(1_000, 700)] },
    ])).toBeNull();
  });
});

describe('assertWorkLimitRun — Herleitung und Bestätigung', () => {
  const row = (target: number, workUnits: number, maxMs: number) => ({
    targetWorkUnits: target, ok: true, workUnits, nodes: 8, medianMs: maxMs, maxMs,
  });
  const holding = [
    { category: 'selector-compare', rows: [row(1_000, 990, 100), row(2_000, 1_980, 200)] },
    { category: 'merge-step', rows: [row(1_000, 985, 300), row(2_000, 1_970, 900)] },
  ];
  const breaking = [
    { category: 'selector-compare', rows: [row(1_000, 990, 100), row(2_000, 1_980, 200)] },
    { category: 'merge-step', rows: [row(1_000, 985, 300), row(2_000, 1_970, 6_000)] },
  ];

  it('gibt im Herleitungslauf das Minimum zurück, auch weit unter dem Kandidaten', () => {
    expect(assertWorkLimitRun({
      workUnitLimit: 2_000, workUnitLimitRole: 'search', profileResolution: breaking,
    })).toBe(985);
  });

  it('besteht den Bestätigungslauf, wenn keine Reihe unterhalb reißt', () => {
    expect(assertWorkLimitRun({
      workUnitLimit: 2_000, workUnitLimitRole: 'confirm', profileResolution: holding,
    })).toBe(1_970);
  });

  it('bricht den Bestätigungslauf ab, sobald eine Reihe unterhalb reißt', () => {
    // Kein erfolgreicher Bericht mit zwei widersprüchlichen Zahlen: Reißt eine
    // Kategorie unter dem gelieferten Wert, ist der Wert widerlegt.
    expect(() => assertWorkLimitRun({
      workUnitLimit: 2_000, workUnitLimitRole: 'confirm', profileResolution: breaking,
    })).toThrow(/reißt unterhalb/);
  });

  it('behandelt einen Lauf ohne ausgewiesene Rolle als Bestätigung', () => {
    expect(() => assertWorkLimitRun({
      workUnitLimit: 2_000, profileResolution: breaking,
    })).toThrow(/reißt unterhalb/);
  });

  it('weist eine unbekannte Rolle zurück', () => {
    expect(() => assertWorkLimitRun({
      workUnitLimit: 2_000, workUnitLimitRole: 'irgendwas', profileResolution: holding,
    })).toThrow(/unbekannter Rolle/);
  });

  it('weist einen hergeleiteten Wert über dem Kandidaten als defekte Messung zurück', () => {
    expect(() => assertWorkLimitRun({
      workUnitLimit: 500, workUnitLimitRole: 'search', profileResolution: holding,
    })).toThrow(/über dem Kandidaten/);
  });

  it('weist einen Lauf ohne Grenzwertkandidaten zurück', () => {
    expect(() => assertWorkLimitRun({ workUnitLimit: 0, profileResolution: holding }))
      .toThrow(/ohne ausgewiesenen Grenzwertkandidaten/);
  });
});

describe('GSPP-345 — der einkompilierte Grenzwert ist an das Messartefakt gebunden', () => {
  const artifact = JSON.parse(readFileSync(
    resolve(process.cwd(), 'docs/measurements/gspp345-work-budget.json'),
    'utf8',
  )) as {
    runs: { throttleRate: number; workUnitLimit: number; workUnitLimitRole?: string;
      profileResolution: { category: string; rows: Record<string, unknown>[] }[] }[];
  };
  const runs = artifact.runs.filter((run) => run.profileResolution?.length > 0);

  it('führt Arbeitsreihen für jede der sechs Work-Unit-Kategorien', () => {
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.profileResolution.map((entry) => entry.category).sort())
        .toEqual([...WORK_UNIT_CATEGORIES].sort());
    }
  });

  it('leitet den einkompilierten WORK_UNIT_LIMIT exakt aus dem Artefakt her', () => {
    // DER RIEGEL gegen einen Wert, den die Messung nicht trägt: Maßgeblich ist
    // das Minimum über alle Drosselungsläufe — die stärkste Drosselung ist die
    // ungünstigste Hardware, und ein Grenzwert, der nur auf der schnellsten
    // Maschine hält, schützt niemanden. Zieht jemand die Konstante hoch, ohne
    // neu zu messen, schlägt dieser Test fehl.
    const derivedPerRun = runs.map((run) => deriveWorkUnitLimit(run.profileResolution));
    expect(derivedPerRun).not.toContain(null);
    expect(Math.min(...(derivedPerRun as number[]))).toBe(WORK_UNIT_LIMIT);
  });

  it('ist ein Herleitungslauf, dessen Kandidat ECHT über dem gelieferten Wert liegt', () => {
    // Ohne diese Bedingung wäre die Messung zirkulär: Ein Lauf misst nur bis
    // zu seinem eigenen Kandidaten, weil der Resolver darüber abbricht. Ein
    // Artefakt, dessen Kandidat gleich dem gelieferten Wert ist, kann den Wert
    // deshalb nicht belegen — es bestätigt nur, dass unterhalb nichts reißt.
    for (const run of runs) {
      expect(run.workUnitLimitRole).toBe('search');
      expect(run.workUnitLimit).toBeGreaterThan(WORK_UNIT_LIMIT);
    }
  });

  it('ist am AKTUELLEN Messweg erhoben', () => {
    // Ohne diese Prüfung altert das Artefakt still: Wird der Auflösungspfad
    // langsamer, bleibt der einkompilierte Wert stehen und nichts wird rot.
    // Geprüft wird die enge Hülle des gemessenen Laufs, nicht der ganze Baum —
    // sonst erzwänge jede unbeteiligte Änderung einen Browsermesslauf.
    const provenance = workLimitProvenance();
    expect(artifact.sourceBefore.workLimitProvenance.sha256).toBe(provenance.sha256);
    expect(artifact.sourceAfter.workLimitProvenance.sha256).toBe(provenance.sha256);
  });

  it('rendert das Artefakt ohne widersprüchliche Zahlen', () => {
    const markdown = renderRawReport(artifact);
    expect(markdown).toContain('Zu übernehmen ist der fail-closed über alle Kategorien getragene Wert');
    expect(markdown).toContain(WORK_UNIT_LIMIT.toLocaleString('de-DE'));
  });
});
