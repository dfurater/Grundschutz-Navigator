import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PageTitle deployment contract', () => {
  it('provides a marked product-title fallback before React starts', () => {
    const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

    expect(indexHtml).toContain(
      '<title data-page-title-fallback>Grundschutz++ Navigator</title>',
    );
  });
});
