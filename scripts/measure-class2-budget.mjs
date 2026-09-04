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
// Der Lauf misst, was ein Dokument EXAKT AN DER GRENZE an Rechenzeit und Heap
// im Browser-Tab kostet — nicht, wie viel Kopfraum der reale BSI-Katalog noch
// hat. Gemessen wird gegen die produktiven Einheiten der Prüfkette über einen
// temporären Vite-Dev-Server und einen von Playwright gesteuerten Chromium.
//
//   node scripts/measure-class2-budget.mjs [--throttle 1,4] [--repeat 3] [--json <pfad>]
//
// Zeit: `performance.now()` in der Seite um genau den gemessenen Schritt.
// Heap: CDP `HeapProfiler.collectGarbage` + `Runtime.getHeapUsage` um denselben
// Schritt.
//
// Messgrenze, die das Protokoll mitführen MUSS: `Runtime.getHeapUsage` liefert
// den V8-JS-Heap des gemessenen Kontexts. Backing Stores von `ArrayBuffer` und
// `Uint8Array` liegen als externer Speicher daneben und erscheinen dort NICHT;
// die Eingabebytes werden deshalb separat und arithmetisch ausgewiesen. Ebenso
// wenig erscheint der Heap des Import-Workers im Hauptkontext — die
// Schrittmessung läuft daher zusätzlich direkt im Tab über dieselben
// produktiven Einheiten, die der Worker ausführt, und ist damit die
// belastbare Aussage über seinen Heap-Bedarf.
// =============================================================================

import { createServer } from 'vite';
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS_PATH = '/scripts/measure/class2-budget.html';
const MIB = 1024 * 1024;

/** Musterlängen des Glob-Worst-Case; die Reihe endet, sobald sie das Budget reißt. */
const GLOB_STAR_COUNTS = [4, 6, 8, 10, 12];
const GLOB_SUBJECT_LENGTH = 40;

function parseArguments(argv) {
  const options = { throttleRates: [1, 4], repeat: 3, jsonPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--throttle') {
      options.throttleRates = argv[++index].split(',').map((rate) => Number(rate));
    } else if (flag === '--repeat') {
      options.repeat = Number(argv[++index]);
    } else if (flag === '--json') {
      options.jsonPath = argv[++index];
    } else {
      throw new Error(`Unbekanntes Argument: ${flag}`);
    }
  }
  if (!Number.isInteger(options.repeat) || options.repeat < 1) {
    throw new RangeError('--repeat erwartet eine positive ganze Zahl');
  }
  return options;
}

/** Median einer Zahlenreihe; robuster gegen einzelne JIT- oder GC-Ausreißer. */
function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

class HeapProbe {
  constructor(session) {
    this.session = session;
  }

  /** Erzwungene Sammlung, dann Momentaufnahme — ohne sie misst man Müll mit. */
  async usedBytes() {
    await this.session.send('HeapProfiler.collectGarbage');
    const usage = await this.session.send('Runtime.getHeapUsage');
    return usage.usedSize;
  }
}

async function measureFixture(page, heap, fixtureId) {
  const call = (method, ...args) =>
    page.evaluate(
      ([name, parameters]) => globalThis.__gspp382[name](...parameters),
      [method, args],
    );

  const baseline = await heap.usedBytes();
  const prepared = await call('prepare', fixtureId);
  const afterBytes = await heap.usedBytes();

  const stage1 = await call('stage1');
  const afterStage1 = await heap.usedBytes();

  const objectChain = await call('objectChain');
  const afterChain = await heap.usedBytes();

  const endToEnd = await call('endToEnd');

  await call('release');

  return {
    ...prepared,
    stage1,
    objectChain,
    endToEnd,
    heap: {
      baselineBytes: baseline,
      // Das gehaltene Parse-Produkt samt Herkunftsregister.
      parsedBytes: afterStage1 - afterBytes,
      // Zusätzliche Rückhaltung der objektorientierten Kette.
      chainBytes: afterChain - afterStage1,
      // Zusätzlicher JS-Heap über der Basislinie am teuersten Punkt. Der
      // Eingabepuffer selbst liegt als externer Speicher daneben und ist
      // hierin NICHT enthalten; er wird über `fixture.bytes` gesondert
      // ausgewiesen.
      jsHeapOverBaselineBytes: afterChain - baseline,
      // Gesamtabdruck im Tab: JS-Heap plus der externe Eingabepuffer.
      totalOverBaselineBytes: afterChain - baseline + prepared.bytes,
    },
  };
}

/**
 * Wiederholt die Fixture-Messung und verdichtet sie: Zeiten als Median gegen
 * JIT- und GC-Ausreißer, Heap als Maximum, weil das Budget den ungünstigsten
 * beobachteten Abdruck tragen muss.
 */
