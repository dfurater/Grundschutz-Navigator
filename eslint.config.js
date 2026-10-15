import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';

const UI_FILES = [
  'src/features/**/*.{ts,tsx}',
  'src/app/**/*.{ts,tsx}',
  'src/components/**/*.{ts,tsx}',
];

const oscalSecurity = {
  rules: {
    'no-dangerous-oscal-markup': {
      meta: {
        type: 'problem',
        docs: {
          description: 'forbid raw HTML insertion for OSCAL content',
        },
        schema: [],
        messages: {
          forbidden: 'dangerouslySetInnerHTML is forbidden for OSCAL content; render untrusted markup as text.',
        },
      },
      create(context) {
        return {
          JSXAttribute(node) {
            if (node.name.type === 'JSXIdentifier' && node.name.name === 'dangerouslySetInnerHTML') {
              context.report({ node, messageId: 'forbidden' });
            }
          },
        };
      },
    },
  },
};

// Gestaltungssystem (GSPP-533): Rohwerte für Farbe, Größe, Schatten und
// Radius stehen nur in `src/index.css`. Die Regel prüft jedes String-Literal
// einer UI-Datei Klasse für Klasse; was weder Token noch Positivliste ist,
// ist ein Befund.
const FORBIDDEN_UTILITIES = [
  { pattern: /^-?shadow(?:-(?:2xs|xs|md|lg|xl|2xl))?$/, messageId: 'shadow' },
  { pattern: /^-?(?:drop|inset|text)-shadow(?:-|$)/, messageId: 'shadow' },
  { pattern: /^rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?-(?:xs|xl|2xl|3xl|4xl)$/, messageId: 'radius' },
  { pattern: /^text-(?:[2-9]xl)$/, messageId: 'fontSize' },
  { pattern: /^bg-(?:gradient|linear|radial|conic)(?:-|$)/, messageId: 'gradient' },
  { pattern: /^bg-\[.*gradient\(/, messageId: 'gradient' },
  { pattern: /^backdrop-/, messageId: 'backdrop' },
];

// Eine Variante hängt vom Zeigerzustand ab, wenn ihr Name `hover` enthält:
// `hover:`, benannte Gruppen und Peers (`group-hover/card:`), zusammengesetzte
// Varianten (`in-hover:`, `not-hover:`) und beliebige wie `[&:hover]:`.
const isHoverVariant = (variant) => variant.includes('hover');

// Ein Wert gilt als Token, wenn er genau ein `var(--…)` ist, wahlweise mit
// Typhinweis (`length:`). Ein Fallback darf nur ein Schlüsselwort oder ein
// weiterer Tokenbezug sein; ein Rohwert dort gälte bei undefinierter Variable.
const TOKEN_VALUE =
  /^(?:[a-z-]+:)?var\(--[\w-]+(?:,(?:auto|none|inherit|initial|unset|currentColor|transparent|0|var\(--[\w-]+\)))?\)$/;

// CSS-Eigenschaftsnamen sind ASCII-case-insensitive, und ein Herstellerpräfix
// ändert die Wirkung nicht; benutzerdefinierte Eigenschaften (`--…`) bleiben unverändert.
const normalizePropertyName = (name) => (name.startsWith('--') ? name : name.toLowerCase().replace(/^-[a-z]+-/, ''));

// Arbitrary Properties, die Verlauf, Hintergrundfilter oder Schatten setzen.
function forbiddenProperty(property, value) {
  if (property === 'backdrop-filter') return 'backdrop';
  if (/^(?:box|text)-shadow$/.test(property) || (property === 'filter' && value.includes('drop-shadow('))) return 'shadow';
  if (value.includes('gradient(')) return 'gradient';
  return null;
}

// Positivliste für beliebige Werte ohne Token. Jeder Eintrag deckt eine Form,
// für die es kein Gestaltungstoken geben kann.
const ARBITRARY_VALUE_ALLOWLIST = [
  // Spaltenvorlagen sind Layout, kein Gestaltungswert.
  (value, prefix) => /^grid-(?:cols|rows)-$/.test(prefix),
  // Pseudo-Element-Inhalt: leer oder aus einem Attribut.
  (value, prefix) => prefix === 'content-' && /^(?:''|attr\([a-z-]+\))$/.test(value),
  // Liste von CSS-Eigenschaften, deren Übergang animiert wird.
  (value, prefix) => prefix === 'transition-' && /^[a-z-]+(?:,[a-z-]+)*$/.test(value),
  // Höhen und Breiten relativ zum Viewport.
  (value, prefix) => /^(?:min-|max-)?[hw]-$/.test(prefix) && /^(?:calc\()?\d+(?:\.\d+)?[dsl]?v[hw]\b/.test(value),
];

/** Zerlegt eine Klasse an Doppelpunkten außerhalb von Klammern in Varianten und Utility. */
function splitVariants(token) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i += 1) {
    const char = token[i];
    if (char === '[' || char === '(') depth += 1;
    else if (char === ']' || char === ')') depth -= 1;
    else if (char === ':' && depth === 0) {
      parts.push(token.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(token.slice(start));
  return { variants: parts.slice(0, -1), utility: parts.at(-1) };
}

/**
 * Prüft eine Arbitrary Property wie `[opacity:var(--x)]`; `base` ist die Klasse
 * ohne Modifier, `modifier` der abgetrennte Rest wie `/50` oder `/[0.3]`.
 */
function checkArbitraryProperty(base, modifier, onHover) {
  // Ohne Doppelpunkt ist es ein Attributselektor wie `[inert]`, keine Klasse.
  if (!base.includes(':')) return null;
  // Der Name reicht bis zum ersten Doppelpunkt; jede andere Form mit Doppelpunkt ist ein Befund.
  const property = /^\[([^:]+):(.+)\]$/.exec(base);
  if (!property) return 'arbitraryProperty';
  const [, rawName, value] = property;
  const name = normalizePropertyName(rawName);
  const forbidden = forbiddenProperty(name, value);
  if (forbidden) return forbidden;
  if (name === 'opacity' && onHover) return 'hoverOpacity';
  if (!TOKEN_VALUE.test(value)) return 'arbitraryProperty';
  return modifier.startsWith('/[') && !TOKEN_VALUE.test(modifier.slice(2, -1)) ? 'arbitraryValue' : null;
}

/** Normalisiert Tailwinds Variablen-Kurzformen zu eckigen var()-Werten. */
function normalizeVariableShorthand(utility) {
  let depth = 0;
  let start = -1;
  let cursor = 0;
  let normalized = '';
  for (let i = 0; i < utility.length; i += 1) {
    const char = utility[i];
    if (char === '[' || char === '(') {
      if (depth === 0 && char === '(' && /[-/]/.test(utility[i - 1] ?? '')) start = i;
      depth += 1;
    } else if (char === ']' || char === ')') {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        // Ein Typhinweis gehört vor var(); Fallback-Funktionen bleiben vollständig.
        const [, hint = '', value] = /^(?:([a-z-]+:))?([\s\S]*)$/.exec(utility.slice(start + 1, i));
        normalized += `${utility.slice(cursor, start)}[${hint}var(${value})]`;
        cursor = i + 1;
        start = -1;
      }
    }
  }
  return normalized + utility.slice(cursor);
}

function checkClassToken(token) {
  const { variants, utility: rawUtility } = splitVariants(token);
  // `!important` steht als `!` vor oder hinter der Utility, auch hinter Varianten
  // (`hover:!opacity-50`, `md:backdrop-blur-sm!`); die Prüfung gilt der Utility ohne `!`.
  const utility = normalizeVariableShorthand(rawUtility.replace(/^!/, '').replace(/!$/, ''));
  if (utility === '') return null;
  const onHover = variants.some(isHoverVariant);

  // Verbotene Utilities gelten unabhängig vom Wert: Auch ein Tokenbezug macht
  // `backdrop-blur-[var(--…)]` nicht zulässig. Ein Modifier hinter `/` ändert die Utility nicht.
  const base = utility.replace(/\/(?:\[[^\]]*\]|\([^)]*\)|[\w.-]+)$/, '');
  const forbidden = FORBIDDEN_UTILITIES.find(({ pattern }) => pattern.test(base));
  if (forbidden) return forbidden.messageId;
  if (base.startsWith('opacity-') && onHover) return 'hoverOpacity';

  if (utility.startsWith('[')) return checkArbitraryProperty(base, utility.slice(base.length), onHover);
  // Jeder beliebige Wert (`-[…]`) und jeder beliebige Modifier (`/[…]`, etwa
  // eine rohe Zeilenhöhe) wird einzeln geprüft, auch vor einem Skalenmodifier
  // wie in `text-[13px]/6`.
  const values = [...utility.matchAll(/[-/]\[([^\]]*)\]/g)];
  if (values.some((match) => {
    const value = match[1];
    // Nur der aktuelle Wert und sein Präfix dürfen eine Ausnahme begründen.
    // Ein Modifier hat dadurch keinen Grid-/Content-/Viewport-Präfix.
    const prefix = utility.slice(0, match.index + 1);
    return !TOKEN_VALUE.test(value) && !ARBITRARY_VALUE_ALLOWLIST.some((allowed) => allowed(value, prefix));
  })) {
    return 'arbitraryValue';
  }
  return null;
}

