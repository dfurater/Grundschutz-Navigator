#!/usr/bin/env node
// Production-Messung des Katalog-Startpfads (GSPP-194).
// Misst Download, JSON- und Domain-Parsing, React-Commit, Browser-Paint sowie
// überlappende Long Tasks getrennt. Ein Worker wird nur bei einem Parse-Long-Task empfohlen.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, devices } from 'playwright';
import { listCatalogArtifactFileNames } from '../src/domain/sourceRegistry.mjs';
import { startPreview, stopPreview } from './measure-search-production.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const PREVIEW_PORT = 4174;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
const ITERATIONS = 5;
const MOBILE_DEVICE = 'Pixel 7';
const LONG_TASK_SETTLE_MS = 250;
const CATALOG_LOAD_MEASURES = {
  download: 'gspp:catalog-download',
  jsonParse: 'gspp:catalog-json-parse',
  domainParse: 'gspp:catalog-domain-parse',
  reactRender: 'gspp:catalog-react-render',
};
const BROWSER_PAINT_MEASURES = {
  firstPaint: 'first-paint',
  firstContentfulPaint: 'first-contentful-paint',
};
const ARCHITECTURE_MEASUREMENT_TABLE_START = '<!-- startup-measurement:table:start -->';
const ARCHITECTURE_MEASUREMENT_TABLE_END = '<!-- startup-measurement:table:end -->';

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function round(value) {
  return Number(value.toFixed(2));
}

/** Ob ein Long Task die JSON- oder Domain-Parsephase zeitlich schneidet. */
function taskOverlapsParse(task, run) {
  const taskEnd = task.startTime + task.duration;
  return [run.jsonParse, run.domainParse].some((phase) => {
    const phaseEnd = phase.startTime + phase.duration;
    return task.startTime < phaseEnd && phase.startTime < taskEnd;
  });
}

/** Verdichtet fünf Startläufe eines Profils und trifft die Worker-Entscheidung. */
function summarizeStartupRuns(runs, { parserRunsOnMainThread = true } = {}) {
  // Worker-Dauern werden erst beim Eintreffen der Antwort in die Main-Thread-
  // User-Timing-Timeline eingetragen. Sie haben daher keinen kausalen
  // Zeitbereich auf dem Main Thread und dürfen keinen Long Task als Parsearbeit
  // klassifizieren. Die rohen Main-Thread-Long-Tasks bleiben separat sichtbar.
  const parseLongTasks = parserRunsOnMainThread
    ? runs.flatMap((run) => run.longTasks.filter((task) => taskOverlapsParse(task, run)))
    : [];
  const parseLongTaskRuns = parserRunsOnMainThread
    ? runs.filter((run) => run.longTasks.some((task) => taskOverlapsParse(task, run))).length
    : null;
  const mainThreadLongTaskRuns = runs.filter((run) => run.longTasks.length > 0).length;

  return {
    medianDownloadMs: round(median(runs.map((run) => run.download.duration))),
    medianJsonParseMs: round(median(runs.map((run) => run.jsonParse.duration))),
    medianDomainParseMs: round(median(runs.map((run) => run.domainParse.duration))),
    medianReactRenderMs: round(median(runs.map((run) => run.reactRender.duration))),
    medianFirstPaintMs: round(median(runs.map((run) => run.firstPaint.startTime))),
    medianFirstContentfulPaintMs: round(
      median(runs.map((run) => run.firstContentfulPaint.startTime)),
    ),
    mainThreadLongTaskRuns,
    parseLongTaskRuns,
    parseLongTasks,
    workerRecommended: parserRunsOnMainThread ? parseLongTaskRuns > 0 : null,
  };
}

function formatFixedMilliseconds(value) {
  return `${value.toLocaleString('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} ms`;
}

function formatCompactMilliseconds(value) {
  return `${value.toLocaleString('de-DE', {
    maximumFractionDigits: 1,
  })} ms`;
}

