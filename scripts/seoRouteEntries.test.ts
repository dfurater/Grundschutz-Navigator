// @vitest-environment node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCatalog } from '../src/adapters/oscalAdapter';
import type { CatalogKey } from '../src/domain/sourceRegistry';
import { catalogDataFileName, catalogMetadataFileName, listSupportedCatalogs } from '../src/domain/sourceRegistry.mjs';
import { STATIC_CONTENT_TITLES, listSeoRouteMetadata, loadPublicSeoCatalogs, writeSeoRouteEntries } from './seoRouteEntries';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string) => { window: { document: Document; close(): void } };
};
const BASE_URL = 'https://dfurater.github.io/Grundschutz-Navigator/';
const HTML = '<!doctype html><html><head><meta property="og:title" content="Grundschutz++ Navigator" /><meta property="og:url" content="' + BASE_URL + '" /><meta property="og:description" content="Keep this" /><meta property="og:image" content="/og-image.png" /><meta http-equiv="Content-Security-Policy" content="default-src &apos;self&apos;" /><title data-page-title-fallback>Grundschutz++ Navigator</title></head><body><script type="module" src="/assets/app.js"></script></body></html>';
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDir(html: string | null = HTML) {
  const directory = mkdtempSync(join(tmpdir(), 'gspp-seo-'));
  directories.push(directory);
  if (html !== null) writeFileSync(join(directory, 'index.html'), html);
  return directory;
}

function rawCatalog(title = 'Catalog', groupId: string | undefined = 'GC') {
  return {
    uuid: 'synthetic-public-catalog',
    metadata: { title, 'last-modified': '2026-10-01T00:00:00Z', version: 'test', 'oscal-version': '1.1.3' },
    controls: [{ id: 'ROOT.1', title: 'Root control', props: [{ name: 'alt-identifier', value: 'root-control' }] }],
    groups: [{
      ...(groupId === undefined ? {} : { id: groupId }),
      title: 'Governance',
      groups: [{ id: 'GC.1', title: 'Foundations', controls: [{ id: 'GC.1.1', title: 'ISMS', props: [{ name: 'alt-identifier', value: 'control-uuid' }] }] }],
    }],
  };
}
function catalog(catalogKey: CatalogKey = 'gspp', title = 'Catalog') {
  return parseCatalog(rawCatalog(title), { catalogKey });
}
function metadata(html: string) {
  const { window } = new JSDOM(html);
  try {
    const title = window.document.querySelectorAll('meta[property="og:title"]');
    const url = window.document.querySelectorAll('meta[property="og:url"]');
    expect(title).toHaveLength(1);
    expect(url).toHaveLength(1);
    return { title: title[0].getAttribute('content'), url: url[0].getAttribute('content') };
  } finally {
    window.close();
  }
}

describe('listSeoRouteMetadata', () => {
  it('uses the shared fixed labels and resolved catalog, practice, topic and control titles', () => {
    const entries = listSeoRouteMetadata([catalog()]);
    expect(entries).toContainEqual({ path: '/', title: 'Grundschutz++ Navigator' });
    for (const [path, title] of Object.entries(STATIC_CONTENT_TITLES)) expect(entries).toContainEqual({ path, title });
    expect(entries).toContainEqual({ path: '/katalog/gspp', title: 'Catalog' });
    expect(entries).toContainEqual({ path: '/katalog/gspp/GC', title: 'Governance — Catalog' });
    expect(entries).toContainEqual({ path: '/katalog/gspp/GC.1', title: 'Foundations — Catalog' });
    expect(entries).toContainEqual({ path: '/katalog/gspp/kontrolle/control-uuid', title: 'GC.1.1 — ISMS — Catalog' });
    expect(entries).toContainEqual({ path: '/katalog/gspp/kontrolle/root-control', title: 'ROOT.1 — Root control — Catalog' });
  });

  it('keeps identical control IDs and alternate identifiers scoped to each catalog', () => {
    const entries = listSeoRouteMetadata([catalog('gspp', 'One'), catalog('wlan', 'Two')]);
    expect(entries).toContainEqual({ path: '/katalog/gspp/kontrolle/control-uuid', title: 'GC.1.1 — ISMS — One' });
    expect(entries).toContainEqual({ path: '/katalog/wlan/kontrolle/control-uuid', title: 'GC.1.1 — ISMS — Two' });
  });

  it('skips unaddressable groups while preserving their addressable topics and controls', () => {
    const raw = rawCatalog();
    delete raw.groups[0].id;
    const entries = listSeoRouteMetadata([parseCatalog(raw, { catalogKey: 'gspp' })]);
    expect(entries.some(entry => entry.path === '/katalog/gspp/undefined')).toBe(false);
    expect(entries.some(entry => entry.path === '/katalog/gspp/GC.1')).toBe(true);
    expect(entries.some(entry => entry.path.endsWith('/kontrolle/control-uuid'))).toBe(true);
  });

  it('rejects catalogs outside the published supported registry', () => {
    expect(() => listSeoRouteMetadata([catalog('mindeststandard-tls')])).toThrow(/supported/i);
  });
});

