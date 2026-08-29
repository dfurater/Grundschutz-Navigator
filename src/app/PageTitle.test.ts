import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PageTitle deployment contract', () => {
  it('leaves the document title to the declarative React title source', () => {
    const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

    expect(indexHtml).not.toMatch(/<title(?:\s|>)/i);
  });
});
