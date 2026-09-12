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

/** Sichtbare Wartezeit laut docs/OSCAL_VALIDATION.md, für jede Wiederholung. */
export const IMPORT_WAIT_BUDGET_MS = 5_000;

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
 * Der Budgetposten „Sichtbare Wartezeit bis zum Ergebnis" aus
 * `docs/OSCAL_VALIDATION.md`, Abschnitt „Ressourcenbudget des
 * Klasse-2-Pfads". Er wird hier nicht neu erfunden, sondern übernommen: Die
 * Arbeitsgrenze der Profile Resolution begrenzt dieselbe Wartezeit wie die
 * Ressourcengrenzen des Eingangspfads, und zwei verschiedene Zahlen für
 * denselben Posten wären Willkür.
 */
export const VISIBLE_WAIT_BUDGET_MS = 5_000;

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
  // Ein fehlender Wartezeithöchstwert ist kein gerissenes Budget, sondern eine
  // unvollständige Messreihe. Sie darf deshalb keinen Grenzwert herleiten.
  if (rows.some((row) => !finiteNonnegative(row.endToEnd?.maxMs))) return null;

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
      memoryVerdict(row.heap) !== 'gehalten'
      || !uiBudgetHolds(row.endToEnd)
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

/**
 * Flaggen ohne Wert. Als Tabelle statt als Zweigkette: Eine Kette wächst mit
 * jeder Flagge und trägt die Bedeutung im Kontrollfluss statt im Namen.
 */
const SWITCH_FLAGS = Object.freeze({
  '--skip-glob': 'skipGlob',
  '--skip-profile-resolution': 'skipProfileResolution',
  '--skip-fixtures': 'skipFixtures',
  // Erklärt den Lauf als HERLEITUNG der Arbeitsgrenze: Der einkompilierte Wert
  // ist bewusst über den erwarteten Grenzwert gesetzt, damit die Reihen bis zu
  // ihrem Riss gemessen werden können. Ohne dieses Flag ist jeder Lauf eine
  // Bestätigung und bricht ab, sobald eine Reihe unterhalb reißt.
  '--search-work-limit': 'searchWorkLimit',
  // Druckt den Quellfingerprint des aktuellen Baums und beendet, ohne zu
  // messen: der Einzeiler, mit dem sich ein committetes Artefakt gegen den
  // Lieferstand prüfen lässt.
  '--print-source-fingerprint': 'printSourceFingerprint',
});

/** Flaggen mit genau einem Wert, jeweils samt ihrer Deutung. */
const VALUE_FLAGS = Object.freeze({
  '--throttle': ['throttleRates', (value) => parseThrottleRates(value ?? '')],
  '--repeat': ['repeat', (value) => Number.parseInt(value ?? '', 10)],
  '--json': ['jsonPath', (value) => value ?? null],
  '--scale': ['scaleNodes', (value) => parseNodeCounts(value ?? '')],
});

/**
 * Ein Kalibrierlauf erhebt allein die Raten der Worst-Case-Fixtures. Liefe er
 * zusätzlich die Stützpunkte, wären seine Zahlen an Fixtures gemessen, die er
 * gerade erst neu vermisst.
 */
const CALIBRATION_OPTIONS = Object.freeze({
  calibrate: true,
  skipFixtures: true,
  skipGlob: true,
  skipProfileResolution: true,
  throttleRates: [1],
});

