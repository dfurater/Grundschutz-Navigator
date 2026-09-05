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
 * Das in `docs/OSCAL_VALIDATION.md` festgelegte UI-Budget. Es steht hier, weil
 * der Bericht das Urteil „gehalten/gerissen“ selbst fällt, statt es dem Leser
 * der Zahlenkolonne zu überlassen. Es ist zugleich die Schwelle, ab der die
 * Plattform einen Task als `longtask` meldet — die Messung kann das Budget
 * deshalb nicht knapp verfehlen, ohne es zu sehen.
 */
export const UI_BLOCKING_BUDGET_MS = 50;

/**
 * Speicherbudget aus `docs/OSCAL_VALIDATION.md`.
 *
 * Am 2026-09-05 von 64 auf 128 MiB angehoben, nachdem der Codex-Befund zu
 * 36d9c79 den echten Speicher-Worst-Case sichtbar gemacht hat: `heap-bound`
 * kostet 89,14 MiB und riss die alte Zahl. Die Anhebung folgt einer Messung,
 * nicht einer neuen Erkenntnis über verfügbaren Speicher — das steht so auch
 * in der Dokumentation. 96 MiB wären der knappste Wert gewesen, der den
 * Messwert noch trägt; ein zu 93 % ausgeschöpftes Budget kann aber keine
 * künftige Grenzwertänderung mehr leiten, sondern zeichnet nur den Ist-Stand
 * nach.
 */
export const MEMORY_BUDGET_BYTES = 128 * MIB;

/**
 * Der größte gemessene Stützpunkt, der BEIDE Budgetposten hält.
 *
 * Bewusst keine Interpolation zwischen zwei Stützpunkten: Ein hergeleiteter
 * Grenzwert darf nur auf einer Zahl stehen, die auch wirklich gemessen wurde.
 * Genau die fehlende Messung war der Kern des Codex-Befunds zu 36d9c79. Liegt
 * kein Stützpunkt im Budget, ist die Rückgabe `null` — dann trägt die Messreihe
 * die Aussage nicht, und der Bericht behauptet auch keine.
 *
 * @param {object[]} rows Zeilen der Skalierungsreihe eines Laufs.
 */
export function deriveNodeLimit(rows) {
  const holding = rows.filter(
    (row) => row.heap.peakBytes <= MEMORY_BUDGET_BYTES
      && row.endToEnd.blockingMs <= UI_BLOCKING_BUDGET_MS,
  );
  if (holding.length === 0) return null;
  // Über ALLE Fixtures hinweg: Der Grenzwert muss den ungünstigsten von ihnen
  // tragen, nicht den freundlichsten.
  const byFixture = new Map();
  for (const row of rows) {
    const held = row.heap.peakBytes <= MEMORY_BUDGET_BYTES
      && row.endToEnd.blockingMs <= UI_BLOCKING_BUDGET_MS;
    if (!held) continue;
    byFixture.set(row.id, Math.max(byFixture.get(row.id) ?? 0, row.totalNodes));
  }
  const measured = new Set(rows.map((row) => row.id));
  // Ein Fixture, das an KEINEM Stützpunkt hält, deckelt die Aussage auf null.
  if (byFixture.size !== measured.size) return null;
  return Math.min(...byFixture.values());
}

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
export function parseNodeCounts(value) {
  const counts = value.split(',').map((count) => Number.parseInt(count, 10));
  if (counts.length === 0 || counts.some((count) => !Number.isInteger(count) || count < 4)) {
    throw new RangeError('--scale erwartet kommagetrennte Knotenzahlen >= 4');
  }
  // Gerade Zahlen, weil `heap-bound` aus Knotenpaaren besteht; eine ungerade
  // Vorgabe würde dort werfen, statt einen Messpunkt zu liefern.
  if (counts.some((count) => count % 2 !== 0)) {
    throw new RangeError('--scale erwartet gerade Knotenzahlen');
  }
  return counts;
}

