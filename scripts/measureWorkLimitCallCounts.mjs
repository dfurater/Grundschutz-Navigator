// =============================================================================
// Aufrufzählung des gemessenen Auflösungslaufs (GSPP-445).
//
// Liefert die Rohdaten, aus denen `measureWorkLimitProvenance.mjs` die Hülle
// der Messwegprovenienz bestimmt: Für jede Work-Unit-Kategorie läuft der
// produktive `resolveProfile` über die Kalibrierfixture mit N und mit 2N
// Wiederholungen, und V8 zählt dabei jede Ausführung. Ausgewertet wird
// hier nichts; das Skript schreibt die Zählung als JSON auf stdout.
//
// Gezählt wird auf Blockebene, nicht nur je Funktionsaufruf: Eine Funktion,
// die je Lauf einmal aufgerufen wird, deren Schleifenrumpf aber je
// Arbeitseinheit läuft, hat bei N und 2N dieselbe Aufrufzahl — ihr
// Schleifenblock nicht.
//
// Warum ein eigener Node-Prozess. V8-Precise-Coverage ist ein Zustand des
// ganzen Isolates, und `takePreciseCoverage` setzt die Zähler zurück. Unter
// `npm run test:coverage` misst Vitest seine Abdeckung über genau diesen
// Mechanismus; eine Zählung im Testprozess verfälschte dessen Abdeckung und
// umgekehrt. Der eigene Prozess lädt die Domänenmodule über Nodes
// Typ-Stripping und den Aliashook der Domänenbrücke, sodass die Coverage-URLs
// auf die Quelldateien selbst zeigen.
//
// Gezählt wird genau der Abschnitt, den der Messharnisch zwischen seinen beiden
// `nowMs()` misst (`scripts/measure/class2-budget.harness.mjs`,
// `runResolutionFixture`): Plan und `parseProfileDocument` laufen vorher und
// fallen mit dem ersten `takePreciseCoverage` heraus.
// =============================================================================

import { Session } from 'node:inspector/promises';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerAliasHook } from './oscal-domain-bridge.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_ROOT = pathToFileURL(`${resolve(REPO_ROOT, 'schemas', 'oscal')}/`).href;

/**
 * Die kleinere der beiden Wiederholungszahlen je Kategorie; die größere ist
 * ihr Doppeltes. Klein genug, dass alle sechs Kategorien zusammen in rund
 * einer Sekunde laufen, und groß genug, dass jede Kategorie zwischen beiden
 * Zahlen nachweislich wächst — das prüft der Selbstnachweis bei jeder
 * Berechnung.
 */
const BASE_REPETITIONS = 4;

/**
 * Vite lädt die gepinnten NIST-Schemas als JSON-Module ohne Importattribut,
 * Node verlangt `with { type: 'json' }`. Der Hook reicht das Attribut nach,
 * und zwar nur für JSON-Dateien unter `schemas/oscal/`.
 */
export function resolveSchemaJson(specifier, context, nextResolve) {
  const resolved = nextResolve(specifier, context);
  if (!resolved.url.startsWith(SCHEMA_ROOT) || !resolved.url.endsWith('.json')) return resolved;
  return { ...resolved, importAttributes: { ...context.importAttributes, type: 'json' } };
}

/**
 * Alle ausgeführten Bereiche: `[url, name, startOffset, endOffset, count]`.
 * Der erste Bereich einer Funktion trägt ihre Aufrufzahl, jeder weitere die
 * Ausführungszahl eines Blocks darin, etwa eines Schleifenrumpfs.
 */
export function executedRanges(coverage) {
  const ranges = [];
  for (const script of coverage) {
    for (const fn of script.functions) {
      for (const range of fn.ranges) {
        if (range.count > 0) {
          ranges.push([script.url, fn.functionName, range.startOffset, range.endOffset, range.count]);
        }
      }
    }
  }
  return ranges;
}