describe('loadPublicSeoCatalogs', () => {
  function prepareData() {
    const directory = tempDir(null);
    for (const entry of listSupportedCatalogs()) {
      const bytes = JSON.stringify({ catalog: rawCatalog(entry.title) });
      writeFileSync(join(directory, catalogDataFileName(entry)), bytes);
      writeFileSync(join(directory, catalogMetadataFileName(entry)), JSON.stringify({
        integrity: { sha256: createHash('sha256').update(bytes).digest('hex') },
      }));
    }
    writeFileSync(join(directory, 'private-import.json'), 'invalid private document');
    return directory;
  }

  it('loads exactly the public registry artifacts and reuses the catalog projection', () => {
    const result = loadPublicSeoCatalogs(prepareData());
    expect(result.map(item => item.catalogKey)).toEqual(listSupportedCatalogs().map(entry => entry.catalogKey));
    expect(result[0].controlsByAltIdentifier.get('control-uuid')?.id).toBe('GC.1.1');
  });

  it('fails on missing supported artifacts', () => {
    const directory = prepareData();
    rmSync(join(directory, 'catalog-wlan.json'));
    expect(() => loadPublicSeoCatalogs(directory)).toThrow();
  });

  it('rejects modified catalog bytes before publishing their titles', () => {
    const directory = prepareData();
    writeFileSync(join(directory, 'catalog.json'), JSON.stringify({ catalog: rawCatalog('Tampered') }));
    expect(() => loadPublicSeoCatalogs(directory)).toThrow(/integrity/i);
  });

  it('rejects an unresolvable catalog root even with a matching byte hash', () => {
    const directory = prepareData();
    const bytes = JSON.stringify({ catalog: {} });
    writeFileSync(join(directory, 'catalog.json'), bytes);
    writeFileSync(join(directory, 'catalog-metadata.json'), JSON.stringify({ integrity: { sha256: createHash('sha256').update(bytes).digest('hex') } }));
    expect(() => loadPublicSeoCatalogs(directory)).toThrow(/Invalid OSCAL catalog/);
  });
});

