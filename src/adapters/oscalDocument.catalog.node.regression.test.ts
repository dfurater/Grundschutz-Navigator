// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const catalogPathEnvironmentVariable = 'GSPP_CATALOG_CORPUS_PATH';
const catalogCorpusTestPath = resolve('src/adapters/oscalDocument.catalog.node.test.ts');
const vitestEntryPoint = resolve('node_modules/vitest/vitest.mjs');
const ansiCsiSequence = new RegExp(`${String.fromCodePoint(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

function stripAnsiSequences(value: string): string {
  return value.replace(ansiCsiSequence, '');
}

describe('Katalogkorpus — Abwesenheitsregression', () => {
  it('normalisiert ANSI-formatierte Kindprozessausgabe', () => {
    expect(stripAnsiSequences('\u001B[1mTests  1 passed | 9 skipped (10)\u001B[0m')).toBe(
      'Tests  1 passed | 9 skipped (10)',
    );
  });

  it('registriert den übersprungenen Korpus ohne katalog.json', async () => {
    const fixtureDirectory = await mkdtemp(join(tmpdir(), 'gspp-catalog-corpus-'));
    const missingCatalogPath = join(fixtureDirectory, 'catalog.json');

    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [vitestEntryPoint, 'run', catalogCorpusTestPath],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            FORCE_COLOR: '1',
            [catalogPathEnvironmentVariable]: missingCatalogPath,
          },
        },
      );

      expect(stderr).not.toContain('ENOENT');
      expect(stripAnsiSequences(stdout)).toContain('Tests  1 passed | 9 skipped (10)');
    } finally {
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  });
});
