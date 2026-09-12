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
import { isBuiltin } from 'node:module';

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
]);

/**
 * Die AUSWERTUNG (`measureClass2BudgetReport.mjs`) steht bewusst nicht in der
 * Hülle. Sie läuft im Browser nie mit und erzeugt keine Rohdaten; sie leitet
 * aus ihnen den Wert ab. Und sie ist bereits schärfer gebunden als durch einen
 * Fingerprint: Der Bindungstest leitet den Grenzwert bei JEDEM Testlauf mit der
 * aktuellen Auswertung aus dem Artefakt neu her. Eine Änderung an ihr wird also
 * sofort geprüft — ohne einen Browsermesslauf zu erzwingen, der an denselben
 * Rohdaten nichts ändern würde.
 */

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
 * Alle Importspezifizierer einer Datei.
 *
 * Bewusst eine Textsuche und kein Parser: Sie darf keine Datei ÜBERSEHEN,
 * Mehrtreffer sind unschädlich. Die Muster setzen direkt am Schlüsselwort an
 * und tragen kein `[\s\S]*?` — eine Suche, die den ganzen Dateikopf
 * überspringen darf, backtrackt superlinear. Ausgerechnet hier wäre das
 * unpassend: Dieser Slice hat dieselbe Bauart aus dem Glob-Pfad entfernt.
 * Die `from`-Form deckt mehrzeilige Importlisten mit ab, weil sie am `from`
 * ansetzt und nicht am `import`.
 */
const IMPORT_PATTERNS = Object.freeze([
  /\bfrom\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]/g,
]);

function importSpecifiers(source) {
  const found = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

/**
 * Sortierung über UTF-16-Code-Units, ausdrücklich nicht `localeCompare`:
 * Der Fingerprint hängt an der Reihenfolge, und eine locale-abhängige
 * Sortierung machte ihn von der Umgebung des Messrechners abhängig.
 */
function byCodeUnit(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
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
 * Die transitive Hülle der Einstiegspunkte: jede Datei und jedes Paket, die der
 * gemessene Auflösungslauf ausführt. Sortiert, damit der Fingerprint nicht an
 * der Besuchsreihenfolge hängt.
 */
export function collectWorkLimitSources(entryPoints = WORK_LIMIT_ENTRY_POINTS) {
  const seen = new Set();
  const packages = new Set();
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
      if (target !== null) {
        if (!seen.has(target)) queue.push(target);
      } else if (isExternalSpecifier(specifier)) {
        packages.add(packageNameOf(specifier));
      }
    }
  }
  return {
    paths: [...seen].filter((path) => !PROVENANCE_EXCLUDED_PATHS.includes(path)).sort(byCodeUnit),
    packages: [...packages].sort(byCodeUnit),
  };
}

/** Ein Spezifizierer, der aus `node_modules` kommt — kein Pfad, kein Builtin. */
function isExternalSpecifier(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('@/') || specifier.startsWith('/')) return false;
  if (isBuiltin(specifier)) return false;
  // Ein Treffer aus Fließtext oder einem Beispiel ist kein Paket. Paketnamen
  // sind eng definiert; alles andere fliegt hier fail-closed heraus, statt als
  // fehlender Lockfile-Eintrag den ganzen Lauf abzubrechen.
  return /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.-]+)*$/.test(specifier);
}

/** `ajv/dist/2020` → `ajv`, `@scope/paket/unterpfad` → `@scope/paket`. */
function packageNameOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Die aufgelösten Versionen der externen Pakete des Messwegs, transitiv über
 * das Lockfile.
 *
 * Dateien allein decken den gemessenen Lauf nicht ab: Er führt vor dem Ergebnis
 * die Schemaprüfung mit Ajv aus. Würde Ajv langsamer, bliebe ein Fingerprint
 * über reine Repository-Dateien unverändert und ein altes Arbeitslimit weiter
 * als belegt stehen (Greptile-Befund zu 88a568e).
 *
 * Fail-closed: Ein Paket ohne Lockfile-Eintrag bricht ab, statt still aus dem
 * Fingerprint zu fallen.
 */
function resolvePackageVersions(names) {
  const lock = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package-lock.json'), 'utf8'));
  const entries = lock.packages ?? {};
  const versions = new Map();
  const queue = [...names];
  while (queue.length > 0) {
    const name = queue.pop();
    if (versions.has(name)) continue;
    const entry = entries[`node_modules/${name}`];
    if (entry === undefined || typeof entry.version !== 'string') {
      throw new Error(`Laufzeitpaket des Messwegs fehlt im Lockfile: ${name}`);
    }
    versions.set(name, entry.version);
    for (const dependency of Object.keys(entry.dependencies ?? {})) {
      if (!versions.has(dependency)) queue.push(dependency);
    }
  }
  return [...versions.entries()]
    .map(([name, version]) => `${name}@${version}`)
    .sort(byCodeUnit);
}

/**
 * Fingerprint des Messwegs. Gleiche Zahl bedeutet: Der Code UND die Laufzeit,
 * an denen die Arbeitsgrenze gemessen wurde, sind unverändert — die Messung
 * gilt noch.
 */
export function workLimitProvenance() {
  const { paths, packages } = collectWorkLimitSources();
  const runtime = resolvePackageVersions(packages);
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(path).update('\0').update(readFileSync(resolve(REPO_ROOT, path))).update('\0');
  }
  for (const entry of runtime) hash.update(entry).update('\0');
  return { sha256: hash.digest('hex'), files: paths.length, paths, runtime };
}
