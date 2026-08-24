import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { copyFileSync, existsSync } from 'node:fs';
import { catalogFreshnessPlugin } from './scripts/check-catalog-freshness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GITHUB_PAGES_BASE = '/Grundschutz-Navigator/';
const DIST_DIR = resolve(__dirname, 'dist');

export function writeSpaFallbackFile(outDir: string) {
  const indexHtmlPath = resolve(outDir, 'index.html');
  const fallbackHtmlPath = resolve(outDir, '404.html');

  if (!existsSync(indexHtmlPath)) {
    throw new Error(`Cannot create SPA fallback without build output at ${indexHtmlPath}`);
  }

  copyFileSync(indexHtmlPath, fallbackHtmlPath);
}

function spaFallbackPlugin() {
  return {
    name: 'github-pages-spa-fallback',
    closeBundle() {
      writeSpaFallbackFile(DIST_DIR);
    },
  };
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.BUILD_BASE ?? GITHUB_PAGES_BASE) : '/',
  plugins: [react(), tailwindcss(), catalogFreshnessPlugin(), spaFallbackPlugin()],
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
    exclude: [...configDefaults.exclude, 'src/test/browser/**/*.browser.test.ts'],
    globals: true,
    css: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
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
