#!/usr/bin/env node
// =============================================================================
// Kostenbasierte Nachvalidierung der Klasse-2-Ressourcengrenzen (GSPP-382)
//
// WARTUNGSWERKZEUG. Bewusst nicht in `npm run build`, `npm run test` oder
// `npm run dev` eingebunden und kein CI-Gate — dieselbe Trennung wie
// `scripts/sync-oscal-schemas.mjs`. Committed wird das Ergebnis in
// `docs/OSCAL_VALIDATION.md`; das Skript existiert, damit die Zahlen dort
// reproduzierbar sind, nicht damit sie laufend neu erhoben werden.
//
// Der Lauf misst, was ein Dokument EXAKT AN DER GRENZE an Rechenzeit und
// Speicher im Browser-Tab kostet — nicht, wie viel Kopfraum der reale
// BSI-Katalog noch hat. Gemessen wird gegen die produktiven Einheiten der
// Prüfkette über einen temporären Vite-Dev-Server und einen von Playwright
// gesteuerten Chromium.
//
//   node scripts/measure-class2-budget.mjs [--throttle 1,4] [--repeat 3] [--json <pfad>]
//                                          [--scale 125000,250000,500000,1000000] [--skip-glob]
//
// `--scale` misst die knotenskalierbaren Fixtures zusätzlich an mehreren
// Knotenzahlen. Daraus wird `maxNodes` gegen das Budget hergeleitet, statt von
// einem einzelnen Messpunkt aus hochgerechnet zu werden. `--skip-glob` lässt
// die Glob-Reihe aus, deren größte Muster allein Minuten kosten.
//
// Die reine Logik (Argumente, Verdichtung, Berichtsformat) liegt in
// `measureClass2BudgetReport.mjs` und ist dort kolokiert getestet; diese Datei
// hält nur die Orchestrierung, die ohne Browser nicht prüfbar ist.
//
// Zeit: `performance.now()` in der Seite um genau den gemessenen Schritt.
// Speicher: `performance.measureUserAgentSpecificMemory()` in der Seite. Diese
// Messung erfasst den gesamten Agenten — JS-Heap, externe Blink-Strings und
// `ArrayBuffer`-Backing-Stores — und verlangt dafür eine cross-origin
// isolierte Seite; der temporäre Messserver setzt COOP/COEP entsprechend. Sie
// kostet je Aufruf rund zehn Sekunden, weshalb der Speicher je Fixture einmal
// und nicht je Wiederholung erhoben wird. Ein Lauf mit `--scale` dauert
// dadurch Minuten bis Dutzende von Minuten; das ist für ein Wartungswerkzeug
// der richtige Tausch gegen eine Zahl, die stimmt.
//
// DIE SPEICHERSPITZE WIRD AUS DREI GEMESSENEN POSTEN GEBILDET, weil im Tab
// zwei Isolate an demselben Import arbeiten und ein Puffer doppelt liegt:
//
//   1. `chainPeak` — der größere der beiden Höchststände der Prüfkette
//      (Parse-Stufe und Objektkette; ihre Bestände unterscheiden sich, siehe
//      Harnisch). Produktiv ist das der Bestand des Worker-Isolats; dessen
//      Speicher wird von der Messung im Hauptkontext nicht ausgewiesen,
//      weshalb der Harnisch dieselben Einheiten über dasselbe Dokument
//      zusätzlich direkt im Tab ausführt.
//   2. `mainThread` — was der PRODUKTIVE Weg im Hauptkontext hinterlässt, im
//      Wesentlichen der aus der Worker-Antwort strukturiert deserialisierte
//      Ergebnisgraph. Gemessen um `importClass2OscalDocument` herum, gegen
//      eine eigene Basislinie mit bereits gehaltenen Eingabebytes.
//   3. Die Eingabebytes EIN ZWEITES MAL: `copyForTransfer` in
//      `src/adapters/oscalImportGate.ts` legt für die Übergabe eine
//      vollständige Kopie an, die an den Worker übergeht, während der Aufrufer
//      sein Original behält. Posten 1 enthält davon nur eine.
//
// Posten 1 und 2 bestehen gleichzeitig: Der Worker wird erst nach Eintreffen
// der Antwort beendet, sein Bestand lebt also noch, während der Hauptkontext
// den Klon aufbaut.
// =============================================================================

