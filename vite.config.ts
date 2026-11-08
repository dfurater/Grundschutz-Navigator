import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, sep } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Catalog } from './src/domain/models.ts';
import {
  STATIC_CONTENT_TITLES, listSeoRouteMetadata, loadPublicSeoCatalogs, writeSeoRouteEntries,
} from './scripts/seoRouteEntries.ts';
import { listSupportedCatalogs } from './src/domain/sourceRegistry.mjs';
import { LAZY_ROUTE_MODULES } from './src/app/lazyRouteModules.mjs';
import { catalogFreshnessPlugin } from './scripts/check-catalog-freshness.mjs';
import { checkBuiltSeoTitles } from './scripts/check-seo-titles.mjs';
import { writeChecksumsManifestFile } from './scripts/deployChecksums.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_DEPLOYMENT_BASE = '/';
const DIST_DIR = resolve(__dirname, 'dist');

/*
 * Kanonischer Routenvertrag der SEO-Einstiege (GSPP-210).
 *
 * Die Sitemap und die festen 200-Einstiege lesen ihre Routen aus der gemeinsamen
 * Titeltabelle bzw. aus dem Quellregister. GSPP-449 ergänzt die HTML-Einstiege um
 * aufgelöste Gruppen- und Kontrollrouten, ohne den Sitemapvertrag zu erweitern.
 */
const CANONICAL_CONTENT_ROUTES = Object.keys(STATIC_CONTENT_TITLES);

/**
 * Vollständige Positivliste der kanonischen Einstiegsrouten: zuerst die festen
 * Inhaltsrouten in Vertragsreihenfolge, dann je produktiv ausgeliefertem Katalog
 * ein Einstieg in Registerreihenfolge. Preview-, Draft- und
 * blocked-by-upstream-Kataloge erreichen die Liste nie, weil
 * `listSupportedCatalogs()` sie bereits aussortiert.
 */
export function listCanonicalEntryRoutes(
  catalogKeys: readonly string[] = listSupportedCatalogKeys(),
): string[] {
  return [
    ...CANONICAL_CONTENT_ROUTES,
    ...catalogKeys.map((catalogKey) => `/katalog/${encodeURIComponent(catalogKey)}`),
  ];
}

function listSupportedCatalogKeys(): string[] {
  return listSupportedCatalogs().flatMap((entry) =>
    entry.catalogKey !== undefined ? [entry.catalogKey] : [],
  );
}

export function writeSpaFallbackFile(outDir: string) {
  const indexHtmlPath = resolve(outDir, 'index.html');
  const fallbackHtmlPath = resolve(outDir, '404.html');

  if (!existsSync(indexHtmlPath)) {
    throw new Error(`Cannot create SPA fallback without build output at ${indexHtmlPath}`);
  }

  copyFileSync(indexHtmlPath, fallbackHtmlPath);
}

/**
 * Statische HTTP-200-Einstiege mit aufgelösten OG-Titeln für feste Seiten,
 * öffentliche Kataloge und deren adressierbare Gruppen und Kontrollen (GSPP-449).
 */
export function writeStaticRouteEntries(
  outDir: string,
  catalogs?: readonly Catalog[],
  modulePreloads?: ReadonlyMap<string, string>,
): void {
  const indexHtmlPath = resolve(outDir, 'index.html');
  if (!existsSync(indexHtmlPath)) {
    throw new Error(`Cannot create static route entries without build output at ${indexHtmlPath}`);
  }
  const publicCatalogs = catalogs ?? loadPublicSeoCatalogs(resolve(__dirname, 'public/data'));
  writeSeoRouteEntries(
    outDir,
    listSeoRouteMetadata(publicCatalogs, modulePreloads),
    `${CANONICAL_ORIGIN}${resolveDeploymentBase()}`,
  );
}

/**
 * Nachgelagerte Build-Ausgaben für GitHub Pages. `SHA256SUMS` entsteht als
 * letzter Schritt, damit es Routen-Einstiege, `404.html` und Sitemap bereits
 * bindet (GSPP-465); der Deploy attestiert ausschließlich dieses Manifest.
 * Davor prüft der Titelvertrag jede gebaute HTML-Datei gegen U+2014 in
 * Titel- und Meta-Texten (GSPP-468): Der Vite-Build könnte einen Titel- oder
 * Meta-Tag ändern oder duplizieren, und erst diese Prüfung sieht das
 * gebaute `dist/`-HTML statt der Quellvorlage. `apply: 'build'` hält das
 * Plugin aus Dev-Server und Vitest heraus: Vite ruft `closeBundle` auch beim
 * Schließen eines Servers auf, sonst schriebe jeder Testlauf ein vorhandenes
 * `dist/` neu.
 *
 * Jeder statische Einstieg einer Lazy-Route erhält ein `modulepreload` auf den
 * Chunk seiner Seite (GSPP-506), sodass ein Direktaufruf ihn parallel zum
 * Hauptchunk lädt. Pfade tragen die aufgelöste Deployment-Basis.
 */
