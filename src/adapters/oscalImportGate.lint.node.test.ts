// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createEslintWithoutTypes } from '@/test/eslintWithoutTypes';

describe('Klasse-2-Markup-Grenze', () => {
  it.each([
    'src/test-fixture/UnsafeMarkup.tsx',
    'src/components/UnsafeMarkup.tsx',
  ])('verbietet dangerouslySetInnerHTML in %s', async (filePath) => {
    const eslint = createEslintWithoutTypes();

    const [result] = await eslint.lintText(
      'export const Unsafe = () => <div dangerouslySetInnerHTML={{ __html: "<script>" }} />;',
      { filePath },
    );

    expect(result!.errorCount).toBe(1);
    expect(result!.messages[0]?.message).toContain('dangerouslySetInnerHTML');
  });
});