import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  composeHeapFootprint,
  parseArguments,
  renderReport,
  summarizeSamples,
} from './measureClass2BudgetReport.mjs';
import { assertScalableNodeCounts } from './class2WorstCaseFixtures.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS_PATH = '/scripts/measure/class2-budget.html';

/** Musterlängen des Glob-Worst-Case; die Reihe endet, sobald sie das Budget reißt. */
const GLOB_STAR_COUNTS = [4, 6, 8, 10, 12];
const GLOB_SUBJECT_LENGTH = 40;
const GLOB_BUDGET_MS = 10_000;

/** Fixtures, deren Kosten an der Knotenzahl hängen und die deshalb skaliert messbar sind. */
const SCALABLE_FIXTURES = ['node-bound', 'heap-bound', 'record-bound', 'combined-bound'];

const FIXTURE_ORDER = [
  'byte-bound',
  'node-bound',
  'depth-bound',
  'heap-bound',
  'record-bound',
  'base64-bound',
  'combined-bound',
];

/**
 * Cross-Origin-Isolation für den temporären Messserver.
 *
 * `performance.measureUserAgentSpecificMemory()` steht nur einer isolierten
 * Seite zur Verfügung. Der Server lebt allein für die Dauer des Messlaufs und
 * liefert ausschließlich Repository-Dateien aus; die Anwendung selbst ist von
 * dieser Einstellung nicht berührt.
 */
