// @vitest-environment node

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join, relative, resolve } from 'path';
import { listSeoRouteMetadata, loadPublicSeoCatalogs } from './scripts/seoRouteEntries';
import { tmpdir } from 'os';
import { afterEach, afterAll, describe, expect, it } from 'vitest';
import {
  listCanonicalEntryRoutes,
  buildSitemapXml,
  resolveDeploymentBase,
  spaFallbackPlugin,
  writeSpaFallbackFile,
  writeSitemapFile,
  writeStaticRouteEntries,
} from './vite.config';
import { createRequire } from 'node:module';
import { assertChecksumsManifest, parseChecksumsManifest } from './scripts/deployChecksums.mjs';
import { LAZY_ROUTE_MODULES } from './src/app/lazyRouteModules.mjs';

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
  '<!doctype html><html><head><title>Grundschutz++ Navigator</title><meta name="description" content="BSI-Anwenderkatalog durchsuchen, filtern und exportieren." /><meta property="og:title" content="Grundschutz++ Navigator" /><meta property="og:url" content="https://dfurater.github.io/Grundschutz-Navigator/" /><meta property="og:image:alt" content="Grundschutz++ Navigator. BSI-Anwenderkatalog, OSCAL 1.1.3." /></head><body><script type="module" src="/Grundschutz-Navigator/assets/app.js"></script></body></html>';

const CONTENT_ROUTES = [
  '/suche',
  '/vokabular',
  '/about',
  '/datenschutz',
  '/impressum',
  '/lizenzen',
] as const;

// Ein Seitenchunk je Lazy-Route, wie ihn der Bundler-Hook ermittelt.
const MODULE_PRELOADS = new Map(
  Object.keys(LAZY_ROUTE_MODULES).map((route) => [route, `assets/${route.slice(1)}-TEST.js`]),
);

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

// Spiegelt den Schreiber: Routen tragen kodierte IDs, die Dateipfade dekodierte Segmente.
function entryFileForRoute(route: string): string {
  if (route === '/') return 'index.html';
  return join(...route.slice(1).split('/').map(segment => decodeURIComponent(segment)), 'index.html');
}

function expectedEntryFiles(): string[] {
  const catalogs = loadPublicSeoCatalogs(resolve(import.meta.dirname, 'public/data'));
  return listSeoRouteMetadata(catalogs).map(entry => entryFileForRoute(entry.path)).sort();
}

