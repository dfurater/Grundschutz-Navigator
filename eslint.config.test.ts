import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

async function lint(source: string, filePath: string) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages;
}

describe('ESLint architecture boundaries', () => {
  it.each([
    '@/features/export/csvExport',
    '@/domain/controlRelationships',
  ])('rejects %s imports in CatalogBrowser', async (restrictedImport) => {
    const messages = await lint(
      `import '${restrictedImport}';`,
      'src/features/catalog/CatalogBrowser.tsx',
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'no-restricted-imports',
          severity: 2,
        }),
      ]),
    );
  });

  it('rejects direct document.body access in UI layers', async () => {
    const messages = await lint(
      "document.body.style.overflow = 'hidden';",
      'src/features/catalog/SampleOverlay.tsx',
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'no-restricted-properties',
          severity: 2,
        }),
      ]),
    );
  });

  it.each([
    'src/hooks/useSample.ts',
    'src/adapters/browserDownload.ts',
  ])('allows document.body access in %s', async (filePath) => {
    const messages = await lint("document.body.dataset.test = 'true';", filePath);

    expect(messages.filter(({ ruleId }) => ruleId === 'no-restricted-properties')).toEqual([]);
  });

  it('reports imperative UI listeners as warnings', async () => {
    const messages = await lint(
      "window.addEventListener('resize', () => undefined);",
      'src/components/Sample.tsx',
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'no-restricted-syntax',
          severity: 1,
        }),
      ]),
    );
  });

  it('reports source files above 300 physical lines as warnings', async () => {
    const messages = await lint(
      ['export {};', ...Array<string>(300).fill('// line')].join('\n'),
      'src/domain/LongModule.ts',
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'max-lines',
          severity: 1,
        }),
      ]),
    );
  });
});
