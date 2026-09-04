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
//
// Die reine Logik (Argumente, Verdichtung, Berichtsformat) liegt in
// `measureClass2BudgetReport.mjs` und ist dort kolokiert getestet; diese Datei
// hält nur die Orchestrierung, die ohne Browser nicht prüfbar ist.
//
// Zeit: `performance.now()` in der Seite um genau den gemessenen Schritt.
// Speicher: CDP `HeapProfiler.collectGarbage` + `Runtime.getHeapUsage`.
//
// Zwei Messgrenzen, die die Spitzenbildung bestimmen:
//   1. `Runtime.getHeapUsage` liefert den V8-JS-Heap. Backing Stores von
//      `ArrayBuffer`/`Uint8Array` liegen als externer Speicher daneben; die
//      Eingabebytes werden deshalb arithmetisch zugeschlagen.
//   2. Die erzwungene Sammlung vor jeder Messung räumt die Identitätsmenge der
//      Strukturinvariante ab, sobald deren Lauf zurückgekehrt ist. Sie wird
//      darum in einem eigenen Schritt noch einmal aufgebaut, festgehalten und
//      separat gemessen — sonst fehlte der transiente Teil der Spitze.
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

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS_PATH = '/scripts/measure/class2-budget.html';

/** Musterlängen des Glob-Worst-Case; die Reihe endet, sobald sie das Budget reißt. */
const GLOB_STAR_COUNTS = [4, 6, 8, 10, 12];
const GLOB_SUBJECT_LENGTH = 40;
const GLOB_BUDGET_MS = 10_000;

const FIXTURE_ORDER = [
  'byte-bound',
  'node-bound',
  'depth-bound',
  'base64-bound',
  'combined-bound',
];

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

  const stage1 = await call('stage1');
  const objectChain = await call('objectChain');
  const afterChain = await heap.usedBytes();

  // Der transiente Anteil: dieselbe Identitätsmenge noch einmal, diesmal
  // festgehalten, damit die Sammlung sie nicht vor der Messung abräumt.
  const identity = await call('identitySetCost');
  const afterIdentitySet = await heap.usedBytes();

  const endToEnd = await call('endToEnd');
  await call('release');

  return {
    ...prepared,
    stage1,
    objectChain,
    endToEnd,
    containers: identity.containers,
    heap: composeHeapFootprint({
      retainedBytes: afterChain - baseline,
      identitySetBytes: afterIdentitySet - afterChain,
      inputBytes: prepared.bytes,
    }),
  };
}

async function measureFixtureRepeatedly(page, heap, fixtureId, repeat) {
  const samples = [];
  for (let attempt = 0; attempt < repeat; attempt += 1) {
    samples.push(await measureFixture(page, heap, fixtureId));
  }
  return summarizeSamples(samples);
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
  for (const throttleRate of options.throttleRates) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const session = await context.newCDPSession(page);
      await session.send('Runtime.enable');
      await session.send('HeapProfiler.enable');

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

      const heap = new HeapProbe(session);
      const fixtures = [];
      for (const fixtureId of FIXTURE_ORDER) {
        fixtures.push(await measureFixtureRepeatedly(page, heap, fixtureId, options.repeat));
      }

      runs.push({
        throttleRate,
        repeat: options.repeat,
        environment,
        fixtures,
        glob: await measureGlob(page),
      });
    } finally {
      await context.close();
    }
  }
  return runs;
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
