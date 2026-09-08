import { describe, expect, it } from 'vitest';
import { CLASS_2_TRANSPORT_FIXTURES } from './class2TransportFixtures.mjs';
import { processClass2OscalBytes } from '@/domain/oscalClass2Import';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';

describe('Transport-Grenzfixtures', () => {
  it('deckt lange Werte, Unicode, Schlüssel und zulässige Tiefe ab', () => {
    expect(CLASS_2_TRANSPORT_FIXTURES.map((fixture) => fixture.id)).toEqual([
      'string-bound', 'unicode-bound', 'key-bound', 'valid-depth-bound',
    ]);
  });

  it.each(['string-bound', 'unicode-bound', 'key-bound'])('%s schöpft die Bytegrenze aus', (id) => {
    const fixture = CLASS_2_TRANSPORT_FIXTURES.find((entry) => entry.id === id)!;
    expect(new TextEncoder().encode(fixture.build()).byteLength).toBe(CLASS_2_IMPORT_LIMITS.maxBytes);
  });

  it.each(['string-bound', 'unicode-bound', 'valid-depth-bound'])('%s besteht die vollständige Prüfkette', async (id) => {
    const fixture = CLASS_2_TRANSPORT_FIXTURES.find((entry) => entry.id === id)!;
    const text = fixture.build(65_536);
    const result = await processClass2OscalBytes(new TextEncoder().encode(text), {
      trustClass: 'class-2-local-user',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.source).toEqual(JSON.parse(text));
  });

  it('lange unbekannte Schlüssel bleiben schemawidrig und redigiert', async () => {
    const text = CLASS_2_TRANSPORT_FIXTURES.find((entry) => entry.id === 'key-bound')!.build(65_536);
    const result = await processClass2OscalBytes(new TextEncoder().encode(text), {
      trustClass: 'class-2-local-user',
    });
    expect(result).toMatchObject({ ok: false, diagnostic: { code: 'OSCAL_SCHEMA_ADDITIONAL_PROPERTY' } });
    expect(JSON.stringify(result).length).toBeLessThan(2_000);
  });
});
