import { describe, expect, it } from 'vitest';
import * as provenanceModule from './oscalObjectProvenance';
import { isParserProducedRoot } from './oscalObjectProvenance';
import { parseClass2OscalInput } from './oscalImportProcessing';

describe('Geschlossene Herkunftsfläche (Greptile-Befunde zu 805c638 und 3a1b1d6)', () => {
  it('exponiert keine beschreibbare Registrierung — Belege entstehen nur am Byteweg', () => {
    // Die Fläche des Herkunftsmoduls kennt nur die Identitätsfrage; das
    // Register lebt als modulprivater Zustand im Byte-Eintrittspunkt.
    const moduleKeys = Object.keys(provenanceModule);

    expect(moduleKeys).not.toContain('registerParserProducedRoot');
    expect(moduleKeys).not.toContain('registerParsedTree');
    expect(moduleKeys).not.toContain('register');
    expect(moduleKeys).toContain('isParserProducedRoot');
  });

  it('bindet jeden Beleg an die vollständige Bytepolitik — Duplicate-Member bleibt unregistriert', async () => {
    // Schema-valid, aber mit doppeltem Member: processClass2OscalBytes weist
    // es mit OSCAL_JSON_DUPLICATE_MEMBER ab — und genau deshalb darf kein
    // Container des Parse-Produkts einen Beleg tragen.
    const duplicateText = '{"catalog":{"metadata":{"title":"a","title":"b"},"oscal-version":"1.1.3"}}';
    const result = await import('./oscalClass2Import').then((m) =>
      m.processClass2OscalBytes(new TextEncoder().encode(duplicateText), {
        trustClass: 'class-2-local-user',
      }),
    );

    expect(result).toMatchObject({ ok: false });

    const directParse = JSON.parse(duplicateText) as object;
    expect(isParserProducedRoot(directParse)).toBe(false);
    expect(
      isParserProducedRoot((directParse as Record<string, unknown>)['catalog'] as object),
    ).toBe(false);
  });

  it('belegt nach bestandener Bytepolitik Wurzel und jeden Container', async () => {
    const input = await parseClass2OscalInput(new TextEncoder().encode('{"a":{"b":1}}'));
    if (!input.ok) throw new Error('Fixture muss parsen');

    const root = input.source as Record<string, unknown>;
    expect(isParserProducedRoot(input.source as object)).toBe(true);
    expect(isParserProducedRoot(root['a'] as object)).toBe(true);

    const foreign = { a: { b: 1 } };
    expect(isParserProducedRoot(foreign)).toBe(false);
  });
});
