import { ESLint } from 'eslint';

/** Regeln aus eslint.config.js, die Typinformation brauchen (GSPP-199). */
export const TYPE_AWARE_RULES = [
  '@typescript-eslint/await-thenable',
  '@typescript-eslint/no-floating-promises',
] as const;

/**
 * ESLint mit der Repo-Konfiguration, aber ohne Project Service. Tests, die
 * Quelltext unter einem nicht existierenden Pfad linten, kennt der Project
 * Service nicht; er bräche mit einem Parsing-Fehler ab, bevor eine Regel
 * läuft. Für syntaktische Regeln ist die Typinformation entbehrlich.
 */
export function createEslintWithoutTypes(): ESLint {
  return new ESLint({
    cwd: process.cwd(),
    overrideConfig: {
      files: ['src/**/*.{ts,tsx}'],
      languageOptions: { parserOptions: { projectService: false } },
      rules: Object.fromEntries(TYPE_AWARE_RULES.map((rule) => [rule, 'off'])),
    },
  });
}