export function parseArguments(argv) {
  const options = {
    throttleRates: [1, 4], repeat: 3, jsonPath: null, scaleNodes: null, skipGlob: false,
    skipProfileResolution: false, skipFixtures: false, calibrate: false,
    searchWorkLimit: false, printSourceFingerprint: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const valueFlag = VALUE_FLAGS[flag];
    if (valueFlag !== undefined) {
      const [key, read] = valueFlag;
      options[key] = read(argv[++index]);
    } else if (SWITCH_FLAGS[flag] !== undefined) {
      options[SWITCH_FLAGS[flag]] = true;
    } else if (flag === '--calibrate') {
      Object.assign(options, CALIBRATION_OPTIONS);
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
function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function validSample(sample) {
  const end = sample.endToEnd;
  const expected = sample.stage1.ok ? sample.objectChain : sample.stage1;
  return finiteNonnegative(sample.stage1.ms) && finiteNonnegative(sample.objectChain.ms)
    && finiteNonnegative(sample.bytes)
    && ['ms', 'submitMs', 'blockingMs', 'longestTaskMs'].every((key) => finiteNonnegative(end[key]))
    && Array.isArray(end.longTasks)
    && end.longTasks.every(finiteNonnegative)
    && end.blockingMs === end.longTasks.reduce((sum, ms) => sum + ms, 0)
    && end.longestTaskMs === Math.max(0, ...end.longTasks)
    && typeof expected.ok === 'boolean'
    && end.ok === expected.ok && end.code === expected.code
    && Object.hasOwn(sample, 'expectedCode')
    && end.code === sample.expectedCode && end.ok === (sample.expectedCode === null)
    && !['OSCAL_IMPORT_WORKER_FAILURE', 'OSCAL_IMPORT_WORKER_TIMEOUT'].includes(end.code);
}

function uiBudgetHolds(end) {
  return end.valid === true && Array.isArray(end.longTasks) && end.longTasks.length === 0
    && finiteNonnegative(end.blockingMs) && end.blockingMs <= UI_BLOCKING_BUDGET_MS
    && finiteNonnegative(end.submitMs) && end.submitMs <= UI_BLOCKING_BUDGET_MS
    && finiteNonnegative(end.maxMs) && end.maxMs <= IMPORT_WAIT_BUDGET_MS;
}

export function summarizeSamples(samples) {
  if (samples.length === 0) throw new RangeError('summarizeSamples erwartet Messwerte');

  const first = samples[0];
  const pick = (select) => samples.map((sample) => select(sample));
  return {
    id: first.id,
    expectedCode: first.expectedCode,
    limit: first.limit,
    label: first.label,
    reachesSchemaStage: first.reachesSchemaStage,
    bytes: first.bytes,
    samples: samples.length,
    repetitions: samples,
    stage1: { ...first.stage1, ms: median(pick((entry) => entry.stage1.ms)) },
    objectChain: { ...first.objectChain, ms: median(pick((entry) => entry.objectChain.ms)) },
    // Wartezeit als Median und Maximum, Blockierzeit als MAXIMUM: Für die
    // Bedienbarkeit zählt der schlechteste beobachtete Lauf, nicht der
    // typische. Ein Budget, das nur im Median hält, hält nicht.
    endToEnd: {
      ...first.endToEnd,
      valid: samples.every(validSample),
      ok: samples.every((entry) => entry.endToEnd.ok),
      code: samples.find((entry) => !entry.endToEnd.ok)?.endToEnd.code ?? null,
      longTasks: samples.flatMap((entry) => entry.endToEnd.longTasks ?? []),
      ms: median(pick((entry) => entry.endToEnd.ms)),
      maxMs: Math.max(...pick((entry) => entry.endToEnd.ms)),
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
 *          mainThreadBytes: number, inputBytes: number, transportInventoryBytes?: number}} parts
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
    ...(parts.transportInventoryBytes === undefined ? {} : { transportInventoryBytes: parts.transportInventoryBytes }),
    peakBytes: Math.max(
      parts.transportInventoryBytes ?? 0,
      Math.max(parts.stage1PeakBytes, parts.chainPeakBytes)
      + mainThreadBytes,
    ) + parts.inputBytes,
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
  return finiteNonnegative(value) && value <= budget ? 'gehalten' : 'GERISSEN';
}

function memoryVerdict(heap) {
  const fields = ['stage1PeakBytes', 'chainPeakBytes', 'mainThreadBytes', 'inputBytes', 'transportInventoryBytes', 'peakBytes'];
  return fields.every((field) => finiteNonnegative(heap[field]))
    ? verdict(heap.peakBytes, MEMORY_BUDGET_BYTES) : 'GERISSEN';
}

function resultLabel(endToEnd) {
  return endToEnd.valid ? (endToEnd.code ?? 'angenommen') : `UNVOLLSTÄNDIG: ${endToEnd.code ?? 'Messfelder'}`;
}

/** Kosten je Fixture an seiner Grenze. */
function renderFixtureTable(run) {
  return [
    '| Fixture | Grenze | Dokument | Stufe 1 | Objektkette | Ende-zu-Ende '
    + '| Bestand Parse | Bestand Kette | Main Thread | Transportbestand | Spitze | Budget | Schemastufe | Ergebnis |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...run.fixtures.map((fixture) =>
      `| ${fixture.id} | ${fixture.limit} | ${formatMiB(fixture.bytes)} `
      + `| ${formatMs(fixture.stage1.ms)} | ${formatMs(fixture.objectChain.ms)} `
      + `| ${formatMs(fixture.endToEnd.ms)} `
      + `| ${formatMiB(fixture.heap.stage1PeakBytes)} `
      + `| ${formatMiB(fixture.heap.chainPeakBytes)} `
      + `| ${formatMiB(fixture.heap.mainThreadBytes)} `
      + `| ${formatMiB(fixture.heap.transportInventoryBytes ?? Number.NaN)} `
      + `| ${formatMiB(fixture.heap.peakBytes)} `
      + `| ${memoryVerdict(fixture.heap)} `
      + `| ${fixture.reachesSchemaStage ? 'ja' : 'nein'} `
      + `| ${resultLabel(fixture.endToEnd)} |`),
  ];
}

/** Blockierzeit des Main Threads mitsamt dem belegten Messweg. */
function renderBlockingTable(run) {
  return [
    '### UI-Budgets: Blockierzeit 50 ms, Wartezeit 5 s',
    '',
    `Messweg geprüft: ${run.observability.probeMs} ms absichtliche Blockade wurden als `
    + `${formatMs(run.observability.observedMs)} gemeldet.`,
    '',
    '| Fixture | Wartezeit Median | Wartezeit Maximum | Hinweg synchron | Längster Long Task | Blockierzeit gesamt | Budget |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...run.fixtures.map((fixture) =>
      `| ${fixture.id} | ${formatMs(fixture.endToEnd.ms)} `
      + `| ${formatMs(fixture.endToEnd.maxMs)} | ${formatMs(fixture.endToEnd.submitMs)} `
      + `| ${formatMs(fixture.endToEnd.longestTaskMs)} `
      + `| ${formatMs(fixture.endToEnd.blockingMs)} `
      + `| ${uiBudgetHolds(fixture.endToEnd) ? 'gehalten' : 'GERISSEN'} |`),
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
      + `| ${memoryVerdict(row.heap)} `
      + `| ${formatMs(row.endToEnd.blockingMs)} `
      + `| ${uiBudgetHolds(row.endToEnd) ? 'gehalten' : 'GERISSEN'} |`),
    '',
    derived === null
      ? 'Kein gemessener Stützpunkt hält beide Budgetposten für jedes Fixture. '
        + 'Die Reihe trägt keinen hergeleiteten Grenzwert.'
      : 'Größte gemessene Knotenzahl, die beide Budgetposten für jedes Fixture hält: '
        + `**${derived.toLocaleString('de-DE')}**.`,
  ];
}

