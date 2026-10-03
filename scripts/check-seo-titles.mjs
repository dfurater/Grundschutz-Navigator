/*
 * Titelvertrag der gebauten HTML-Auslieferung (GSPP-468).
 *
 * Der U+2014-Regressionstest in `scripts/seoRouteEntries.test.ts` liest die
 * Quellvorlage `index.html`, die ausgelieferten Routenseiten entstehen im
 * Build aber aus `dist/index.html`. Ändert oder dupliziert der Vite-Build
 * einen Titel- oder Meta-Tag, sähe der Test das nicht.
 *
 * Diese Prüfung hebt den Vertrag auf das gebaute Ausgabeverzeichnis: Sie
 * liest jede ausgelieferte HTML-Datei aus `dist/` und verlangt in `<title>`,
 * `og:title`, Meta-Description und `og:image:alt` genau einen Treffer ohne
 * Gedankenstrich (U+2014). Fehlendes Ausgabeverzeichnis, null HTML-Dateien
 * sowie fehlende oder doppelte Felder brechen fail-closed ab, statt still zu
 * bestehen — eine nicht prüfbare Auslieferung ist keine geprüfte.
 *
 * Welche Felder es gibt und welchen Text sie tragen, entscheidet der
 * HTML-Parser von jsdom mit denselben Selektoren wie der DOM-Regressionstest
 * des Generators, nicht eine eigene Lesart des Standards: Kommentare,
 * Attributgrenzen in gequoteten Werten, maskierte Selektorwerte und jede
 * maskierte Form des Gedankenstrichs folgen damit dem Tokenizer.
 *
 * Das Modul läuft ohne Vite und ohne `@/`-Alias: `vite.config.ts` ruft die
 * Prüfung im Build auf (`spaFallbackPlugin().closeBundle()`, vor dem
 * Manifest als letztem Schreibschritt), die CLI prüft ein fertiges
 * Ausgabeverzeichnis von Hand.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EM_DASH = '\u2014';

export class SeoTitleCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeoTitleCheckError';
  }
}

/*
 * Geprüfte Titel- und Meta-Felder je ausgelieferter HTML-Datei: Feldname,
 * Selektor und Bezeichnung in Fehlermeldungen.
 */
const FIELDS = [
  { field: 'title', selector: 'title', label: '<title>' },
  { field: 'ogTitle', selector: 'meta[property="og:title"]' },
  { field: 'description', selector: 'meta[name="description"]' },
  { field: 'ogImageAlt', selector: 'meta[property="og:image:alt"]' },
];

/*
 * jsdom wird erst beim Prüfen geladen: `vite.config.ts` importiert dieses
 * Modul auch für Dev-Server und Vitest, die den Parser nie brauchen. Ein
 * Fenster dient allen Dateien eines Laufs; `DOMParser` führt keine Skripte
 * aus und lädt keine Ressourcen.
 */
function withHtmlParser(callback) {
  const { JSDOM } = createRequire(import.meta.url)('jsdom');
  const { window } = new JSDOM('');
  try {
    const parser = new window.DOMParser();
    return callback((html) => parser.parseFromString(html, 'text/html'));
  } finally {
    window.close();
  }
}

/*
 * Liest ein Feld, ohne abzubrechen: `{ value }` mit dem Text oder `{ error }`
 * mit dem Strukturfehler. So kann die Auslieferungsprüfung jedes Feld einer
 * Datei unabhängig von den anderen bewerten.
 */
function inspectField(document, { selector, label = selector }) {
  const elements = document.querySelectorAll(selector);
  if (elements.length !== 1) {
    return { error: `Genau ein ${label} erwartet, gefunden: ${elements.length}` };
  }
  const [element] = elements;
  if (element.localName === 'title') return { value: element.textContent };
  const content = element.getAttribute('content');
  if (content === null) return { error: `${label} ohne content-Attribut` };
  return { value: content };
}

function readSeoTitleFields(document) {
  return Object.fromEntries(FIELDS.map((definition) => {
    const { value, error } = inspectField(document, definition);
    if (error !== undefined) throw new SeoTitleCheckError(error);
    return [definition.field, value];
  }));
}

/**
 * Die vier Titel- und Meta-Texte so, wie der HTML-Parser sie liest —
 * decodiert, ohne Kommentare und mit denselben Selektoren wie der
 * DOM-Regressionstest des Generators.
 */
export function extractSeoTitleFields(html) {
  return withHtmlParser((parse) => readSeoTitleFields(parse(html)));
}

/** Alle ausgelieferten HTML-Dateien unter `distDir`, relativ und sortiert. */
export function collectBuiltHtmlFiles(distDir) {
  const root = resolve(distDir);
  let stat;
  try {
    stat = statSync(root);
  } catch {
    throw new SeoTitleCheckError(`Ausgabeverzeichnis fehlt: ${root}`);
  }
  if (!stat.isDirectory()) {
    throw new SeoTitleCheckError(`Ausgabeverzeichnis ist kein Verzeichnis: ${root}`);
  }
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      // Packregel des gepinnten `actions/upload-pages-artifact`: Namen mit
      // führendem Punkt fallen samt Unterbaum aus der Auslieferung heraus.
      if (entry.name.startsWith('.')) continue;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        files.push(relative(root, full));
      }
    }
  };
  walk(root);
  if (files.length === 0) {
    throw new SeoTitleCheckError(`Keine HTML-Dateien unter ${root}`);
  }
  return files.sort(compareCodeUnit);
}

// Standard-Stringsortierung: UTF-16-Codeunits, unabhängig von der Locale —
// ohne Vergleichsfunktion sortierte `sort()` die Pfade alphabetisch statt
// nach Codepoints.
function compareCodeUnit(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Prüft jede gebaute HTML-Datei gegen den Titelvertrag und meldet jede
 * Verletzung als `Pfad: Feld` — Gedankenstriche wie Strukturfehler gemeinsam
 * und jedes Feld unabhängig von den anderen, damit ein Lauf alle Verstöße
 * aller Routenseiten zeigt statt nur den ersten. Gibt Datei- und Feldzahl für
 * die Build-Zusammenfassung zurück.
 */
export function checkBuiltSeoTitles(distDir) {
  const root = resolve(distDir);
  const files = collectBuiltHtmlFiles(root);
  const violations = withHtmlParser((parse) => files.flatMap((file) => {
    let html;
    try {
      html = readFileSync(join(root, file), 'utf8');
    } catch (error) {
      return [`${file}: ${error instanceof Error ? error.message : error}`];
    }
    const document = parse(html);
    return FIELDS.flatMap((definition) => {
      const { value, error } = inspectField(document, definition);
      if (error !== undefined) return [`${file}: ${error}`];
      return value.includes(EM_DASH) ? [`${file}: ${definition.field} enthält U+2014`] : [];
    });
  }));
  if (violations.length > 0) {
    throw new SeoTitleCheckError(`Titelvertragsverletzungen in der Auslieferung:\n${violations.join('\n')}`);
  }
  return { fileCount: files.length, fieldCount: files.length * FIELDS.length };
}

export function parseCheckArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--dist' || argv[1] === '') {
    throw new SeoTitleCheckError('Aufruf: check:seo-titles -- --dist <verzeichnis>');
  }
  return { distDir: argv[1] };
}

export function main(argv = process.argv.slice(2)) {
  const { distDir } = parseCheckArgs(argv);
  const { fileCount, fieldCount } = checkBuiltSeoTitles(distDir);
  console.log(
    `Titelvertrag der Auslieferung: ${fileCount} HTML-Dateien, ${fieldCount} Titel- und Meta-Texte ohne U+2014.`,
  );
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
