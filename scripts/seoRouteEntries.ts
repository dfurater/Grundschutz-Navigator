import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Catalog } from '../src/domain/models.ts';
import {
  catalogDataFileName, catalogMetadataFileName, listSupportedCatalogs,
} from '../src/domain/sourceRegistry.mjs';
import { PAGE_TITLES, PRODUCT_TITLE, TITLE_ID_SEPARATOR, TITLE_PARENT_SEPARATOR } from '../src/app/pageTitles.ts';

// Die Vite-Konfiguration wird vor dem Vite-Aliashook gebündelt. Die bestehende
// Node-Brücke lädt die App-Module deshalb über ihre echten URLs und löst @/ auf.
// Vites Config-Bundler injiziert import.meta.dirname je ursprünglicher Quelldatei.
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
  /**
   * Chunk der Seite dieses Einstiegs, relativ zum Ausgabeverzeichnis
   * (`assets/<Name>.js`). Der Einstieg erhält dafür ein `modulepreload`, damit der
   * Browser den Chunk parallel zum Hauptchunk lädt (GSPP-506).
   */
  readonly modulePreload?: string;
}

// Nur erzeugte Chunk-Dateien: Der Wert fließt in ein HTML-Attribut und eine URL.
const MODULE_PRELOAD_PATH = /^assets\/[A-Za-z0-9._-]+\.js$/;

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
export function listSeoRouteMetadata(
  catalogs: readonly Catalog[],
  modulePreloads: ReadonlyMap<string, string> = new Map(),
): SeoRouteMetadata[] {
  const entries: SeoRouteMetadata[] = [
    { path: '/', title: PRODUCT_TITLE },
    ...Object.entries(STATIC_CONTENT_TITLES).map(([path, title]) => {
      const modulePreload = modulePreloads.get(path);
      return modulePreload === undefined ? { path, title } : { path, title, modulePreload };
    }),
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
            title: group.title + TITLE_PARENT_SEPARATOR + catalogTitle,
          });
        }
      }
    }
    for (const control of catalog.controls) {
      entries.push({
        path: buildControlUrlForControl(catalog.catalogKey, control),
        title: control.id + TITLE_ID_SEPARATOR + control.title + TITLE_PARENT_SEPARATOR + catalogTitle,
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

function addModulePreload(html: string, href: string): string {
  const closings = html.match(/<\/head>/gi) ?? [];
  if (closings.length !== 1) throw new Error('Expected exactly one </head> tag');
  return html.replace(/<\/head>/i, () => '  <link rel="modulepreload" href="' + escapeAttribute(href) + '" />\n  </head>');
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
      [...segment].some(character => character.codePointAt(0)! < 32)
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
    paths.push(resolve(paths.at(-1)!, segment));
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

function canonicalBaseUrl(baseUrl: string): URL {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.search || base.hash || !base.pathname.endsWith('/')) {
    throw new Error('Invalid canonical SEO base URL');
  }
  return base;
}

/** HTML-Kopf eines Einstiegs: OG-Titel und -URL, bei Lazy-Routen das `modulepreload`. */
function renderRouteEntry(template: string, entry: SeoRouteMetadata, base: URL): string {
  if (!entry.title.trim()) throw new Error('SEO title must not be empty');
  const url = new URL(entry.path.slice(1), base).href;
  const html = replaceOgTag(replaceOgTag(template, 'og:title', entry.title), 'og:url', url);
  if (entry.modulePreload === undefined) return html;
  if (!MODULE_PRELOAD_PATH.test(entry.modulePreload)) throw new Error('Unsafe module preload path');
  // Die Deployment-Basis steckt im kanonischen Basispfad (`resolveDeploymentBase()`).
  return addModulePreload(html, base.pathname + entry.modulePreload);
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
  const base = canonicalBaseUrl(baseUrl);
  for (const entry of entries) {
    const path = outputPath(root, entry.path);
    const key = pathKey(path);
    if (files.has(key)) throw new Error('SEO output path collision');
    files.set(key, { path, html: renderRouteEntry(template, entry, base) });
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
