import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Eigene Lane für den verpflichtenden Bauzeitlauf der Profile Resolution
 * (GSPP-291): Er läuft ausschließlich als Workflow-Schritt nach
 * `npm run fetch-catalog` und scheitert hart ohne Korpus-Cache. Die
 * Basis-Konfiguration schließt die Datei deshalb aus dem Default-Lauf aus;
 * diese Konfiguration öffnet sie gezielt.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '../src'),
    },
  },
  test: {
    environment: 'node',
    include: ['scripts/profileResolutionCorpus.test.ts'],
  },
});
