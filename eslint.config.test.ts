import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { createEslintWithoutTypes, TYPE_AWARE_RULES } from './src/test/eslintWithoutTypes';

const eslint = new ESLint({ cwd: process.cwd() });
const eslintWithoutTypes = createEslintWithoutTypes();

async function lint(source: string, filePath: string) {
  const [result] = await eslintWithoutTypes.lintText(source, { filePath });
  // Ohne diese Prüfung bestünden die Erlaubt-Tests auch dann, wenn die Datei
  // gar nicht geparst wurde und keine Regel lief.
  expect(result.messages.filter(({ fatal }) => fatal)).toEqual([]);
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

describe('Type-aware Promise-Gate (GSPP-199)', () => {
  it.each([
    'src/domain/integrity.ts',
    'src/features/catalog/ControlTable.tsx',
  ])('aktiviert den Project Service und beide Regeln als Fehler für %s', async (filePath) => {
    const config = await eslint.calculateConfigForFile(filePath);

    expect(config.languageOptions.parserOptions.projectService).toBe(true);
    for (const rule of TYPE_AWARE_RULES) {
      expect(config.rules[rule]).toEqual([2]);
    }
  });

  it('prüft Fehl-await auch in Tests, nicht aber schwebende Promises', async () => {
    const config = await eslint.calculateConfigForFile('src/domain/integrity.test.ts');

    expect(config.rules['@typescript-eslint/await-thenable']).toEqual([2]);
    expect(config.rules['@typescript-eslint/no-floating-promises']).toEqual([0]);
  });
});