const designSystem = {
  rules: {
    'no-off-system-classes': {
      meta: {
        type: 'problem',
        docs: {
          description: 'forbid utility classes that bypass the design tokens in src/index.css',
        },
        schema: [],
        messages: {
          arbitraryValue: '"{{token}}" uses a raw arbitrary value; use a token from src/index.css or var(--…).',
          arbitraryProperty: '"{{token}}" sets a raw arbitrary property; use a utility or a token.',
          shadow: '"{{token}}" is outside the shadow vocabulary; use shadow-sm, shadow-overlay, shadow-footer or a grip shadow.',
          radius: '"{{token}}" is outside the radius scale (sm, md, lg, full).',
          fontSize: '"{{token}}" is outside the six font sizes (2xs to xl).',
          gradient: '"{{token}}" adds a gradient; the design system uses flat surfaces.',
          backdrop: '"{{token}}" adds a backdrop filter; the design system uses flat surfaces.',
          hoverOpacity: '"{{token}}" signals hover through opacity; use a color token.',
        },
      },
      create(context) {
        function check(node, text) {
          for (const token of text.split(/\s+/)) {
            if (token === '') continue;
            const messageId = checkClassToken(token);
            if (messageId) context.report({ node, messageId, data: { token } });
          }
        }
        return {
          Literal(node) {
            if (typeof node.value === 'string') check(node, node.value);
          },
          TemplateElement(node) {
            check(node, node.value.cooked ?? node.value.raw);
          },
        };
      },
    },
  },
};

