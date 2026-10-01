import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Catalog } from '../src/domain/models.ts';
import {
  catalogDataFileName, catalogMetadataFileName, listSupportedCatalogs,
} from '../src/domain/sourceRegistry.mjs';
import { PAGE_TITLES, PRODUCT_TITLE } from '../src/app/pageTitles.ts';

// Die Vite-Konfiguration wird vor dem Vite-Aliashook gebündelt. Die bestehende
// Node-Brücke lädt die App-Module deshalb über ihre echten URLs und löst @/ auf.
const { registerAliasHook }: { registerAliasHook(): void } = await import(
  pathToFileURL(resolve(import.meta.dirname, 'oscal-domain-bridge.mjs')).href
);
registerAliasHook();
const { parseCatalog }: typeof import('../src/adapters/oscalAdapter') = await import(
  pathToFileURL(resolve(import.meta.dirname, '../src/adapters/oscalAdapter.ts')).href
);
const { buildCatalogUrl, buildControlUrlForControl, buildGroupUrl }: typeof import('../src/app/routes') = await import(
  pathToFileURL(resolve(import.meta.dirname, '../src/app/routes.ts')).href
);

/** Gemeinsamer Vertrag der festen SEO-Einstiege und ihrer inhaltsbezogenen Titel. */
export const STATIC_CONTENT_TITLES = {
  '/suche': PAGE_TITLES.search,
  '/vokabular': PAGE_TITLES.vocabularies,
  '/about': PAGE_TITLES.about,
  '/datenschutz': PAGE_TITLES.privacy,
  '/impressum': PAGE_TITLES.imprint,
  '/lizenzen': PAGE_TITLES.licenses,
} as const;

export interface SeoRouteMetadata {
  readonly path: string;
  readonly title: string;
}

/** Nur registry-benannte öffentliche Dateien; Hashprüfung vor der Domain-Projektion. */
export function loadPublicSeoCatalogs(dataDir: string): Catalog[] {
  return listSupportedCatalogs().map(entry => {
    const catalogKey = entry.catalogKey;
    if (!catalogKey) throw new Error('Supported SEO catalog is missing its catalogKey');
    const bytes = readFileSync(resolve(dataDir, catalogDataFileName(entry)));
    const metadata = JSON.parse(
      readFileSync(resolve(dataDir, catalogMetadataFileName(entry)), 'utf8'),
    ) as { integrity?: { sha256?: unknown } } | null;
    const expectedHash = metadata?.integrity?.sha256;
    if (
      typeof expectedHash !== 'string' ||
      createHash('sha256').update(bytes).digest('hex') !== expectedHash
    ) {
      throw new Error('SEO catalog integrity check failed for ' + catalogKey);
    }
    const document = JSON.parse(bytes.toString('utf8')) as { catalog?: unknown } | null;
    return parseCatalog(document?.catalog, { catalogKey });
  });
}

/** Gleiche Catalog-Projektion und URL-Builder wie die App; kein zweiter OSCAL-Reader. */
export function listSeoRouteMetadata(catalogs: readonly Catalog[]): SeoRouteMetadata[] {
  const entries: SeoRouteMetadata[] = [
    { path: '/', title: PRODUCT_TITLE },
    ...Object.entries(STATIC_CONTENT_TITLES).map(([path, title]) => ({ path, title })),
  ];
  const supportedKeys = new Set(listSupportedCatalogs().map(entry => entry.catalogKey));
  for (const catalog of catalogs) {
    if (!supportedKeys.has(catalog.catalogKey)) {
      throw new Error('SEO catalog is not supported for public delivery');
    }
    const catalogTitle = catalog.metadata.title;
    entries.push({ path: buildCatalogUrl(catalog.catalogKey), title: catalogTitle });
    for (const practice of catalog.practices) {
      for (const group of [practice, ...practice.topics]) {
        if (group.id) {
          entries.push({
            path: buildGroupUrl(catalog.catalogKey, group.id),
            title: group.title + ' — ' + catalogTitle,
          });
        }
      }
    }
    for (const control of catalog.controls) {
      entries.push({
        path: buildControlUrlForControl(catalog.catalogKey, control),
        title: control.id + ' — ' + control.title + ' — ' + catalogTitle,
      });
    }
  }
  return entries;
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function replaceOgTag(html: string, property: 'og:title' | 'og:url', value: string): string {
  const tags = (html.match(/<meta\b[^>]*>/gi) ?? []).filter(
    tag => tag.includes('property="' + property + '"') || tag.includes("property='" + property + "'"),
  );
  if (tags.length !== 1) throw new Error('Expected exactly one ' + property + ' meta tag');
  const replacement = '<meta property="' + property + '" content="' + escapeAttribute(value) + '" />';
  return html.replace(tags[0], () => replacement);
}

function outputPath(outDir: string, route: string): string {
  if (route === '/') return resolve(outDir, 'index.html');
  if (!route.startsWith('/') || route.includes('?') || route.includes('#')) {
    throw new Error('Unsafe SEO route');
  }
  const segments = route.slice(1).split('/').map(segment => decodeURIComponent(segment));
  for (const segment of segments) {
    if (
      !segment || segment === '.' || segment === '..' ||
      segment.includes('/') || segment.includes('\\') ||
      [...segment].some(character => character.charCodeAt(0) < 32)
    ) {
      throw new Error('Unsafe SEO route segment');
    }
  }
  const target = resolve(outDir, ...segments, 'index.html');
  if (!target.startsWith(outDir + sep)) throw new Error('SEO output path escapes the build directory');
  return target;
}

function pathKey(path: string): string {
  // Auch auf macOS dürfen sich zwei öffentliche URLs keine Ausgabedatei teilen.
  return path.normalize('NFC').toLowerCase();
}

function assertExistingPath(outDir: string, target: string): void {
  const paths = [outDir];
  for (const segment of relative(outDir, target).split(sep)) {
    paths.push(resolve(paths[paths.length - 1], segment));
  }
  for (const path of paths) {
    let stat;
    try {
      stat = lstatSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error('SEO output path contains a symlink');
    if (path !== target && !stat.isDirectory()) throw new Error('SEO output path collision');
    if (path === target && !stat.isFile()) throw new Error('SEO output path collision');
  }
}

/** Alle HTML-Köpfe und Pfade vorbereiten und prüfen, bevor die erste Datei entsteht. */
export function writeSeoRouteEntries(
  outDir: string,
  entries: readonly SeoRouteMetadata[],
  baseUrl: string,
): void {
  const root = resolve(outDir);
  const indexPath = resolve(root, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error('Cannot create static route entries without build output at ' + indexPath);
  }
  assertExistingPath(root, indexPath);
  const template = readFileSync(indexPath, 'utf8');
  const files = new Map<string, { path: string; html: string }>();
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.search || base.hash || !base.pathname.endsWith('/')) {
    throw new Error('Invalid canonical SEO base URL');
  }
  for (const entry of entries) {
    const path = outputPath(root, entry.path);
    const key = pathKey(path);
    if (files.has(key)) throw new Error('SEO output path collision');
    if (!entry.title.trim()) throw new Error('SEO title must not be empty');
    const url = new URL(entry.path.slice(1), base).href;
    const html = replaceOgTag(replaceOgTag(template, 'og:title', entry.title), 'og:url', url);
    files.set(key, { path, html });
  }
  for (const { path } of files.values()) {
    assertExistingPath(root, path);
    for (let parent = dirname(path); parent !== root; parent = dirname(parent)) {
      if (files.has(pathKey(parent))) throw new Error('SEO output path collision');
    }
  }
  for (const { path, html } of files.values()) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, html, 'utf8');
  }
}
