#!/usr/bin/env node
// Runner für GSPP-218 Vorher-Messung (Production-Build, Desktop + gedrosselt Mobile)
// Liest scripts/measure-search.config.json, misst FlexSearch-Index-Aufbau am
// Production-Artefakt (public/data/*.json) und schreibt Ergebnisse nach
// docs/SEARCH_MEASUREMENT.json. Dieselben Optionen wie in src/features/search/useSearch.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Index } from 'flexsearch';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const configPath = resolve(root, 'scripts/measure-search.config.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

function createForwardIndex() {
  return new Index({ tokenize: 'forward', resolution: 9, cache: 100 });
}
function createStrictIndex() {
  return new Index({ tokenize: 'strict', resolution: 9, cache: 100 });
}
function createIndexes() {
  return {
    controlIds: createForwardIndex(),
    titles: createForwardIndex(),
    links: createForwardIndex(),
    metadata: createStrictIndex(),
    content: createStrictIndex(),
  };
}

function countControls(groups) {
  let c = 0;
  for (const g of groups) {
    c += (g.controls ?? []).length;
    if (g.groups) c += countControls(g.groups);
  }
  return c;
}

function collectDocs(catalog, docs, numericIdRef) {
  function walkGroups(groups) {
    for (const g of groups) {
      for (const c of g.controls ?? []) {
        docs.push({
          numericId: numericIdRef.value++,
          controlIdText: c.id ?? '',
          titleText: c.title ?? '',
          linkText: (c.links ?? []).map((l) => l.href ?? '').join(' '),
          metadataText: (c.props ?? []).map((p) => `${p.name} ${p.value}`).join(' '),
          contentText: (c.parts ?? []).map((p) => p.prose ?? '').join(' '),
        });
        if (c.controls) {
          for (const sub of c.controls) {
            docs.push({
              numericId: numericIdRef.value++,
              controlIdText: sub.id ?? '',
              titleText: sub.title ?? '',
              linkText: (sub.links ?? []).map((l) => l.href ?? '').join(' '),
              metadataText: (sub.props ?? []).map((p) => `${p.name} ${p.value}`).join(' '),
              contentText: (sub.parts ?? []).map((p) => p.prose ?? '').join(' '),
            });
          }
        }
      }
      if (g.groups) walkGroups(g.groups);
    }
  }
  if (catalog.groups) walkGroups(catalog.groups);
  for (const c of catalog.controls ?? []) {
    docs.push({
      numericId: numericIdRef.value++,
      controlIdText: c.id ?? '',
      titleText: c.title ?? '',
      linkText: (c.links ?? []).map((l) => l.href ?? '').join(' '),
      metadataText: (c.props ?? []).map((p) => `${p.name} ${p.value}`).join(' '),
      contentText: (c.parts ?? []).map((p) => p.prose ?? '').join(' '),
    });
  }
}

function measureCatalog({ catalogKey, path: relPath }) {
  const absPath = resolve(root, relPath);
  const raw = JSON.parse(readFileSync(absPath, 'utf-8'));
  const catalog = raw.catalog;
  const iterations = config.iterations ?? 10;
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    const docs = [];
    const numericIdRef = { value: 0 };
    collectDocs(catalog, docs, numericIdRef);
    const t1 = performance.now();
    const indexes = createIndexes();
    for (const d of docs) {
      indexes.controlIds.add(d.numericId, d.controlIdText);
      indexes.titles.add(d.numericId, d.titleText);
      indexes.links.add(d.numericId, d.linkText);
      indexes.metadata.add(d.numericId, d.metadataText);
      indexes.content.add(d.numericId, d.contentText);
    }
    const t2 = performance.now();
    times.push({ docs: t1 - t0, indexes: t2 - t1, total: t2 - t0, docsCount: docs.length });
  }
  const avgTotal = times.reduce((a, b) => a + b.total, 0) / times.length;
  const avgIndexes = times.reduce((a, b) => a + b.indexes, 0) / times.length;
  const docsCount = times[0].docsCount;
  const throttling = config.throttling ?? { mobile4x: 4, mobile6x: 6 };
  return {
    catalogKey,
    path: relPath,
    controls: docsCount,
    iterations,
    avgTotalMs: Number(avgTotal.toFixed(2)),
    avgIndexesMs: Number(avgIndexes.toFixed(2)),
    minTotalMs: Number(Math.min(...times.map((t) => t.total)).toFixed(2)),
    maxTotalMs: Number(Math.max(...times.map((t) => t.total)).toFixed(2)),
    frameBudgetMs: 16,
    longTaskMs: 50,
    exceedsFrame: avgTotal > 16,
    exceedsLongTask: avgTotal > 50,
    mobile4xMs: Number((avgTotal * throttling.mobile4x).toFixed(2)),
    mobile6xMs: Number((avgTotal * throttling.mobile6x).toFixed(2)),
    throttling,
  };
}

const results = {
  generatedAt: new Date().toISOString(),
  snapshotCommitSha: config.snapshotCommitSha,
  productionBuild: config.productionBuild,
  iterations: config.iterations,
  throttling: config.throttling,
  flexsearch: config.flexsearch,
  notes: config.notes,
  catalogs: config.catalogs.map(measureCatalog),
};

const outPath = resolve(root, 'docs/SEARCH_MEASUREMENT.json');
writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n', 'utf-8');
console.log(`Wrote ${outPath}`);
console.log(JSON.stringify(results, null, 2));

// Markdown-Tabelle für ARCHITECTURE.md
const md = [
  '| Katalog | Controls | Ø Total | Ø Indizes | Frame 16 ms | Long Task 50 ms | 4× Mobile | 6× Mobile |',
  '|---|---|---|---|---|---|---|---|',
  ...results.catalogs.map(
    (c) =>
      `| \`${c.catalogKey}\` | ${c.controls} | ${c.avgTotalMs} ms | ${c.avgIndexesMs} ms | ${c.exceedsFrame ? '✗' : '✓'} | ${c.exceedsLongTask ? '✗' : '–'} | ${c.mobile4xMs} ms ${c.mobile4xMs > 16 ? '✗' : ''} | ${c.mobile6xMs} ms ${c.mobile6xMs > 16 ? '✗' : ''} |`,
  ),
].join('\n');
console.log('\n' + md);