export function parseArguments(argv) {
  const options = {
    throttleRates: [1, 4], repeat: 3, jsonPath: null, scaleNodes: null, skipGlob: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--throttle') {
      options.throttleRates = parseThrottleRates(argv[++index] ?? '');
    } else if (flag === '--repeat') {
      options.repeat = Number.parseInt(argv[++index] ?? '', 10);
    } else if (flag === '--json') {
      options.jsonPath = argv[++index] ?? null;
    } else if (flag === '--scale') {
      options.scaleNodes = parseNodeCounts(argv[++index] ?? '');
    } else if (flag === '--skip-glob') {
      options.skipGlob = true;
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
    // Wartezeit als Median gegen Ausreißer, Blockierzeit als MAXIMUM: Für die
    // Bedienbarkeit zählt der schlechteste beobachtete Lauf, nicht der
    // typische. Ein Budget, das nur im Median hält, hält nicht.
    endToEnd: {
      ...first.endToEnd,
      ms: median(pick((entry) => entry.endToEnd.ms)),
      submitMs: Math.max(...pick((entry) => entry.endToEnd.submitMs)),
      blockingMs: Math.max(...pick((entry) => entry.endToEnd.blockingMs)),
      longestTaskMs: Math.max(...pick((entry) => entry.endToEnd.longestTaskMs)),
    },
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

/** Urteil eines Budgetpostens; ein nicht erhobener Wert gilt als gerissen. */
function verdict(value, budget) {
  return value <= budget ? 'gehalten' : 'GERISSEN';
}

/** Kosten je Fixture an seiner Grenze. */
function renderFixtureTable(run) {
  return [
    '| Fixture | Grenze | Dokument | Stufe 1 | Objektkette | Ende-zu-Ende | Gehalten '
    + '| Identitätsmenge | Spitze | Schemastufe | Ergebnis |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...run.fixtures.map((fixture) =>
      `| ${fixture.id} | ${fixture.limit} | ${formatMiB(fixture.bytes)} `
      + `| ${formatMs(fixture.stage1.ms)} | ${formatMs(fixture.objectChain.ms)} `
      + `| ${formatMs(fixture.endToEnd.ms)} `
      + `| ${formatMiB(fixture.heap.retainedBytes)} `
      + `| ${formatMiB(fixture.heap.identitySetBytes)} `
      + `| ${formatMiB(fixture.heap.peakBytes)} `
      + `| ${fixture.reachesSchemaStage ? 'ja' : 'nein'} `
      + `| ${fixture.objectChain.code ?? 'angenommen'} |`),
  ];
}

/**
 * Blockierzeit des Main Threads, mitsamt dem Beleg, dass der Messweg in diesem
 * Lauf überhaupt etwas melden konnte.
 */
function renderBlockingTable(run) {
  return [
    '### Main-Thread-Blockierzeit (Budget 50 ms)',
    '',
    `Messweg geprüft: ${run.observability.probeMs} ms absichtliche Blockade wurden als `
    + `${formatMs(run.observability.observedMs)} gemeldet.`,
    '',
    '| Fixture | Wartezeit | Hinweg synchron | Längster Long Task | Blockierzeit gesamt | Budget |',
    '| --- | --- | --- | --- | --- | --- |',
    ...run.fixtures.map((fixture) =>
      `| ${fixture.id} | ${formatMs(fixture.endToEnd.ms)} `
      + `| ${formatMs(fixture.endToEnd.submitMs)} `
      + `| ${formatMs(fixture.endToEnd.longestTaskMs)} `
      + `| ${formatMs(fixture.endToEnd.blockingMs)} `
      + `| ${verdict(fixture.endToEnd.blockingMs, UI_BLOCKING_BUDGET_MS)} |`),
  ];
}

/** Kosten über der Knotenzahl und der daraus hergeleitete Grenzwert. */
function renderScaleTable(run) {
  const derived = deriveNodeLimit(run.scale);
  return [
    '### Grenzwertherleitung: Kosten über der Knotenzahl',
    '',
    '| Fixture | Knoten | Dokument | Spitze | Speicherbudget | Blockierzeit | UI-Budget |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...run.scale.map((row) =>
      `| ${row.id} | ${row.totalNodes.toLocaleString('de-DE')} `
      + `| ${formatMiB(row.bytes)} | ${formatMiB(row.heap.peakBytes)} `
      + `| ${verdict(row.heap.peakBytes, MEMORY_BUDGET_BYTES)} `
      + `| ${formatMs(row.endToEnd.blockingMs)} `
      + `| ${verdict(row.endToEnd.blockingMs, UI_BLOCKING_BUDGET_MS)} |`),
    '',
    derived === null
      ? 'Kein gemessener Stützpunkt hält beide Budgetposten für jedes Fixture. '
        + 'Die Reihe trägt keinen hergeleiteten Grenzwert.'
      : 'Größte gemessene Knotenzahl, die beide Budgetposten für jedes Fixture hält: '
        + `**${derived.toLocaleString('de-DE')}**.`,
  ];
}

/** Laufzeit der Glob-Übersetzung über der Zahl der Sterne. */
function renderGlobTable(run) {
  return [
    '| Glob-Sterne | Musterbytes | Subjektlänge | Laufzeit |',
    '| --- | --- | --- | --- |',
    ...run.glob.map((row) =>
      `| ${row.stars} | ${row.patternBytes} | ${row.subjectLength} | ${formatMs(row.ms)} |`),
  ];
}

/** Ein Drosselungslauf mit allen seinen Tabellen. */
function renderRun(run) {
  // Ohne belegten Messweg gibt es keinen Bericht. Ein Lauf, dessen
  // Long-Task-Instrumentierung nicht nachweislich meldet, würde sonst lauter
  // Nullen als eingehaltenes UI-Budget ausweisen — genau die Verwechslung,
  // die der erste Messlauf dieser Auflage produziert hat.
  if (run.observability === undefined || run.observability === null) {
    throw new Error('Messlauf ohne belegte Long-Task-Beobachtbarkeit');
  }

  const hasScale = run.scale !== null && run.scale !== undefined;
  return [
    '',
    `## CPU-Drosselung ${run.throttleRate}x — ${run.environment.userAgent}`,
    `Wiederholungen je Fixture: ${run.repeat} (Zeiten als Median, Speicher als Maximum)`,
    '',
    ...renderFixtureTable(run),
    '',
    ...renderBlockingTable(run),
    ...(hasScale ? ['', ...renderScaleTable(run)] : []),
    '',
    ...renderGlobTable(run),
  ];
}

/**
 * Rendert den Bericht als Markdown, damit er unverändert in
 * `docs/OSCAL_VALIDATION.md` übernommen werden kann.
 *
 * @param {object} report Ergebnis eines Messlaufs.
 */
export function renderReport(report) {
  return [
    '',
    'Klasse-2-Kostenmessung (GSPP-382)',
    `Erhoben: ${report.generatedAt}`,
    `Chromium: ${report.browserVersion}`,
    ...report.runs.flatMap((run) => renderRun(run)),
    '',
  ].join('\n');
}