/**
 * Auswertung EINER Kategoriereihe: Wie weit trägt sie, und WARUM hört sie auf?
 *
 * Dieselbe Regel wie `deriveNodeLimit`, aus demselben Grund: keine
 * Interpolation, keine Hochrechnung, lückenlose Haltung von unten. Die Reihe
 * wird aufsteigend über den Stützpunkten gelesen und endet beim ersten
 * Stützpunkt, der nicht mehr trägt.
 *
 * Der GRUND des Endes gehört zum Ergebnis, weil er zwei verschiedene Aussagen
 * trennt, die früher beide als „Reihe zu Ende" durchgingen:
 *
 *   - `time`/`incomplete` — die Reihe REISST. Der Stützpunkt ist erreichbar
 *     und hält die sichtbare Wartezeit nicht (oder liefert gar keine). Alles
 *     darüber ist unbelegt, die Kategorie schränkt den Grenzwert ein.
 *   - `document-cap` — die Reihe ist GEDECKELT. Das ungünstigste
 *     Steuerdokument dieser Kategorie trägt den Stützpunkt gar nicht mehr; er
 *     existiert nicht, statt zu reißen.
 *
 * Eine Deckelung zählt nur, wenn sie TERMINAL ist (kein weiterer Stützpunkt
 * dahinter) und einen endlichen Erreichbarkeitswert trägt. Alles andere ist
 * eine kaputte Reihe und wird fail-closed wie ein Riss behandelt: Eine
 * Deckelzeile mitten in der Reihe kann die Stützpunkte hinter sich nicht
 * erklären, und ein Deckel ohne Zahl belegt keine Obergrenze.
 *
 * Entscheidend ist die REIHENFOLGE: Ein Riss UNTERHALB einer späteren
 * Deckelzeile beendet die Reihe vor dem Deckel. Er liegt damit im
 * erreichbaren Bereich, und die Kategorie ist nicht gedeckelt, sondern
 * langsam. Die Vorgängerfassung prüfte die Deckelung zuerst und hat eine
 * gerissene Kategorie deshalb vollständig aus der Herleitung genommen —
 * fail-open (Codex-Befund zu 10338f3).
 *
 * @param {object[]} rows Zeilen einer Kategoriereihe.
 * @returns {{held: number|null, capped: boolean, ceiling: number|null,
 *   breach: 'none'|'time'|'incomplete'|'broken-cap'}}
 */