export async function countedRun(session, domain, category, repetitions) {
  // `buildWorkUnitCalibration` baut jede Wiederholungszahl, auch jenseits der
  // Dokumentgrenze; ein `capped` setzt nur `buildWorkUnitWorstCase`. Die Grenze
  // wird deshalb hier gegen `maxRepetitions` geprüft, bevor gebaut wird.
  const cap = domain.maxRepetitions(category);
  if (!Number.isInteger(cap) || repetitions > cap) {
    throw new Error(
      `Kalibrierfixture ${category} mit ${repetitions} Wiederholungen liegt jenseits der Dokumentgrenze (${cap})`,
    );
  }
  const fixture = domain.buildWorkUnitCalibration(category, repetitions);
  // Vorbereitung wie im Harnisch — außerhalb des gezählten Abschnitts.
  const documents = new Map(Object.entries(fixture.documents));
  const edgesByArtifactKey = new Map(Object.entries(fixture.edges));
  const plan = domain.buildProfileResolutionPlan({
    topProfileArtifactKey: fixture.topProfileArtifactKey,
    documents,
    edgesByArtifactKey,
  });
  if (!plan.ok) throw new Error(`Plan für ${category} gescheitert: ${plan.diagnostic.code}`);
  const profileViews = new Map(
    plan.order
      .filter((key) => key.startsWith('profile'))
      .map((key) => [
        key,
        domain.parseProfileDocument(documents.get(key), { trustClass: 'class-2-local-user' }),
      ]),
  );

  // Verwirft die Zähler der Vorbereitung.
  await session.post('Profiler.takePreciseCoverage');
  const outcome = await domain.resolveProfile({ plan, edgesByArtifactKey, profileViews });
  const { result } = await session.post('Profiler.takePreciseCoverage');

  if (!outcome.ok) throw new Error(`Auflösung für ${category} gescheitert: ${outcome.diagnostic.code}`);
  return { workUnits: outcome.output.budgetUsage.workUnits, ranges: executedRanges(result) };
}

async function loadDomain() {
  registerAliasHook();
  registerHooks({ resolve: resolveSchemaJson });
  const source = (path) => pathToFileURL(resolve(REPO_ROOT, path)).href;
  const [fixtures, importGraph, engine, profileDocument] = await Promise.all([
    import(source('scripts/profileResolutionWorstCaseFixtures.mjs')),
    import(source('src/domain/profileResolutionImportGraph.ts')),
    import(source('src/domain/profileResolutionEngine.ts')),
    import(source('src/adapters/oscalProfileDocument.ts')),
  ]);
  return {
    categories: fixtures.WORK_UNIT_CATEGORIES,
    buildWorkUnitCalibration: fixtures.buildWorkUnitCalibration,
    maxRepetitions: fixtures.maxRepetitions,
    buildProfileResolutionPlan: importGraph.buildProfileResolutionPlan,
    resolveProfile: engine.resolveProfile,
    parseProfileDocument: profileDocument.parseProfileDocument,
  };
}

/** Startet die Zählung auf Blockebene; ohne `detailed` gäbe V8 nur Aufrufzahlen. */
export async function startBlockCounting(session) {
  await session.post('Profiler.enable');
  await session.post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
}

async function main() {
  const domain = await loadDomain();
  const session = new Session();
  session.connect();
  try {
    await startBlockCounting(session);
    const categories = [];
    for (const category of domain.categories) {
      categories.push({
        category,
        n: await countedRun(session, domain, category, BASE_REPETITIONS),
        twoN: await countedRun(session, domain, category, 2 * BASE_REPETITIONS),
      });
    }
    process.stdout.write(JSON.stringify({
      repetitions: { n: BASE_REPETITIONS, twoN: 2 * BASE_REPETITIONS },
      categories,
    }));
  } finally {
    session.disconnect();
  }
}

// Nur als Skript zählen; beim Import aus dem Test bleibt das Modul still.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