describe('writeSeoRouteEntries', () => {
  it('changes only the two OG tags and writes a neutral index for the 404 fallback', () => {
    const directory = tempDir();
    const entries = listSeoRouteMetadata([catalog()]);
    writeSeoRouteEntries(directory, entries, BASE_URL);
    for (const entry of entries) {
      const file = entry.path === '/' ? 'index.html' : entry.path.slice(1) + '/index.html';
      const html = readFileSync(join(directory, file), 'utf8');
      expect(metadata(html)).toEqual({ title: entry.title, url: BASE_URL + entry.path.slice(1) });
      const withoutOg = (value: string) => value.replace(/<meta property="og:(title|url)"[^>]*>/g, '');
      expect(withoutOg(html)).toBe(withoutOg(HTML));
    }
    expect(existsSync(join(directory, 'katalog/gspp/unknown/index.html'))).toBe(false);
    expect(existsSync(join(directory, 'katalog/unknown/index.html'))).toBe(false);
    expect(metadata(readFileSync(join(directory, 'index.html'), 'utf8'))).toEqual({ title: 'Grundschutz++ Navigator', url: BASE_URL });
  });

  it('escapes all attribute delimiters and preserves literal replacement-pattern characters', () => {
    const title = `&<>"' $& $1 </head><script>bad()</script>`;
    const directory = tempDir();
    writeSeoRouteEntries(directory, listSeoRouteMetadata([catalog('gspp', title)]), BASE_URL);
    const html = readFileSync(join(directory, 'katalog/gspp/index.html'), 'utf8');
    expect(metadata(html).title).toBe(title);
    const { window } = new JSDOM(html);
    expect(window.document.querySelectorAll('script')).toHaveLength(1);
    expect(window.document.querySelector('meta[property="og:title"]')?.attributes).toHaveLength(2);
    window.close();
  });

  it('uses encoded URLs and decoded, contained file paths for Unicode and spaces', () => {
    const directory = tempDir();
    writeSeoRouteEntries(directory, [{ path: '/katalog/gspp/%C3%9Cber%20uns', title: 'Übersicht' }], BASE_URL);
    const html = readFileSync(join(directory, 'katalog/gspp/Über uns/index.html'), 'utf8');
    expect(metadata(html).url).toBe(BASE_URL + 'katalog/gspp/%C3%9Cber%20uns');
  });

  it('preserves route metadata for query URLs and uses a configured deployment base', () => {
    const directory = tempDir();
    writeSeoRouteEntries(directory, listSeoRouteMetadata([]), 'https://example.com/preview/');
    for (const target of ['https://example.com/preview/suche?q=secret', 'https://example.com/preview/suche?filter=secret#secret']) {
      const route = new URL(target).pathname.slice('/preview/'.length);
      expect(metadata(readFileSync(join(directory, route, 'index.html'), 'utf8'))).toEqual({ title: 'Suche', url: 'https://example.com/preview/suche' });
    }
  });

  it.each(['/../escape', '/%2e%2e/escape', '/a/%2Fescape', '/a/%5cescape', '/a?q=secret', '/a#secret', '//evil', '/a/%00'])('rejects unsafe route %s before writing any output', path => {
    const directory = tempDir();
    expect(() => writeSeoRouteEntries(directory, [{ path: '/suche', title: 'Suche' }, { path, title: 'Unsafe' }], BASE_URL)).toThrow();
    expect(readdirSync(directory)).toEqual(['index.html']);
    expect(readFileSync(join(directory, 'index.html'), 'utf8')).toBe(HTML);
  });

  it.each([
    ['/katalog/gspp/GC', '/katalog/gspp/GC'],
    ['/katalog/gspp/GC', '/katalog/gspp/%47C'],
    ['/katalog/gspp/GC', '/katalog/gspp/gc'],
    ['/katalog/gspp', '/katalog/gspp/index.html'],
  ])('rejects colliding output paths %s and %s before writing', (first, second) => {
    const directory = tempDir();
    expect(() => writeSeoRouteEntries(directory, [{ path: first, title: 'One' }, { path: second, title: 'Two' }], BASE_URL)).toThrow(/collision/i);
    expect(readdirSync(directory)).toEqual(['index.html']);
  });

  it('rejects symlink directories before writing outside the output tree', async () => {
    const { symlinkSync } = await import('node:fs');
    const directory = tempDir();
    const outside = tempDir(null);
    symlinkSync(outside, join(directory, 'suche'));
    expect(() => writeSeoRouteEntries(directory, listSeoRouteMetadata([]), BASE_URL)).toThrow(/symlink/i);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('rejects a dangling output symlink during preflight', async () => {
    const { symlinkSync } = await import('node:fs');
    const directory = tempDir();
    symlinkSync(join(directory, 'missing-target'), join(directory, 'suche'));
    expect(() => writeSeoRouteEntries(directory, listSeoRouteMetadata([]), BASE_URL)).toThrow(/symlink/i);
    expect(readFileSync(join(directory, 'index.html'), 'utf8')).toBe(HTML);
  });

  it('rejects an index symlink before reading its external template', async () => {
    const { symlinkSync } = await import('node:fs');
    const directory = tempDir(null);
    const outside = tempDir(null);
    writeFileSync(join(outside, 'template.html'), 'synthetic unrelated data');
    symlinkSync(join(outside, 'template.html'), join(directory, 'index.html'));
    expect(() => writeSeoRouteEntries(directory, listSeoRouteMetadata([]), BASE_URL)).toThrow(/symlink/i);
    expect(readdirSync(directory)).toEqual(['index.html']);
  });

  it('fails on missing or duplicate required tags before creating any entries', () => {
    for (const template of [HTML.replace(/<meta property="og:title"[^>]*>/, ''), HTML.replace('</head>', '<meta property="og:title" content="Duplicate" /></head>')]) {
      const directory = tempDir(template);
      expect(() => writeSeoRouteEntries(directory, listSeoRouteMetadata([]), BASE_URL)).toThrow(/og:title/);
      expect(readdirSync(directory)).toEqual(['index.html']);
    }
  });

  it('fails safely on a missing index and writes identical bytes on repeated calls', () => {
    expect(() => writeSeoRouteEntries(tempDir(null), listSeoRouteMetadata([]), BASE_URL)).toThrow(/without build output/);
    const directory = tempDir();
    const entries = listSeoRouteMetadata([catalog()]);
    writeSeoRouteEntries(directory, entries, BASE_URL);
    const first = readFileSync(join(directory, 'katalog/gspp/GC/index.html'));
    writeSeoRouteEntries(directory, entries, BASE_URL);
    expect(readFileSync(join(directory, 'katalog/gspp/GC/index.html'))).toEqual(first);
  });
});
