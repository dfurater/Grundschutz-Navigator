import { describe, expect, it } from 'vitest';
import {
  createOscalDerivedGraph,
  type DerivedGraphValue,
} from './oscalDerivedGraph';
import { processClass2OscalValue } from './oscalObjectPipeline';

const context = { trustClass: 'class-2-local-user' as const };

/**
 * Baut einen beliebigen strukturell zulässigen Wert ausschließlich über den
 * kontrollierten Builder nach — fremde Objekte und Arrays werden dabei nie
 * als Werte übergeben.
 */
function rebuildWithBuilder(value: unknown): unknown {
  const builder = createOscalDerivedGraph();
  const handle = rebuildInto(builder, value);
  if (typeof handle !== 'object' || handle === null) {
    throw new Error('Fixture-Wurzel muss ein Builder-Container sein');
  }
  return builder.finishRoot(handle);
}

function rebuildInto(
  builder: ReturnType<typeof createOscalDerivedGraph>,
  value: unknown,
): DerivedGraphValue {
  if (Array.isArray(value)) {
    const array = builder.array();
    for (const element of value) builder.pushArrayItem(array, rebuildInto(builder, element));
    return array;
  }
  if (value !== null && typeof value === 'object') {
    const object = builder.object();
    for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
      builder.setObjectMember(object, key, rebuildInto(builder, member));
    }
    return object;
  }
  return value as DerivedGraphValue;
}

describe('Kontrollierter Builder für den Ableitungsweg', () => {
  it('lehnt ein fremdes Rohobjekt weiterhin an der Kette ab', async () => {
    const result = await processClass2OscalValue({ unknownroot: {} }, context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: 'OSCAL_OBJECT_UNPROVENANCED' },
    });
  });

  it('trägt Builder-Grafen als Herkunft — ein unbekannter Root erreicht den Root-Dispatch', async () => {
    const root = rebuildWithBuilder({ unknownroot: { 'metadata': { 'oscal-version': '1.1.3' } } });

    const result = await processClass2OscalValue(root, context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { stage: 'root-dispatch' },
    });
  });

  it('führt ein vollständiges Builder-Katalogdokument durch Strukturprüfung und Dispatch bis zur Schemastufe', async () => {
    const document = {
      catalog: {
        metadata: { 'oscal-version': '1.1.3' },
        groups: [{ id: 'g1', class: 'example', title: 'Gruppe' }],
      },
    };
    const root = rebuildWithBuilder(document);

    const result = await processClass2OscalValue(root, context);

    // Strukturinvariante und Root-Dispatch sind passiert; das minimale
    // Dokument endet erwartbar an der anschließenden Schemastufe.
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { stage: 'json-schema' },
    });
  });

  it('lehnt ein nachgebautes Handle — gleichförmiges Fremdobjekt — mit derselben Diagnose ab', async () => {
    const forged: Record<string, unknown> = { unknownroot: { 'metadata': {} } };

    const result = await processClass2OscalValue(forged, context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: 'OSCAL_OBJECT_UNPROVENANCED' },
    });
  });

  it('lehnt einen Proxy um ein echtes Builder-Handle an der Kette ab — andere Containeridentität', async () => {
    const builder = createOscalDerivedGraph();
    const object = builder.object();
    const root = builder.finishRoot(object);

    const wrapped = new Proxy(root, {});

    const result = await processClass2OscalValue(wrapped, context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: 'OSCAL_OBJECT_UNPROVENANCED' },
    });
  });

  it('wirft bei fremden Objekt- oder Arraywerten sofort', () => {
    const builder = createOscalDerivedGraph();
    const object = builder.object();
    const untyped = builder as unknown as {
      setObjectMember(handle: unknown, key: string, value: unknown): void;
      pushArrayItem(handle: unknown, value: unknown): void;
    };

    expect(() => untyped.setObjectMember(object, 'a', { foreign: true })).toThrow(TypeError);
    expect(() => untyped.pushArrayItem(object, [1, 2])).toThrow(TypeError);
  });

  it('bewahrt ein eigenes __proto__-Feld als voll schreibbare Data-Property', () => {
    const builder = createOscalDerivedGraph();
    const object = builder.object();
    builder.setObjectMember(object, '__proto__', 'eigener-wert');

    const root = builder.finishRoot(object);
    const descriptor = Object.getOwnPropertyDescriptor(root as object, '__proto__');

    expect(Object.getPrototypeOf(root as object)).toBe(Object.prototype);
    expect(descriptor).toMatchObject({
      writable: true,
      enumerable: true,
      configurable: true,
    });
    expect((root as Record<string, unknown>)['__proto__']).toBe('eigener-wert');
  });

  it('wirft bei doppelten Mitgliedern', () => {
    const builder = createOscalDerivedGraph();
    const object = builder.object();
    builder.setObjectMember(object, 'a', 1);

    expect(() => builder.setObjectMember(object, 'a', 2)).toThrow(TypeError);
  });

  it('überlässt der Grenze den Ableitungspfad — große Builder-Nutzlast scheitert nicht an Bytes', async () => {
    // Die Bytegrenze bindet ausschließlich den Parser-Weg; der Ableitungsweg
    // erhält seinen eigenen Etat aus dem Resolver-Vertrag.
    const builder = createOscalDerivedGraph();
    const object = builder.object();
    builder.setObjectMember(
      object,
      'unknownroot',
      rebuildInto(builder, {
        'metadata': { 'oscal-version': '1.1.3', 'title': 'x'.repeat(1024) },
      }),
    );
    const root = builder.finishRoot(object);

    const result = await processClass2OscalValue(root, context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { stage: 'root-dispatch' },
    });
  });
});
