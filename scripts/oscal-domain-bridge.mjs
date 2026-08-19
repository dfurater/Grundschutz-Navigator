// =============================================================================
// Node-Brücke in die OSCAL-Domänenschicht (GSPP-251)
//
// Die CI-Lane ist ein reines Node-Skript, der Referenzgraph und sein
// Klassifikator liegen in TypeScript unter `src/domain/`. Node 22 entfernt
// Typannotationen selbst; was fehlt, ist ausschließlich die Auflösung des
// Projektalias `@/` — genau dieselbe Abbildung, die `vite.config.ts` und
// `tsconfig.app.json` vornehmen.
//
// Die Brücke existiert, damit die CI-Prüfung **denselben** Klassifikator
// ausführt wie App und Tests. Eine zweite, für Node nachgebaute Implementierung
// wäre die Fehlerquelle, die dieser Validator gerade ausschließen soll.
//
// Der Hook ist absichtlich eng: Er greift nur für Spezifizierer, die mit `@/`
// beginnen, bildet sie auf `src/` ab und lädt keine Datei außerhalb davon.
// =============================================================================

import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SOURCE_ROOT = pathToFileURL(
  `${path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')}/`,
).href;

/**
 * Die Erweiterungen, die ein erweiterungsloser Spezifizierer annehmen darf —
 * dieselbe Reihenfolge, die der Bundler verwendet. Node löst
 * erweiterungslose Importe nicht selbst auf; im Quellbaum kommen sie vor.
 */
const SOURCE_EXTENSIONS = Object.freeze(['.ts', '.mts', '.mjs']);

let hooksRegistered = false;

function mapAlias(specifier) {
  if (!specifier.startsWith('@/')) return specifier;

  const target = new URL(specifier.slice(2), SOURCE_ROOT).href;
  if (!target.startsWith(SOURCE_ROOT)) {
    throw new Error('Aliasauflösung zeigt aus dem Quellbaum heraus');
  }
  return target;
}

function registerAliasHook() {
  if (hooksRegistered) return;
  hooksRegistered = true;

  registerHooks({
    resolve(specifier, context, nextResolve) {
      const mapped = mapAlias(specifier);
      try {
        return nextResolve(mapped, context);
      } catch (error) {
        // Nur der erweiterungslose Fall wird nachgereicht. Jeder andere
        // Auflösungsfehler bleibt unverändert stehen.
        if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
        for (const extension of SOURCE_EXTENSIONS) {
          try {
            return nextResolve(`${mapped}${extension}`, context);
          } catch {
            // nächste Erweiterung
          }
        }
        throw error;
      }
    },
  });
}

/**
 * Lädt die für den Referenzgraphlauf benötigten Domänenmodule.
 *
 * Der Aufruf ist idempotent und führt keinen Netzwerk- oder Schreibzugriff aus.
 */
export async function loadOscalDomain() {
  registerAliasHook();

  const [adapters, graph, policy] = await Promise.all([
    import(new URL('adapters/oscalRootAdapters.ts', SOURCE_ROOT).href),
    import(new URL('domain/referenceGraph.ts', SOURCE_ROOT).href),
    import(new URL('domain/referenceGraphPolicy.ts', SOURCE_ROOT).href),
  ]);

  return Object.freeze({
    parseOscalDocument: adapters.parseOscalDocument,
    buildReferenceGraph: graph.buildReferenceGraph,
    evaluateReferenceGraph: policy.evaluateReferenceGraph,
    formatReferenceGraphSummary: policy.formatReferenceGraphSummary,
    toReferenceGraphReport: policy.toReferenceGraphReport,
  });
}