function formatFallbackParseLongTasks(summary) {
  if (summary.parseLongTaskRuns === 0) return `0/${ITERATIONS}`;

  const durations = summary.parseLongTasks.map((task) => task.duration);
  return `${summary.parseLongTaskRuns}/${ITERATIONS}, ${formatCompactMilliseconds(Math.min(...durations)).replace(' ms', '')}–${formatCompactMilliseconds(Math.max(...durations))}`;
}

function formatParserPhases(summary) {
  return [
    formatFixedMilliseconds(summary.medianJsonParseMs).replace(' ms', ''),
    formatFixedMilliseconds(summary.medianDomainParseMs).replace(' ms', ''),
    formatFixedMilliseconds(summary.medianReactRenderMs),
  ].join(' / ');
}

function formatPaints(summary) {
  return [
    formatCompactMilliseconds(summary.medianFirstPaintMs).replace(' ms', ''),
    formatCompactMilliseconds(summary.medianFirstContentfulPaintMs),
  ].join(' / ');
}

/** Rendert die Architektur-Tabelle ausschließlich aus dem gerade erzeugten Artefakt. */
function renderStartupMeasurementTable(output) {
  const profiles = [
    { label: 'Desktop 1×', key: 'desktop' },
    { label: 'Pixel 7, 4× CPU', key: 'mobile4x' },
  ];
  const rows = profiles
    .filter(({ key }) => output.mainThreadFallback[key] && output.moduleWorker[key])
    .map(({ label, key }) => {
      const fallback = output.mainThreadFallback[key].summary;
      const worker = output.moduleWorker[key].summary;
      return [
        `| ${label}`,
        formatParserPhases(fallback),
        formatPaints(fallback),
        formatFallbackParseLongTasks(fallback),
        formatPaints(worker),
        `${worker.mainThreadLongTaskRuns}/${ITERATIONS} |`,
      ].join(' | ');
    });

  return [
    '| Profil | Vor Worker: JSON / Domain / React (Median) | Vor Worker: FP / FCP (Median) | Vor Worker: Parse-Long-Tasks | Nach Worker: FP / FCP (Median) | Nach Worker: Main-Thread-Long-Tasks |',
    '|---|---:|---:|---:|---:|---:|',
    ...rows,
  ].join('\n');
}

function updateArchitectureMeasurementTable(output) {
  const path = resolve(root, 'docs/ARCHITECTURE.md');
  const architecture = readFileSync(path, 'utf-8');
  const start = architecture.indexOf(ARCHITECTURE_MEASUREMENT_TABLE_START);
  const end = architecture.indexOf(ARCHITECTURE_MEASUREMENT_TABLE_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Startup-Messtabelle in docs/ARCHITECTURE.md nicht gefunden.');
  }

  const updated = `${architecture.slice(0, start + ARCHITECTURE_MEASUREMENT_TABLE_START.length)}\n${renderStartupMeasurementTable(output)}\n${architecture.slice(end)}`;
  writeFileSync(path, updated, 'utf-8');
}

function assertCatalogArtifactsPresent() {
  const missing = listCatalogArtifactFileNames()
    .map((fileName) => `public/data/${fileName}`)
    .filter((path) => !existsSync(resolve(root, path)));
  if (missing.length === 0) return;

  throw new Error(
    `Vorbedingung nicht erfüllt: ${missing.join(', ')} fehlt. Bitte zuerst npm run fetch-catalog ausführen.`,
  );
}

function buildProductionBundle() {
  console.log('Baue Production-Build (npm run build:local)...');
  const npmCli = resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
  execFileSync(process.execPath, [npmCli, 'run', 'build:local'], { cwd: root, stdio: 'inherit' });
}

async function waitForPreview(port, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      // Der Server braucht noch einen weiteren Poll-Zyklus.
    }
    await delay(300);
  }
  throw new Error(`Preview auf Port ${port} nicht erreichbar nach ${timeoutMs}ms`);
}