export function evaluateWorkUnitSeries(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { held: null, capped: false, ceiling: null, breach: 'incomplete' };
  }
  const ordered = [...rows].sort((left, right) => left.targetWorkUnits - right.targetWorkUnits);
  let held = null;
  for (const [index, row] of ordered.entries()) {
    if (row.code === 'FIXTURE_DOKUMENTGRENZE') {
      const terminal = index === ordered.length - 1;
      if (!terminal || !finiteNonnegative(row.reachableWorkUnits)) {
        return { held, capped: false, ceiling: null, breach: 'broken-cap' };
      }
      return { held, capped: true, ceiling: row.reachableWorkUnits, breach: 'none' };
    }
    if (row.ok !== true) return { held, capped: false, ceiling: null, breach: 'incomplete' };
    if (!finiteNonnegative(row.maxMs) || !finiteNonnegative(row.workUnits)) {
      return { held, capped: false, ceiling: null, breach: 'incomplete' };
    }
    if (row.maxMs > VISIBLE_WAIT_BUDGET_MS) {
      return { held, capped: false, ceiling: null, breach: 'time' };
    }
    held = row.workUnits;
  }
  return { held, capped: false, ceiling: null, breach: 'none' };
}

/**
 * Der größte gemessene Stützpunkt der Arbeitsreihe, der die sichtbare
 * Wartezeit hält — und unterhalb dessen kein gemessener Stützpunkt reißt.
 *
 * Ein Stützpunkt ohne erhobene Laufzeit ist kein bestandener, sondern ein
 * fehlender: Ein abgebrochener Lauf (`ok: false`) liefert keine Wartezeit und
 * beendet die Aussage an dieser Stelle. Reißt schon der kleinste Stützpunkt,
 * ist die Rückgabe `null` — dann trägt die Reihe keinen Grenzwert.
 *
 * @param {object[]} rows Zeilen der Arbeitsreihe eines Laufs.
 */
export function deriveSeriesWorkUnitLimit(rows) {
  return evaluateWorkUnitSeries(rows).held;
}

/**
 * Eine Reihe ist GEDECKELT, wenn ihr letzter Stützpunkt nicht an der Zeit
 * scheiterte, sondern daran, dass das Steuerdokument ihn nicht mehr tragen
 * kann. Eine solche Kategorie kann die Arbeitsgrenze nur dann nicht
 * einschränken, wenn ihr Deckel unter dem Grenzwert liegt — die Entscheidung
 * darüber fällt in `deriveWorkUnitLimit`, weil sie den Grenzwert kennt.
 *
 * @param {object[]} rows Zeilen einer Kategoriereihe.
 */
export function seriesIsDocumentCapped(rows) {
  return evaluateWorkUnitSeries(rows).capped;
}

/**
 * Der fail-closed über ALLE Kategoriereihen getragene Grenzwert: das Minimum
 * der Reihen, die ihre Kategorie überhaupt bis an die Grenze treiben können.
 *
 * Eine einzige Reihe genügt hier nicht. Alle sechs Kategorien verbrauchen
 * denselben Zähler, aber eine Arbeitseinheit kostet je nach Kategorie
 * unterschiedlich viel Zeit; ein Grenzwert auf der Rate der schnellsten
 * Kategorie bricht das Zeitbudget, sobald ein Dokument die langsamste treibt.
 *
 * Eine gedeckelte Reihe wird NICHT vorab ausgenommen, sondern erst, wenn ihr
 * Deckel nachweislich unter dem gewählten Grenzwert liegt. Nur dann ist die
 * Aussage „diese Kategorie erreicht die Grenze nie" wirklich belegt. Liegt
 * ihr Deckel darüber, geht sie mit ihrem gemessenen Wert ins Minimum ein wie
 * jede andere Reihe: Zwischen ihrem letzten gemessenen Stützpunkt und ihrem
 * Deckel ist nichts gemessen, und ungemessene Strecke trägt keinen Grenzwert.
 * Weil das Minimum dabei sinken kann, wird bis zum Festpunkt iteriert.
 *
 * @param {object[]} series Kategoriereihen eines Laufs.
 */
