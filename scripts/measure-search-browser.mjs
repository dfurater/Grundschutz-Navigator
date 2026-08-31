#!/usr/bin/env node
// Browser-Runner für GSPP-218: misst FlexSearch-Index-Aufbau im Chromium mit CPU-Throttling
// Nutzt Playwright + CDP Emulation.setCPUThrottlingRate (4× wie PSI Moto G4).
// Schreibt docs/SEARCH_MEASUREMENT_BROWSER.json
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outPath = resolve(root, 'docs/SEARCH_MEASUREMENT_BROWSER.json');

async function measureInBrowser(throttlingRate) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const client = await page.context().newCDPSession(page);
  if (throttlingRate > 1) {
    await client.send('Emulation.setCPUThrottlingRate', { rate: throttlingRate });
  }
  // Lade FlexSearch im Browser (gleiche Version wie App)
  await page.addScriptTag({ path: resolve(root, 'node_modules/flexsearch/dist/flexsearch.bundle.min.js') });
  const result = await page.evaluate(async (rate) => {
    const catalogs = [
      { key: 'gspp', count: 979 },
      { key: 'lieferkette', count: 140 },
      { key: 'wlan', count: 48 },
    ];
    // FlexSearch ist global als FlexSearch.Index verfügbar (Bundle)
    const FlexSearch = self.FlexSearch || window.FlexSearch;
    function createIndex(tokenize) {
      return new FlexSearch.Index({ tokenize, resolution: 9, cache: 100 });
    }
    const results = [];
    for (const cat of catalogs) {
      const t0 = performance.now();
      const indexes = {
        controlIds: createIndex('forward'),
        titles: createIndex('forward'),
        links: createIndex('forward'),
        metadata: createIndex('strict'),
        content: createIndex('strict'),
      };
      for (let i = 0; i < cat.count; i++) {
        const id = `ID-${i}`;
        indexes.controlIds.add(i, id);
        indexes.titles.add(i, `Titel ${i} ISMS Errichtung`);
        indexes.links.add(i, `GC.1.1`);
        indexes.metadata.add(i, `erhöht MUSS praezisierung Taxonomy-L1`);
        indexes.content.add(i, `Governance MUSS verankert werden. Guidance Text.`);
      }
      const t1 = performance.now();
      for (let q = 0; q < 3; q++) {
        indexes.titles.search('ISMS', { limit: cat.count });
        indexes.metadata.search('erhöht', { limit: cat.count });
      }
      const t2 = performance.now();
      results.push({
        catalogKey: cat.key,
        controls: cat.count,
        throttlingRate: rate,
        totalMs: Number((t2 - t0).toFixed(2)),
        indexesMs: Number((t1 - t0).toFixed(2)),
      });
    }
    return results;
  }, throttlingRate);
  await browser.close();
  return result;
}

const desktop = await measureInBrowser(1);
const mobile4x = await measureInBrowser(4);

const combined = {
  generatedAt: new Date().toISOString(),
  runner: 'scripts/measure-search-browser.mjs',
  config: 'playwright.chromium + CDP Emulation.setCPUThrottlingRate',
  throttling: { desktop: 1, mobile4x: 4 },
  desktop,
  mobile4x,
  notes: 'Browser-Runner misst FlexSearch-Index-Aufbau im Chromium mit CPU-Throttling 4× (PSI Moto G4). Desktop 1× und Mobile 4× werden separat gemessen, nicht nur berechnet.',
};

writeFileSync(outPath, JSON.stringify(combined, null, 2) + '\n', 'utf-8');
console.log(`Wrote ${outPath}`);
console.log(JSON.stringify(combined, null, 2));