export function spaFallbackPlugin(
  options: {
    outDir?: string;
    catalogs?: readonly Catalog[];
    /** Route → Seitenchunk (`assets/<Name>.js`); ohne Angabe liest das Plugin sie aus dem Bundle. */
    modulePreloads?: ReadonlyMap<string, string>;
  } = {},
) {
  const outDir = options.outDir ?? DIST_DIR;
  // Einmal je Plugin-Instanz, damit ein wiederholtes closeBundle byte-gleich schreibt.
  const buildTime = new Date();
  const foundPreloads = new Map<string, string>();
  return {
    name: 'github-pages-spa-fallback',
    apply: 'build' as const,
    // Chunk-Dateinamen tragen Hashes und stehen erst nach dem Bündeln fest. Die
    // Seitenchunks der Lazy-Routen erkennt das Plugin an ihrem Fassadenmodul, das
    // `LAZY_ROUTE_MODULES` der Route zuordnet (GSPP-506).
    generateBundle(
      _outputOptions: unknown,
      bundle: Readonly<Record<string, {
        type: string;
        fileName: string;
        isDynamicEntry?: boolean;
        facadeModuleId?: string | null;
      }>>,
    ) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk' || !item.isDynamicEntry || !item.facadeModuleId) continue;
        const facade = item.facadeModuleId.split('?')[0];
        for (const [route, module] of Object.entries(LAZY_ROUTE_MODULES)) {
          if (resolve(__dirname, module) === facade) foundPreloads.set(route, item.fileName);
        }
      }
    },
    closeBundle() {
      const modulePreloads = options.modulePreloads ?? foundPreloads;
      // Fail-closed: Eine zugeordnete Lazy-Route ohne gefundenen Chunk bricht den
      // Build, bevor etwas geschrieben wird. Still wegzulassen hieße, den Preload
      // unbemerkt zu verlieren.
      const missing = Object.keys(LAZY_ROUTE_MODULES).filter((route) => !modulePreloads.has(route));
      if (missing.length > 0) {
        throw new Error(`Kein Seitenchunk im Bundle für die Lazy-Routen: ${missing.join(', ')}`);
      }
      writeStaticRouteEntries(outDir, options.catalogs, modulePreloads);
      writeSpaFallbackFile(outDir);
      writeSitemapFile(outDir);
      writeFileSync(resolve(outDir, 'robots.txt'), [
        'User-agent: *',
        'Allow: /',
        `Sitemap: ${CANONICAL_ORIGIN}${resolveDeploymentBase()}sitemap.xml`,
        '',
      ].join('\n'), 'utf8');
      mkdirSync(resolve(outDir, '.well-known'), { recursive: true });
      writeFileSync(resolve(outDir, '.well-known', 'security.txt'), buildSecurityTxt(buildTime), 'utf8');
      checkBuiltSeoTitles(outDir);
      writeChecksumsManifestFile(outDir);
    },
  };
}

/**
 * GitHub Pages beantwortet einen Verzeichnispfad ohne abschließenden Slash mit
 * 301 auf die Slash-Variante und liefert dort `index.html` aus. `vite preview`
 * gäbe stattdessen den SPA-Fallback mit den Startseiten-Metadaten zurück; die
 * Middleware bildet die Pages-Weiterleitung für jede vorhandene Routendatei nach.
 */
export function trailingSlashRedirect(outDir: string, base: string) {
  const root = resolve(outDir);
  return (
    req: { method?: string; url?: string },
    res: { statusCode: number; setHeader(name: string, value: string): void; end(): void },
    next: () => void,
  ): void => {
    const [path, query] = (req.url ?? '').split(/\?(.*)/s, 2);
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !path.startsWith(base) || path.endsWith('/')) return next();
    let segments: string[];
    try {
      segments = decodeURIComponent(path.slice(base.length)).split('/');
    } catch {
      return next();
    }
    // Leere, Punkt- und Backslash-Segmente abweisen: Ein Pfad wie `//host/…` oder
    // `/\host` würde sonst als protokollrelative Location auf einen fremden Host zeigen.
    if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
      return next();
    }
    const target = resolve(root, ...segments, 'index.html');
    if (!target.startsWith(root + sep) || !existsSync(target)) return next();
    res.statusCode = 301;
    res.setHeader('Location', query ? `${path}/?${query}` : `${path}/`);
    res.end();
  };
}

