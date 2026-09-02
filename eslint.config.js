import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
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

export default tseslint.config(
  { ignores: ['dist', 'coverage', '.worktrees'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'oscal-security': oscalSecurity,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
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
);
