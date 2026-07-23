import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const UI_FILES = [
  'src/features/**/*.{ts,tsx}',
  'src/app/**/*.{ts,tsx}',
  'src/components/**/*.{ts,tsx}',
];

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
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
