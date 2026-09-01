#!/usr/bin/env node
// Produktions-Runner für GSPP-218: misst Suche → Detail → Zurück im Production-Build
// Desktop (1×) und gedrosselt Mobile (4×) mit Long-Task-Erfassung
import { spawn, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
const QUERY = 'ISMS';
const ITERATIONS = 5;

function checkPreconditions() {
  const required = [
    'public/data/catalog.json',
    'public/data/catalog-lieferkette.json',
    'public/data/catalog-wlan.json',
    'public/data/catalog-metadata.json',
  ];
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
  execSync('npm run build:local', { cwd: root, stdio: 'inherit' });
}

function startPreview(port) {
  console.log(`Starte vite preview auf Port ${port}...`);
  const child = spawn('npx', ['vite', 'preview', '--port', String(port), '--host', '127.0.0.1'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d.toString(); });
  child.stderr.on('data', (d) => { output += d.toString(); });
  return { child, output: () => output };
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

async function measureOnce(page, baseUrl, query) {
  // Cold: direkt /suche?q=...
  const coldStart = Date.now();
  await page.goto(`${baseUrl}/suche?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
  const coldTime = await page.evaluate(async () => {
    const start = performance.now();
    // Warte auf Ergebnisliste (Desktop oder Mobile)
    const selector = '[data-testid="search-results-desktop"], [data-testid="search-results-mobile"]';
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for search results (cold)')), 10000);
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
    // Zusätzlich warten bis mindestens eine Zeile sichtbar
    const rowSelector = '[data-testid="search-results-desktop"] [role="row"], [data-testid="search-results-mobile"] [role="button"]';
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for result rows (cold)')), 10000);
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
    return performance.now() - start;
  });
  const coldDuration = coldTime;
  const coldLongTasks = await page.evaluate(() => {
    const tasks = window.__longTasks ?? [];
    const copy = [...tasks];
    window.__longTasks = [];
    return copy;
  });

  // Warm: Ergebnis öffnen → goBack
  // Klick auf erste Zeile in Desktop-Liste, fallback Mobile
  const hasDesktop = await page.locator('[data-testid="search-results-desktop"]').count() > 0;
  const rowLocator = hasDesktop
    ? page.locator('[data-testid="search-results-desktop"] [role="row"]').nth(1)
    : page.locator('[data-testid="search-results-mobile"] [role="button"]').first();
  await rowLocator.click({ timeout: 10000 });
  // Warte auf Detailseite: URL enthält /katalog/ und /kontrolle/
  await page.waitForURL(/\/katalog\/.*\/kontrolle\//, { timeout: 10000 });
  // goBack
  const warmStart = Date.now();
  await page.goBack({ waitUntil: 'domcontentloaded' });
  const warmTime = await page.evaluate(async () => {
    const start = performance.now();
    const selector = '[data-testid="search-results-desktop"], [data-testid="search-results-mobile"]';
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for search results (warm)')), 10000);
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
    const rowSelector = '[data-testid="search-results-desktop"] [role="row"], [data-testid="search-results-mobile"] [role="button"]';
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for result rows (warm)')), 10000);
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
    return performance.now() - start;
  });
  const warmLongTasks = await page.evaluate(() => {
    const tasks = window.__longTasks ?? [];
    const copy = [...tasks];
    window.__longTasks = [];
    return copy;
  });

  // Zweite kalte Messung nach Reload als Kontrolle
  await page.reload({ waitUntil: 'domcontentloaded' });
  const cold2Time = await page.evaluate(async () => {
    const start = performance.now();
    const selector = '[data-testid="search-results-desktop"], [data-testid="search-results-mobile"]';
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for search results (cold2)')), 10000);
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
    const rowSelector = '[data-testid="search-results-desktop"] [role="row"], [data-testid="search-results-mobile"] [role="button"]';
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout waiting for result rows (cold2)')), 10000);
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
    return performance.now() - start;
  });
  const cold2LongTasks = await page.evaluate(() => {
    const tasks = window.__longTasks ?? [];
    const copy = [...tasks];
    window.__longTasks = [];
    return copy;
  });

  return {
    coldMs: Number(coldDuration.toFixed(2)),
    coldLongTasks,
    warmMs: Number(warmTime.toFixed(2)),
    warmLongTasks,
    cold2Ms: Number(cold2Time.toFixed(2)),
    cold2LongTasks,
  };
}

async function runWithThrottling(throttlingRate, port) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  // Long-Task Observer vor App-Bootstrap registrieren
  await page.addInitScript(() => {
    window.__longTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__longTasks.push({
            duration: Number(entry.duration.toFixed(2)),
            startTime: Number(entry.startTime.toFixed(2)),
            name: entry.name,
            entryType: entry.entryType,
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      // longtask nicht in allen Kontexten verfügbar
    }
  });
  if (throttlingRate > 1) {
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: throttlingRate });
  }
  const results = [];
  for (let i = 0; i < ITERATIONS; i++) {
    console.log(`Lauf ${i + 1}/${ITERATIONS} mit Drosselung ${throttlingRate}×...`);
    // Leere Long-Tasks vor jedem Lauf
    await page.evaluate(() => { window.__longTasks = []; });
    const res = await measureOnce(page, `http://127.0.0.1:${port}`, QUERY);
    results.push(res);
    // Kurze Pause zwischen Iterationen
    await delay(300);
  }
  await browser.close();
  const coldMedians = median(results.map((r) => r.coldMs));
  const warmMedians = median(results.map((r) => r.warmMs));
  const cold2Medians = median(results.map((r) => r.cold2Ms));
  return {
    throttlingRate,
    iterations: ITERATIONS,
    runs: results,
    summary: {
      medianColdMs: Number(coldMedians.toFixed(2)),
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
    const output = {
      generatedAt: new Date().toISOString(),
      snapshotCommitSha: snapshotSha,
      chromiumVersion,
      previewPort: PREVIEW_PORT,
      previewUrl: PREVIEW_URL,
      query: QUERY,
      catalogKey: 'gspp',
      iterations: ITERATIONS,
      throttling: { desktop: 1, mobile4x: 4 },
      desktop,
      mobile4x: mobile,
      notes: 'Kalt = /suche?q= direkt, Zeit bis Ergebnisliste sichtbar. Warm = Detail öffnen → goBack, Zeit bis Ergebnisliste erneut sichtbar (Cache). Cold2 = Reload + erneut kalt als Kontrolle. Long Tasks via PerformanceObserver (longtask) vor Bootstrap.',
    };
    const outPath = resolve(root, 'docs/SEARCH_MEASUREMENT.json');
    writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
    console.log(`Wrote ${outPath}`);
    console.log(JSON.stringify(output, null, 2));
  } finally {
    console.log('Beende Preview-Server...');
    preview.child.kill('SIGTERM');
    await delay(1000);
    if (!preview.child.killed) preview.child.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
