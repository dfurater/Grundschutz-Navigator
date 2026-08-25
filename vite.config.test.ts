// @vitest-environment node

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join, relative } from 'path';
import { tmpdir } from 'os';
import { afterEach, afterAll, describe, expect, it } from 'vitest';
import {
  listCanonicalEntryRoutes,
  buildSitemapXml,
  resolveDeploymentBase,
  writeSpaFallbackFile,
  writeSitemapFile,
  writeStaticRouteEntries,
} from './vite.config';
import { createRequire } from 'node:module';

// jsdom ist als Dev-Dependency vorhanden (Vitest-jsdom-Umgebung), bringt aber
// keine Typen mit. Der Laufzeit-Import über createRequire hält die
// Abhängigkeitsliste und die Typwelt unverändert und dient ausschließlich der
// echten XML-Parsing-Validierung der Sitemap im Test.
const requireJsdom = createRequire(import.meta.url);

interface XmlLikeDocument {
  documentElement: { namespaceURI: string | null };
  querySelectorAll(selector: string): { textContent: string | null }[];
}

const { JSDOM } = requireJsdom('jsdom') as {
  JSDOM: new (
    input: string,
    options?: { contentType?: string },
  ) => { window: { document: XmlLikeDocument } },
};

/*
 * Die byte-exakten Sitemap-Erwartungen gelten für die Production-Defaults;
 * ein von außen (z. B. Shell) gesetztes BUILD_BASE würde sie sonst kippen.
 */
delete process.env.BUILD_BASE;
afterAll(() => {
  delete process.env.BUILD_BASE;
});

const tempDirs: string[] = [];

const INDEX_HTML =
  '<!doctype html><html><body><script type="module" src="/Grundschutz-Navigator/assets/app.js"></script></body></html>';

const CONTENT_ROUTES = [
  '/suche',
  '/vokabular',
  '/about',
  '/datenschutz',
  '/impressum',
  '/lizenzen',
] as const;

const SUPPORTED_CATALOG_KEYS = ['gspp', 'lieferkette', 'wlan'] as const;

function createTempDistDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gspp-static-routes-'));
  tempDirs.push(dir);
  return dir;
}

function createTempDistWithIndex() {
  const dir = createTempDistDir();
  writeFileSync(join(dir, 'index.html'), INDEX_HTML);
  return dir;
}

function listFilesRecursive(root: string): string[] {
  const files: string[] = [];
  const directories = [root];
  while (directories.length > 0) {
    const current = directories.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        directories.push(fullPath);
      } else {
        files.push(relative(root, fullPath));
      }
    }
  }
  return files.sort();
}

function expectedEntryFiles(catalogKeys: readonly string[]): string[] {
  return [
    ...CONTENT_ROUTES.map((route) => `${route.slice(1)}/index.html`),
    ...catalogKeys.map((catalogKey) => `katalog/${catalogKey}/index.html`),
  ].sort();
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('writeSitemapFile / buildSitemapXml', () => {
  const EXPECTED_SITEMAP = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '  <url><loc>https://dfurater.github.io/Grundschutz-Navigator/</loc></url>',
    ...listCanonicalEntryRoutes().map(
      (route) =>
        `  <url><loc>https://dfurater.github.io/Grundschutz-Navigator${route}</loc></url>`,
    ),
    '</urlset>',
    '',
  ].join('\n');

  it('emits a deterministic UTF-8 document with XML declaration and urlset namespace', () => {
    expect(buildSitemapXml()).toBe(EXPECTED_SITEMAP);
    expect(Buffer.from(buildSitemapXml(), 'utf8')).toEqual(
      Buffer.from(EXPECTED_SITEMAP, 'utf8'),
    );
  });

  it('lists the start page, all fixed content routes, and every supported catalog entry exactly once', () => {
    const xml = buildSitemapXml();
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);

    expect(new Set(locs).size).toBe(locs.length);
    expect(locs).toContain('https://dfurater.github.io/Grundschutz-Navigator/');
    for (const route of listCanonicalEntryRoutes()) {
      expect(locs).toContain(`https://dfurater.github.io/Grundschutz-Navigator${route}`);
    }
    expect(locs).toHaveLength(1 + listCanonicalEntryRoutes().length);
  });

  it('excludes /katalog, /mehr, detail routes, query URLs, and unsupported catalogs from the sitemap', () => {
    const locs = buildSitemapXml().match(/<loc>[^<]*<\/loc>/g) ?? [];

    for (const loc of locs) {
      expect(loc).not.toMatch(/^<loc>https:\/\/dfurater\.github\.io\/Grundschutz-Navigator\/katalog<\/loc>$/);
      expect(loc).not.toContain('/mehr');
      expect(loc).not.toContain('/kontrolle/');
      expect(loc).not.toContain('?');
      expect(loc).toMatch(/^<loc>https:\/\/dfurater\.github\.io/);
    }
  });

  it('never emits optional sitemap fields and keeps every loc inside the canonical origin and base path', () => {
    const xml = buildSitemapXml();

    expect(xml).not.toContain('<lastmod>');
    expect(xml).not.toContain('<changefreq>');
    expect(xml).not.toContain('<priority>');
    expect(xml).not.toContain('&amp;apos;');
  });

  it('escapes XML special characters in generated values', () => {
    const xml = buildSitemapXml({
      origin: 'https://example.com',
      basePath: '/base/',
      routes: ['/a&b<c>d"e\''],
    });

    expect(xml).toContain('<loc>https://example.com/base/a&amp;b&lt;c&gt;d&quot;e&apos;</loc>');
  });

  it('writes byte-deterministically to dist/sitemap.xml', () => {
    const distDir = createTempDistWithIndex();

    writeSitemapFile(distDir);

    expect(readFileSync(join(distDir, 'sitemap.xml'), 'utf8')).toBe(EXPECTED_SITEMAP);
  });

  it('parses as valid XML with the sitemap namespace and one loc per canonical URL', () => {
    const { window } = new JSDOM(buildSitemapXml(), { contentType: 'application/xml' });
    const { document } = window;

    expect(document.documentElement.namespaceURI).toBe(
      'http://www.sitemaps.org/schemas/sitemap/0.9',
    );
    const locs = [...document.querySelectorAll('loc')].map(
      (node) => node.textContent ?? '',
    );
    expect(locs).toHaveLength(1 + listCanonicalEntryRoutes().length);
    expect(locs[0]).toBe('https://dfurater.github.io/Grundschutz-Navigator/');
  });

  it('derives its base from the resolved deployment base, not from a hardcoded path', () => {
    process.env.BUILD_BASE = '/preview/';

    try {
      expect(resolveDeploymentBase()).toBe('/preview/');
      expect(buildSitemapXml()).toContain(
        '<loc>https://dfurater.github.io/preview/suche</loc>',
      );
    } finally {
      delete process.env.BUILD_BASE;
    }
  });
});

