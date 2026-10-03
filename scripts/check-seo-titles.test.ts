// @vitest-environment node

import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkBuiltSeoTitles,
  collectBuiltHtmlFiles,
  extractSeoTitleFields,
  main,
  parseCheckArgs,
} from './check-seo-titles.mjs';

const scratchRoots: string[] = [];

afterEach(() => {
  for (const root of scratchRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratchTree(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'gspp-seo-titles-'));
  scratchRoots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function page(fields: { title?: string; ogTitle?: string; description?: string; ogImageAlt?: string } = {}) {
  const {
    title = 'Seitentitel',
    ogTitle = 'OG Titel',
    description = 'Beschreibungstext',
    ogImageAlt = 'Bildalternative',
  } = fields;
  return '<!doctype html><html><head>'
    + `<title>${title}</title>`
    + `<meta property="og:title" content="${ogTitle}" />`
    + `<meta name="description" content="${description}" />`
    + `<meta property="og:image:alt" content="${ogImageAlt}" />`
    + '</head><body></body></html>';
}

describe('extractSeoTitleFields', () => {
  it('extracts the four title and meta texts', () => {
    expect(extractSeoTitleFields(page())).toEqual({
      title: 'Seitentitel',
      ogTitle: 'OG Titel',
      description: 'Beschreibungstext',
      ogImageAlt: 'Bildalternative',
    });
  });

  it('reads attributes independently of order, quotes and extra attributes', () => {
    const html = '<html><head>'
      + '<title data-page-title-fallback>Seitentitel</title>'
      + '<meta content=\'OG Titel\' property=\'og:title\' data-x="1" />'
      + '<meta content="Beschreibungstext" name="description" />'
      + '<meta property="og:image:alt" content="Bildalternative" />'
      + '</head></html>';
    expect(extractSeoTitleFields(html).ogTitle).toBe('OG Titel');
  });

  it('ignores data attributes whose names end in a field name', () => {
    const html = page().replace(
      '<meta property="og:title" content="OG Titel" />',
      '<meta property="og:title" data-content="Tarnung \u2014 X" content="OG Titel" />',
    );
    expect(extractSeoTitleFields(html).ogTitle).toBe('OG Titel');
  });

  it('decodes escaped attribute delimiters before checking', () => {
    const fields = extractSeoTitleFields(page({ ogTitle: '&lt;&amp;&gt;&quot;&#39;' }));
    expect(fields.ogTitle).toBe('<&>"\'');
  });

  // Das Urteil folgt dem Tokenizer: Maßgeblich ist, ob im Titeltext und im
  // Attributwert ein Gedankenstrich ankommt, nicht die Schreibweise.
  it.each([
    ['&mdash;', true], ['&mdash', false], ['&MDASH;', false], ['&mdashx;', false],
    ['&#8212;', true], ['&#8212', true], ['&#8212 ', true], ['&#8212b', true], ['&#8212=', true], ['&#08212z', true],
    ['&#x2014;', true], ['&#X2014;', true], ['&#x2014', true], ['&#x2014g', true], ['&#x2014f', false], ['&#x02014=', true],
    ['&#151;', true], ['&#151', true], ['&#151a', true], ['&#x97;', true], ['&#x97z', true],
    ['&#38;mdash;', false], ['&amp;#8212;', false], ['&amp;#8212', false], ['&amp;mdash;', false], ['&amp#8212;', false],
  ])('reads %s in title text and attribute value as em dash: %s', (reference, emDash) => {
    const text = `A ${reference} B`;
    const fields = extractSeoTitleFields(page({ title: text, ogTitle: text }));
    expect(fields.title.includes('\u2014')).toBe(emDash);
    expect(fields.ogTitle.includes('\u2014')).toBe(emDash);
  });

  it('reads the real content attribute behind a quoted look-alike', () => {
    const html = page().replace(
      '<meta name="description" content="Beschreibungstext" />',
      '<meta name="description" x.y=" content=\'Sicher\'" content="Beschreibung \u2014 Regression" />',
    );
    expect(extractSeoTitleFields(html).description).toBe('Beschreibung \u2014 Regression');
  });

  it.each([
    ['missing title', page().replace(/<title>.*<\/title>/, '')],
    ['missing og:title', page().replace(/<meta property="og:title"[^>]*>/, '')],
    ['missing description', page().replace(/<meta name="description"[^>]*>/, '')],
    ['missing og:image:alt', page().replace(/<meta property="og:image:alt"[^>]*>/, '')],
    ['duplicate og:title', page().replace('</head>', '<meta property="og:title" content="Doppelt" /></head>')],
    ['duplicate title', page().replace('</head>', '<title>Doppelt</title></head>')],
    ['duplicate description behind an encoded selector value', page().replace('</head>', '<meta name="descript&#105;on" content="A \u2014 B" /></head>')],
    ['commented-out description', page().replace(/(<meta name="description"[^>]*>)/, '<!-- $1 -->')],
  ])('fails fail-closed on %s', (_label, html) => {
    expect(() => extractSeoTitleFields(html)).toThrow(/Genau ein/);
  });

  it('fails fail-closed on a meta field without content attribute', () => {
    const html = page().replace('<meta property="og:title" content="OG Titel" />', '<meta property="og:title" />');
    expect(() => extractSeoTitleFields(html)).toThrow(/og:title"\] ohne content-Attribut/);
  });
});

describe('collectBuiltHtmlFiles', () => {
  it('collects nested HTML files sorted and skips dotfiles like the Pages pack rule', () => {
    const dir = scratchTree({
      'index.html': page(),
      'suche/index.html': page(),
      'katalog/gspp/GC/index.html': page(),
      'assets/app.js': 'console.log(1)',
      '.DS_Store': 'mac',
      '.hidden/index.html': page(),
    });
    expect(collectBuiltHtmlFiles(dir)).toEqual([
      'index.html',
      'katalog/gspp/GC/index.html',
      'suche/index.html',
    ]);
  });

  it('fails fail-closed on a missing directory, a file path and an HTML-free tree', () => {
    expect(() => collectBuiltHtmlFiles(join(scratchTree({}), 'fehlt'))).toThrow(/Ausgabeverzeichnis fehlt/);
    const file = join(scratchTree({}), 'datei.txt');
    writeFileSync(file, 'x');
    expect(() => collectBuiltHtmlFiles(file)).toThrow(/kein Verzeichnis/);
    const empty = scratchTree({ 'assets/app.js': 'x' });
    expect(() => collectBuiltHtmlFiles(empty)).toThrow(/Keine HTML-Dateien/);
  });
});

describe('checkBuiltSeoTitles', () => {
  it('passes a clean delivery and reports file and field counts', () => {
    const dir = scratchTree({ 'index.html': page(), 'suche/index.html': page() });
    expect(checkBuiltSeoTitles(dir)).toEqual({ fileCount: 2, fieldCount: 8 });
  });

  it.each([
    ['title', { title: 'Titel \u2014 mit Strich' }],
    ['ogTitle', { ogTitle: 'OG \u2014 Titel' }],
    ['description', { description: 'Text \u2014 mit Strich' }],
    ['ogImageAlt', { ogImageAlt: 'Alt \u2014 Text' }],
  ])('fails on U+2014 in %s with a file and field reference', (field, override) => {
    const dir = scratchTree({ 'suche/index.html': page(override) });
    expect(() => checkBuiltSeoTitles(dir)).toThrow(new RegExp(`suche/index\\.html: ${field} enth`));
  });

  it('fails on a masked em dash that browsers render as U+2014', () => {
    const dir = scratchTree({ 'index.html': page({ ogTitle: 'OG &mdash; Titel' }) });
    expect(() => checkBuiltSeoTitles(dir)).toThrow(/index\.html: ogTitle enth/);
  });

  it('lists every violation across files and prefixes structural defects with the path', () => {
    const dir = scratchTree({
      'index.html': page({ title: 'A \u2014 B' }),
      'suche/index.html': page({ description: 'C \u2014 D' }),
      'kaputt/index.html': '<html><head></head></html>',
    });
    const message = violationMessage(dir);
    expect(message).toContain('index.html: title enthält U+2014');
    expect(message).toContain('suche/index.html: description enthält U+2014');
    expect(message).toContain('kaputt/index.html: Genau ein <title> erwartet');
  });

  it('checks every field of a file independently of a structural defect in another field', () => {
    const html = page({ ogTitle: 'OG — Titel' }).replace('</head>', '<title>Doppelt</title></head>');
    const message = violationMessage(scratchTree({ 'index.html': html }));
    expect(message).toContain('index.html: Genau ein <title> erwartet, gefunden: 2');
    expect(message).toContain('index.html: ogTitle enthält U+2014');
  });

  it('reports each missing field of a file on its own', () => {
    const html = page()
      .replace(/<title>.*<\/title>/, '')
      .replace(/<meta name="description"[^>]*>/, '')
      .replace('<meta property="og:image:alt" content="Bildalternative" />', '<meta property="og:image:alt" />');
    const message = violationMessage(scratchTree({ 'index.html': html }));
    expect(message).toContain('index.html: Genau ein <title> erwartet, gefunden: 0');
    expect(message).toContain('index.html: Genau ein meta[name="description"] erwartet, gefunden: 0');
    expect(message).toContain('index.html: meta[property="og:image:alt"] ohne content-Attribut');
    expect(message).not.toContain('og:title"]');
  });

  // Windows entzieht mit `chmod` kein Leserecht, und root liest Dateien ohne
  // Leserecht trotzdem — beide Umgebungen können den Lesefehler nicht erzeugen.
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports an unreadable file with its path', () => {
    const dir = scratchTree({ 'index.html': page(), 'gesperrt/index.html': page() });
    chmodSync(join(dir, 'gesperrt/index.html'), 0o000);
    const message = violationMessage(dir);
    expect(message).toContain('gesperrt/index.html: EACCES');
    expect(message).not.toMatch(/^index\.html:/m);
  });
});

function violationMessage(dir: string) {
  try {
    checkBuiltSeoTitles(dir);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Titelprüfung hat keinen Verstoß gemeldet');
}

describe('parseCheckArgs', () => {
  it('accepts exactly --dist <directory>', () => {
    expect(parseCheckArgs(['--dist', 'dist'])).toEqual({ distDir: 'dist' });
  });

  it.each([[[]], [['dist']], [['--dist', '']], [['--dist', 'a', 'b']]])('rejects %j', (argv) => {
    expect(() => parseCheckArgs(argv)).toThrow(/Aufruf/);
  });
});

describe('main', () => {
  it('checks the given directory and rejects a missing argument', () => {
    const dir = scratchTree({ 'index.html': page() });
    expect(() => main(['--dist', dir])).not.toThrow();
    expect(() => main([])).toThrow(/Aufruf/);
    expect(() => main(['--dist', join(dir, 'fehlt')])).toThrow(/Ausgabeverzeichnis fehlt/);
  });
});