describe('entryFileForRoute', () => {
  it('maps the root and decodes encoded route segments like the SEO writer', () => {
    expect(entryFileForRoute('/')).toBe('index.html');
    expect(entryFileForRoute('/katalog/x/%C3%9Cberblick')).toBe(join('katalog', 'x', 'Überblick', 'index.html'));
  });
});

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

  it('normalizes a BUILD_BASE without a trailing slash before joining it to routes', () => {
    process.env.BUILD_BASE = '/preview';

    try {
      expect(resolveDeploymentBase()).toBe('/preview/');
      expect(buildSitemapXml()).toContain(
        '<loc>https://dfurater.github.io/preview/suche</loc>',
      );
      expect(buildSitemapXml()).not.toContain('previewsuche');
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
  it('delivers route-specific OG metadata for every canonical entry', () => {
    const distDir = createTempDistWithIndex();
    writeStaticRouteEntries(distDir);
    for (const route of listCanonicalEntryRoutes()) {
      const html = readFileSync(join(distDir, route.slice(1), 'index.html'), 'utf8');
      expect(html).toContain(`<meta property="og:url" content="https://dfurater.github.io/Grundschutz-Navigator${route}" />`);
      expect(html.match(/property="og:title"/g)).toHaveLength(1);
      expect(html).toContain('<script type="module" src="/Grundschutz-Navigator/assets/app.js"></script>');
    }
    expect(readFileSync(join(distDir, 'suche/index.html'), 'utf8')).toContain('content="Suche"');
  });

  it('materializes exactly the resolved public route list, including group and control entries', () => {
    const distDir = createTempDistWithIndex();
    writeStaticRouteEntries(distDir);
    expect(listFilesRecursive(distDir)).toEqual(expectedEntryFiles());
    expect(existsSync(join(distDir, 'katalog/gspp/GC/index.html'))).toBe(true);
    expect(existsSync(join(distDir, 'katalog/gspp/kontrolle/80351189-6ffc-495e-a995-6219b9704724/index.html'))).toBe(true);
    expect(existsSync(join(distDir, 'katalog/index.html'))).toBe(false);
    expect(existsSync(join(distDir, 'mehr/index.html'))).toBe(false);
  });

  it('keeps unknown targets on the neutral 404 fallback and supports a normalized BUILD_BASE', () => {
    const distDir = createTempDistWithIndex();
    process.env.BUILD_BASE = '/preview';
    try {
      writeStaticRouteEntries(distDir, []);
      writeSpaFallbackFile(distDir);
      const fallback = readFileSync(join(distDir, '404.html'), 'utf8');
      expect(fallback).toContain('property="og:title" content="Grundschutz++ Navigator"');
      expect(fallback).toContain('property="og:url" content="https://dfurater.github.io/preview/"');
      expect(fallback).toBe(readFileSync(join(distDir, 'index.html'), 'utf8'));
      expect(readFileSync(join(distDir, 'suche/index.html'), 'utf8')).toContain('content="https://dfurater.github.io/preview/suche"');
      expect(existsSync(join(distDir, 'katalog/unknown/index.html'))).toBe(false);
    } finally {
      delete process.env.BUILD_BASE;
    }
  });

  it('fails safely before writing anything when the build output is missing', () => {
    const distDir = createTempDistDir();
    expect(() => writeStaticRouteEntries(distDir)).toThrow(
      `Cannot create static route entries without build output at ${join(distDir, 'index.html')}`,
    );
    expect(listFilesRecursive(distDir)).toEqual([]);
  });
});

describe('modulepreload für Lazy-Routen (GSPP-506)', () => {
  it('gibt genau den Einstiegen der Lazy-Routen ein modulepreload auf ihren Seitenchunk', () => {
    const distDir = createTempDistWithIndex();
    writeStaticRouteEntries(distDir, [], MODULE_PRELOADS);

    for (const route of Object.keys(LAZY_ROUTE_MODULES)) {
      const html = readFileSync(join(distDir, route.slice(1), 'index.html'), 'utf8');
      expect(html.match(/<link rel="modulepreload"/g)).toHaveLength(1);
      expect(html).toContain(`<link rel="modulepreload" href="/Grundschutz-Navigator/assets/${route.slice(1)}-TEST.js" />`);
    }
    expect(readFileSync(join(distDir, 'index.html'), 'utf8')).not.toContain('modulepreload');
  });

  it('führt die aufgelöste Deployment-Basis im Pfad, auch bei BUILD_BASE=/', () => {
    const distDir = createTempDistWithIndex();
    process.env.BUILD_BASE = '/';
    try {
      writeStaticRouteEntries(distDir, [], MODULE_PRELOADS);
      expect(readFileSync(join(distDir, 'suche/index.html'), 'utf8')).toContain('<link rel="modulepreload" href="/assets/suche-TEST.js" />');
    } finally {
      delete process.env.BUILD_BASE;
    }
  });

  it('lässt Katalog-, Gruppen- und Kontrolleinstiege ohne Preload', () => {
    const distDir = createTempDistWithIndex();
    writeStaticRouteEntries(distDir, undefined, MODULE_PRELOADS);
    for (const file of listFilesRecursive(distDir).filter((f) => f.startsWith('katalog'))) {
      expect(readFileSync(join(distDir, file), 'utf8')).not.toContain('modulepreload');
    }
  });

  it('ermittelt die Seitenchunks im Bundle über Fassadenmodul und isDynamicEntry', () => {
    const distDir = createTempDistWithIndex();
    const plugin = spaFallbackPlugin({ outDir: distDir, catalogs: [] });
    const bundle: Record<string, { type: string; fileName: string; isDynamicEntry?: boolean; facadeModuleId?: string | null }> = {
      // Kein dynamischer Einstieg: bleibt unbeachtet, auch mit passendem Fassadenmodul.
      'assets/index-A.js': { type: 'chunk', fileName: 'assets/index-A.js', isDynamicEntry: false, facadeModuleId: resolve(import.meta.dirname, LAZY_ROUTE_MODULES['/suche']) },
      'assets/other.css': { type: 'asset', fileName: 'assets/other.css' },
    };
    for (const [route, module] of Object.entries(LAZY_ROUTE_MODULES)) {
      const fileName = `assets/Seite-${route.slice(1)}-HASH.js`;
      bundle[fileName] = { type: 'chunk', fileName, isDynamicEntry: true, facadeModuleId: `${resolve(import.meta.dirname, module)}?query` };
    }
    plugin.generateBundle({}, bundle);

    plugin.closeBundle();

    expect(readFileSync(join(distDir, 'about/index.html'), 'utf8')).toContain('href="/Grundschutz-Navigator/assets/Seite-about-HASH.js"');
    expect(readFileSync(join(distDir, 'suche/index.html'), 'utf8')).toContain('href="/Grundschutz-Navigator/assets/Seite-suche-HASH.js"');
  });

  it('bricht den Build, wenn für eine zugeordnete Lazy-Route kein Chunk gefunden wird, und schreibt nichts', () => {
    const distDir = createTempDistWithIndex();
    const plugin = spaFallbackPlugin({ outDir: distDir, catalogs: [] });
    plugin.generateBundle({}, {
      'assets/x.js': { type: 'chunk', fileName: 'assets/x.js', isDynamicEntry: true, facadeModuleId: resolve(import.meta.dirname, LAZY_ROUTE_MODULES['/suche']) },
    });

    expect(() => plugin.closeBundle()).toThrow(/Kein Seitenchunk im Bundle für die Lazy-Routen: .*\/vokabular/);
    expect(listFilesRecursive(distDir)).toEqual(['index.html']);
  });

  it('bricht ohne jede Bundle-Information ab, statt den Preload still wegzulassen', () => {
    const distDir = createTempDistWithIndex();
    expect(() => spaFallbackPlugin({ outDir: distDir, catalogs: [] }).closeBundle()).toThrow(/Kein Seitenchunk/);
  });
});

describe('spaFallbackPlugin closeBundle', () => {
  it('runs only in the build, not when a dev or Vitest server closes', () => {
    expect(spaFallbackPlugin().apply).toBe('build');
  });

  it('writes SHA256SUMS last so it binds route entries, 404.html, sitemap and assets', () => {
    const distDir = createTempDistWithIndex();
    writeFileSync(join(distDir, 'favicon.svg'), '<svg/>');

    spaFallbackPlugin({ outDir: distDir, catalogs: [], modulePreloads: MODULE_PRELOADS }).closeBundle();

    const manifest = readFileSync(join(distDir, 'SHA256SUMS'), 'utf8');
    const paths = [...parseChecksumsManifest(manifest).keys()];
    expect(paths).toContain('404.html');
    expect(paths).toContain('sitemap.xml');
    expect(paths).toContain('favicon.svg');
    expect(paths).toContain('suche/index.html');
    expect(paths).not.toContain('SHA256SUMS');
    // Bindet das Manifest den Endzustand bytegenau, hat nach ihm kein
    // Schritt mehr geschrieben.
    expect(assertChecksumsManifest(distDir).fileCount).toBe(listFilesRecursive(distDir).length);
  });

  it.each([
    ['in the description', 'content="BSI-Anwenderkatalog durchsuchen \u2014 filtern'],
    ['behind a quoted look-alike attribute', 'x.y=" content=\'Sicher\'" content="BSI-Anwenderkatalog durchsuchen \u2014 filtern'],
  ])('fails the build on an em dash %s before writing the manifest (GSPP-468)', (_label, description) => {
    const distDir = createTempDistDir();
    writeFileSync(join(distDir, 'index.html'), INDEX_HTML.replace('content="BSI-Anwenderkatalog durchsuchen, filtern', description));

    expect(() => spaFallbackPlugin({ outDir: distDir, catalogs: [], modulePreloads: MODULE_PRELOADS }).closeBundle()).toThrow(/description enthält U\+2014/);
    expect(existsSync(join(distDir, 'SHA256SUMS'))).toBe(false);
  });
});
