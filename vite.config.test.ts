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
import { afterEach, describe, expect, it } from 'vitest';
import {
  listCanonicalEntryRoutes,
  writeSpaFallbackFile,
  writeStaticRouteEntries,
} from './vite.config';

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
