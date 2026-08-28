import { describe, expect, it } from 'vitest';
import { processClass2OscalValue } from './oscalObjectPipeline';
import { processClass2OscalBytes } from './oscalClass2Import';
import { parseClass2OscalInput } from './oscalImportProcessing';
import { CLASS_2_IMPORT_LIMITS } from './oscalImportContract';
import {
  makeSchemaInvalidOscalDocument,
  makeSchemaValidOscalDocument,
} from '@/test/fixtures/oscalSchemaFixtures';

const context = { trustClass: 'class-2-local-user' } as const;

/**
 * Belegt ein Fixture über den echten Byte-Eintrittspunkt mit Herkunft.
 */
async function parseBytes(source: unknown): Promise<unknown> {
  const input = parseClass2OscalInput(
    new TextEncoder().encode(JSON.stringify(source)),
  );
  if (!input.ok) throw new Error('Fixture muss parsen');
  return input.source;
}

describe('processClass2OscalValue — gemeinsame objektorientierte Prüfkette', () => {
  it('führt ein gültiges, herkunftsbelegtes Dokument durch Strukturprüfung, Root-Dispatch und Schemastufe', async () => {
    const result = await processClass2OscalValue(
      await parseBytes(makeSchemaValidOscalDocument('catalog', '1.1.3')),
      context,
    );

    expect(result).toMatchObject({
      ok: true,
      document: {
        context,
        rootType: 'catalog',
        oscalVersion: '1.1.3',
      },
    });
  });

  it('reicht einen Schema-Fehler nach bestandener Strukturprüfung durch', async () => {
    const result = await processClass2OscalValue(
      await parseBytes(makeSchemaInvalidOscalDocument('catalog', '1.1.3')),
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { stage: 'json-schema' },
    });
  });

  it('reicht einen Root-Dispatch-Fehler nach bestandener Strukturprüfung durch', async () => {
    const result = await processClass2OscalValue(
      await parseBytes({ unknownroot: { 'metadata': { 'oscal-version': '1.1.3' } } }),
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { stage: 'root-dispatch' },
    });
  });

  it('weist einen Kontext mit falscher Vertrauensklasse ohne Prüfung ab', async () => {
    const result = await processClass2OscalValue(
      await parseBytes(makeSchemaValidOscalDocument('catalog', '1.1.3')),
      {
        trustClass: 'class-1-verified-public',
      } as never,
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: 'OSCAL_IMPORT_CONTEXT_INVALID', stage: 'domain' },
    });
  });

  it('nimmt dem Byte-Eintrittspunkt die Objektgraph-Limits ab und lehnt sie in der Kette ab', async () => {
    // Mehr Knoten, als das Limit erlaubt: Stufe 1 parst nur noch; die
    // Ablehnung geschieht in der gemeinsamen Einheit hinter dem Herkunftsnachweis.
    const text = `[${'null,'.repeat(CLASS_2_IMPORT_LIMITS.maxNodes)}null]`;

    const result = await processClass2OscalBytes(new TextEncoder().encode(text), context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: 'OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED', stage: 'resource-limit' },
    });
  });
});

describe('processClass2OscalValue — Regressionsnachweis des Bestandskorpus', () => {
  it('lässt ein heute gültiges Klasse-2-Dokument am Byte-Eintritt unverändert durch', async () => {
    const document = makeSchemaValidOscalDocument('catalog', '1.1.3');

    const bytes = new TextEncoder().encode(JSON.stringify(document));
    const viaBytes = await processClass2OscalBytes(bytes, context);

    expect(viaBytes).toMatchObject({ ok: true, document: { rootType: 'catalog' } });
  });
});
