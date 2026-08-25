import { describe, expect, it } from 'vitest';
import {
  createClass2UnprovenancedDiagnostic,
  isParserProducedRoot,
  OSCAL_OBJECT_UNPROVENANCED,
} from './oscalObjectProvenance';
import { OBJECT_GRAPH_STAGE } from './oscalObjectGraph';
import { processClass2OscalValue } from './oscalObjectPipeline';
import { processClass2OscalBytes } from './oscalClass2Import';
import { parseClass2OscalInput } from './oscalImportProcessing';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';

const context = { trustClass: 'class-2-local-user' } as const;

describe('Herkunftsnachweis am Objekteinstieg (Gate-Befund P1, c69ca82)', () => {
  it('lehnt ein fremdes Rohobjekt an der Kette ab — vor jeder Reflexion', async () => {
    const raw = makeSchemaValidOscalDocument('catalog', '1.1.3');

    const result = await processClass2OscalValue(raw, context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        stage: OBJECT_GRAPH_STAGE,
        code: OSCAL_OBJECT_UNPROVENANCED,
      },
    });
  });

  it('lehnt einen transparenten Proxy als Rohgraph mit derselben Diagnose ab', async () => {
    const proxy = new Proxy(makeSchemaValidOscalDocument('catalog', '1.1.3'), {});

    const result = await processClass2OscalValue(proxy, context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: OSCAL_OBJECT_UNPROVENANCED },
    });
  });

  it('lehnt einen Proxy um ein echtes geparstes Ergebnis ab — andere Containeridentität', async () => {
    const input = await parseClass2OscalInput(
      new TextEncoder().encode(JSON.stringify(makeSchemaValidOscalDocument('catalog', '1.1.3'))),
    );
    if (!input.ok) throw new Error('Fixture muss parsen');

    const wrapped = new Proxy(input.source as object, {});

    const result = await processClass2OscalValue(wrapped, context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: OSCAL_OBJECT_UNPROVENANCED },
    });
  });

  it('belegt die Herkunft strukturell: kein Pfadsegment, keine Parameter, kein Inhalt', async () => {
    const diagnostic = createClass2UnprovenancedDiagnostic();
    const serialized = JSON.stringify(diagnostic);

    expect(diagnostic.path).toBe('/');
    expect(Object.keys(diagnostic.params)).toHaveLength(0);
    expect(serialized).not.toContain('catalog');
  });

  it('akzeptiert das unmittelbare JSON.parse-Ergebnis des eigenen Byte-Eintrittspunkts', async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify(makeSchemaValidOscalDocument('catalog', '1.1.3')),
    );
    const result = await processClass2OscalBytes(bytes, context);

    expect(result).toMatchObject({ ok: true, document: { rootType: 'catalog' } });
  });

  it('stellt die registrierte Herkunft als reine Identitätsfrage bereit', async () => {
    const input = await parseClass2OscalInput(new TextEncoder().encode('{"a":1}'));
    if (!input.ok) throw new Error('Fixture muss parsen');

    expect(isParserProducedRoot(input.source as object)).toBe(true);

    const foreign = { a: 1 };
    expect(isParserProducedRoot(foreign)).toBe(false);
    expect(isParserProducedRoot(new Proxy(foreign, {}))).toBe(false);
  });
});
