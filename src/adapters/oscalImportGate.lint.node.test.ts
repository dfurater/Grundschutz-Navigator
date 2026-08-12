// @vitest-environment node

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('Klasse-2-Markup-Grenze', () => {
  it.each([
    'src/test-fixture/UnsafeMarkup.tsx',
    'src/components/UnsafeMarkup.tsx',
  ])('verbietet dangerouslySetInnerHTML in %s', async (filePath) => {
    const eslint = new ESLint({ cwd: process.cwd() });

    const [result] = await eslint.lintText(
      'export const Unsafe = () => <div dangerouslySetInnerHTML={{ __html: "<script>" }} />;',
      { filePath },
    );

    expect(result!.errorCount).toBe(1);
    expect(result!.messages[0]?.message).toContain('dangerouslySetInnerHTML');
  });
});