function limitFromUncappedSeries(evaluated) {
  let limit = null;
  for (const entry of evaluated) {
    if (entry.capped) continue;
    // Eine Reihe, die keinen Stützpunkt hält, beendet die Aussage für alle.
    if (entry.held === null) return null;
    limit = limit === null ? entry.held : Math.min(limit, entry.held);
  }
  // `null` auch dann, wenn ALLE Reihen gedeckelt sind: Ohne eine einzige
  // gemessene Zeitaussage steht kein Grenzwert auf einer Messung.
  return limit;
}

/**
 * Eine Senkungsrunde: Jede gedeckelte Reihe, deren Deckel ÜBER dem Grenzwert
 * liegt, geht mit ihrem gemessenen Wert ein. `null` bedeutet, dass eine solche
 * Reihe gar nichts hält und die Herleitung damit endet.
 */
function lowerByReachableCaps(evaluated, limit) {
  let lowered = limit;
  for (const entry of evaluated) {
    if (!entry.capped || entry.ceiling <= lowered) continue;
    if (entry.held === null) return null;
    if (entry.held < lowered) lowered = entry.held;
  }
  return lowered;
}

export function deriveWorkUnitLimit(series) {
  if (!Array.isArray(series) || series.length === 0) return null;
  const evaluated = series.map((entry) => evaluateWorkUnitSeries(entry.rows));
  let limit = limitFromUncappedSeries(evaluated);
  if (limit === null) return null;
  // Bis zum Festpunkt: Senkt eine Deckelreihe das Minimum, kann dadurch der
  // Deckel einer weiteren Reihe über den Grenzwert rutschen.
  //
  // Die Rundenschranke ist keine Vorsichtsmaßnahme, sondern eine Schranke, die
  // gilt: Jede Runde senkt den Grenzwert ECHT — sonst bricht sie ab —, und es
  // gibt höchstens so viele verschiedene gemessene Werte wie Reihen.
  let remainingRounds = evaluated.length;
  while (remainingRounds > 0) {
    remainingRounds -= 1;
    const lowered = lowerByReachableCaps(evaluated, limit);
    if (lowered === null) return null;
    if (lowered === limit) break;
    limit = lowered;
  }
  return limit;
}

/** Anteil der Kategorie an der Arbeit EINES Stützpunkts, als Prozentzelle. */
function shareCell(row, category) {
  const share = row.workUnitsByCategory?.[category];
  if (!finiteNonnegative(share)) return '—';
  const percent = ((share / row.workUnits) * 100).toFixed(1);
  return `${percent} %`;
}

/** Eine Zeile der Stützpunkttabelle einer Kategoriereihe. */
function renderSupportPointRow(row, category) {
  const target = row.targetWorkUnits.toLocaleString('de-DE');
  if (row.code === 'FIXTURE_DOKUMENTGRENZE') {
    return `| ${target} | — | — | — | — | — | NICHT ERREICHBAR (Dokumentgrenze) |`;
  }
  if (row.ok !== true) {
    return `| ${target} | — | — | — | — | — | ABGEBROCHEN (${row.code}) |`;
  }
  if (!finiteNonnegative(row.maxMs)) {
    throw new Error(`Arbeitsstützpunkt ${row.targetWorkUnits} ohne erhobenen Wartezeithöchstwert`);
  }
  const verdict = row.maxMs <= VISIBLE_WAIT_BUDGET_MS ? 'gehalten' : 'GERISSEN';
  return `| ${target} | ${row.workUnits.toLocaleString('de-DE')} `
    + `| ${shareCell(row, category)} | ${row.nodes.toLocaleString('de-DE')} `
    + `| ${formatMs(row.medianMs)} | ${formatMs(row.maxMs)} | ${verdict} |`;
}

