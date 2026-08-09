import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
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
  test: {
    name: 'browser-chromium',
    include: ['src/test/browser/**/*.browser.test.ts'],
    setupFiles: ['./src/test/browser/browserSetup.ts'],
    globals: true,
    browser: {
      enabled: true,
      headless: true,
      ui: false,
      isolate: false,
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
