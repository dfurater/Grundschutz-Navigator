/*
 * Titelvertrag der gebauten HTML-Auslieferung (GSPP-468).
 *
 * Ein Greptile-P2-Befund auf dem Release-PR #350 stellte fest, dass der
 * U+2014-Regressionstest in `scripts/seoRouteEntries.test.ts` die
 * Quellvorlage `index.html` liest, während die ausgelieferten Routenseiten im
 * Build aus `dist/index.html` entstehen. Ändert oder dupliziert der
 * Vite-Build einen Titel- oder Meta-Tag, bliebe der Test grün, obwohl die
 * ausgelieferten Seiten vom Titelvertrag abweichen.
 *
 * Diese Prüfung hebt den Vertrag auf das gebaute Ausgabeverzeichnis: Sie
 * liest jede ausgelieferte HTML-Datei aus `dist/` und verlangt in `<title>`,
 * `og:title`, Meta-Description und `og:image:alt` genau einen Treffer ohne
 * Gedankenstrich (U+2014). Fehlendes Ausgabeverzeichnis, null HTML-Dateien
 * sowie fehlende oder doppelte Felder brechen fail-closed ab, statt still zu
 * bestehen — eine nicht prüfbare Auslieferung ist keine geprüfte.
 * Maskierte Gedankenstriche (`&mdash;`, `&#8212;`, `&#x2014;`, numerisch auch
 * ohne Semikolon, soweit HTML sie darstellt) zählen mit, weil der Browser sie
 * als U+2014 rendert. Decodiert wird in genau einem Durchgang, sodass doppelt
 * maskierte Folgen (`&amp;#8212;`) wörtlich bleiben wie im Browser.
 *
 * Das Modul läuft ohne Vite und ohne `@/`-Alias: `vite.config.ts` ruft die
 * Prüfung im Build auf (`spaFallbackPlugin().closeBundle()`, vor dem
 * Manifest als letztem Schreibschritt), die CLI prüft ein fertiges
 * Ausgabeverzeichnis von Hand.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EM_DASH = '\u2014';

export class SeoTitleCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SeoTitleCheckError';
  }
}

const TITLE_PATTERN = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi;
const META_TAG_PATTERN = /<meta\b[^>]*>/gi;
/** Geprüfte Titel- und Meta-Felder je ausgelieferter HTML-Datei. */
const FIELD_COUNT = 4;

/*
 * Attribute sind im Tag leerzeichengetrennt; der Name muss vollständig
 * dastehen. `data-content` liest sich dadurch nie als `content` — `\b` allein
 * träfe auch nach `-`, und der echte OG-Titel mit U+2014 bliebe ungeprüft.
 */
const ATTRIBUTE_PATTERN = /\s([\w-]+)\s*=\s*("[^"]*"|'[^']*')/gi;

/*
 * Ein Durchgang über entitätsartige Folgen; die Entscheidung fällt im
 * Callback statt in verzweigten Mustern. Benannte Referenzen gelten exakt wie
 * im Standard: `mdash` nur klein — `&MDASH;` zeigt der Browser wörtlich —,
 * die vier Legacy-Namen zusätzlich groß. Ohne Semikolon decodiert nur die
 * Legacy-Liste und nur vor einem Folger, der kein Buchstabe, keine Ziffer und
 * kein `=` ist; numerisch zählt ohne Semikolon allein der Gedankenstrich vor
 * solch einem Folger. Alles andere bleibt wörtlich. Doppelt Maskiertes
 * (`&#38;mdash;`, `&amp;#8212;`) trifft nie eine zweite Stufe, weil es keine
 * gibt: Der Aufruf durchsucht sein Ergebnis nicht erneut.
 */