/** Das Urteil unter einer Kategoriereihe — gedeckelt, tragend oder nicht tragend. */
function renderSeriesVerdict(entry, limit) {
  const evaluated = evaluateWorkUnitSeries(entry.rows);
  if (evaluated.capped && limit !== null && evaluated.ceiling <= limit) {
    return 'Diese Kategorie erreicht die Arbeitsgrenze NICHT: Ihr ungünstigstes Steuerdokument '
      + `schöpft Byte- und Knotengrenze aus und kommt dabei auf höchstens ${evaluated.ceiling.toLocaleString('de-DE')} `
      + 'Arbeitseinheiten. Sie schränkt den Grenzwert deshalb nicht ein.';
  }
  if (evaluated.capped) {
    const heldCell = evaluated.held === null
      ? 'kein gehaltener Stützpunkt'
      : `${evaluated.held.toLocaleString('de-DE')} Arbeitseinheiten`;
    return 'Diese Kategorie ist durch die Dokumentgrenzen gedeckelt, ihr Deckel von '
      + `${evaluated.ceiling.toLocaleString('de-DE')} Arbeitseinheiten liegt aber ÜBER dem `
      + 'Grenzwert. Zwischen ihrem letzten gemessenen Stützpunkt und dem Deckel ist nichts '
      + `gemessen; die Reihe geht deshalb mit ihrem gemessenen Wert in das Minimum ein: ${heldCell}.`;
  }
  if (evaluated.breach === 'broken-cap') {
    return 'Diese Reihe führt eine Dokumentgrenze, die nicht terminal ist oder keine '
      + 'Erreichbarkeitszahl trägt. Sie belegt damit keine Obergrenze und wird wie ein Riss '
      + 'behandelt.';
  }
  if (evaluated.held === null) {
    return 'Kein Stützpunkt hält die sichtbare Wartezeit — die Reihe begründet KEINEN Grenzwert.';
  }
  return `Getragener Grenzwert aus dieser Reihe: ${evaluated.held.toLocaleString('de-DE')} Arbeitseinheiten.`;
}

/** Eine Kategoriereihe der Profile Resolution über den Stützpunkten. */
function renderProfileResolutionSeries(entry, limit) {
  return [
    '',
    `**Kategorie \`${entry.category}\`**`,
    '',
    '| Stützpunkt | gemessene Arbeitseinheiten | Anteil der Kategorie | erzeugte Knoten | Wartezeit Median | Wartezeit Max | Urteil |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...entry.rows.map((row) => renderSupportPointRow(row, entry.category)),
    '',
    renderSeriesVerdict(entry, limit),
  ];
}

/**
 * Die beiden Rollen, die ein Arbeitsgrenzenlauf haben kann. Sie stellen
 * verschiedene Fragen und werden deshalb verschieden streng geprüft.
 *
 * `search` — HERLEITUNG. Der einkompilierte Wert ist bewusst über den
 * erwarteten Grenzwert gesetzt, damit die Stützpunkte überhaupt bis dorthin
 * reichen, wo die Reihen reißen. Ohne diesen Lauf gibt es keinen Grenzwert:
 * Jenseits des einkompilierten Werts bricht der Resolver ab, ein Lauf kann
 * also nie einen Stützpunkt ÜBER seinem eigenen Kandidaten messen. Ein Riss
 * ist hier das gesuchte Ergebnis, kein Fehler.
 *
 * `confirm` — BESTÄTIGUNG (Vorgabe). Der einkompilierte Wert ist der
 * gelieferte. Gefragt wird nicht, ob die Reihen den Kandidaten exakt treffen —
 * das können sie nicht, weil eine Fixture nur in ganzen Wiederholungen wächst
 * und ihren Stützpunkt deshalb von unten annähert. Gefragt wird, ob unterhalb
 * des gelieferten Werts irgendetwas REISST. Reißt eine Reihe, ist der
 * gelieferte Wert widerlegt und der Lauf bricht ab.
 */
export const WORK_LIMIT_ROLES = Object.freeze(['search', 'confirm']);

/**
 * Prüft einen Arbeitsgrenzenlauf fail-closed und liefert den hergeleiteten
 * Wert. Wirft, statt einen erfolgreichen Bericht mit zwei widersprüchlichen
 * Zahlen auszugeben (Codex-Befund zu 10338f3).
 *
 * @param {object} run Ein Drosselungslauf.
 */
