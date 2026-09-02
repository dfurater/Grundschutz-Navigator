#!/usr/bin/env node
// Produktions-Runner für GSPP-218: misst Suche → Detail → Zurück im Production-Build
// Desktop (1×) und gedrosselt Mobile (4×) mit Long-Task-Erfassung
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, devices } from 'playwright';
import { ENTRY_CATALOG_KEY, listCatalogArtifactFileNames } from '../src/domain/sourceRegistry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
const QUERY = 'ISMS';
const ITERATIONS = 5;
// Korrespondiert mit SEARCH_INDEX_BUILD_MEASURE in src/features/search/useSearch.ts.
// Jeder FlexSearch-Indexaufbau hinterlässt genau einen User-Timing-Eintrag; bleibt
// die Liste nach einer Navigation leer, hat der Suchindex-Cache getroffen.
const INDEX_BUILD_MEASURE = 'gspp:search-index-build';
const MOBILE_DEVICE = 'Pixel 7';

/** Verwirft die Index-Build-Einträge der vorherigen Phase. */
function resetIndexBuildMeasures(page) {
  return page.evaluate((name) => {
    performance.clearMeasures(name);
  }, INDEX_BUILD_MEASURE);
}

/**
 * Summe der Index-Build-Zeiten seit dem letzten Reset, oder `null`, wenn in dieser
 * Phase kein Index gebaut wurde (Cache-Treffer).
 */
function readIndexBuildMs(page) {
  return page.evaluate((name) => {
    const entries = performance.getEntriesByName(name, 'measure');
    if (entries.length === 0) return null;
    const total = entries.reduce((sum, entry) => sum + entry.duration, 0);
    return Number(total.toFixed(2));
  }, INDEX_BUILD_MEASURE);
}

/**
 * Ausgelieferte Katalogartefakte, die der Messlauf braucht — abgeleitet aus dem
 * Quellregister (`src/domain/sourceRegistry.mjs`), statt als eigene, unabhängig
 * von ihm pflegbare Liste geführt zu werden (Greptile-Befund, GSPP-218).
 */
function requiredCatalogArtifactPaths() {
  return listCatalogArtifactFileNames().map((fileName) => `public/data/${fileName}`);
}

/**
 * Baut das Ergebnisartefakt. `catalogKey` kommt aus dem Quellregister
 * (`ENTRY_CATALOG_KEY`), weil `/suche?q=…` ohne Katalogpräfix implizit den
 * Einstiegskatalog misst — nicht als fest codierter Katalogname, der bei einer
 * Umbenennung im Register stillschweigend falsch bliebe (Greptile-Befund, GSPP-218).
 */
function buildMeasurementOutput({ snapshotSha, chromiumVersion, desktop, mobile }) {
  return {
    generatedAt: new Date().toISOString(),
    snapshotCommitSha: snapshotSha,
    chromiumVersion,
    previewPort: PREVIEW_PORT,
    previewUrl: PREVIEW_URL,
    query: QUERY,
    catalogKey: ENTRY_CATALOG_KEY,
    iterations: ITERATIONS,
    throttling: { desktop: 1, mobile4x: 4 },
    desktop,
    mobile4x: mobile,
    notes: 'Kalt = /suche?q= direkt, Zeit bis Ergebnisliste sichtbar. Warm = Detail öffnen → goBack, Zeit bis Ergebnisliste erneut sichtbar (Cache). Cold2 = Reload + erneut kalt als Kontrolle. Long Tasks via PerformanceObserver (longtask) vor Bootstrap.',
  };
}

function checkPreconditions() {
  const required = requiredCatalogArtifactPaths();
  const missing = required.filter((p) => !existsSync(resolve(root, p)));
  if (missing.length > 0) {
    console.error('Vorbedingung nicht erfüllt: public/data fehlt.');
    console.error('Fehlende Dateien:', missing.join(', '));
    console.error('Bitte zuerst ausführen: npm run fetch-catalog');
    process.exit(1);
  }
}