async function installLongTaskObserver(page, forceMainThreadFallback) {
  await page.addInitScript((forceFallback) => {
    if (forceFallback) {
      Object.defineProperty(window, 'Worker', { configurable: true, value: undefined });
    }

    window.__gsppStartupLongTasks = [];
    window.__gsppStartupLongTaskObserver = null;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__gsppStartupLongTasks.push({
            startTime: Number(entry.startTime.toFixed(2)),
            duration: Number(entry.duration.toFixed(2)),
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
      window.__gsppStartupLongTaskObserver = observer;
    } catch {
      // Die Messung bleibt nutzbar; das Ergebnis markiert die fehlende API.
    }
    window.__gsppReadStartupLongTasks = async (quietMs) => {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, quietMs));
      const observer = window.__gsppStartupLongTaskObserver;
      if (observer !== null) {
        for (const entry of observer.takeRecords()) {
          window.__gsppStartupLongTasks.push({
            startTime: Number(entry.startTime.toFixed(2)),
            duration: Number(entry.duration.toFixed(2)),
          });
        }
      }
      return {
        supported: observer !== null,
        tasks: [...window.__gsppStartupLongTasks],
      };
    };
  }, forceMainThreadFallback);
}

async function readStartupRun(page, baseUrl) {
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (name) => performance.getEntriesByName(name, 'measure').length > 0,
    CATALOG_LOAD_MEASURES.reactRender,
    { timeout: 30_000 },
  );

  const [phases, paints, longTaskResult] = await Promise.all([
    page.evaluate((measureNames) => Object.fromEntries(
      Object.entries(measureNames).map(([key, name]) => {
        const entry = performance.getEntriesByName(name, 'measure').at(-1);
        return [key, entry === undefined ? null : {
          startTime: Number(entry.startTime.toFixed(2)),
          duration: Number(entry.duration.toFixed(2)),
        }];
      }),
    ), CATALOG_LOAD_MEASURES),
    page.evaluate((paintNames) => Object.fromEntries(
      Object.entries(paintNames).map(([key, name]) => {
        const entry = performance.getEntriesByName(name, 'paint').at(-1);
        return [key, entry === undefined ? null : {
          startTime: Number(entry.startTime.toFixed(2)),
          duration: Number(entry.duration.toFixed(2)),
        }];
      }),
    ), BROWSER_PAINT_MEASURES),
    page.evaluate((quietMs) => window.__gsppReadStartupLongTasks(quietMs), LONG_TASK_SETTLE_MS),
  ]);

  const missing = Object.entries(phases)
    .filter(([, phase]) => phase === null)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Startup-Messpunkte fehlen: ${missing.join(', ')}`);
  }

  const missingPaints = Object.entries(paints)
    .filter(([, paint]) => paint === null)
    .map(([name]) => name);
  if (missingPaints.length > 0) {
    throw new Error(`Browser-Paint-Messpunkte fehlen: ${missingPaints.join(', ')}`);
  }

  return {
    ...phases,
    ...paints,
    longTasks: longTaskResult.tasks,
    longTaskSupported: longTaskResult.supported,
  };
}

async function runProfile(throttlingRate, { parserRunsOnMainThread }) {
  const browser = await chromium.launch();
  const isMobile = throttlingRate > 1;
  const runs = [];
  let viewport = null;
  try {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      console.log(`Startup-Lauf ${iteration + 1}/${ITERATIONS} mit Drosselung ${throttlingRate}×...`);
      const context = await browser.newContext(isMobile ? { ...devices[MOBILE_DEVICE] } : {});
      const page = await context.newPage();
      try {
        await installLongTaskObserver(page, parserRunsOnMainThread);
        if (throttlingRate > 1) {
          const client = await page.context().newCDPSession(page);
          await client.send('Emulation.setCPUThrottlingRate', { rate: throttlingRate });
        }
        const run = await readStartupRun(page, PREVIEW_URL);
        runs.push(run);
        if (viewport === null) {
          viewport = await page.evaluate(() => ({
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
            touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
          }));
        }
      } finally {
        await context.close();
      }
      await delay(300);
    }
  } finally {
    await browser.close();
  }

  return {
    throttlingRate,
    parserRunsOnMainThread,
    device: isMobile ? MOBILE_DEVICE : null,
    viewport,
    runs,
    summary: summarizeStartupRuns(runs, { parserRunsOnMainThread }),
  };
}

async function runMeasurementMode(parserRunsOnMainThread) {
  return {
    desktop: await runProfile(1, { parserRunsOnMainThread }),
    mobile4x: await runProfile(4, { parserRunsOnMainThread }),
  };
}

function getSnapshotSha() {
  try {
    const manifest = JSON.parse(readFileSync(resolve(root, 'upstream-manifest.json'), 'utf-8'));
    return manifest.snapshotCommitSha ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function buildOutput({ chromiumVersion, mainThreadFallback, moduleWorker }) {
  const workerRecommended =
    mainThreadFallback.desktop.summary.workerRecommended === true ||
    mainThreadFallback.mobile4x.summary.workerRecommended === true;

  return {
    generatedAt: new Date().toISOString(),
    snapshotCommitSha: getSnapshotSha(),
    chromiumVersion,
    previewUrl: PREVIEW_URL,
    iterations: ITERATIONS,
    profiles: { desktop: 1, mobile4x: 4 },
    measures: CATALOG_LOAD_MEASURES,
    browserPaintMeasures: BROWSER_PAINT_MEASURES,
    mainThreadFallback,
    moduleWorker,
    decision: {
      workerActive: true,
      workerRecommended,
      basis: workerRecommended
        ? 'Ein Parse-Long-Task im erzwungenen Main-Thread-Fallback begründet die Auslagerung. Main-Thread-Long-Tasks des Modul-Worker-Laufs werden separat erfasst; zurückgemeldete Worker-Dauern klassifizieren sie nicht als Parsearbeit.'
        : 'Der erzwungene Main-Thread-Fallback zeigte keinen Parse-Long-Task; der Modul-Worker bleibt als gemessener Produktionspfad dokumentiert.',
    },
    notes: 'Jeder Lauf verwendet einen frischen Browser-Kontext. Der Main-Thread-Fallback wird ausschließlich in der Messseite durch eine vor dem Bootstrap gesetzte fehlende Worker-API erzwungen; der ausgelieferte Produktionspfad bleibt unverändert. Long Tasks werden vor dem App-Bootstrap beobachtet und erst nach einer Zustellbarriere mit takeRecords ausgelesen. Worker-Dauern dienen der Phasentrennung, sind aber nicht direkt mit CDP-gedrosselten Main-Thread-Dauern vergleichbar. firstPaint und firstContentfulPaint stammen aus Browser Paint Timing; reactRender misst davon getrennt ausschließlich den React-Commit.',
  };
}

async function main() {
  assertCatalogArtifactsPresent();
  buildProductionBundle();
  const preview = startPreview(PREVIEW_PORT);
  try {
    await waitForPreview(PREVIEW_PORT);
    const versionBrowser = await chromium.launch();
    const chromiumVersion = versionBrowser.version();
    await versionBrowser.close();

    console.log('Messe den erzwungenen Main-Thread-Fallback...');
    const mainThreadFallback = await runMeasurementMode(true);
    console.log('Messe den Modul-Worker-Produktionspfad...');
    const moduleWorker = await runMeasurementMode(false);
    const output = buildOutput({ chromiumVersion, mainThreadFallback, moduleWorker });
    const outputPath = resolve(root, 'docs/STARTUP_MEASUREMENT.json');
    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');
    updateArchitectureMeasurementTable(output);
    console.log(`Wrote ${outputPath}`);
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await stopPreview(preview.child);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

export { renderStartupMeasurementTable, summarizeStartupRuns, taskOverlapsParse };