export function assertWorkLimitRun(run) {
  if (!finiteNonnegative(run.workUnitLimit) || run.workUnitLimit === 0) {
    throw new Error('Arbeitsreihe ohne ausgewiesenen Grenzwertkandidaten');
  }
  const role = run.workUnitLimitRole ?? 'confirm';
  if (!WORK_LIMIT_ROLES.includes(role)) {
    throw new Error(`Arbeitsreihe mit unbekannter Rolle: ${role}`);
  }
  const derived = deriveWorkUnitLimit(run.profileResolution);
  if (derived !== null && derived > run.workUnitLimit) {
    // Unmöglich: Kein Stützpunkt kann mehr Arbeit verbrauchen, als der
    // Kandidat zulässt. Träte das auf, wäre die Messung selbst defekt.
    throw new Error(
      `Hergeleiteter Grenzwert ${derived} liegt über dem Kandidaten ${run.workUnitLimit}`,
    );
  }
  if (role === 'search') return derived;
  if (derived === null) {
    throw new Error(
      `Bestätigungslauf trägt den einkompilierten Grenzwert ${run.workUnitLimit} nicht: `
      + 'mindestens eine Kategoriereihe hält an keinem Stützpunkt',
    );
  }
  for (const entry of run.profileResolution) {
    const evaluated = evaluateWorkUnitSeries(entry.rows);
    if (evaluated.breach === 'none') continue;
    throw new Error(
      `Bestätigungslauf trägt den einkompilierten Grenzwert ${run.workUnitLimit} nicht: `
      + `Kategorie ${entry.category} reißt unterhalb (${evaluated.breach})`,
    );
  }
  return derived;
}

