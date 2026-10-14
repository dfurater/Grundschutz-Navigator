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

describe('Gestaltungssystem-Regel (GSPP-533)', () => {
  const RULE = 'design-system/no-off-system-classes';

  async function designFindings(classes: string, filePath = 'src/components/Sample.tsx') {
    const messages = await lint(`export const c = ${JSON.stringify(classes)};`, filePath);
    return messages.filter(({ ruleId }) => ruleId === RULE);
  }

  it.each([
    ['Literal-Wert', 'text-[13px]', 'arbitraryValue'],
    ['Literal-Wert mit Variante', 'md:h-[51px]', 'arbitraryValue'],
    ['Arbitrary Property', '[overflow-wrap:anywhere]', 'arbitraryProperty'],
    ['Schatten außerhalb des Vokabulars', 'shadow-lg', 'shadow'],
    ['Schatten ohne Stufe', 'shadow', 'shadow'],
    ['Radius außerhalb der Skala', 'rounded-2xl', 'radius'],
    ['Radius einer Ecke außerhalb der Skala', 'rounded-tl-xl', 'radius'],
    ['Schriftgröße außerhalb der sechs Stufen', 'text-2xl', 'fontSize'],
    ['Verlauf', 'bg-linear-to-r', 'gradient'],
    ['Hintergrundfilter', 'backdrop-blur-sm', 'backdrop'],
    ['Hover-Deckkraft', 'hover:opacity-80', 'hoverOpacity'],
    ['Hover-Deckkraft über die Gruppe', 'group-hover:opacity-60', 'hoverOpacity'],
    ['rohe Zeilenhöhe im Modifier', 'text-lg/[1.35]', 'arbitraryValue'],
    ['rohe Deckkraft im Modifier', 'bg-black/[0.37]', 'arbitraryValue'],
    ['Schlagschatten-Filter', 'drop-shadow-lg', 'shadow'],
    ['Innenschatten', 'inset-shadow-sm', 'shadow'],
    ['Textschatten', 'text-shadow-md', 'shadow'],
    ['Radialverlauf ohne Stufe', 'bg-radial', 'gradient'],
    ['Verlauf über Tokens', 'bg-[linear-gradient(var(--color-a),var(--color-b))]', 'gradient'],
    ['Hintergrundfilter über Token', 'backdrop-blur-[var(--radius-lg)]', 'backdrop'],
    ['Schatten über Token außerhalb des Vokabulars', 'drop-shadow-[var(--shadow-overlay)]', 'shadow'],
    ['Hover-Deckkraft mit Modifier', 'hover:opacity-50/50', 'hoverOpacity'],
  ])('meldet %s (%s) als Fehler', async (_label, classes, messageId) => {
    expect(await designFindings(`p-4 ${classes}`)).toEqual([
      expect.objectContaining({ ruleId: RULE, severity: 2, messageId }),
    ]);
  });

  it.each([
    ['Token über var()', 'text-[var(--color-text-primary)] shadow-[var(--shadow-overlay)]'],
    ['Token-Utilities', 'min-h-touch h-panel-head shadow-footer shadow-sm shadow-overlay text-2xs text-xl text-lg/title rounded rounded-lg rounded-full tracking-wide'],
    ['Modifier mit Token oder Skalenwert', 'bg-black/50 text-sm/[var(--leading-title)] w-1/2'],
    ['Spaltenvorlage', 'grid-cols-[auto_1fr] sm:grid-rows-[3.5rem_1fr]'],
    ['Pseudo-Element-Inhalt', "after:content-[''] after:content-[attr(data-label)]"],
    ['Übergangsliste', 'transition-[rotate,color]'],
    ['sichere Fläche', 'pb-[calc(7rem+env(safe-area-inset-bottom,0px))]'],
    ['Viewport-Maß', 'min-h-[50vh] max-h-[calc(100dvh-8rem)]'],
    ['Deckkraft ohne Hover', 'opacity-0 peer-checked:opacity-100 disabled:opacity-50'],
    ['Varianten mit Klammern', 'data-[state=open]:block @min-[18.5rem]:flex'],
    ['Attributselektor', '[data-tooltip-root]'],
  ])('erlaubt %s', async (_label, classes) => {
    expect(await designFindings(classes)).toEqual([]);
  });

  it('prüft auch Template-Literale', async () => {
    const messages = await lint('export const c = `p-4 ${String(1)} rounded-3xl`;', 'src/features/catalog/Sample.tsx');

    expect(messages.filter(({ ruleId }) => ruleId === RULE)).toEqual([
      expect.objectContaining({ messageId: 'radius' }),
    ]);
  });

  it.each([
    'src/features/catalog/Sample.test.tsx',
    'src/domain/sample.ts',
  ])('gilt nicht für %s', async (filePath) => {
    expect(await designFindings('text-[13px] shadow-lg', filePath)).toEqual([]);
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
