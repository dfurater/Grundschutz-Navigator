// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import { writeSpaFallbackFile } from './vite.config';

const tempDirs: string[] = [];

function createTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'gspp-spa-fallback-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe('writeSpaFallbackFile', () => {
  it('copies the built index.html to 404.html for GitHub Pages deep links', () => {
    const distDir = createTempDir();
    const indexHtmlPath = join(distDir, 'index.html');
    const indexHtml = '<!doctype html><html><body><script type="module" src="/Grundschutz-Navigator/assets/app.js"></script></body></html>';

    writeFileSync(indexHtmlPath, indexHtml);

    writeSpaFallbackFile(distDir);

    expect(readFileSync(join(distDir, '404.html'), 'utf8')).toBe(indexHtml);
  });

  it('fails safely when the build output is missing', () => {
    const distDir = createTempDir();

    expect(() => writeSpaFallbackFile(distDir)).toThrow(
      `Cannot create SPA fallback without build output at ${join(distDir, 'index.html')}`,
    );
  });
});
