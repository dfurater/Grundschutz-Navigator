// =============================================================================
// Reine Logik der Klasse-2-Kostenmessung (GSPP-382): Argumente, Verdichtung
// und Berichtsformat.
//
// Bewusst von `measure-class2-budget.mjs` getrennt: Das Skript dort ruft auf
// oberster Ebene `run()` auf und startet damit bei jedem Import einen
// Vite-Server und einen Chromium. Alles, was ohne Browser prüfbar ist, liegt
// deshalb hier und wird von `measureClass2BudgetReport.test.ts` abgedeckt
// (Gitar- und Greptile-Befund zu 6643714).
// =============================================================================

const MIB = 1024 * 1024;

/**
 * Drosselungsfaktoren aus der Kommandozeile. Ein Faktor unter 1 wäre eine
 * Beschleunigung, die es nicht gibt, und ein nicht lesbarer Wert würde die
 * Messreihe stillschweigend mit `NaN` durchlaufen.
 *
 * @param {string} value Kommagetrennte Faktoren.
 * @returns {number[]}
 */
export function parseThrottleRates(value) {
  const rates = value.split(',').map((rate) => Number.parseFloat(rate));
  if (rates.some((rate) => !Number.isFinite(rate) || rate < 1)) {
    throw new RangeError('--throttle erwartet kommagetrennte Faktoren >= 1');
  }
  return rates;
}

/**
 * Kommandozeile des Messlaufs.
 *
 * @param {string[]} argv Argumente ohne Node- und Skriptpfad.
 */
export function parseArguments(argv) {
  const options = { throttleRates: [1, 4], repeat: 3, jsonPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--throttle') {
      options.throttleRates = parseThrottleRates(argv[++index] ?? '');
    } else if (flag === '--repeat') {
      options.repeat = Number.parseInt(argv[++index] ?? '', 10);
    } else if (flag === '--json') {
      options.jsonPath = argv[++index] ?? null;
    } else {
      throw new Error(`Unbekanntes Argument: ${flag}`);
    }
  }
  if (!Number.isInteger(options.repeat) || options.repeat < 1) {
    throw new RangeError('--repeat erwartet eine positive ganze Zahl');
  }
  if (options.jsonPath === null && argv.includes('--json')) {
    throw new RangeError('--json erwartet einen Pfad');
  }
  return options;
}

/**
 * Median einer Zahlenreihe; robuster gegen einzelne JIT- oder GC-Ausreißer.
 *
 * @param {number[]} values
 */
export function median(values) {
  if (values.length === 0) throw new RangeError('median erwartet mindestens einen Wert');
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Verdichtet die Wiederholungen eines Fixtures: Zeiten als Median gegen JIT-
 * und GC-Ausreißer, Speicher als Maximum, weil das Budget den ungünstigsten
 * beobachteten Abdruck tragen muss.
 *
 * @param {object[]} samples Einzelmessungen desselben Fixtures.
 */
export function summarizeSamples(samples) {
  if (samples.length === 0) throw new RangeError('summarizeSamples erwartet Messwerte');

  const first = samples[0];
  const pick = (select) => samples.map((sample) => select(sample));
  return {
    id: first.id,
    limit: first.limit,
    label: first.label,
    reachesSchemaStage: first.reachesSchemaStage,
    bytes: first.bytes,
    samples: samples.length,
    stage1: { ...first.stage1, ms: median(pick((entry) => entry.stage1.ms)) },
    objectChain: { ...first.objectChain, ms: median(pick((entry) => entry.objectChain.ms)) },
    endToEnd: { ...first.endToEnd, ms: median(pick((entry) => entry.endToEnd.ms)) },
    heap: {
      retainedBytes: Math.max(...pick((entry) => entry.heap.retainedBytes)),
      identitySetBytes: Math.max(...pick((entry) => entry.heap.identitySetBytes)),
      peakBytes: Math.max(...pick((entry) => entry.heap.peakBytes)),
    },
  };
}

/**
 * Speicherabdruck einer Einzelmessung.
 *
 * `retained` ist der JS-Heap, der nach erzwungener Sammlung übrig bleibt:
 * Parse-Produkt und Herkunftsregister. `identitySet` ist die transiente
 * Identitätsmenge der Strukturinvariante, die nach ihrem Lauf unerreichbar
 * wird und deshalb separat gemessen werden muss. `input` sind die Eingabebytes
 * — ein `ArrayBuffer`-Backing-Store, der als externer Speicher NICHT im
 * V8-JS-Heap erscheint und darum arithmetisch zugeschlagen wird.
 *
 * @param {{retainedBytes: number, identitySetBytes: number, inputBytes: number}} parts
 */
export function composeHeapFootprint(parts) {
  return {
    retainedBytes: parts.retainedBytes,
    identitySetBytes: parts.identitySetBytes,
    inputBytes: parts.inputBytes,
    peakBytes: parts.retainedBytes + parts.identitySetBytes + parts.inputBytes,
  };
}

/**
 * @param {number} value Millisekunden.
 */
export function formatMs(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(1)} ms`;
}

/**
 * @param {number} value Bytes.
 */
export function formatMiB(value) {
  return `${(value / MIB).toFixed(2)} MiB`;
}

/**
 * Rendert den Bericht als Markdown, damit er unverändert in
 * `docs/OSCAL_VALIDATION.md` übernommen werden kann.
 *
 * @param {object} report Ergebnis eines Messlaufs.
 */
export function renderReport(report) {
  const lines = [
    '',
    'Klasse-2-Kostenmessung (GSPP-382)',
    `Erhoben: ${report.generatedAt}`,
    `Chromium: ${report.browserVersion}`,
  ];

  for (const run of report.runs) {
    lines.push(
      '',
      `## CPU-Drosselung ${run.throttleRate}x — ${run.environment.userAgent}`,
      `Wiederholungen je Fixture: ${run.repeat} (Zeiten als Median, Speicher als Maximum)`,
      '',
      '| Fixture | Grenze | Dokument | Stufe 1 | Objektkette | Ende-zu-Ende | Gehalten '
      + '| Identitätsmenge | Spitze | Schemastufe | Ergebnis |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const fixture of run.fixtures) {
      lines.push(
        `| ${fixture.id} | ${fixture.limit} | ${formatMiB(fixture.bytes)} `
        + `| ${formatMs(fixture.stage1.ms)} | ${formatMs(fixture.objectChain.ms)} `
        + `| ${formatMs(fixture.endToEnd.ms)} `
        + `| ${formatMiB(fixture.heap.retainedBytes)} `
        + `| ${formatMiB(fixture.heap.identitySetBytes)} `
        + `| ${formatMiB(fixture.heap.peakBytes)} `
        + `| ${fixture.reachesSchemaStage ? 'ja' : 'nein'} `
        + `| ${fixture.objectChain.code ?? 'angenommen'} |`,
      );
    }

    lines.push('', '| Glob-Sterne | Musterbytes | Subjektlänge | Laufzeit |', '| --- | --- | --- | --- |');
    for (const row of run.glob) {
      lines.push(
        `| ${row.stars} | ${row.patternBytes} | ${row.subjectLength} | ${formatMs(row.ms)} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}
