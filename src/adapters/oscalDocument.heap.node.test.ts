// @vitest-environment node
// =============================================================================
// Heap-Regressionstest — Preis des erhaltenen Quellgraphen
//
// Misst, was es kostet, `source` neben `view` zu halten. Der Wert hängt fast
// vollständig am String-Sharing: Das Domänenmodell übernimmt Titel, Prosa und
// Prop-Werte per Referenz auf dieselben Quellstrings
// (`src/adapters/oscalAdapter.ts` — `title: raw.title`, `statementRaw`,
// `value: prop.value`). Solange das gilt, trägt der Quellgraph im Wesentlichen
// seine Container-Hüllen bei. Stellt jemand diese Stellen auf Kopien um,
// wandert die Textmasse ins Inkrement und der Messwert bricht aus.
//
// Verfahren nach GSPP-280, an den Node-Testlauf angepasst:
//   1. genau ein Parse je Sample
//   2. Quelltext vor der Messung freigeben
//   3. GC zweimal erzwingen, nicht über Allokationsdruck provozieren
//   4. A/B am selben Graphen: mit und ohne gehaltenen `source`
//   5. fünf Läufe, Median, Spannweite
//
// Zwei Abweichungen vom Originalverfahren sind unvermeidbar und dokumentiert:
//
//   - Gemessen wird `v8.getHeapStatistics().used_heap_size` statt CDP
//     `Runtime.getHeapUsage`; CDP steht im Testlauf nicht zur Verfügung.
//   - Statt eines frischen Page Loads je Sample trennt ein Task-Wechsel die
//     Messpunkte. Das ist nicht kosmetisch: V8 scannt den Stack konservativ,
//     deshalb hält eine tote Referenz in einem Registerslot den gesamten
//     Quellgraphen am Leben. Ohne den Stack-Unwind misst das Verfahren
//     nachweislich ~500 B statt ~1,9 MB.
//
// Deshalb ist der Absolutwert aus GSPP-280 (1.305.788 B bei 21.289 Containern,
// ~61,3 B/Container, Chrome 150 / V8 15.0.245.21) hier keine gültige Schranke.
// Er stammt aus einer anderen Engine und einer anderen A/B-Variante. Geprüft
// wird der übertragbare Teil: der Zusatzspeicher **je Container**.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { getHeapStatistics, setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { parseCatalogDocument } from './oscalDocument';
import { SUPPORTED_CATALOG_KEY } from '@/domain/sourceRegistry';
import { countContainers } from '@/test/oscalStructure';
import type { Catalog } from '@/domain/models';

/** Relativ zum Projektwurzelverzeichnis, dem Arbeitsverzeichnis des Testlaufs. */
const catalogPath = 'public/data/catalog.json';

/** Erzwingt GC auch ohne `--expose-gc` auf der Kommandozeile. */
function makeCollector(): (() => void) | null {
  const existing = (globalThis as { gc?: () => void }).gc;
  if (typeof existing === 'function') return existing;

  try {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as unknown;
    return typeof gc === 'function' ? (gc as () => void) : null;
  } catch {
    return null;
  }
}

const collectGarbage = makeCollector();
const runnable = existsSync(catalogPath) && collectGarbage !== null;

/** Zweimal sammeln: der erste Durchgang gibt frei, der zweite räumt nach. */
function settledHeap(gc: () => void): number {
  gc();
  gc();
  return getHeapStatistics().used_heap_size;
}

/**
 * Baut das Dokument und misst Variante B (Quellgraph und Projektion zusammen).
 *
 * Eigener Aufrufrahmen: Nach der Rückkehr existiert keine lebende Referenz auf
 * das Dokument mehr, nur noch tote Stackslots — die räumt der Task-Wechsel in
 * `measureIncrement` ab.
 */
function buildAndMeasure(gc: () => void): { withSource: number; view: Catalog } {
  const document = parseCatalogDocument(
    JSON.parse(readFileSync(catalogPath, 'utf8')),
    { catalogKey: SUPPORTED_CATALOG_KEY, trustClass: 'class-1-verified-public' },
  );

  return { withSource: settledHeap(gc), view: document.view };
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Zählt die Container des Artefakts in einem eigenen Rahmen. */
function countCatalogContainers(): number {
  return countContainers(JSON.parse(readFileSync(catalogPath, 'utf8'))).total;
}

/** Inkrement des gehaltenen Quellgraphen gegenüber dem Domänenmodell allein. */
async function measureIncrement(gc: () => void): Promise<number> {
  const { withSource, view } = buildAndMeasure(gc);

  // Stack unwinden, damit der Quellgraph tatsächlich unerreichbar wird.
  await nextTask();

  // Variante A: nur die Projektion. Freigegeben wird ausschließlich, was allein
  // über `source` erreichbar war — geteilte Strings hält das Domänenmodell
  // weiter und sie zählen deshalb nicht ins Inkrement.
  const withoutSource = settledHeap(gc);

  // Hält die Projektion nachweislich über beide Messpunkte am Leben.
  expect(view.totalControls).toBeGreaterThan(0);

  return withSource - withoutSource;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

describe.skipIf(!runnable)('Heap-Regression des erhaltenen Quellgraphen', () => {
  it('hält den Zusatzspeicher je Container in der Schranke des String-Sharings', async () => {
    const gc = collectGarbage as () => void;
    const containers = countCatalogContainers();

    // Der Zählgraph ist jetzt Müll. Er muss vor dem ersten Messpunkt weg sein,
    // sonst landet seine Freigabe unvorhersehbar in einem Sample-Fenster.
    await nextTask();
    settledHeap(gc);

    const samples: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      samples.push(await measureIncrement(gc));
    }

    const increment = median(samples);
    const spread = Math.max(...samples) - Math.min(...samples);
    const bytesPerContainer = increment / containers;

    console.info(
      [
        `Heap-Regression — Node ${process.version}, V8 ${process.versions.v8}, ${process.platform}`,
        `  Container:          ${containers}`,
        `  Inkrement (Median): ${Math.round(increment)} B`,
        `  Spannweite:         ${Math.round(spread)} B`,
        `  Byte je Container:  ${bytesPerContainer.toFixed(1)}`,
        '  Referenz GSPP-280:  1.305.788 B bei 21.289 Containern (~61,3 B/Container,',
        '                      Chrome 150 / V8 15.0.245.21) — andere Engine, nicht deckungsgleich',
      ].join('\n'),
    );

    // Untere Schranke: schlägt an, wenn der Quellgraph gar nicht mehr gehalten
    // wird oder die Messung wieder am konservativen Stack-Scanning scheitert.
    expect(bytesPerContainer).toBeGreaterThan(50);

    // Obere Schranke: Bei aufgegebenem String-Sharing müsste der Quellgraph die
    // Textmasse des 5-MB-Artefakts allein tragen; der Wert läge dann jenseits
    // von 200 B/Container. 150 lässt Raum für Engine-Wechsel und
    // Katalogwachstum, ohne den Bruch durchzulassen.
    expect(bytesPerContainer).toBeLessThan(150);

    // Die Messung selbst muss reproduzierbar sein, sonst ist die Aussage wertlos.
    expect(spread / increment).toBeLessThan(0.1);
  });
});
