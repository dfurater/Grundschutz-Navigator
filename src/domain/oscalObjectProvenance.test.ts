import { describe, expect, it } from 'vitest';
import {
  createClass2UnprovenancedDiagnostic,
  isParserProducedRoot,
  OSCAL_OBJECT_UNPROVENANCED,
  parseAndRegisterOscalJson,
} from './oscalObjectProvenance';
import { OBJECT_GRAPH_STAGE } from './oscalObjectGraph';
import { processClass2OscalValue } from './oscalObjectPipeline';
import { processClass2OscalBytes } from './oscalClass2Import';
import { parseClass2OscalInput } from './oscalImportProcessing';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';

const context = { trustClass: 'class-2-local-user' } as const;

describe('Herkunftsnachweis am Objekteinstieg', () => {
  it('lehnt ein fremdes Rohobjekt an der Kette ab — vor jeder Reflexion', async () => {
    const result = await processClass2OscalValue(
      makeSchemaValidOscalDocument('catalog', '1.1.3'),
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { stage: OBJECT_GRAPH_STAGE, code: OSCAL_OBJECT_UNPROVENANCED },
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

  it('belegt die Herkunft strukturell: kein Pfadsegment, keine Parameter, kein Inhalt', () => {
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
    const reparsed = parseAndRegisterOscalJson('{"a":1}') as object;
    expect(isParserProducedRoot(reparsed)).toBe(true);

    const foreign = { a: 1 };
    expect(isParserProducedRoot(foreign)).toBe(false);
    expect(isParserProducedRoot(new Proxy(foreign, {}))).toBe(false);
  });

  it('bindet die Herkunft über den gesamten Baum — eingetauschter Teilbaum nach dem Parse fällt auf', async () => {
    // Greptile-Befund zu 3a1b1d6: Nur die Wurzel war registriert. Ein Aufrufer,
    // der nach dem Parse catalog.metadata durch ein Fremdobjekt ersetzt, muss
    // am fehlenden Beleg des Ersatzcontainers scheitern — nicht erst am
    // Prototypvergleich eines Proxies.
    const input = await parseClass2OscalInput(
      new TextEncoder().encode(JSON.stringify(makeSchemaValidOscalDocument('catalog', '1.1.3'))),
    );
    if (!input.ok) throw new Error('Fixture muss parsen');

    const root = input.source as { catalog: Record<string, unknown> };
    root.catalog['metadata'] = {};

    const result = await processClass2OscalValue(input.source, context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: OSCAL_OBJECT_UNPROVENANCED },
    });
  });

  it('bindet die Herkunft über den gesamten Baum — Proxy-Ersatz fällt auf', async () => {
    const input = await parseClass2OscalInput(
      new TextEncoder().encode(JSON.stringify(makeSchemaValidOscalDocument('catalog', '1.1.3'))),
    );
    if (!input.ok) throw new Error('Fixture muss parsen');

    const root = input.source as { catalog: Record<string, unknown> };
    root.catalog['metadata'] = new Proxy({}, {});

    const result = await processClass2OscalValue(input.source, context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: OSCAL_OBJECT_UNPROVENANCED },
    });
  });
});
