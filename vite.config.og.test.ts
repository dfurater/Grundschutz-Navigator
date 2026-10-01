// @vitest-environment node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { writeStaticRouteEntries } from './vite.config';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it('delivers the search OG title and canonical URL in HTML without running JavaScript', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gspp-og-integration-'));
  directories.push(directory);
  writeFileSync(join(directory, 'index.html'), readFileSync(new URL('./index.html', import.meta.url)));

  writeStaticRouteEntries(directory, []);

  const html = readFileSync(join(directory, 'suche/index.html'), 'utf8');
  expect(html).toContain('<meta property="og:title" content="Suche" />');
  expect(html).toContain('<meta property="og:url" content="https://dfurater.github.io/Grundschutz-Navigator/suche" />');
});