function githubPagesPreviewPlugin() {
  return {
    name: 'github-pages-preview-redirect',
    configurePreviewServer(server: {
      config: { base: string };
      middlewares: { use(handler: ReturnType<typeof trailingSlashRedirect>): void };
    }) {
      server.middlewares.use(trailingSlashRedirect(DIST_DIR, server.config.base));
    },
  };
}

const CANONICAL_ORIGIN = 'https://gspp-navigator.furater.com';

/*
 * Der XML-Namespace des Sitemap-Protokolls ist als Identifier byte-exakt
 * `http://www.sitemaps.org/schemas/sitemap/0.9` vorgeschrieben — er ist eine
 * opaque Kennung, über die nie eine unverschlüsselte Verbindung aufgebaut
 * wird. Das http-Literal ist daher korrekt (SonarQube S5332 hier gezielt
 * unterdrückt) und das https-Pendant wäre ein protokollfremder Namespace.
 */
const SITEMAP_NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9'; // NOSONAR: opaque XML-Namespace-Kennung, kein Netzwerkzugriff

/**
 * Dieselbe aufgelöste Deployment-Basis wie die Vite-Option `base` im
 * Build-Fall (Greptile-Befund zu GSPP-231): Statische Einstiege und
 * Sitemap-URLs müssen zur tatsächlich konfigurierten Auslieferung passen,
 * auch wenn `BUILD_BASE` davon abweicht. Ein `BUILD_BASE` ohne
 * abschließenden Slash wird hier normalisiert (Greptile-Befund auf
 * PR #187): sonst verschmelzen Basispfad und Routensegment beim
 * String-Concat in `buildSitemapXml()` zu einer nicht erreichbaren URL.
 */
export function resolveDeploymentBase(): string {
  const base = process.env.BUILD_BASE ?? DEFAULT_DEPLOYMENT_BASE;
  return base.endsWith('/') ? base : `${base}/`;
}

const SECURITY_TXT_VALIDITY_MS = 364 * 24 * 60 * 60 * 1000;

/**
 * security.txt nach RFC 9116. `Expires` liegt 364 Tage nach `now`, weil §2.5.5
 * weniger als ein Jahr empfiehlt; jeder Deploy erneuert den Wert.
 */