const crossOriginIsolation = {
  name: 'gspp382-cross-origin-isolation',
  configureServer(server) {
    server.middlewares.use((_request, response, next) => {
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  },
};

/**
 * Speichersonde samt Abdruckregister.
 *
 * Das Register lebt über alle Drosselungsläufe hinweg, weil der Speicherbedarf
 * an der Datenstruktur hängt und nicht an der Taktrate: Ein zweiter Lauf mit
 * `Emulation.setCPUThrottlingRate` misst dieselben Bytes noch einmal und
 * kostet dafür bei rund zehn Sekunden je Messung Dutzende Minuten. Erhoben
 * wird deshalb einmal; welcher Lauf das war, weist der Bericht aus.
 */
class MemoryProbe {
  constructor() {
    this.page = null;
    this.throttleRate = null;
    this.measuredAtThrottleRate = null;
    this.footprints = new Map();
  }

  attach(page, throttleRate) {
    this.page = page;
    this.throttleRate = throttleRate;
  }

  /** Speicherstand des Agenten; die Messung sammelt vorher selbst ein. */
  async usedBytes() {
    return this.page.evaluate(() => globalThis.__gspp382.usedBytes());
  }

  async footprintFor(fixtureId, totalNodes) {
    const key = `${fixtureId}:${totalNodes ?? 'grenze'}`;
    const known = this.footprints.get(key);
    if (known !== undefined) return known;

    const footprint = await measureMemory(this.page, this, fixtureId, totalNodes);
    this.measuredAtThrottleRate ??= this.throttleRate;
    this.footprints.set(key, footprint);
    return footprint;
  }
}

/** Ruft eine Harnischmethode in der Seite auf. */
function harnessCall(page) {
  return (method, ...args) =>
    page.evaluate(
      ([name, parameters]) => globalThis.__gspp382[name](...parameters),
      [method, args],
    );
}

/**
 * Ein Zeitdurchlauf eines Fixtures — ohne Speichersonden.
 *
 * Zeit und Speicher werden getrennt erhoben, weil sie verschieden teuer sind:
 * Ein Zeitdurchlauf kostet Sekundenbruchteile bis Sekunden und wird mehrfach
 * wiederholt, damit der Median JIT- und GC-Ausreißer verliert. Eine
 * Speichermessung kostet rund zehn Sekunden und ist ihrerseits deterministisch
 * — sie hängt an der Datenstruktur, nicht am Lauf.
 */
async function measureTiming(page, fixtureId, totalNodes = null) {
  const call = harnessCall(page);
  const prepared = totalNodes === null
    ? await call('prepare', fixtureId)
    : await call('prepareScaled', fixtureId, totalNodes);

  const stage1 = await call('stage1');
  const objectChain = await call('objectChain');
  const endToEnd = await call('endToEnd');
  await call('release');

  return { ...prepared, stage1, objectChain, endToEnd };
}

/**
 * Der Speicherabdruck eines Fixtures, einmal erhoben.
 *
 * Zwei Durchläufe mit getrennten Basislinien: erst die Prüfkette direkt im
 * Tab mit ihren beiden festgehaltenen Höchstständen, dann der produktive Weg
 * mit Worker. Der zweite braucht eine eigene Basislinie, weil sonst der
 * Bestand des ersten nicht vom Ergebnisklon zu trennen wäre.
 */
async function measureMemory(page, memory, fixtureId, totalNodes = null) {
  const call = harnessCall(page);
  const prepare = () => (totalNodes === null
    ? call('prepare', fixtureId)
    : call('prepareScaled', fixtureId, totalNodes));

  const baseline = await memory.usedBytes();
  const prepared = await prepare();
  await call('stage1');
  await call('objectChain');

  // Die beiden Höchststände der Kette nacheinander, jeder festgehalten. Was
  // sie enthalten und warum sie sich unterscheiden, steht im Harnisch.
  const stage1Live = await call('holdStage1Peak');
  const stage1PeakBytes = await memory.usedBytes();
  const chainLive = await call('holdChainPeak');
  const chainPeakBytes = await memory.usedBytes();

  await call('release');
  await prepare();
  const workerBaseline = await memory.usedBytes();
  await call('endToEnd');
  const afterEndToEnd = await memory.usedBytes();
  await call('release');

  return {
    live: { ...stage1Live, ...chainLive },
    heap: composeHeapFootprint({
      stage1PeakBytes: stage1PeakBytes - baseline,
      chainPeakBytes: chainPeakBytes - baseline,
      mainThreadBytes: afterEndToEnd - workerBaseline,
      inputBytes: prepared.bytes,
    }),
  };
}

async function measureFixtureRepeatedly(page, memory, fixtureId, repeat, totalNodes = null) {
  const samples = [];
  for (let attempt = 0; attempt < repeat; attempt += 1) {
    samples.push(await measureTiming(page, fixtureId, totalNodes));
  }
  const summary = summarizeSamples(samples);
  const footprint = await memory.footprintFor(fixtureId, totalNodes);
  return totalNodes === null
    ? { ...summary, ...footprint }
    : { ...summary, ...footprint, totalNodes };
}

/**
 * Misst die knotenskalierbaren Fixtures an mehreren Knotenzahlen.
 *
 * Das ist die Grundlage, auf der `maxNodes` gegen das Budget HERGELEITET wird
 * statt hochgerechnet: Jeder Stützpunkt ist eine eigene Messung mit eigenem
 * Dokument, und die Bytegrenze bleibt dabei ausgeschöpft.
 */
async function measureScale(page, memory, nodeCounts, repeat) {
  const rows = [];
  for (const fixtureId of SCALABLE_FIXTURES) {
    for (const totalNodes of nodeCounts) {
      rows.push(await measureFixtureRepeatedly(page, memory, fixtureId, repeat, totalNodes));
    }
  }
  return rows;
}

async function measureGlob(page) {
  const rows = [];
  for (const stars of GLOB_STAR_COUNTS) {
    const row = await page.evaluate(
      ([starCount, subjectLength]) => globalThis.__gspp382.glob(starCount, subjectLength),
      [stars, GLOB_SUBJECT_LENGTH],
    );
    rows.push({ stars, ...row });
    if (row.ms > GLOB_BUDGET_MS) break;
  }
  return rows;
}

async function measureInBrowser(browser, origin, options) {
  const runs = [];
  const memory = new MemoryProbe();
  for (const throttleRate of options.throttleRates) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const session = await context.newCDPSession(page);

      page.on('pageerror', (error) => {
        throw error;
      });
      await page.goto(`${origin}${HARNESS_PATH}`, { waitUntil: 'load' });
      // Auf die Existenz der Eigenschaft prüfen, nicht auf ihren Wert: Der
      // Harnisch setzt sie erst am Ende seines Moduls, und ein
      // Wertvergleich gegen `undefined` auf einem untypisierten Global ist
      // nicht eindeutig lesbar.
      await page.waitForFunction(() => '__gspp382' in globalThis);

      const environment = await page.evaluate(() => globalThis.__gspp382.environment());
      if (throttleRate !== 1) {
        await session.send('Emulation.setCPUThrottlingRate', { rate: throttleRate });
      }

      // Vor der ersten Messung, NACH dem Setzen der Drosselung: Meldet die
      // Long-Task-Instrumentierung in diesem Kontext überhaupt etwas? Ohne
      // diese Probe ist jede später gemessene Blockierzeit von null
      // zweideutig — freier Main Thread oder blinde Messung. Wirft die Probe,
      // bricht der Lauf ab, statt ein eingehaltenes UI-Budget zu behaupten.
      const observability = await page.evaluate(
        () => globalThis.__gspp382.assertLongTaskObservability(),
      );

      // Vor der ersten Speichermessung: Sieht dieser Messweg überhaupt, was er
      // sehen soll? Der Vorgänger sah Puffer und externe Strings nicht.
      const memoryObservability = await page.evaluate(
        () => globalThis.__gspp382.assertMemoryObservability(),
      );

      // Schema-Chunk laden und Ajv kompilieren, bevor die erste Basislinie
      // steht: Dieser einmalige Modulaufbau gehört zu keinem Dokument und
      // würde sonst dem ersten Fixture zugeschlagen.
      await page.evaluate(() => globalThis.__gspp382.warmUp());

      memory.attach(page, throttleRate);
      const fixtures = [];
      for (const fixtureId of FIXTURE_ORDER) {
        fixtures.push(await measureFixtureRepeatedly(page, memory, fixtureId, options.repeat));
      }

      runs.push({
        throttleRate,
        repeat: options.repeat,
        environment,
        observability,
        memoryObservability,
        memoryThrottleRate: memory.measuredAtThrottleRate ?? throttleRate,
        fixtures,
        scale: options.scaleNodes === null
          ? null
          : await measureScale(page, memory, options.scaleNodes, options.repeat),
        glob: options.skipGlob ? [] : await measureGlob(page),
      });
    } finally {
      await context.close();
    }
  }
  return runs;
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  // VOR dem Serverstart: Ein Stützpunkt, den nicht jedes skalierbare Fixture
  // trägt, würde den Lauf sonst erst nach dem Start von Vite und Chromium
  // abbrechen — ohne Bericht und mit einem Konstruktionsfehler statt einer
  // lesbaren Meldung.
  if (options.scaleNodes !== null) assertScalableNodeCounts(options.scaleNodes);

  const server = await createServer({
    configFile: false,
    root: REPO_ROOT,
    plugins: [crossOriginIsolation],
    resolve: { alias: { '@': resolve(REPO_ROOT, 'src') } },
    server: {
      port: 0,
      strictPort: false,
      // KEIN HMR und kein Dateiwächter. Der Messlauf dauert Minuten bis
      // Dutzende von Minuten, und in dieser Zeit darf die Seite unter keinen
      // Umständen neu geladen werden: Ein Reload zerstört den
      // Ausführungskontext samt festgehaltenem Bestand, und der Lauf endet
      // ohne Bericht. Der Server liest den gesamten Repository-Baum, also auch
      // fremde Git-Worktrees unter `.worktrees/`; eine Änderung dort — eine
      // parallele Agentensitzung genügt — hat einen vollständigen Messlauf
      // dieser Auflage bereits abgebrochen. Der Server lebt ohnehin nur für
      // die Dauer des Laufs und liefert einen unveränderlichen Stand aus.
      hmr: false,
      watch: { ignored: ['**/.worktrees/**', '**/node_modules/**', '**/dist/**'] },
    },
    // Keine App-Plugins: der Harnisch importiert reine Domänenmodule und
    // braucht weder React noch Tailwind noch Katalogdaten. Ajv liegt als CJS
    // vor und muss vom Dep-Optimizer vorgebündelt werden, sonst scheitert der
    // Named-Import der Schemastufe im Browser.
    optimizeDeps: { include: ['ajv'] },
  });

  let report;
  try {
    await server.listen();
    const origin = server.resolvedUrls.local[0].replace(/\/$/, '');

    // Der Browserstart liegt INNERHALB des Aufräumbereichs des Servers:
    // Scheitert er, würde ein außen liegender Start den Vite-Server samt Port
    // zurücklassen (Greptile-Befund zu 6643714).
    const browser = await chromium.launch({ channel: 'chromium' });
    try {
      report = {
        generatedAt: new Date().toISOString(),
        origin,
        browserVersion: browser.version(),
        runs: await measureInBrowser(browser, origin, options),
      };
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }

  process.stdout.write(renderReport(report));
  if (options.jsonPath !== null) {
    writeFileSync(resolve(REPO_ROOT, options.jsonPath), `${JSON.stringify(report, null, 2)}\n`);
  }
}

await run();
