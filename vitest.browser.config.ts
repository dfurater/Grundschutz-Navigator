import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  assertNoBrowserEgress,
  getBrowserEgressEnforcements,
  installBrowserEgressGuard,
  resetBrowserEgressGuard,
} from './src/test/browser/browserEgressGuard.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  /*
   * `ajv` wird von der Schemaprüfung erst zur Laufzeit importiert. Ohne diesen
   * Eintrag entdeckt Vite die Abhängigkeit mitten im Lauf, optimiert sie neu
   * und lädt den Testframe neu; unter Vitest 5 verliert die gerade importierte
   * Datei dabei ihren Suite-Kontext und scheitert mit „Vitest failed to find
   * the current suite" (reproduziert in CI an
   * `egressOracle.negative.browser.test.ts`). Vorab-Optimierung nimmt dem
   * Reload den Anlass.
   */
  optimizeDeps: {
    include: ['ajv'],
  },
  test: {
    name: 'browser-chromium',
    include: ['src/test/browser/**/*.browser.test.ts'],
    setupFiles: ['./src/test/browser/browserSetup.ts'],
    globals: true,
    isolate: false,
    browser: {
      enabled: true,
      headless: true,
      ui: false,
      provider: playwright({
        launchOptions: {
          channel: 'chromium',
        },
      }),
      instances: [{ browser: 'chromium' }],
      commands: {
        installBrowserEgressGuard,
        resetBrowserEgressGuard,
        assertNoBrowserEgress,
        getBrowserEgressEnforcements,
      },
    },
  },
});
