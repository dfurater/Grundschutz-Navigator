import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { copyFileSync, existsSync } from 'fs';

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
  plugins: [react(), tailwindcss(), spaFallbackPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: true,
    css: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.*',
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/test-setup.ts',
        'src/vite-env.d.ts',
      ],
      thresholds: {
        lines: 8,
        branches: 49,
        functions: 35,
        statements: 8,
      },
    },
  },
}));
