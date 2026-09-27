// =============================================================================
// Provenienz der Arbeitsgrenze (GSPP-345, Hülle seit GSPP-445).
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
// Warum die Hülle aus der Aufrufzählung kommt. `WORK_UNIT_LIMIT` ist eine
// Aussage über die Zeit PRO ARBEITSEINHEIT: Der Messlauf treibt je Kategorie
// die Arbeitseinheiten über eine Leiter von Stützpunkten. Maßgeblich ist also
// der Code, dessen Ausführung mit den Arbeitseinheiten wächst — nicht alles,
// was vom Auflösungspfad aus importierbar ist. Die frühere statische
// Importhülle erfasste auch die Vorbereitung vor dem Timer und die
// Abschlusskette, die je Profil genau einmal läuft; eine O(1)-Änderung dort
// verlangte einen Browsermesslauf, der an den Kosten pro Arbeitseinheit
// nichts belegen konnte.
//
// Warum keine handgeschriebene Dateiliste. Sie wäre eine Behauptung über den
// Messweg und würde bei jedem neuen Modul des Auflösungspfads still zu eng.
// Die Hülle wird deshalb bei jeder Berechnung am echten Lauf gezählt
// (`measureWorkLimitCallCounts.mjs`), und ein Selbstnachweis verlangt, dass
// die Zählung sieht, was sie sehen muss.
//
// Warum die Worst-Case-Fixture zusätzlich gebunden ist. Die Zählung sieht nur,
// was während `resolveProfile` läuft; die Eingaben entstehen davor. Ändert
// sich die Fixture — mehr Controls im Quellkatalog, eine andere Musterform —,
// misst derselbe Code etwas anderes, und die alten Zeitreihen belegten den
// Grenzwert für Eingaben, die es nicht mehr gibt.
// =============================================================================

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WORK_UNIT_CATEGORIES,
  buildWorkUnitCalibration,
  maxRepetitions,
} from './profileResolutionWorstCaseFixtures.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CALL_COUNT_COLLECTOR = resolve(REPO_ROOT, 'scripts', 'measureWorkLimitCallCounts.mjs');

/**
 * Kennung des Verfahrens, nach dem der Fingerprint gebildet ist — Hülle aus der
 * Aufrufzählung plus gebundene Fixture. Sie steht im Messartefakt neben dem
 * Hash: Ein Hash nach der früheren Importhülle ist mit einem Hash nach diesem
 * Verfahren nicht vergleichbar. Die Auswertung
 * verweigert einen Bericht ohne Kennung oder mit wechselnder Kennung, der
 * Bindungstest verlangt die aktuelle.
 */
export const WORK_LIMIT_PROVENANCE_METHOD = 'skalierende-bereiche';

/**
 * Die Funktion, die jede Arbeitseinheit bucht. Zählt die Berechnung sie nicht
 * als skalierend, sieht sie den Auflösungslauf nicht — und jede Hülle, die sie
 * dann liefert, wäre zu klein.
 */
export const SPEND_WORK = Object.freeze({
  path: 'src/domain/profileResolutionBudget.ts',
  functionName: 'spendWork',
});

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

/**
 * Sortierung über UTF-16-Code-Units, ausdrücklich nicht `localeCompare`:
 * Der Fingerprint hängt an der Reihenfolge, und eine locale-abhängige
 * Sortierung machte ihn von der Umgebung des Messrechners abhängig.
 *
 * Exportiert, weil `sourceRevision()` in `measure-class2-budget.mjs` dieselbe
 * Ordnung braucht: Beide Provenance-Fingerprints des Repositoriums stehen auf
 * einer Sortiersemantik aus einer Quelle, mitsamt dieser Begründung.
 */