function getSnapshotSha() {
  try {
    const manifest = JSON.parse(readFileSync(resolve(root, 'upstream-manifest.json'), 'utf-8'));
    return manifest.snapshotCommitSha ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function buildLocal() {
  console.log('Baue Production-Build (npm run build:local)...');
  execSync('npm run build:local', { cwd: root, stdio: 'inherit' }); // NOSONAR - PATH is from fixed npm script, not user input
}

function startPreview(port) {
  console.log(`Starte vite preview auf Port ${port}...`);
  // detached: true, damit `npx` und der von ihm gestartete vite-Serverprozess
  // dieselbe Prozessgruppe teilen — nur so lässt sich der ganze Baum beenden,
  // statt nur den npx-Wrapper zu treffen und den Server verwaist weiterlaufen
  // zu lassen.
  const child = spawn('npx', ['vite', 'preview', '--port', String(port), '--host', '127.0.0.1'], { // NOSONAR - fixed preview command, PATH from trusted npx
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d.toString(); });
  child.stderr.on('data', (d) => { output += d.toString(); });
  return { child, output: () => output };
}

/**
 * Prüft per Signal 0, ob noch mindestens ein Prozess der Gruppe `pgid` existiert.
 * Signal 0 sendet nichts, sondern testet nur die Zustellbarkeit (POSIX).
 */
function isGroupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

/**
 * Pollt, bis die gesamte Prozessgruppe `pgid` verschwunden ist, oder gibt nach
 * timeoutMs auf. Prüft die Gruppe direkt statt auf das `exit`-Event eines einzelnen
 * Kindprozesses zu warten: der unmittelbare Kindprozess (`npx`) kann sich beenden,
 * während ein von ihm gestarteter, in derselben Gruppe laufender Enkelprozess
 * (der eigentliche vite-Server) SIGTERM ignoriert und weiterläuft — ein
 * `exit`-Event auf dem npx-Handle allein sagt darüber nichts aus.
 */
async function waitForGroupExit(pgid, timeoutMs, pollMs = 100) {
  const start = Date.now();
  while (isGroupAlive(pgid)) {
    if (Date.now() - start >= timeoutMs) return false;
    await delay(pollMs);
  }
  return true;
}

/**
 * Beendet die gesamte Prozessgruppe des Preview-Servers und wartet auf ihr
 * tatsächliches Verschwinden (siehe `waitForGroupExit`). Fällt auf `child.kill()`
 * zurück, falls die Gruppen-Signalisierung fehlschlägt (Windows, kein eigener
 * pid-Besitz).
 */
async function stopPreview(child, { termTimeoutMs = 3000, killTimeoutMs = 2000 } = {}) {
  console.log('Beende Preview-Server...');
  const pgid = child.pid;
  const signalGroup = (signal) => {
    try {
      process.kill(-pgid, signal);
    } catch {
      child.kill(signal);
    }
  };
  signalGroup('SIGTERM');
  if (await waitForGroupExit(pgid, termTimeoutMs)) return;
  console.warn('Preview-Prozessgruppe reagierte nicht vollständig auf SIGTERM, sende SIGKILL...');
  signalGroup('SIGKILL');
  if (!(await waitForGroupExit(pgid, killTimeoutMs))) {
    console.warn('Preview-Prozessgruppe blieb nach SIGKILL unbeendet.');
  }
}

async function waitForPreview(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) return;
    } catch {}
    await delay(300);
  }
  throw new Error(`Preview auf Port ${port} nicht erreichbar nach ${timeoutMs}ms`);
}

/** Beruhigungsphase in Millisekunden, bevor Long Tasks ausgelesen werden. */
const LONG_TASK_SETTLE_MS = 250;

/** Wartet auf die Zustellung des Observers und leert den Puffer für die nächste Phase. */
async function readLongTasks(page) {
  await page.evaluate((quietMs) => window.__settleLongTasks(quietMs), LONG_TASK_SETTLE_MS);
  return page.evaluate(() => {
    const tasks = window.__longTasks ?? [];
    const copy = [...tasks];
    window.__longTasks = [];
    return copy;
  });
}