describe('listCanonicalEntryRoutes', () => {
  it('derives the canonical contract from the fixed content routes plus the supported catalogs of the source registry', () => {
    expect(listCanonicalEntryRoutes()).toEqual([
      ...CONTENT_ROUTES,
      ...SUPPORTED_CATALOG_KEYS.map(
        (catalogKey) => `/katalog/${catalogKey}`,
      ),
    ]);
  });

  it('contains every currently shipped catalog entry and never preview, draft, or blocked catalogs', () => {
    const routes = listCanonicalEntryRoutes();

    for (const catalogKey of SUPPORTED_CATALOG_KEYS) {
      expect(routes).toContain(`/katalog/${catalogKey}`);
    }
    // Die Registry-Ableitung ist die einzige Quelle: Der Vertrag darf keine
    // Katalogeinstiege führen, die `listSupportedCatalogs()` nicht liefert.
    for (const route of routes) {
      if (route.startsWith('/katalog/')) {
        expect(SUPPORTED_CATALOG_KEYS).toContain(route.slice('/katalog/'.length));
      }
    }
  });

  it('excludes /katalog, /mehr, parameterized detail routes, and query/filter URLs', () => {
    const routes = listCanonicalEntryRoutes();

    expect(routes).not.toContain('/katalog');
    expect(routes).not.toContain('/mehr');
    expect(routes.some((route) => route.endsWith('/'))).toBe(false);
    expect(routes.some((route) => route.includes('/kontrolle/'))).toBe(false);
    expect(routes.some((route) => route.includes('?'))).toBe(false);
    expect(routes.filter((route) => route.startsWith('/katalog')).every(
      (route) => route.split('/').length === 3,
    )).toBe(true);
  });

  it('accepts an injected catalog key list so callers can pin the derivation', () => {
    expect(listCanonicalEntryRoutes(['wlan'])).toEqual([
      ...CONTENT_ROUTES,
      '/katalog/wlan',
    ]);
  });
});

describe('writeSpaFallbackFile', () => {
  it('copies the built index.html to 404.html for GitHub Pages deep links', () => {
    const distDir = createTempDistWithIndex();

    writeSpaFallbackFile(distDir);

    expect(readFileSync(join(distDir, '404.html'), 'utf8')).toBe(INDEX_HTML);
  });

  it('fails safely when the build output is missing', () => {
    const distDir = createTempDistDir();

    expect(() => writeSpaFallbackFile(distDir)).toThrow(
      `Cannot create SPA fallback without build output at ${join(distDir, 'index.html')}`,
    );
  });
});

describe('writeStaticRouteEntries', () => {
  it('creates byte-identical index.html documents for every fixed content route and supported catalog entry', () => {
    const distDir = createTempDistWithIndex();

    writeStaticRouteEntries(distDir, SUPPORTED_CATALOG_KEYS);

    for (const entryFile of expectedEntryFiles(SUPPORTED_CATALOG_KEYS)) {
      const entryPath = join(distDir, entryFile);
      expect(existsSync(entryPath), entryPath).toBe(true);
      expect(readFileSync(entryPath).equals(Buffer.from(INDEX_HTML, 'utf8')), entryPath).toBe(
        true,
      );
    }
  });

  it('derives the materialized entries from the same route contract as the route list', () => {
    const distDir = createTempDistWithIndex();

    writeStaticRouteEntries(distDir);

    expect(listFilesRecursive(distDir)).toEqual(
      ['index.html', ...expectedEntryFiles(SUPPORTED_CATALOG_KEYS)].sort(),
    );
  });

  it('never creates /katalog/index.html, /mehr/index.html, or any unlisted route document', () => {
    const distDir = createTempDistWithIndex();

    writeStaticRouteEntries(distDir, SUPPORTED_CATALOG_KEYS);

    expect(existsSync(join(distDir, 'katalog', 'index.html'))).toBe(false);
    expect(existsSync(join(distDir, 'mehr', 'index.html'))).toBe(false);
    const created = listFilesRecursive(distDir);
    expect(created).toEqual(
      ['index.html', ...expectedEntryFiles(SUPPORTED_CATALOG_KEYS)].sort(),
    );
  });

  it('fails safely before writing anything when the build output is missing', () => {
    const distDir = createTempDistDir();

    expect(() => writeStaticRouteEntries(distDir)).toThrow(
      `Cannot create static route entries without build output at ${join(distDir, 'index.html')}`,
    );
    expect(listFilesRecursive(distDir)).toEqual([]);
  });
});