/** Alle Kategoriereihen der Profile Resolution samt fail-closed Gesamturteil. */
function renderProfileResolutionTable(run) {
  // Der einkompilierte Grenzwert kommt als MESSDATUM aus dem Lauf, nicht als
  // Import: Dieses Modul bleibt frei von Abhängigkeiten, und das Artefakt
  // sagt selbst, gegen welchen Kandidaten gemessen wurde.
  const derived = assertWorkLimitRun(run);
  const role = run.workUnitLimitRole ?? 'confirm';
  const closing = role === 'search'
    ? `Herleitungslauf: Der Kandidat ${run.workUnitLimit.toLocaleString('de-DE')} ist bewusst `
      + 'über den erwarteten Grenzwert gesetzt, damit die Reihen bis zu ihrem Riss gemessen '
      + `werden können. Zu übernehmen ist der fail-closed über alle Kategorien getragene Wert `
      + `**${derived.toLocaleString('de-DE')}** Arbeitseinheiten `
      + `(Budget sichtbare Wartezeit ${formatMs(VISIBLE_WAIT_BUDGET_MS)}).`
    : `Bestätigungslauf: Keine Kategoriereihe reißt unterhalb des einkompilierten Grenzwerts `
      + `${run.workUnitLimit.toLocaleString('de-DE')}. Größter in diesem Lauf gemessener `
      + `gemeinsamer Stützpunkt: ${derived.toLocaleString('de-DE')} Arbeitseinheiten `
      + `(Budget sichtbare Wartezeit ${formatMs(VISIBLE_WAIT_BUDGET_MS)}).`;
  return [
    ...run.profileResolution.flatMap((entry) => renderProfileResolutionSeries(entry, derived)),
    '',
    closing,
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
  if (!finiteNonnegative(run.observability?.probeMs)
    || run.observability.probeMs < UI_BLOCKING_BUDGET_MS
    || !finiteNonnegative(run.observability.observedMs)
    || run.observability.observedMs < run.observability.probeMs * 0.5) {
    throw new Error('Messlauf ohne belegte Long-Task-Beobachtbarkeit');
  }
  // Dasselbe für den Speicherweg: Der Vorgänger dieser Messung sah
  // Puffer-Backing-Stores und externe Blink-Strings nicht und hätte damit ein
  // gehaltenes Speicherbudget ausweisen können, das nicht gehalten wird.
  if (!finiteNonnegative(run.memoryObservability?.probeBytes)
    || run.memoryObservability.probeBytes === 0
    || !finiteNonnegative(run.memoryObservability.observedBytes)
    || run.memoryObservability.observedBytes < run.memoryObservability.probeBytes * 0.9) {
    throw new Error('Messlauf ohne belegte Speicher-Beobachtbarkeit');
  }

  const timingRows = [...run.fixtures, ...(run.scale ?? [])];
  for (const row of timingRows) {
    if (!finiteNonnegative(row.endToEnd?.maxMs)) {
      throw new Error(`Fixture ${row.id} ohne erhobenen Wartezeithöchstwert`);
    }
  }

  const hasScale = run.scale !== null && run.scale !== undefined;
  return [
    '',
    `## CPU-Drosselung ${run.throttleRate}x — ${run.environment.userAgent}`,
    `Wiederholungen je Fixture: ${run.repeat} (Wartezeiten als Median und Maximum, Budgeturteil über alle Wiederholungen)`,
    '',
    ...renderFixtureTable(run),
    '',
    `Speichermessweg geprüft: ${formatMiB(run.memoryObservability.probeBytes)} Prüfpuffer `
    + `wurden als ${formatMiB(run.memoryObservability.observedBytes)} gemeldet. `
    + `Speicherwerte erhoben bei CPU-Drosselung ${run.memoryThrottleRate}x — sie hängen an `
    + 'der Datenstruktur, nicht an der Taktrate, und werden deshalb einmal erhoben. '
    + 'Transportbestand ist ein konservativer gleichzeitig gehaltener Bestand, keine abgetastete Spitze; '
    + 'er enthält Quellbaum, vollständigen Decoderbaum, alle Record-Schlüsselarrays, begrenzte '
    + 'Stack- und Fragmentbestände beider Seiten sowie Fortsetzungs- und Flatteningpuffer. '
    + 'Die ausgewiesene Spitze ist das Maximum aus diesem Bestand plus Originaleingabe '
    + 'und dem bisherigen Kettenbestand plus Ergebnis und Originaleingabe. '
    + 'Die Inventarmessung läuft in einem Realm: getrennte Worker-/Main-Realm-Maps und '
    + 'engine-interne temporäre Allokationen werden damit nicht als tatsächliche Laufzeitspitze gemessen.',
    '',
    ...renderBlockingTable(run),
    ...(hasScale ? ['', ...renderScaleTable(run)] : []),
    '',
    ...renderGlobTable(run),
    '',
    ...(Array.isArray(run.profileResolution) && run.profileResolution.length > 0
      ? renderProfileResolutionTable(run)
      : []),
  ];
}

/**
 * Rendert den Bericht als Markdown, damit er unverändert in
 * `docs/OSCAL_VALIDATION.md` übernommen werden kann.
 *
 * @param {object} report Ergebnis eines Messlaufs.
 */
export function renderReport(report) {
  const before = report.sourceBefore;
  const after = report.sourceAfter;
  if (!before || !after || !/^[a-f0-9]{64}$/.test(before.sha256)
    || !/^[a-f0-9]{40}$/.test(before.commit)
    || !Number.isInteger(before.files) || before.files < 1
    || before.sha256 !== after.sha256 || before.commit !== after.commit || before.files !== after.files) {
    throw new Error('Fehlender oder geänderter Quellfingerprint: Messlauf belegt keinen stabilen Stand');
  }
  // Derselbe Anspruch für die ENGE Hülle des gemessenen Laufs — aber nur, wenn
  // überhaupt eine Arbeitsgrenze gemessen wurde: Änderte sich der
  // Auflösungspfad während der Messung, gehören die Stützpunkte zu zwei
  // verschiedenen Ständen und tragen zusammen keinen Grenzwert. Ein Lauf ohne
  // Arbeitsreihen (Transport, Speicher) führt diesen Pfad nicht aus und
  // braucht die Angabe deshalb nicht.
  const measuresWorkLimit = report.runs.some(
    (run) => Array.isArray(run.profileResolution) && run.profileResolution.length > 0,
  );
  if (measuresWorkLimit
    && (!/^[a-f0-9]{64}$/.test(before.workLimitProvenance?.sha256 ?? '')
      || before.workLimitProvenance.sha256 !== after.workLimitProvenance?.sha256)) {
    throw new Error('Fehlende oder geänderte Messwegprovenienz: Messlauf belegt keinen stabilen Auflösungspfad');
  }
  return [
    '',
    'Klasse-2-Kostenmessung (GSPP-382)',
    `Erhoben: ${report.generatedAt}`,
    `Chromium: ${report.browserVersion}`,
    `Commit: ${before.commit}; Quellfingerprint SHA-256: ${before.sha256} (${before.files} Dateien).`,
    'Quellfingerprint vor und nach der Messung identisch.',
    ...report.runs.flatMap((run) => renderRun(run)),
    '',
  ].join('\n');
}
