import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ESLint } from 'eslint';
import { compile } from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { createEslintWithoutTypes, TYPE_AWARE_RULES } from './src/test/eslintWithoutTypes';

const eslint = new ESLint({ cwd: process.cwd() });
const eslintWithoutTypes = createEslintWithoutTypes();

/**
 * Setzt einen Wert als JS-String-Literal in Testquelltext ein. `<`, `>`, `/`
 * und die Zeilentrenner U+2028/U+2029 stehen als Unicode-Escape, damit der
 * Wert den umgebenden Quelltext nicht beenden kann.
 */
function jsStringLiteral(value: string) {
  return JSON.stringify(value).replace(
    /[<>/\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

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

const RULE = 'design-system/no-off-system-classes';

// Gültige Tailwind-Syntax, die einen verbotenen Effekt erzeugt: `!important`
// hinter Varianten, benannte und zusammengesetzte Hover-Varianten, Deckkraft
// als Arbitrary Property oder Variablen-Kurzform, Arbitrary Properties mit
// Ziffer, Großbuchstaben oder Herstellerpräfix im Namen und mit Modifier. `css` sind Ausschnitte des
// CSS, das Tailwind mit `src/index.css` für die Klasse erzeugt.
const BYPASS_FORMS = [
  { label: 'Rohschatten mit Safe Area', classes: 'shadow-[0_0_env(safe-area-inset-top)_red]', messageId: 'arbitraryValue', css: ['--tw-shadow:', 'env(safe-area-inset-top)'] },
  { label: 'Rohmaß neben Safe Area', classes: 'pb-[calc(13px+env(safe-area-inset-bottom))]', messageId: 'arbitraryValue', css: ['padding-bottom: calc(13px + env(safe-area-inset-bottom))'] },
  { label: 'Rohfarbe im Safe-Area-Fallback', classes: 'bg-[env(safe-area-inset-top,red)]', messageId: 'arbitraryValue', css: ['background-color: env(safe-area-inset-top,red)'] },
  { label: 'Rohmaß im Safe-Area-Fallback', classes: 'pb-[env(safe-area-inset-bottom,13px)]', messageId: 'arbitraryValue', css: ['padding-bottom: env(safe-area-inset-bottom,13px)'] },

  { label: 'Rohschriftgröße vor Safe-Area-Modifier', classes: 'text-[13px]/[var(--leading-title,env(safe-area-inset-top))]', messageId: 'arbitraryValue', css: ['font-size: 13px', 'line-height: var(--leading-title,env(safe-area-inset-top))'] },
  { label: 'Rohe Zeilenhöhe nach Safe-Area-Basiswert', classes: 'text-[length:var(--text-sm,env(safe-area-inset-top))]/[1.37]', messageId: 'arbitraryValue', css: ['font-size: var(--text-sm,env(safe-area-inset-top))', 'line-height: 1.37'] },

  { label: 'Hover-Deckkraft mit Important-Präfix', classes: 'hover:!opacity-50', messageId: 'hoverOpacity', css: [':hover', 'opacity: 50% !important'] },
  { label: 'Hover-Deckkraft mit Important-Suffix', classes: 'hover:opacity-50!', messageId: 'hoverOpacity', css: [':hover', 'opacity: 50% !important'] },
  { label: 'Hintergrundfilter mit Important hinter Variante', classes: 'md:!backdrop-blur-sm', messageId: 'backdrop', css: ['backdrop-filter:', '!important'] },
  { label: 'Hintergrundfilter mit Important-Suffix', classes: 'md:backdrop-blur-sm!', messageId: 'backdrop', css: ['backdrop-filter:', '!important'] },
  { label: 'Schlagschatten mit Important hinter Variante', classes: 'hover:!drop-shadow-[var(--x)]', messageId: 'shadow', css: [':hover', 'drop-shadow(var(--x)) !important'] },
  { label: 'Hover-Deckkraft über benannte Gruppe', classes: 'group-hover/card:opacity-50', messageId: 'hoverOpacity', css: [':where(.group\\/card):hover', 'opacity: 50%'] },
  { label: 'Hover-Deckkraft über benannten Peer', classes: 'peer-hover/name:opacity-50', messageId: 'hoverOpacity', css: [':where(.peer\\/name):hover', 'opacity: 50%'] },
  { label: 'Hover-Deckkraft über Vorfahren', classes: 'in-hover:opacity-50', messageId: 'hoverOpacity', css: [':where(:hover)', 'opacity: 50%'] },
  { label: 'Hover-Deckkraft über beliebige Variante', classes: '[&:hover]:opacity-50', messageId: 'hoverOpacity', css: [':hover', 'opacity: 50%'] },
  { label: 'Hover-Deckkraft über Variablen-Kurzform', classes: 'hover:opacity-(--x)', messageId: 'hoverOpacity', css: [':hover', 'opacity: var(--x)'] },
  { label: 'Hover-Deckkraft als Arbitrary Property', classes: 'hover:[opacity:var(--x)]', messageId: 'hoverOpacity', css: [':hover', 'opacity: var(--x)'] },
  { label: 'Hover-Deckkraft als Arbitrary Property mit Important', classes: 'group-hover/card:![opacity:var(--x)]', messageId: 'hoverOpacity', css: [':hover', 'opacity: var(--x) !important'] },
  { label: 'Schatten als Arbitrary Property mit Important', classes: 'hover:![box-shadow:var(--x)]', messageId: 'shadow', css: [':hover', 'box-shadow: var(--x) !important'] },
  { label: 'Rohfarbe in benutzerdefinierter Eigenschaft mit Ziffer', classes: '[--color-effort-dot-1:#ff0000]', messageId: 'arbitraryProperty', css: ['--color-effort-dot-1: #ff0000'] },
  { label: 'Schatten mit Herstellerpräfix', classes: '[-webkit-box-shadow:var(--x)]', messageId: 'shadow', css: ['-webkit-box-shadow: var(--x)'] },
  { label: 'Schlagschatten-Filter mit Herstellerpräfix', classes: '[-webkit-filter:drop-shadow(var(--x))]', messageId: 'shadow', css: ['-webkit-filter: drop-shadow(var(--x))'] },
  { label: 'Schatten mit Großbuchstaben im Namen', classes: '[bOx-shadow:var(--x)]', messageId: 'shadow', css: ['bOx-shadow: var(--x)'] },
  { label: 'Hover-Deckkraft mit Großbuchstaben im Namen', classes: 'hover:[opaCity:var(--x)]', messageId: 'hoverOpacity', css: [':hover', 'opaCity: var(--x)'] },
  { label: 'Rohfarbe als Arbitrary Property mit Modifier', classes: '[color:red]/50', messageId: 'arbitraryProperty', css: ['color: color-mix(in oklab, red 50%, transparent)'] },
  { label: 'Schatten als Arbitrary Property mit Modifier', classes: '[box-shadow:var(--x)]/50', messageId: 'shadow', css: ['box-shadow: var(--x)'] },
  { label: 'Rohe Deckkraft im Modifier einer Arbitrary Property', classes: '[color:var(--x)]/[0.3]', messageId: 'arbitraryValue', css: ['color-mix(in oklab, var(--x) 30%, transparent)'] },
] as const;

// Erlaubte Klassen mit denselben Varianten und Important-Formen.
const ALLOWED_FORMS = [
  { label: 'Tokenfarbe unter Hover mit Important', classes: 'hover:!text-primary-main hover:text-primary-main!' },
  { label: 'Deckkraftmodifier unter benannter Gruppe', classes: 'group-hover/card:bg-black/50 peer-hover/name:underline' },
  { label: 'Tokenfarbe unter Vorfahren- und beliebiger Hover-Variante', classes: 'in-hover:text-primary-main [&:hover]:text-primary-main' },
  { label: 'Abstand mit Important hinter Variante', classes: 'md:!p-4 md:p-4!' },
  { label: 'Deckkraft mit Important ohne Hover', classes: 'md:!opacity-100 focus-visible:opacity-100!' },
  { label: 'Tokenwert in benutzerdefinierter Eigenschaft mit Ziffer', classes: '[--color-effort-dot-1:var(--x)]' },
  { label: 'Arbitrary Property mit Token und Skalen- oder Tokenmodifier', classes: '[color:var(--x)]/50 [color:var(--x)]/[var(--y)]' },
] as const;

describe('Gestaltungssystem-Regel (GSPP-533)', () => {

  async function designFindings(classes: string, filePath = 'src/components/Sample.tsx') {
    const messages = await lint(`export const c = ${jsStringLiteral(classes)};`, filePath);
    return messages.filter(({ ruleId }) => ruleId === RULE);
  }

  it.each([
    ['Safe-Area-Modifier nach roher Schriftgröße mit Important und Variante', 'md:!text-[13px]/[env(safe-area-inset-top)]', 'arbitraryValue'],
    ['Grid-Ausnahme vor Rohwert-Modifier', 'grid-cols-[auto_1fr]/[13px]', 'arbitraryValue'],
    ['Content-Ausnahme vor Rohwert-Modifier', "content-['']/[13px]", 'arbitraryValue'],
    ['Transition-Ausnahme vor Rohwert-Modifier', 'transition-[rotate,color]/[13px]', 'arbitraryValue'],
    ['Viewport-Ausnahme vor Rohwert-Modifier', 'h-[50vh]/[13px]', 'arbitraryValue'],
    ['Safe-Area-Ausnahme vor Rohwert-Modifier', 'pb-[env(safe-area-inset-bottom)]/[13px]', 'arbitraryValue'],
    ['Safe Area in Schriftgröße und Zeilenhöhe', 'text-[length:var(--text-sm,env(safe-area-inset-top))]/[var(--leading-title,env(safe-area-inset-bottom))]', 'arbitraryValue'],
    ['Safe Area ohne Rohwert', 'pb-[env(safe-area-inset-bottom)]', 'arbitraryValue'],
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
    ['Rohwert neben einem Token', 'shadow-[0_0_8px_var(--color-focus-ring)]', 'arbitraryValue'],
    ['Rechnung mit Token', 'rounded-[calc(var(--radius-md)-2px)]', 'arbitraryValue'],
    ['Rohwert im Token-Fallback', 'text-[var(--x,13px)]', 'arbitraryValue'],
    ['Schatten im Token-Fallback', 'shadow-[var(--nicht-definiert,0_0_8px_red)]', 'arbitraryValue'],
    ['Rohfarbe im Fallback einer Arbitrary Property', '[--y:var(--x,#f00)]', 'arbitraryProperty'],
    ['Rohwert vor Skalenmodifier', 'text-[13px]/6', 'arbitraryValue'],
    ['Rohfarbe vor Deckkraftmodifier', 'bg-[#123456]/50', 'arbitraryValue'],
    ['Token mit Rohwert-Modifier', 'text-[var(--x)]/[13px]', 'arbitraryValue'],
    ['Verlauf als Arbitrary Property mit Tokens', '[background-image:linear-gradient(var(--color-a),var(--color-b))]', 'gradient'],
    ['Hintergrundfilter als Arbitrary Property mit Token', '[backdrop-filter:blur(var(--radius-lg))]', 'backdrop'],
    ['Schatten als Arbitrary Property mit Token', '[box-shadow:var(--shadow-overlay)]', 'shadow'],
    ['Schlagschatten-Filter als Arbitrary Property', '[filter:drop-shadow(var(--shadow-sm))]', 'shadow'],
    ...BYPASS_FORMS.map(({ label, classes, messageId }) => [label, classes, messageId] as const),
  ])('meldet %s (%s) als Fehler', async (_label, classes, messageId) => {
    expect(await designFindings(`p-4 ${classes}`)).toEqual([
      expect.objectContaining({ ruleId: RULE, severity: 2, messageId }),
    ]);
  });

  it.each([
    ['Token über var()', 'text-[var(--color-text-primary)] shadow-[var(--shadow-overlay)]'],
    ['Token-Utilities', 'min-h-touch h-panel-head shadow-footer shadow-sm shadow-overlay text-2xs text-xl text-lg/title rounded rounded-lg rounded-full tracking-wide'],
    ['Modifier mit Token oder Skalenwert', 'bg-black/50 text-sm/[var(--leading-title)] w-1/2'],
    ['Token mit Typhinweis oder Fallback', 'border-[length:var(--border-x)] w-[var(--control-id-column,auto)] [--x:var(--y)] text-[var(--a,var(--b))]'],
    ['Token mit Skalenmodifier', 'bg-[var(--color-primary-main)]/50 text-[var(--x)]/6'],
    ['Basis-Ausnahmen mit Tokenmodifier', "grid-cols-[auto_1fr]/[var(--x)] content-['']/[var(--x)] transition-[rotate,color]/[var(--x)] h-[50vh]/[var(--x)]"],
    ['Spaltenvorlage', 'grid-cols-[auto_1fr] sm:grid-rows-[3.5rem_1fr]'],
    ['Pseudo-Element-Inhalt', "after:content-[''] after:content-[attr(data-label)]"],
    ['Übergangsliste', 'transition-[rotate,color]'],
    ['sichere Fläche über benannte Utilities', 'pb-safe pb-safe-detail pb-safe-selection'],
    ['Viewport-Maß', 'min-h-[50vh] max-h-[calc(100dvh-8rem)]'],
    ['Deckkraft ohne Hover', 'opacity-0 peer-checked:opacity-100 disabled:opacity-50'],
    ['Varianten mit Klammern', 'data-[state=open]:block @min-[18.5rem]:flex'],
    ['Attributselektor', '[data-tooltip-root]'],
    ...ALLOWED_FORMS.map(({ label, classes }) => [label, classes] as const),
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

describe('Gestaltungssystem-Regel gegen Tailwind-Ausgabe (GSPP-533)', () => {
  const require = createRequire(import.meta.url);
  const indexCss = readFileSync(path.resolve('src/index.css'), 'utf8');

  async function loadStylesheet(id: string) {
    const resolved = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : require.resolve(id);
    return { path: resolved, base: path.dirname(resolved), content: readFileSync(resolved, 'utf8') };
  }

  /**
   * CSS, das Tailwind mit `src/index.css` für die Klassen erzeugt. Es steht im
   * ersten `@layer utilities`-Block; ohne erzeugte Klasse ist das die leere
   * Anweisung `@layer utilities;`. Spätere Blöcke stammen aus `src/index.css`.
   */
  async function utilityCss(classes: string) {
    const compiler = await compile(indexCss, { base: path.resolve('src'), loadStylesheet });
    const css = compiler.build(classes.split(' '));
    const start = css.indexOf('@layer utilities');
    if (css.startsWith('@layer utilities;', start)) return '';
    return css.slice(start, css.indexOf('\n}\n', start));
  }

  async function jsxFindings(classes: string) {
    const messages = await lint(
      `export const Sample = () => <div className={${jsStringLiteral(classes)}} />;`,
      'src/components/Sample.tsx',
    );
    return messages.filter(({ ruleId }) => ruleId === RULE);
  }

  it.each([
    ['pb-safe-detail', '1rem'],
    ['pb-safe-selection', '7rem'],
  ])('erhält den Safe-Area-Abstand für %s', async (classes, spacing) => {
    const generated = await utilityCss(`p-4 ${classes} desktop:pb-4`);
    expect(generated).toContain(`padding-bottom: calc(${spacing} + env(safe-area-inset-bottom, 0px))`);
    // Dieselbe Utility-Ebene erlaubt der Desktop-Variante, den Safe-Area-Abstand zu ersetzen.
    expect(generated.indexOf(`.${classes}`)).toBeLessThan(generated.indexOf('.desktop\\:pb-4'));
    expect(generated).toContain('padding-bottom: calc(var(--spacing) * 4)');
    expect(await jsxFindings(classes)).toEqual([]);
  });

  it.each(BYPASS_FORMS)('$label: Tailwind erzeugt den Effekt, die Regel meldet $classes in className', async ({ classes, messageId, css }) => {
    const generated = await utilityCss(classes);
    for (const fragment of css) expect(generated).toContain(fragment);

    expect(await jsxFindings(classes)).toEqual([
      expect.objectContaining({ ruleId: RULE, severity: 2, messageId }),
    ]);
  });

  it.each(ALLOWED_FORMS)('$label: Tailwind erzeugt CSS, die Regel lässt $classes in className zu', async ({ classes }) => {
    for (const single of classes.split(' ')) expect(await utilityCss(single)).not.toBe('');

    expect(await jsxFindings(classes)).toEqual([]);
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