async function measureOnce(page, baseUrl, query) {
  // Cold: direkt /suche?q=... – Zeit inkl. Navigation + Bootstrap
  await page.evaluate(() => {
    window.__longTasks = [];
  });
  await resetIndexBuildMeasures(page);
  const coldStart = performance.now();
  await page.goto(`${baseUrl}/suche?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.__waitForSearchResults());
  const coldDuration = performance.now() - coldStart;
  const coldLongTasks = await readLongTasks(page);
  const coldIndexBuildMs = await readIndexBuildMs(page);

  // Warm: Ergebnis öffnen → goBack – Zeit inkl. Navigation
  const hasDesktop = await page.locator('[data-testid="search-results-desktop"]').count() > 0;
  const rowLocator = hasDesktop
    ? page.locator('[data-testid="search-results-desktop"] [role="row"]').nth(1)
    : page.locator('[data-testid="search-results-mobile"] button').first();
  await rowLocator.click({ timeout: 30000 });
  // Warte auf Detailseite: URL enthält /katalog/ und /kontrolle/
  await page.waitForURL(/\/katalog\/.*\/kontrolle\//, { timeout: 30000 });
  await page.evaluate(() => {
    window.__longTasks = [];
  });
  await resetIndexBuildMeasures(page);
  const warmStart = performance.now();
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.__waitForSearchResults());
  const warmDuration = performance.now() - warmStart;
  const warmLongTasks = await readLongTasks(page);
  const warmIndexBuildMs = await readIndexBuildMs(page);

  // Zweite kalte Messung nach Reload als Kontrolle
  await page.evaluate(() => {
    window.__longTasks = [];
  });
  await resetIndexBuildMeasures(page);
  const cold2Start = performance.now();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.__waitForSearchResults());
  const cold2Duration = performance.now() - cold2Start;
  const cold2LongTasks = await readLongTasks(page);
  const cold2IndexBuildMs = await readIndexBuildMs(page);

  return {
    coldMs: Number(coldDuration.toFixed(2)),
    coldIndexBuildMs,
    coldLongTasks,
    warmMs: Number(warmDuration.toFixed(2)),
    warmIndexBuildMs,
    warmLongTasks,
    cold2Ms: Number(cold2Duration.toFixed(2)),
    cold2IndexBuildMs,
    cold2LongTasks,
  };
}

async function runWithThrottling(throttlingRate, port) {
  const browser = await chromium.launch();
  const isMobile = throttlingRate > 1;
  // Die Throttling-Rate wird bewusst separat per CDP gesetzt, nicht über den Geräte-Deskriptor.
  const context = await browser.newContext(isMobile ? { ...devices[MOBILE_DEVICE] } : {});
  const page = await context.newPage();
  // Long-Task Observer vor App-Bootstrap registrieren
  await page.addInitScript(() => {
    window.__longTasks = [];
    const record = (entry) => {
      window.__longTasks.push({
        duration: Number(entry.duration.toFixed(2)),
        startTime: Number(entry.startTime.toFixed(2)),
        name: entry.name,
        entryType: entry.entryType,
      });
    };
    let longTaskObserver = null;
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          record(entry);
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      // longtask nicht in allen Kontexten verfügbar
    }
    /*
     * Schließt die Zustell-Lücke des Observers. Ein Long Task, der beim
     * abschließenden Rendern entsteht, ist erst nach seinem Ende beobachtbar und
     * wird zudem asynchron zugestellt — ein sofortiges Auslesen nach den
     * sichtbaren Ergebniszeilen würde ihn verlieren und fälschlich „keine Long
     * Tasks" ausweisen. Die Beruhigungsphase gibt ihm Zeit, takeRecords() holt
     * anschließend alles ab, was beobachtet, aber noch nicht zugestellt wurde.
     */
    window.__settleLongTasks = async (quietMs) => {
      await new Promise((resolve) => setTimeout(resolve, quietMs));
      if (longTaskObserver === null) return;
      for (const entry of longTaskObserver.takeRecords()) {
        record(entry);
      }
    };
    // Helper für Messung: wartet auf Ergebnisliste und Zeilen
    window.__waitForSearchResults = async () => {
      const selector = '[data-testid="search-results-desktop"], [data-testid="search-results-mobile"]';
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout waiting for search results')), 30000);
        const observer = new MutationObserver(() => {
          if (document.querySelector(selector)) {
            clearTimeout(timeout);
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        if (document.querySelector(selector)) {
          clearTimeout(timeout);
          observer.disconnect();
          resolve();
        }
      });
      const rowSelector = '[data-testid="search-results-desktop"] [role="row"], [data-testid="search-results-mobile"] button';
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout waiting for result rows')), 30000);
        const check = () => {
          if (document.querySelector(rowSelector)) {
            clearTimeout(timeout);
            resolve();
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      });
    };
  });
  if (throttlingRate > 1) {
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: throttlingRate });
  }
  const results = [];
  let viewport = null;
  for (let i = 0; i < ITERATIONS; i++) {
    console.log(`Lauf ${i + 1}/${ITERATIONS} mit Drosselung ${throttlingRate}×...`);
    // Leere Long-Tasks vor jedem Lauf
    await page.evaluate(() => { window.__longTasks = []; });
    const res = await measureOnce(page, `http://127.0.0.1:${port}`, QUERY);
    results.push(res);
    if (viewport === null) {
      // Erst nach der ersten Navigation auslesen: `width=device-width` wirkt nur auf
      // einer Seite mit Viewport-Meta-Tag, auf about:blank liefert der mobile Kontext
      // ein irreführendes Layout-Viewport. Protokolliert, damit die Dokumentation die
      // tatsächlich wirksamen Parameter wiedergibt statt der Werte des Deskriptors.
      viewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
      }));
    }
    // Kurze Pause zwischen Iterationen
    await delay(300);
  }
  await browser.close();
  const coldMedians = median(results.map((r) => r.coldMs));
  const warmMedians = median(results.map((r) => r.warmMs));
  const cold2Medians = median(results.map((r) => r.cold2Ms));
  // Fehlende Werte bedeuten "kein Indexaufbau" und dürfen den Median nicht als 0 verfälschen.
  const coldIndexBuilds = results.map((r) => r.coldIndexBuildMs).filter((v) => v !== null);
  const warmIndexBuilds = results.map((r) => r.warmIndexBuildMs).filter((v) => v !== null);
  return {
    throttlingRate,
    iterations: ITERATIONS,
    device: isMobile ? MOBILE_DEVICE : null,
    viewport,
    runs: results,
    summary: {
      medianColdMs: Number(coldMedians.toFixed(2)),
      medianIndexBuildMs:
        coldIndexBuilds.length > 0 ? Number(median(coldIndexBuilds).toFixed(2)) : null,
      // null belegt: die Warm-Navigation baute in keinem Lauf einen Index neu.
      medianWarmIndexBuildMs:
        warmIndexBuilds.length > 0 ? Number(median(warmIndexBuilds).toFixed(2)) : null,
      warmIndexBuildRuns: warmIndexBuilds.length,
      medianWarmMs: Number(warmMedians.toFixed(2)),
      medianCold2Ms: Number(cold2Medians.toFixed(2)),
      minColdMs: Math.min(...results.map((r) => r.coldMs)),
      maxColdMs: Math.max(...results.map((r) => r.coldMs)),
      minWarmMs: Math.min(...results.map((r) => r.warmMs)),
      maxWarmMs: Math.max(...results.map((r) => r.warmMs)),
    },
  };
}

async function main() {
  checkPreconditions();
  await buildLocal();
  const preview = startPreview(PREVIEW_PORT);
  let chromiumVersion = 'unknown';
  try {
    await waitForPreview(PREVIEW_PORT);
    console.log('Preview erreichbar.');
    // Chromium-Version ermitteln
    const tmpBrowser = await chromium.launch();
    chromiumVersion = tmpBrowser.version();
    await tmpBrowser.close();

    const desktop = await runWithThrottling(1, PREVIEW_PORT);
    const mobile = await runWithThrottling(4, PREVIEW_PORT);

    const snapshotSha = getSnapshotSha();
    const output = buildMeasurementOutput({ snapshotSha, chromiumVersion, desktop, mobile });
    const outPath = resolve(root, 'docs/SEARCH_MEASUREMENT.json');
    writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
    console.log(`Wrote ${outPath}`);
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await stopPreview(preview.child);
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    await main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

export { isGroupAlive, waitForGroupExit, stopPreview, requiredCatalogArtifactPaths, buildMeasurementOutput };