export function byCodeUnit(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function selfProofFailure(reason) {
  return new Error(`Selbstnachweis der Messwegprovenienz gescheitert: ${reason}`);
}

/** `ajv/dist/2020` → `ajv`, `@scope/paket/unterpfad` → `@scope/paket`. */
function packageNameOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Fail-closed: Jede Kategorie ist gezählt und wächst zwischen N und 2N. */
function assertCountedGrowth(categories) {
  const counted = new Set(categories.map((entry) => entry.category));
  for (const category of WORK_UNIT_CATEGORIES) {
    if (!counted.has(category)) throw selfProofFailure(`Kategorie ${category} wurde nicht gezählt`);
  }
  for (const { category, n, twoN } of categories) {
    // Ausdrücklich auf endliche Zahlen geprüft: Ein fehlender Wert darf nicht
    // als „kein Rückgang“ durchgehen.
    if (!Number.isFinite(n?.workUnits) || !Number.isFinite(twoN?.workUnits) || twoN.workUnits <= n.workUnits) {
      throw selfProofFailure(
        `Kategorie ${category} verbraucht bei 2N nicht mehr Arbeitseinheiten als bei N `
        + `(${n?.workUnits} → ${twoN?.workUnits})`,
      );
    }
  }
}

/** Die Bereiche, deren Ausführungszahl bei 2N in mindestens einer Kategorie größer ist als bei N. */
function scalingRanges(categories) {
  const keyOf = (url, name, start, end) => `${url}\0${name}\0${start}\0${end}`;
  const scaling = new Map();
  for (const { n, twoN } of categories) {
    const before = new Map(n.ranges.map(([url, name, start, end, count]) => [keyOf(url, name, start, end), count]));
    for (const [url, name, start, end, count] of twoN.ranges) {
      const key = keyOf(url, name, start, end);
      if (count > (before.get(key) ?? 0)) scaling.set(key, { url, functionName: name });
    }
  }
  return [...scaling.values()];
}

/**
 * Ordnet die URL eines skalierenden Bereichs ein: Nodes eigene Laufzeit
 * (`null`), ein externes Paket oder eine Repository-Datei. Jede andere
 * Herkunft bricht ab.
 */
function locateRange(url, functionName) {
  if (url.startsWith('node:')) return null;
  if (!url.startsWith('file:')) {
    throw new Error(`Skalierender Code ohne Datei im Messweg: ${functionName || '(anonym)'} in ${url || '(ohne URL)'}`);
  }
  const path = relative(REPO_ROOT, fileURLToPath(url));
  if (path.startsWith('..') || isAbsolute(path)) {
    throw new Error(`Skalierender Code außerhalb des Repositoriums: ${url}`);
  }
  const nodeModules = path.lastIndexOf('node_modules/');
  if (nodeModules !== -1) return { packageName: packageNameOf(path.slice(nodeModules + 'node_modules/'.length)) };
  return { path };
}

/**
 * Bestimmt die Hülle aus der Zählung von `measureWorkLimitCallCounts.mjs`.
 *
 * Skalierend ist ein Bereich — eine Funktion oder ein Block darin, etwa ein
 * Schleifenrumpf —, dessen Ausführungszahl bei 2N in mindestens einer
 * Kategorie größer ist als bei N. Die Blockebene erfasst auch eine Funktion,
 * die je Lauf einmal aufgerufen wird, deren Schleife aber je Arbeitseinheit
 * läuft. Die Hülle besteht aus den Dateien mit mindestens einem skalierenden
 * Bereich. Die Dateiebene genügt: Alle Module, die nur konstant oft laufen,
 * fallen ohnehin heraus, und eine feinere Ebene müsste Bereiche über
 * Quelltextänderungen hinweg wiedererkennen.
 *
 * Fail-closed vor jeder Verwendung: Jede Kategorie muss gezählt sein und bei
 * 2N mehr Arbeitseinheiten verbrauchen als bei N, und `spendWork` muss als
 * skalierend erkannt sein. Sonst zählt die Berechnung am gemessenen Lauf
 * vorbei, und eine leere oder zu kleine Hülle bliebe unbemerkt.
 *
 * Skalierender Code aus Nodes eigener Laufzeit (`node:`) geht nicht ein: Die
 * Node-Version gehört zu keinem der beiden Fingerprints. Jede andere Herkunft,
 * die keine Datei im Repository ist, bricht ab.
 */
export function deriveScalingHull(observation) {
  const categories = Array.isArray(observation?.categories) ? observation.categories : [];
  assertCountedGrowth(categories);

  const paths = new Set();
  const packages = new Set();
  let spendWorkScales = false;
  for (const { url, functionName } of scalingRanges(categories)) {
    const location = locateRange(url, functionName);
    if (location?.packageName !== undefined) packages.add(location.packageName);
    if (location?.path === undefined) continue;
    if (location.path === SPEND_WORK.path && functionName === SPEND_WORK.functionName) spendWorkScales = true;
    if (!PROVENANCE_EXCLUDED_PATHS.includes(location.path)) paths.add(location.path);
  }
  if (!spendWorkScales) {
    throw selfProofFailure(`${SPEND_WORK.functionName} aus ${SPEND_WORK.path} ist nicht als skalierend erkannt`);
  }
  return { paths: [...paths].sort(byCodeUnit), packages: [...packages].sort(byCodeUnit) };
}

let typescript;

/**
 * Der Compiler wird erst beim ersten Fingerprint geladen. Er ist groß, und
 * `measure-class2-budget.mjs` importiert dieses Modul auch für Läufe und
 * Tests, die keinen Fingerprint berechnen.
 */
function loadTypeScript() {
  typescript ??= createRequire(import.meta.url)('typescript');
  return typescript;
}

/**
 * Der Quelltext einer Hüllendatei ohne Kommentare, Formatierung und Typen.
 *
 * `ts.transpileModule` druckt die Ausgabe aus dem Syntaxbaum neu: Kommentare,
 * Einrückung, Zeilenumbrüche und Typannotationen fallen heraus, jede Änderung
 * am ausgeführten Code bleibt stehen. Typen dürfen heraus, weil sie zur
 * Laufzeit nicht existieren und die gemessene Dauer nicht beeinflussen — die
 * Begründung, mit der seit GSPP-394 schon reine Typkanten aus der Hülle fielen.
 */
export function normalizeSource(path, source) {
  const ts = loadTypeScript();
  return ts.transpileModule(source, {
    fileName: path,
    reportDiagnostics: false,
    compilerOptions: {
      removeComments: true,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      verbatimModuleSyntax: true,
    },
  }).outputText;
}

/**
 * Die Datei, die die gemessenen Eingaben baut, und die Module, aus denen sie
 * Werte übernimmt.
 *
 * Die importierten Module gehen nicht als Dateien in den Fingerprint:
 * `sourceRegistry.mjs` ändert sich mit jedem neuen BSI-Artefakt und zieht
 * `oscalVersionMatrix.mjs` nach sich, beides ohne Einfluss auf die gemessenen
 * Eingaben. Gebunden ist stattdessen ihre Wirkung auf die Fixture — die
 * gebauten Dokumente (darin die OSCAL-Version aus der Registry) und die
 * Wiederholungsdeckel je Kategorie (aus den Dokumentgrenzen), siehe
 * `fixtureInputs`. Diese Beobachtung ist nur für die hier benannten Importe
 * begründet; ein weiterer Import bricht ab, bis jemand die Bindung für ihn
 * geprüft hat.
 */
export const WORK_LIMIT_FIXTURE = Object.freeze({
  path: 'scripts/profileResolutionWorstCaseFixtures.mjs',
  imports: Object.freeze([
    '../src/domain/class2ImportLimits.mjs',
    '../src/domain/sourceRegistry.mjs',
  ]),
});

/**
 * Was die Fixture aus ihren Importen macht: je Kategorie der
 * Wiederholungsdeckel und die Dokumente eines Kalibrierfalls mit einer
 * Wiederholung. Die übrige Semantik der Fixture steht in ihrem Quelltext und
 * ist über ihn gebunden.
 */
export function fixtureInputs() {
  return WORK_UNIT_CATEGORIES.map((category) => {
    const { documents, edges, topProfileArtifactKey } = buildWorkUnitCalibration(category, 1);
    return { category, maxRepetitions: maxRepetitions(category), documents, edges, topProfileArtifactKey };
  });
}

/**
 * SHA-256 über normalisierten Quelltext und beobachtete Eingaben der Fixture.
 *
 * Fail-closed: Weicht die Importliste der Fixture von `WORK_LIMIT_FIXTURE.imports`
 * ab, bricht die Berechnung ab — ein neuer Import könnte die Eingaben auf einem
 * Weg ändern, den `fixtureInputs` nicht beobachtet.
 */
export function fingerprintFixture(source, inputs) {
  const imports = loadTypeScript().preProcessFile(source, true, true).importedFiles
    .map((entry) => entry.fileName)
    .sort(byCodeUnit);
  const expected = [...WORK_LIMIT_FIXTURE.imports].sort(byCodeUnit);
  if (imports.length !== expected.length || imports.some((entry, index) => entry !== expected[index])) {
    throw selfProofFailure(
      `${WORK_LIMIT_FIXTURE.path} importiert ${imports.join(', ') || 'nichts'} statt ${expected.join(', ')}; `
      + 'die Bindung der Fixture ist für diese Importe nicht geprüft',
    );
  }
  return createHash('sha256')
    .update(WORK_LIMIT_FIXTURE.path).update('\0')
    .update(normalizeSource(WORK_LIMIT_FIXTURE.path, source)).update('\0')
    .update(JSON.stringify(inputs))
    .digest('hex');
}

/**
 * SHA-256 über Pfad und normalisierten Inhalt jeder Hüllendatei, danach über
 * die Laufzeitversionen. Die Pfade werden hier noch einmal sortiert, damit der
 * Hash nie an der Reihenfolge des Aufrufers hängt.
 */
export function fingerprintHull(
  paths,
  runtime,
  readSource = (path) => readFileSync(resolve(REPO_ROOT, path), 'utf8'),
) {
  const hash = createHash('sha256');
  for (const path of [...paths].sort(byCodeUnit)) {
    hash.update(path).update('\0').update(normalizeSource(path, readSource(path))).update('\0');
  }
  for (const entry of runtime) hash.update(entry).update('\0');
  return hash.digest('hex');
}

/**
 * Die aufgelösten Versionen der externen Pakete, in denen skalierender Code
 * liegt, transitiv über das Lockfile.
 *
 * Dateien allein decken einen skalierenden Lauf nicht ab, sobald er
 * Bibliothekscode je Arbeitseinheit ausführt: Würde die Bibliothek langsamer,
 * bliebe ein Fingerprint über reine Repository-Dateien unverändert und ein
 * altes Arbeitslimit weiter als belegt stehen (Greptile-Befund zu 88a568e).
 *
 * Aufgelöst wird nur der gehobene Eintrag `node_modules/<name>`. Eine
 * verschachtelte Installation mit abweichender Version geht mit der gehobenen
 * Version in den Fingerprint ein.
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
 * Startet die Aufrufzählung in einem eigenen Node-Prozess; warum eigener
 * Prozess, steht im Kopf von `measureWorkLimitCallCounts.mjs`.
 * `NODE_V8_COVERAGE` wird nicht vererbt, damit keine prozessweite Abdeckung
 * des Aufrufers im Kindprozess mitläuft.
 */
function collectCallCounts() {
  const env = { ...process.env };
  delete env.NODE_V8_COVERAGE;
  const stdout = execFileSync(process.execPath, [CALL_COUNT_COLLECTOR], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
  return JSON.parse(stdout);
}

/**
 * Der Gesamtfingerprint aus Hülle und Fixture. Beide Teile stehen einzeln im
 * Artefakt, geprüft wird dieser eine Wert.
 */
export function combineProvenance(hullSha256, fixtureSha256) {
  return createHash('sha256').update(hullSha256).update('\0').update(fixtureSha256).digest('hex');
}

/**
 * Fingerprint des Messwegs. Gleiche Zahl bedeutet: Der Code, dessen Ausführung
 * mit den Arbeitseinheiten wächst, und die Eingaben, an denen er gemessen
 * wurde, sind unverändert — die Messung gilt noch.
 */
export function workLimitProvenance() {
  const { paths, packages } = deriveScalingHull(collectCallCounts());
  const runtime = resolvePackageVersions(packages);
  const hull = fingerprintHull(paths, runtime);
  const fixture = fingerprintFixture(
    readFileSync(resolve(REPO_ROOT, WORK_LIMIT_FIXTURE.path), 'utf8'),
    fixtureInputs(),
  );
  return {
    method: WORK_LIMIT_PROVENANCE_METHOD,
    sha256: combineProvenance(hull, fixture),
    files: paths.length,
    paths,
    runtime,
    hullSha256: hull,
    fixture: { path: WORK_LIMIT_FIXTURE.path, sha256: fixture },
  };
}
