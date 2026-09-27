// @vitest-environment node
// =============================================================================
// ESLint-Geltungsbereiche in docs/ARCHITECTURE.md (Greptile-Befund im
// Release-PR #313)
//
// Unter docs/** steht nur, was sich gegen Code oder Konfiguration prüfen
// lässt. Jeder Satz, der eine ESLint-Regelgruppe beschreibt, nennt deshalb
// genau die `files`-Muster, unter denen `eslint.config.js` die Regel mit
// dieser Stufe setzt. Ein Sammelbegriff wie `src/**` schlösse die `.mjs`-
// Dateien unter `src/` ein, für die keine dieser Regeln gilt.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import eslintConfig from '../eslint.config.js';

const ARCHITECTURE = readFileSync(resolve(import.meta.dirname, '../docs/ARCHITECTURE.md'), 'utf8');

type Severity = 'error' | 'warn' | 'off';

/** Satz in ARCHITECTURE.md, der eine Regel mit ihrer Stufe beschreibt. */
const CLAIMS: ReadonlyArray<{ readonly rule: string; readonly severity: Severity; readonly marker: string }> = [
  { rule: '@typescript-eslint/await-thenable', severity: 'error', marker: 'läuft ESLint zusätzlich mit Typinformation' },
  { rule: '@typescript-eslint/no-floating-promises', severity: 'error', marker: 'läuft ESLint zusätzlich mit Typinformation' },
  { rule: '@typescript-eslint/no-floating-promises', severity: 'off', marker: 'ist nur `no-floating-promises` abgeschaltet' },
  { rule: 'no-restricted-properties', severity: 'error', marker: '`document.body`-Zugriff' },
  { rule: 'no-restricted-syntax', severity: 'warn', marker: 'imperative Event-Listener' },
  { rule: 'max-lines', severity: 'warn', marker: 'mehr als 300 physischen Zeilen' },
];

function severityOf(setting: unknown): unknown {
  return Array.isArray(setting) ? setting[0] : setting;
}

/** `files`-Muster aller Konfigurationsblöcke, die `rule` mit `severity` setzen. */
function configuredFiles(rule: string, severity: Severity): string[] {
  return eslintConfig
    .filter((block) => block.files !== undefined && severityOf(block.rules?.[rule]) === severity)
    .flatMap((block) => block.files!.flat())
    .filter((pattern): pattern is string => typeof pattern === 'string');
}

/** Code-Spannen mit `*`, also Glob-Muster, in Reihenfolge. */
function globsIn(sentence: string): string[] {
  return [...sentence.matchAll(/`([^`]+)`/g)].map((match) => match[1]!).filter((code) => code.includes('*'));
}

/** Glob-Muster aus dem einzigen Satz, der `marker` enthält. */
function documentedFiles(marker: string): string[] {
  const sentences = ARCHITECTURE.split(/(?<=[.:])\s+(?=\p{Lu})/u).filter((sentence) => sentence.includes(marker));
  expect(sentences, marker).toHaveLength(1);
  return globsIn(sentences[0]!);
}

describe('ESLint-Geltungsbereiche in ARCHITECTURE.md', () => {
  it.each(CLAIMS)('nennt für $rule ($severity) genau die files-Muster der Konfiguration', ({ rule, severity, marker }) => {
    const files = configuredFiles(rule, severity);
    expect(files.length).toBeGreaterThan(0);
    expect(documentedFiles(marker)).toEqual(files);
  });

  it('liest den Sammelbegriff src/** nicht als Muster der Typ-Regeln', () => {
    const sample = 'Für `src/**` läuft ESLint zusätzlich mit Typinformation und erzwingt `await-thenable`.';
    expect(globsIn(sample)).toEqual(['src/**']);
    expect(globsIn(sample)).not.toEqual(configuredFiles('@typescript-eslint/await-thenable', 'error'));
  });
});
