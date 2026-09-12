// =============================================================================
// Provenienz der Arbeitsgrenze (GSPP-345).
//
// Der Grenzwert `WORK_UNIT_LIMIT` steht auf einer Messung. Eine Messung gilt
// aber nur für den Code, an dem sie erhoben wurde: Wird der Auflösungspfad
// langsamer, ist der gemessene Wert still falsch, und nichts im Repository
// würde davon etwas merken. Dieses Modul schließt diese Lücke, indem es die
// Dateien fingerprintet, die den gemessenen Lauf WIRKLICH ausmachen.
//
// Warum nicht der breite Quellfingerprint des Messapparats. Der deckt `src`,
// `scripts` und die Build-Konfiguration vollständig ab und belegt damit
// „dieser Baum wurde gemessen". Als Testbedingung taugt er nicht: Jede
// Änderung an einer beliebigen UI-Komponente erzwänge einen Browsermesslauf
// von mehreren Minuten. Er bleibt im Artefakt stehen, wo er hingehört — als
// Protokoll, nicht als Gate.
//
// Warum keine handgeschriebene Dateiliste. Sie wäre eine Behauptung über den
// Messweg und würde bei jedem neuen Modul des Auflösungspfads still zu eng.
// Die Hülle wird deshalb aus den ECHTEN Importen berechnet: ab den
// Einstiegspunkten, die der Messharnisch für den Auflösungslauf benutzt,
// transitiv über alle projektinternen Importe.
// =============================================================================

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Die Einstiegspunkte des gemessenen Laufs — genau das, was
 * `scripts/measure/class2-budget.harness.mjs` für die Arbeitsgrenze aufruft,
 * plus die beiden Messmodule, die Stützpunkte bauen und auswerten.
 *
 * Die übrigen Importe des Harnisches (Transport, Speicher, Fixtures der
 * GSPP-382-Reihen) stehen bewusst NICHT hier: Sie gehören zu anderen
 * Messreihen, laufen im Auflösungspfad nicht mit und würden bei jeder
 * Änderung eine Neumessung der Arbeitsgrenze erzwingen, die nichts belegt.
 */
export const WORK_LIMIT_ENTRY_POINTS = Object.freeze([
  'src/domain/profileResolutionEngine.ts',
  'src/domain/profileResolutionImportGraph.ts',
  'src/domain/profileResolutionSelection.ts',
  'src/domain/profileResolutionBudget.ts',
  'src/adapters/oscalProfileDocument.ts',
  'scripts/profileResolutionWorstCaseFixtures.mjs',
  'scripts/measureClass2BudgetReport.mjs',
]);

/**
 * Die EINE Datei, die zwischen Messstand und Lieferstand verschieden sein
 * MUSS und deshalb in keinen der beiden Fingerprints gehört.
 *
 * Ein Lauf misst nur bis zu seinem eigenen Kandidaten — jenseits davon bricht
 * der Resolver ab, und ein Abbruch liefert keine Wartezeit. Die Herleitung
 * braucht deshalb einen Kandidaten ÜBER dem Ergebnis, und der Lieferstand
 * trägt danach das Ergebnis. Läge diese Datei im Fingerprint, könnte kein
 * Artefakt je zum gelieferten Stand passen, und die Frage „gehört das
 * Artefakt zu diesem Head?" wäre gar nicht erst stellbar.
 *
 * Verschwiegen wird dabei nichts: Der Kandidat jedes Laufs steht als
 * `workUnitLimit` im Artefakt, und `assertWorkLimitRun` verlangt, dass er echt
 * über dem hergeleiteten Wert liegt. Der Wert selbst ist über das hergeleitete
 * Minimum an das Artefakt gebunden.
 */
export const PROVENANCE_EXCLUDED_PATHS = Object.freeze([
  'src/domain/profileResolutionBudgetLimits.mjs',
]);

/** Reihenfolge, in der ein extensionsloser Import aufgelöst wird. */
const RESOLUTION_SUFFIXES = Object.freeze(['', '.ts', '.mjs', '.mts', '.tsx', '.js', '/index.ts', '/index.mjs']);

/**
 * Alle projektinternen Importspezifizierer einer Datei.
 *
 * Bewusst eine Textsuche und kein Parser: Sie darf keine Datei ÜBERSEHEN,
 * Mehrtreffer sind unschädlich. Erfasst werden statische `import`/`export
 * from`-Formen und dynamische `import(...)`-Aufrufe mit festem Literal.
 */
function importSpecifiers(source) {
  const found = new Set();
  const patterns = [
    /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

/** Löst einen Spezifizierer zu einem repo-relativen Pfad auf, oder zu `null`. */
function resolveSpecifier(specifier, fromPath) {
  let base;
  if (specifier.startsWith('@/')) base = resolve(REPO_ROOT, 'src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(REPO_ROOT, dirname(fromPath), specifier);
  // Alles andere ist eine externe Abhängigkeit. Sie gehört nicht in diesen
  // Fingerprint: Ihre Version steht im Lockfile, und der breite
  // Quellfingerprint des Artefakts deckt sie ab.
  else return null;

  for (const suffix of RESOLUTION_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return relative(REPO_ROOT, candidate);
    }
  }
  // Ein `.js`-Spezifizierer, der auf eine `.ts`-Quelle zeigt (TypeScript-NodeNext).
  if (base.endsWith('.js')) return resolveSpecifier(`${specifier.slice(0, -3)}`, fromPath);
  return null;
}

/**
 * Die transitive Hülle der Einstiegspunkte: jede projektinterne Datei, die der
 * gemessene Auflösungslauf ausführt. Sortiert, damit der Fingerprint nicht an
 * der Besuchsreihenfolge hängt.
 */
export function collectWorkLimitSources(entryPoints = WORK_LIMIT_ENTRY_POINTS) {
  const seen = new Set();
  const queue = [...entryPoints];
  while (queue.length > 0) {
    const path = queue.pop();
    if (seen.has(path)) continue;
    const absolute = resolve(REPO_ROOT, path);
    if (!existsSync(absolute)) {
      throw new Error(`Einstiegspunkt des Messwegs fehlt: ${path}`);
    }
    seen.add(path);
    const source = readFileSync(absolute, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      const target = resolveSpecifier(specifier, path);
      if (target !== null && !seen.has(target)) queue.push(target);
    }
  }
  return [...seen].filter((path) => !PROVENANCE_EXCLUDED_PATHS.includes(path)).sort();
}

/**
 * Fingerprint des Messwegs. Gleiche Zahl bedeutet: Der Code, an dem die
 * Arbeitsgrenze gemessen wurde, ist unverändert — die Messung gilt noch.
 */
export function workLimitProvenance() {
  const paths = collectWorkLimitSources();
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(path).update('\0').update(readFileSync(resolve(REPO_ROOT, path))).update('\0');
  }
  return { sha256: hash.digest('hex'), files: paths.length, paths };
}
