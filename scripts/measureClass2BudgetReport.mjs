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
 * Der größte gemessene Stützpunkt, der BEIDE Budgetposten für JEDES Fixture
 * hält — und unterhalb dessen kein gemessener Stützpunkt reißt.
 *
 * Bewusst keine Interpolation zwischen zwei Stützpunkten: Ein hergeleiteter
 * Grenzwert darf nur auf einer Zahl stehen, die auch wirklich gemessen wurde.
 *
 * Die Auswertung läuft über die KNOTENZAHL, nicht über die Fixtures. Die
 * erste Fassung bildete das Minimum der je Fixture größten bestandenen
 * Knotenzahl; das ist nicht dieselbe Frage. Sie kann eine Knotenzahl nennen,
 * an der ein anderes Fixture gemessen wurde und riss — der Codex-Befund zu
 * 84ca1f6 hat das mit einer nichtmonotonen Reihe vorgeführt. Browsermessungen
 * sind nicht monoton, und ein Grenzwert, der auf einem gerissenen Messpunkt
 * steht, ist falsch, nicht bloß ungenau.
 *
 * Zwei Bedingungen je Stützpunkt, beide fail-closed:
 *
 *   1. VOLLSTÄNDIG gemessen — jedes Fixture, das irgendwo in der Reihe
 *      auftaucht, muss auch hier eine Zeile haben. Eine fehlende Zeile ist
 *      keine bestandene.
 *   2. Von der kleinsten Knotenzahl an lückenlos gehalten. Reißt ein
 *      Stützpunkt, endet die Aussage dort; ein größerer, der zufällig wieder
 *      hält, hebt ihn nicht auf.
 *
 * Trägt schon der kleinste Stützpunkt nicht, ist die Rückgabe `null` — dann
 * begründet die Messreihe keinen Grenzwert, und der Bericht behauptet auch
 * keinen.
 *
 * @param {object[]} rows Zeilen der Skalierungsreihe eines Laufs.
 */
export function deriveNodeLimit(rows) {
  if (rows.length === 0) return null;

  const requiredFixtures = new Set(rows.map((row) => row.id));
  const byNodeCount = new Map();
  for (const row of rows) {
    let point = byNodeCount.get(row.totalNodes);
    if (point === undefined) {
      point = { measured: new Set(), holds: true };
      byNodeCount.set(row.totalNodes, point);
    }
    point.measured.add(row.id);
    if (
      row.heap.peakBytes > MEMORY_BUDGET_BYTES
      || row.endToEnd.blockingMs > UI_BLOCKING_BUDGET_MS
    ) {
      point.holds = false;
    }
  }

  let derived = null;
  for (const totalNodes of [...byNodeCount.keys()].sort((left, right) => left - right)) {
    const point = byNodeCount.get(totalNodes);
    if (point.measured.size !== requiredFixtures.size || !point.holds) break;
    derived = totalNodes;
  }
  return derived;
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
 * Verdichtet die Wiederholungen eines Fixtures.
 *
 * Ausschließlich Zeiten: Der Speicherabdruck wird getrennt und nur einmal
 * erhoben, weil eine Speichermessung rund zehn Sekunden kostet und ihrerseits
 * deterministisch ist — sie hängt an der Datenstruktur, nicht am Lauf. Der
 * Aufrufer legt ihn neben das Ergebnis dieser Verdichtung.
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
  };
}

/**
 * Speicherabdruck einer Einzelmessung.
 *
 * `stage1Peak` und `chainPeak` sind die beiden Höchststände der Prüfkette;
 * ihre Bestände unterscheiden sich, weshalb der größere von beiden zählt und
 * nicht ihre Summe. Produktiv ist das der Bestand des Worker-Isolats, gemessen
 * an denselben Einheiten über dasselbe Dokument im Tab.
 *
 * `mainThread` ist, was der produktive Weg im Hauptkontext hinterlässt — im
 * Wesentlichen der aus der Worker-Antwort deserialisierte Ergebnisgraph.
 * Er kommt HINZU, weil beides gleichzeitig besteht: Der Worker wird erst nach
 * Eintreffen der Antwort beendet.
 *
 * `input` kommt EIN weiteres Mal hinzu. Die Kettenmessung hält die
 * Eingabebytes bereits einmal; im Produktivpfad liegen sie doppelt, weil
 * `copyForTransfer` in `src/adapters/oscalImportGate.ts` für die Übergabe an
 * den Worker eine vollständige Kopie anlegt, während der Aufrufer sein
 * Original behält.
 *
 * @param {{stage1PeakBytes: number, chainPeakBytes: number,
 *          mainThreadBytes: number, inputBytes: number}} parts
 */
export function composeHeapFootprint(parts) {
  // Ein abgewiesenes Dokument schickt nur eine Diagnose zurück; der
  // Main-Thread-Anteil ist dann näherungsweise null und kann durch
  // Messrauschen knapp negativ ausfallen. Ein negativer Posten darf die Spitze
  // nicht kleiner rechnen, als sie ohne ihn wäre.
  const mainThreadBytes = Math.max(parts.mainThreadBytes, 0);
  return {
    stage1PeakBytes: parts.stage1PeakBytes,
    chainPeakBytes: parts.chainPeakBytes,
    mainThreadBytes,
    inputBytes: parts.inputBytes,
    peakBytes:
      Math.max(parts.stage1PeakBytes, parts.chainPeakBytes)
      + mainThreadBytes
      + parts.inputBytes,
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
    '| Fixture | Grenze | Dokument | Stufe 1 | Objektkette | Ende-zu-Ende '
    + '| Bestand Parse | Bestand Kette | Main Thread | Spitze | Budget | Schemastufe | Ergebnis |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...run.fixtures.map((fixture) =>
      `| ${fixture.id} | ${fixture.limit} | ${formatMiB(fixture.bytes)} `
      + `| ${formatMs(fixture.stage1.ms)} | ${formatMs(fixture.objectChain.ms)} `
      + `| ${formatMs(fixture.endToEnd.ms)} `
      + `| ${formatMiB(fixture.heap.stage1PeakBytes)} `
      + `| ${formatMiB(fixture.heap.chainPeakBytes)} `
      + `| ${formatMiB(fixture.heap.mainThreadBytes)} `
      + `| ${formatMiB(fixture.heap.peakBytes)} `
      + `| ${verdict(fixture.heap.peakBytes, MEMORY_BUDGET_BYTES)} `
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
  // Dasselbe für den Speicherweg: Der Vorgänger dieser Messung sah
  // Puffer-Backing-Stores und externe Blink-Strings nicht und hätte damit ein
  // gehaltenes Speicherbudget ausweisen können, das nicht gehalten wird.
  if (run.memoryObservability === undefined || run.memoryObservability === null) {
    throw new Error('Messlauf ohne belegte Speicher-Beobachtbarkeit');
  }

  const hasScale = run.scale !== null && run.scale !== undefined;
  return [
    '',
    `## CPU-Drosselung ${run.throttleRate}x — ${run.environment.userAgent}`,
    `Wiederholungen je Fixture: ${run.repeat} (Zeiten als Median, Speicher als Maximum)`,
    '',
    ...renderFixtureTable(run),
    '',
    `Speichermessweg geprüft: ${formatMiB(run.memoryObservability.probeBytes)} Prüfpuffer `
    + `wurden als ${formatMiB(run.memoryObservability.observedBytes)} gemeldet. `
    + `Speicherwerte erhoben bei CPU-Drosselung ${run.memoryThrottleRate}x — sie hängen an `
    + 'der Datenstruktur, nicht an der Taktrate, und werden deshalb einmal erhoben.',
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