async function measureFixtureRepeatedly(page, heap, fixtureId, repeat) {
  const samples = [];
  for (let attempt = 0; attempt < repeat; attempt += 1) {
    samples.push(await measureFixture(page, heap, fixtureId));
  }
  const first = samples[0];
  const pick = (path) => samples.map(path);
  return {
    id: first.id,
    limit: first.limit,
    label: first.label,
    bytes: first.bytes,
    samples: samples.length,
    stage1: { ...first.stage1, ms: median(pick((entry) => entry.stage1.ms)) },
    objectChain: { ...first.objectChain, ms: median(pick((entry) => entry.objectChain.ms)) },
    endToEnd: { ...first.endToEnd, ms: median(pick((entry) => entry.endToEnd.ms)) },
    heap: {
      parsedBytes: Math.max(...pick((entry) => entry.heap.parsedBytes)),
      chainBytes: Math.max(...pick((entry) => entry.heap.chainBytes)),
      jsHeapOverBaselineBytes: Math.max(...pick((entry) => entry.heap.jsHeapOverBaselineBytes)),
      totalOverBaselineBytes: Math.max(...pick((entry) => entry.heap.totalOverBaselineBytes)),
    },
  };
}

async function measureGlob(page, budgetMs) {
  const rows = [];
  for (const stars of GLOB_STAR_COUNTS) {
    const row = await page.evaluate(
      ([starCount, subjectLength]) => globalThis.__gspp382.glob(starCount, subjectLength),
      [stars, GLOB_SUBJECT_LENGTH],
    );
    rows.push({ stars, ...row });
    if (row.ms > budgetMs) break;
  }
  return rows;
}

async function run() {
  const options = parseArguments(process.argv.slice(2));

  const server = await createServer({
    configFile: false,
    root: REPO_ROOT,
    resolve: { alias: { '@': resolve(REPO_ROOT, 'src') } },
    server: { port: 0, strictPort: false },
    // Keine App-Plugins: der Harnisch importiert reine Domänenmodule und
    // braucht weder React noch Tailwind noch Katalogdaten. Ajv liegt als CJS
    // vor und muss vom Dep-Optimizer vorgebündelt werden, sonst scheitert der
    // Named-Import der Schemastufe im Browser.
    optimizeDeps: { include: ['ajv'] },
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');

  const browser = await chromium.launch({ channel: 'chromium' });
  const report = {
    generatedAt: new Date().toISOString(),
    origin,
    browserVersion: browser.version(),
    runs: [],
  };

  try {
    for (const throttleRate of options.throttleRates) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const session = await context.newCDPSession(page);
      await session.send('Runtime.enable');
      await session.send('HeapProfiler.enable');

      page.on('pageerror', (error) => {
        throw error;
      });
      await page.goto(`${origin}${HARNESS_PATH}`, { waitUntil: 'load' });
      await page.waitForFunction(() => globalThis.__gspp382 !== undefined);

      const environment = await page.evaluate(() => globalThis.__gspp382.environment());
      if (throttleRate !== 1) {
        await session.send('Emulation.setCPUThrottlingRate', { rate: throttleRate });
      }

      const heap = new HeapProbe(session);
      const fixtures = [];
      for (const fixtureId of ['byte-bound', 'node-bound', 'depth-bound', 'base64-bound', 'combined-bound']) {
        fixtures.push(await measureFixtureRepeatedly(page, heap, fixtureId, options.repeat));
      }
      const glob = await measureGlob(page, 10_000);

      report.runs.push({ throttleRate, repeat: options.repeat, environment, fixtures, glob });
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }

  printReport(report);
  if (options.jsonPath !== null) {
    writeFileSync(resolve(REPO_ROOT, options.jsonPath), `${JSON.stringify(report, null, 2)}\n`);
  }
}

function formatMs(value) {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(1)} ms`;
}

function formatMiB(value) {
  return `${(value / MIB).toFixed(2)} MiB`;
}

function printReport(report) {
  process.stdout.write(`\nKlasse-2-Kostenmessung (GSPP-382)\n`);
  process.stdout.write(`Erhoben: ${report.generatedAt}\n`);
  process.stdout.write(`Chromium: ${report.browserVersion}\n`);

  for (const run of report.runs) {
    process.stdout.write(
      `\n## CPU-Drosselung ${run.throttleRate}x — ${run.environment.userAgent}\n`,
    );
    process.stdout.write(
      `Wiederholungen je Fixture: ${run.repeat} (Zeiten als Median, Heap als Maximum)\n\n`,
    );
    process.stdout.write(
      '| Fixture | Grenze | Dokument | Stufe 1 | Objektkette | Ende-zu-Ende (Worker) '
      + '| JS-Heap | Tab gesamt | Ergebnis |\n',
    );
    process.stdout.write('| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n');
    for (const fixture of run.fixtures) {
      process.stdout.write(
        `| ${fixture.id} | ${fixture.limit} | ${formatMiB(fixture.bytes)} `
        + `| ${formatMs(fixture.stage1.ms)} | ${formatMs(fixture.objectChain.ms)} `
        + `| ${formatMs(fixture.endToEnd.ms)} `
        + `| ${formatMiB(fixture.heap.jsHeapOverBaselineBytes)} `
        + `| ${formatMiB(fixture.heap.totalOverBaselineBytes)} `
        + `| ${fixture.endToEnd.code ?? 'angenommen'} |\n`,
      );
    }

    process.stdout.write('\n| Glob-Sterne | Musterbytes | Subjektlänge | Laufzeit |\n');
    process.stdout.write('| --- | --- | --- | --- |\n');
    for (const row of run.glob) {
      process.stdout.write(
        `| ${row.stars} | ${row.patternBytes} | ${row.subjectLength} | ${formatMs(row.ms)} |\n`,
      );
    }
  }
  process.stdout.write('\n');
}

await run();
