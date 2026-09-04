// =============================================================================
// Seitenseitiger Messharnisch der Klasse-2-Kostenmessung (GSPP-382).
//
// Wartungswerkzeug, kein Anwendungspfad: Die Datei wird ausschließlich von
// `scripts/measure-class2-budget.mjs` über einen eigenen, temporären
// Vite-Dev-Server geladen und ist an keinem Einstieg der App verlinkt.
//
// Der Harnisch ruft die PRODUKTIVEN Einheiten der Prüfkette auf — keine
// nachgebaute Kopie, auch nicht für die Glob-Übersetzung. Er ist in Schritte
// zerlegt, weil die Heap-Messung zwischen den Schritten über CDP aus dem
// Node-Prozess erfolgt und das Zwischenergebnis dafür referenziert bleiben
// muss.
// =============================================================================

import { parseClass2OscalInput } from '@/domain/oscalImportProcessing';
import { processClass2OscalValue } from '@/domain/oscalObjectPipeline';
import { globToRegExp } from '@/domain/profileResolutionSelection';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { walkOwnContainers } from '@/domain/oscalObjectWalk';
import {
  CLASS_2_WORST_CASE_FIXTURES,
  buildGlobPatternWorstCase,
  toBytes,
} from '../class2WorstCaseFixtures.mjs';

const CONTEXT = { trustClass: 'class-2-local-user' };

/** Hält das Zwischenergebnis eines Laufs, damit der Heap es nicht einsammelt. */
let held = null;

function nowMs() {
  return performance.now();
}

async function timed(run) {
  const start = nowMs();
  const value = await run();
  return { value, ms: nowMs() - start };
}

const harness = {
  /** Fixture-Bytes erzeugen und für die folgenden Schritte festhalten. */
  async prepare(fixtureId) {
    const fixture = CLASS_2_WORST_CASE_FIXTURES.find((entry) => entry.id === fixtureId);
    if (fixture === undefined) throw new Error(`Unbekanntes Fixture: ${fixtureId}`);

    const build = await timed(() => fixture.build());
    const bytes = toBytes(build.value);
    held = { bytes, parsed: null, processed: null, identitySet: null };
    return {
      id: fixture.id,
      limit: fixture.limit,
      label: fixture.label,
      reachesSchemaStage: fixture.reachesSchemaStage,
      bytes: bytes.byteLength,
      buildMs: build.ms,
    };
  },

  /** Stufe 1: Bytelimit, fatale UTF-8-Dekodierung, Scanner, `JSON.parse`, Registrierung. */
  async stage1() {
    const run = await timed(() => parseClass2OscalInput(held.bytes));
    held.parsed = run.value;
    return {
      ms: run.ms,
      ok: run.value.ok,
      code: run.value.ok ? null : run.value.diagnostic.code,
    };
  },

  /** Objektorientierte Kette: Herkunft, Budget, Strukturinvariante, Dispatch, Schemastufe. */
  async objectChain() {
    if (!held.parsed?.ok) return { ms: 0, ok: false, code: 'STUFE_1_ABGEWIESEN' };
    const run = await timed(() => processClass2OscalValue(held.parsed.source, CONTEXT));
    held.processed = run.value;
    return {
      ms: run.ms,
      ok: run.value.ok,
      code: run.value.ok ? null : run.value.diagnostic.code,
    };
  },

  /**
   * Der transiente Anteil der Speicherspitze, den eine Messung NACH dem Lauf
   * nicht mehr sehen kann.
   *
   * `enforceClass2ObjectGraphInvariants` hält während seines Durchlaufs eine
   * `Set`-Identitätsmenge über jeden besuchten Container. Sobald die Funktion
   * zurückkehrt, ist diese Menge unerreichbar und die erzwungene Sammlung vor
   * der Heap-Messung räumt sie ab — die eigentliche Spitze bliebe unsichtbar
   * (Greptile-Befund zu 6643714).
   *
   * Dieser Schritt baut deshalb dieselbe Menge über denselben Containerbestand
   * noch einmal auf und hält sie fest, damit der Node-Prozess sie messen kann.
   * Er misst kein Modell, sondern exakt die Datenstruktur, die die Invariante
   * anlegt: gleicher Typ, gleiche Elemente, gleiche Anzahl.
   */
  identitySetCost() {
    if (!held.parsed?.ok) return { containers: 0 };
    const containers = new Set();
    walkOwnContainers(held.parsed.source, (container) => {
      containers.add(container);
      return true;
    });
    held.identitySet = containers;
    return { containers: containers.size };
  },

  /** Produktiver Einstieg mit Worker: die Zeit, die den 30-s-Timeout verbraucht. */
  async endToEnd() {
    const run = await timed(() => importClass2OscalDocument(held.bytes, CONTEXT));
    return {
      ms: run.ms,
      ok: run.value.ok,
      code: run.value.ok ? null : run.value.diagnostic.code,
    };
  },

  /** Referenzen freigeben, damit die anschließende Heap-Basislinie wieder greift. */
  release() {
    held = null;
    return true;
  },

  /**
   * Glob-Worst-Case gegen die produktive Übersetzung aus
   * `src/domain/profileResolutionSelection.ts`. Der Ausdruck wird dort gebaut,
   * nicht hier nachgebildet.
   */
  glob(stars, subjectLength) {
    const { pattern, subject } = buildGlobPatternWorstCase(stars, subjectLength);
    const regexp = globToRegExp(pattern);
    const start = nowMs();
    const matched = regexp.test(subject);
    return { ms: nowMs() - start, patternBytes: pattern.length, subjectLength, matched };
  },

  /** Umgebungsangaben für das Messprotokoll. */
  environment() {
    return {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory ?? null,
    };
  },
};

globalThis.__gspp382 = harness;
