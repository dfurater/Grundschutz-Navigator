// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Der Einstieg kommt ohne Top-Level-Await aus (GSPP-506). Mit ihm lagert der
 * Bundler die Module, die Einstieg und Seitenchunks teilen, aus dem Hauptchunk in
 * zusätzliche, beim Start geladene Chunks aus: gemessen 12 statt 2 JS-Anfragen je
 * Einstieg und mehr initial übertragene Bytes.
 */
describe('main.tsx', () => {
  it('wartet nicht per Top-Level-Await', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'main.tsx'), 'utf8');

    expect(source).not.toMatch(/^await\b/m);
  });
});
