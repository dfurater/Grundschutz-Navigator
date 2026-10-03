// @vitest-environment node

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkBuiltSeoTitles,
  collectBuiltHtmlFiles,
  decodeHtmlEntities,
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

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hexadecimal references in one pass', () => {
    expect(decodeHtmlEntities('&lt;a &amp; b&gt; &#39; &#x27;')).toBe('<a & b> \' \'');
  });

  it('decodes masked em dashes because browsers render them as U+2014', () => {
    expect(decodeHtmlEntities('&mdash;')).toBe('\u2014');
    expect(decodeHtmlEntities('&#8212;')).toBe('\u2014');
    expect(decodeHtmlEntities('&#x2014;')).toBe('\u2014');
    expect(decodeHtmlEntities('&#X2014;')).toBe('\u2014');
  });

  it('treats named references case-sensitively like the browser', () => {
    expect(decodeHtmlEntities('&MDASH;')).toBe('&MDASH;');
    expect(decodeHtmlEntities('&AMP;')).toBe('&');
    expect(decodeHtmlEntities('&mdash')).toBe('&mdash');
    expect(decodeHtmlEntities('A &amp B')).toBe('A & B');
    expect(decodeHtmlEntities('A &amp= B')).toBe('A &amp= B');
  });

  it('decodes numeric em dashes without a semicolon unless a letter, digit or = follows', () => {
    expect(decodeHtmlEntities('A &#8212 B')).toBe('A \u2014 B');
    expect(decodeHtmlEntities('A &#x2014</title>')).toBe('A \u2014</title>');
    expect(decodeHtmlEntities('A &#8212b C')).toBe('A &#8212b C');
  });

  it('decodes double-masked sequences only once, like the browser', () => {
    expect(decodeHtmlEntities('A &#38;mdash; B')).toBe('A &mdash; B');
    expect(decodeHtmlEntities('A &amp;#8212; B')).toBe('A &#8212; B');
    expect(decodeHtmlEntities('A &amp;#8212 B')).toBe('A &#8212 B');
  });

  it('leaves unknown references untouched', () => {
    expect(decodeHtmlEntities('&nbsp; &#0xZZ;')).toBe('&nbsp; &#0xZZ;');
  });
});

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

  it.each([
    ['missing title', page().replace(/<title>.*<\/title>/, '')],
    ['missing og:title', page().replace(/<meta property="og:title"[^>]*>/, '')],
    ['missing description', page().replace(/<meta name="description"[^>]*>/, '')],
    ['missing og:image:alt', page().replace(/<meta property="og:image:alt"[^>]*>/, '')],
    ['duplicate og:title', page().replace('</head>', '<meta property="og:title" content="Doppelt" /></head>')],
    ['duplicate title', page().replace('</head>', '<title>Doppelt</title></head>')],
    ['og:title without content', page().replace('<meta property="og:title" content="OG Titel" />', '<meta property="og:title" />')],
  ])('fails fail-closed on %s', (_label, html) => {
    expect(() => extractSeoTitleFields(html)).toThrow(/Genau ein/);
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
    let message = '';
    try {
      checkBuiltSeoTitles(dir);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('index.html: title enthält U+2014');
    expect(message).toContain('suche/index.html: description enthält U+2014');
    expect(message).toContain('kaputt/index.html: Genau ein <title> erwartet');
  });
});

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
