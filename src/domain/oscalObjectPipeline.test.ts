import { describe, expect, it } from 'vitest';
import { processClass2OscalValue } from './oscalObjectPipeline';
import { processClass2OscalBytes } from './oscalClass2Import';
import { parseClass2OscalInput } from './oscalImportProcessing';
import { CLASS_2_IMPORT_LIMITS } from './oscalImportContract';
import { buildSchemaId } from './oscalVersionMatrix';
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

describe('processClass2OscalBytes — v-präfigierte oscal-version (GSPP-357)', () => {
  /** Katalog wie in NIST oscal-content v1.5.0: `"oscal-version": "v1.2.2"`. */
  function prefixedCatalog(schemaDirective?: string): Record<string, unknown> {
    const document = makeSchemaValidOscalDocument('catalog', '1.2.2');
    const metadata = (document.catalog as { metadata: Record<string, unknown> }).metadata;
    metadata['oscal-version'] = 'v1.2.2';
    return schemaDirective === undefined ? document : { $schema: schemaDirective, ...document };
  }

  function encode(document: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(document));
  }

  it('führt den Katalog durch Root-Dispatch und Schemastufe mit dem Pin 1.2.2 und lässt die Quelle unverändert', async () => {
    const result = await processClass2OscalBytes(encode(prefixedCatalog()), context);

    expect(result).toMatchObject({
      ok: true,
      document: { context, rootType: 'catalog', oscalVersion: '1.2.2' },
    });
    if (!result.ok) return;
    const source = result.document.source as { catalog: { metadata: Record<string, unknown> } };
    expect(source.catalog.metadata['oscal-version']).toBe('v1.2.2');
  });

  it('prüft den v-präfigierten Katalog tatsächlich gegen das Schema der Zelle 1.2.2', async () => {
    const document = prefixedCatalog();
    // Ein Pflichtfeld des Katalogschemas fehlt: Erreicht die Kette die
    // Schemastufe mit der gewählten Zelle, muss sie dort scheitern.
    delete (document.catalog as Record<string, unknown>).uuid;

    const result = await processClass2OscalBytes(encode(document), context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        stage: 'json-schema',
        artifact: { rootType: 'catalog', oscalVersion: '1.2.2' },
      },
    });
  });

  it('akzeptiert eine zur gewählten Zelle passende Schema-Direktive', async () => {
    const result = await processClass2OscalBytes(
      encode(prefixedCatalog(buildSchemaId('catalog', '1.2.2')!)),
      context,
    );

    expect(result).toMatchObject({ ok: true, document: { oscalVersion: '1.2.2' } });
  });

  it.each([
    ['V1.2.2', 'OSCAL_VERSION_MALFORMED'],
    ['vv1.2.2', 'OSCAL_VERSION_MALFORMED'],
    ['v1.2', 'OSCAL_VERSION_MALFORMED'],
    ['v1.2.3', 'OSCAL_ROOT_VERSION_UNSUPPORTED'],
  ])('lehnt %s fail-closed im Root-Dispatch ab', async (declared, code) => {
    const document = prefixedCatalog();
    (document.catalog as { metadata: Record<string, unknown> }).metadata['oscal-version'] = declared;

    const result = await processClass2OscalBytes(encode(document), context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { stage: 'root-dispatch', code, artifact: { oscalVersion: null } },
    });
  });

  it('lehnt eine widersprechende Schema-Direktive ab', async () => {
    const result = await processClass2OscalBytes(
      encode(prefixedCatalog(buildSchemaId('catalog', '1.2.1')!)),
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { stage: 'root-dispatch', code: 'OSCAL_SCHEMA_DIRECTIVE_CONFLICT' },
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