const ENTITY_LIKE_PATTERN = /&((?:#[xX][\da-fA-F]+|#\d+|[A-Za-z]+);?)/g;

/* Exakt die im Standard definierten Schreibweisen, ohne Faltung. */
const NAMED_ENTITIES = {
  amp: '&', AMP: '&', lt: '<', LT: '<', gt: '>', GT: '>',
  quot: '"', QUOT: '"', apos: "'", mdash: EM_DASH,
};
const LEGACY_UNTERMINATED = new Set(['amp', 'AMP', 'lt', 'LT', 'gt', 'GT', 'quot', 'QUOT']);
const EM_DASH_CODE_POINT = 0x2014;

function continuesReference(value, end) {
  const next = value[end];
  return next !== undefined && /[\dA-Za-z=]/.test(next);
}

function fromCodePoint(text, code) {
  if (!Number.isSafeInteger(code) || code < 0 || code > 0x10ffff) return text;
  try {
    return String.fromCodePoint(code);
  } catch {
    return text;
  }
}

/**
 * Decodiert jede Referenz genau einmal an ihrer Fundstelle. Für den
 * Titelvertrag zählt allein U+2014; jede andere Referenz ist entweder exakt
 * decodiert oder bleibt wörtlich — beides ohne Einfluss auf das Urteil.
 */
export function decodeHtmlEntities(value) {
  return value.replace(ENTITY_LIKE_PATTERN, (text, reference, offset) => {
    const terminated = reference.endsWith(';');
    const core = terminated ? reference.slice(0, -1) : reference;
    if (core[0] === '#') {
      const hex = core[1] === 'x' || core[1] === 'X';
      const code = Number.parseInt(hex ? core.slice(2) : core.slice(1), hex ? 16 : 10);
      if (code === EM_DASH_CODE_POINT) {
        if (terminated || !continuesReference(value, offset + text.length)) return EM_DASH;
        return text;
      }
      if (!terminated) return text;
      return fromCodePoint(text, code);
    }
    if (!terminated && (!LEGACY_UNTERMINATED.has(core) || continuesReference(value, offset + text.length))) {
      return text;
    }
    return NAMED_ENTITIES[core] ?? text;
  });
}

function attributeValue(tag, attribute) {
  const wanted = attribute.toLowerCase();
  for (const match of tag.matchAll(ATTRIBUTE_PATTERN)) {
    if (match[1].toLowerCase() !== wanted) continue;
    return match[2].slice(1, -1);
  }
  return undefined;
}

function singleContent(tags, key, value, label) {
  const matches = [];
  for (const tag of tags) {
    if (attributeValue(tag, key) !== value) continue;
    matches.push(attributeValue(tag, 'content'));
  }
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new SeoTitleCheckError(`Genau ein ${label} erwartet, gefunden: ${matches.length}`);
  }
  return decodeHtmlEntities(matches[0]);
}

/**
 * Die vier Titel- und Meta-Texte derselben Selektoren, die der
 * DOM-Regressionstest des Generators prüft — hier gegen gebautes HTML
 * statt gegen die Quellvorlage gelesen.
 */
export function extractSeoTitleFields(html) {
  const titles = [...html.matchAll(TITLE_PATTERN)];
  if (titles.length !== 1) {
    throw new SeoTitleCheckError(`Genau ein <title> erwartet, gefunden: ${titles.length}`);
  }
  const tags = [...html.matchAll(META_TAG_PATTERN)].map((match) => match[0]);
  return {
    title: decodeHtmlEntities(titles[0][1]),
    ogTitle: singleContent(tags, 'property', 'og:title', 'meta[property="og:title"]'),
    description: singleContent(tags, 'name', 'description', 'meta[name="description"]'),
    ogImageAlt: singleContent(tags, 'property', 'og:image:alt', 'meta[property="og:image:alt"]'),
  };
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
 * Verletzung als `Pfad: Feld` — Gedankenstriche wie Strukturfehler gemeinsam,
 * damit ein Lauf alle defekten Routenseiten zeigt statt nur die erste. Gibt
 * Datei- und Feldzahl für die Build-Zusammenfassung zurück.
 */
export function checkBuiltSeoTitles(distDir) {
  const root = resolve(distDir);
  const files = collectBuiltHtmlFiles(root);
  const violations = [];
  for (const file of files) {
    let fields;
    try {
      fields = extractSeoTitleFields(readFileSync(join(root, file), 'utf8'));
    } catch (error) {
      violations.push(`${file}: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    for (const [field, value] of Object.entries(fields)) {
      if (value.includes(EM_DASH)) violations.push(`${file}: ${field} enthält U+2014`);
    }
  }
  if (violations.length > 0) {
    throw new SeoTitleCheckError(`Titelvertragsverletzungen in der Auslieferung:\n${violations.join('\n')}`);
  }
  return { fileCount: files.length, fieldCount: files.length * FIELD_COUNT };
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