export default defineConfig(
  { ignores: ['dist', 'coverage', '.worktrees'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'oscal-security': oscalSecurity,
      'design-system': designSystem,
      unicorn: eslintPluginUnicorn,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'unicorn/prefer-global-this': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'oscal-security/no-dangerous-oscal-markup': 'error',
      'max-lines': ['warn', {
        max: 300,
        skipBlankLines: false,
        skipComments: false,
      }],
    },
  },
  {
    // GSPP-199: Type-aware Minimal-Gate. Der Project Service findet
    // tsconfig.app.json und tsconfig.node.json über die Referenzen in
    // tsconfig.json. Das Gate ist über `files` auf src/ begrenzt; außerhalb
    // gilt es nicht, auch wenn einzelne Dateien in tsconfig.node.json liegen.
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    // Unbehandelte Rejections in Tests lässt Vitest den Lauf fehlschlagen;
    // die Regel meldet dort vor allem synchrone act()-Aufrufe.
    files: ['src/**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  {
    files: UI_FILES,
    rules: {
      'no-restricted-properties': ['error', {
        object: 'document',
        property: 'body',
        message: 'Access document.body only from a dedicated hook or browser adapter.',
      }],
      'no-restricted-syntax': ['warn', {
        selector: 'CallExpression[callee.property.name=/^(add|remove)EventListener$/]',
        message: 'Keep imperative listener setup and cleanup within one focused owner.',
      }],
    },
  },
  {
    files: UI_FILES,
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'design-system/no-off-system-classes': 'error',
    },
  },
  {
    files: ['src/features/catalog/CatalogBrowser.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: '@/features/export/csvExport',
            message: 'Catalog export components own CSV download behavior.',
          },
          {
            name: '@/domain/controlRelationships',
            message: 'Catalog detail components own relationship graph construction.',
          },
        ],
      }],
    },
  },
  {
    // GSPP-425: Die fail-closed CI-Guards unter scripts/*.mjs sind
    // sicherheitsrelevanter Code und laufen deshalb unter denselben
    // Recommended-Regeln wie der Rest — kein No-Op, keine Ausnahme.
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 'latest',
      globals: globals.node,
    },
  },
);