export function buildSecurityTxt(now: Date): string {
  const expires = new Date(now.getTime() + SECURITY_TXT_VALIDITY_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return [
    'Contact: https://github.com/dfurater/Grundschutz-Navigator/security/advisories/new',
    `Expires: ${expires}`,
    'Preferred-Languages: de, en',
    `Canonical: ${CANONICAL_ORIGIN}${resolveDeploymentBase()}.well-known/security.txt`,
    'Policy: https://github.com/dfurater/Grundschutz-Navigator/blob/main/SECURITY.md',
    '',
  ].join('\n');
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Deterministische Sitemap der kanonischen Einstiegsseiten (GSPP-231): die
 * Startseite plus exakt die Routen aus demselben Vertrag wie die statischen
 * 200-Einstiege von GSPP-210 — dadurch kann keine der beiden Listen driftet.
 * Nur die Pflichtfelder des Sitemap-Protokolls (`urlset`, `url`, `loc`); auf
 * unbelegte optionale Felder (`lastmod`, `changefreq`, `priority`) wird
 * bewusst verzichtet. Pfade müssen vertragsseitig URL-pfadkonform sein
 * (`listCanonicalEntryRoutes()` kodiert die Katalogschlüssel bereits),
 * XML-Sonderzeichen werden hier escaped.
 */
export function buildSitemapXml(
  options: { origin?: string; basePath?: string; routes?: readonly string[] } = {},
): string {
  const origin = options.origin ?? CANONICAL_ORIGIN;
  const basePath = options.basePath ?? resolveDeploymentBase();
  const routes = options.routes ?? ['/', ...listCanonicalEntryRoutes()];
  const baseUrl = `${origin}${basePath}`;

  const urlEntries = routes.map((route) => {
    const loc = escapeXml(`${baseUrl}${route.slice(1)}${route.endsWith('/') ? '' : '/'}`);
    return `  <url><loc>${loc}</loc></url>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<urlset xmlns="${SITEMAP_NAMESPACE}">`,
    ...urlEntries,
    '</urlset>',
    '',
  ].join('\n');
}

/** Schreibt die Sitemap byte-deterministisch nach `dist/sitemap.xml`. */
export function writeSitemapFile(outDir: string): void {
  writeFileSync(resolve(outDir, 'sitemap.xml'), buildSitemapXml());
}

export default defineConfig(({ command, isPreview }) => ({
  // Die Vorschau bedient `dist/` unter derselben Basis, mit der es gebaut wurde.
  base: command === 'build' || isPreview ? resolveDeploymentBase() : '/',
  plugins: [react(), tailwindcss(), catalogFreshnessPlugin(), spaFallbackPlugin(), githubPagesPreviewPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  /*
   * Der OSCAL-Import-Worker wird als Modul-Worker erzeugt (`type: 'module'`).
   * Ohne dieses Format baut Vite ihn als IIFE, und ein IIFE kann nicht
   * code-splitten: Alle 30 gepinnten Schemas (2,83 MiB) lägen dann in einer
   * einzigen Worker-Datei und würden bei jedem Import geladen. Mit `es` bleibt
   * je Matrixzelle ein eigener Chunk, und Stufe 3 lädt nur die ausgewählte
   * Zelle.
   */
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    globalSetup: ['./scripts/check-catalog-freshness.mjs'],
    setupFiles: ['./src/test-setup.ts'],
    // Die QA-Lane des Round-trip-Harnischs (`*.qa.test.ts`, GSPP-298) läuft
    // bewusst IM regulären Lauf mit — ein Ausschluss wäre eine Abschwächung.
    // Gezielt einzeln: `npm run test:qa`.
    // Der Bauzeitlauf der Profile Resolution (GSPP-291) läuft ausschließlich
    // als eigener Workflow-Schritt nach `npm run fetch-catalog`
    // (`npm run test:profile-resolution`) und scheitert dort hart ohne
    // Korpus-Cache; im Default-Lauf hätte er die Daten nie garantiert.
    exclude: [
      ...configDefaults.exclude,
      '**/.worktrees/**',
      'src/test/browser/**/*.browser.test.ts',
      'scripts/profileResolutionCorpus.test.ts',
    ],
    globals: true,
    css: true,
    coverage: {
      provider: 'v8',
      // Vitest-Default plus `lcov`: SonarQube Cloud liest die Testabdeckung
      // ausschliesslich aus coverage/lcov.info (GSPP-404). Die uebrigen vier
      // Reporter bleiben unveraendert, damit Konsolenausgabe, HTML-Report,
      // clover.xml und coverage-final.json erhalten bleiben.
      reporter: ['text', 'html', 'clover', 'json', 'lcov'],
      include: ['src/**/*.{ts,tsx,mjs}'],
      exclude: [
        'src/**/*.test.*',
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/test/browser/**',
        'src/test-setup.ts',
        'src/vite-env.d.ts',
      ],
      thresholds: {
        lines: 87,
        branches: 77,
        functions: 88,
        statements: 85,
        /*
         * `autoUpdate` bewusst NICHT gesetzt (Vitest-Default: false). Der
         * Formatter bekommt von Vitest ausschliesslich den gemessenen Rohwert -
         * nicht den bisherigen Threshold, nicht die Metrik, nicht den Bucket.
         * Ein fixer Puffer-Abzug (z. B. -5) ist damit nicht sicher: Liegt die
         * Messung weniger als der Abzugsbetrag ueber dem bestehenden Gate,
         * senkt ein gruener Lauf das Gate (verifiziert reproduziert: Gate 92,
         * Messung 93.04 -> faelschlich 88 geschrieben). Ein reines `Math.floor`
         * ohne Abzug waere zwar nachweislich monoton (Schreibpfad ruft den
         * Formatter nur bei `actual > threshold` auf, jeder Threshold ist
         * ganzzahlig, also folgt floor(actual) >= threshold) - aber genau
         * dieser Test hat den kompletten 5-Punkte-Puffer aller Werte unten in
         * einem einzigen Lauf auf den exakten Messwert abgeschmolzen, weil
         * "gemessen > gepuffertes Gate" bei einem gepufferten Threshold immer
         * zutrifft. Mit Vitests zustandslosem Formatter (nur der Messwert, kein
         * Zugriff auf den Ist-Threshold) ist "puffert" und "senkt nie ab"
         * strukturell nicht gleichzeitig erreichbar. Threshold-Pflege bleibt
         * deshalb manuell, mit demselben "gemessen - 5 Punkte"-Muster wie hier.
         */
        'src/domain/**': {
          lines: 86,
          branches: 70,
          functions: 91,
          statements: 82,
        },
        'src/adapters/**': {
          lines: 94,
          branches: 92,
          functions: 95,
          statements: 94,
        },
      },
    },
  },
}));
