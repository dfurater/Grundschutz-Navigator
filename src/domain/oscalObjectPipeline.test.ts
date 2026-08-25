import { describe, expect, it } from 'vitest';
import {
  enforceClass2ObjectGraphInvariants,
  OBJECT_GRAPH_DIAGNOSTIC_CODES,
} from './oscalObjectGraph';
import { processClass2OscalValue } from './oscalObjectPipeline';
import { processClass2OscalBytes } from './oscalClass2Import';
import { CLASS_2_IMPORT_LIMITS } from './oscalImportContract';
import {
  makeSchemaInvalidOscalDocument,
  makeSchemaValidOscalDocument,
} from '@/test/fixtures/oscalSchemaFixtures';

const context = { trustClass: 'class-2-local-user' } as const;

/** Ein schemavalider Katalog als Träger für strukturelle Verletzungen darunter. */
function makeValidCatalog(): Record<string, unknown> {
  return makeSchemaValidOscalDocument('catalog', '1.1.3');
}

describe('enforceClass2ObjectGraphInvariants — Strukturinvariante und Limits in einem Durchlauf', () => {
  it('akzeptiert ein Dokument mit einer überlaufenden Zahl (1e400 → Infinity)', () => {
    const parsed: unknown = JSON.parse(
      '{"catalog":{"metadata":{"title":"t","oscal-version":"1.1.3"},"overflow":1e400}}',
    );

    expect(enforceClass2ObjectGraphInvariants(parsed)).toBeNull();
  });

  it('akzeptiert zwei strukturgleiche, aber nicht identische Teilbäume', () => {
    expect(enforceClass2ObjectGraphInvariants({ a: { v: 1 }, b: { v: 1 } })).toBeNull();
  });

  it('akzeptiert genau eine Million Knoten', () => {
    const source = {
      values: Array.from({ length: CLASS_2_IMPORT_LIMITS.maxNodes - 2 }, () => null),
    };

    expect(enforceClass2ObjectGraphInvariants(source)).toBeNull();
  });

  it('weist mehr als eine Million Knoten ab', () => {
    const source = [ ...Array.from({ length: CLASS_2_IMPORT_LIMITS.maxNodes }, () => null), null ];

    const diagnostic = enforceClass2ObjectGraphInvariants(source);

    expect(diagnostic).toMatchObject({
      code: 'OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED',
      stage: 'resource-limit',
      path: '/',
    });
  });
});

describe('processClass2OscalValue — gemeinsame objektorientierte Prüfkette', () => {
  it('führt ein gültiges Dokument durch Strukturprüfung, Root-Dispatch und Schemastufe', async () => {
    const result = await processClass2OscalValue(makeValidCatalog(), context);

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
      makeSchemaInvalidOscalDocument('catalog', '1.1.3'),
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { stage: 'json-schema' },
    });
  });

  it('weist eine Strukturverletzung vor dem Root-Dispatch ab — auch wenn das Dokument nicht einmal ein Objekt ist', async () => {
    const result = await processClass2OscalValue(new Date('2026-08-25T00:00:00Z'), context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        stage: 'object-structure',
        code: OBJECT_GRAPH_DIAGNOSTIC_CODES.PROTOTYPE_REJECTED,
      },
    });
  });

  it('weist einen Kontext mit falscher Vertrauensklasse ohne Prüfung ab', async () => {
    const result = await processClass2OscalValue(makeValidCatalog(), {
      trustClass: 'class-1-verified-public',
    } as never);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: 'OSCAL_IMPORT_CONTEXT_INVALID', stage: 'domain' },
    });
  });
});

describe('processClass2OscalValue — Regressionsnachweis des Bestandskorpus', () => {
  it('lässt ein heute gültiges Klasse-2-Dokument an beiden Eintrittspunkten unverändert durch', async () => {
    const document = makeSchemaValidOscalDocument('catalog', '1.1.3');

    expect(enforceClass2ObjectGraphInvariants(document)).toBeNull();

    const bytes = new TextEncoder().encode(JSON.stringify(document));
    const result = await processClass2OscalValue(document, context);
    const viaBytes = await processClass2OscalBytes(bytes, context);

    expect(result).toMatchObject({ ok: true });
    expect(viaBytes).toMatchObject({ ok: true, document: { rootType: 'catalog' } });
  });

  it('bewahrt ein eigenes __proto__-Feld aus JSON.parse als Data-Property — ohne Prototypwechsel', async () => {
    // JSON.parse erzeugt für "__proto__" eine eigene Data-Property und lässt
    // den Prototyp unverändert. Die Positivdefinition muss genau dieses
    // Dokument akzeptieren; der Feldverlust-Vertrag des Builders ist Teil von
    // Commit B.
    const parsed: unknown = JSON.parse(
      '{"catalog":{"metadata":{"title":"t","oscal-version":"1.1.3"},"__proto__":{"vererbt":true}}}',
    );
    const body = (parsed as { catalog: Record<string, unknown> }).catalog;

    expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
    expect(enforceClass2ObjectGraphInvariants(parsed)).toBeNull();
  });
});

describe('processClass2OscalValue — Negativkorpus der Objektgraphform', () => {
  type ViolationCase = {
    readonly name: string;
    readonly build: () => unknown;
    readonly expectedCode: string;
    /** Marker, der weder als Code noch als Parameter noch im Pfad erscheinen darf. */
    readonly secret?: string;
  };

  const cases: readonly ViolationCase[] = [
    {
      name: 'geteilte Containeridentität (derselbe Teilbaum an zwei Stellen, azyklisch)',
      build: () => {
        const shared = { v: 1 };
        return { x: shared, y: shared };
      },
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.IDENTITY_REJECTED,
    },
    {
      name: 'Objektgraph-Zyklus',
      build: () => {
        const cycle: Record<string, unknown> = {};
        cycle['schleifenfeld'] = cycle;
        return cycle;
      },
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.IDENTITY_REJECTED,
      secret: 'schleifenfeld',
    },
    {
      name: 'Date',
      build: () => new Date('2026-08-25T00:00:00Z'),
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.PROTOTYPE_REJECTED,
    },
    {
      name: 'Map',
      build: () => new Map([[1, 2]]),
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.PROTOTYPE_REJECTED,
    },
    {
      name: 'Accessor-Property',
      build: () => {
        const holder: Record<string, unknown> = {};
        Object.defineProperty(holder, 'geheimesfeld', {
          get: () => 1,
          set: () => {},
          enumerable: true,
          configurable: true,
        });
        return holder;
      },
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.DESCRIPTOR_REJECTED,
      secret: 'geheimesfeld',
    },
    {
      name: 'Objekt mit eigenem toJSON',
      build: () => ({ toJSON: () => ({}) }),
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.VALUE_TYPE_REJECTED,
      secret: 'toJSON',
    },
    {
      name: 'Symbol-Schlüssel',
      build: () => ({ [Symbol('schluessel')]: 1 }),
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.SYMBOL_KEY_REJECTED,
      secret: 'schluessel',
    },
    {
      name: 'nicht aufzählbarer eigener Zustand',
      build: () => {
        const holder: Record<string, unknown> = {};
        Object.defineProperty(holder, 'verstecktesfeld', {
          value: 1,
          writable: true,
          enumerable: false,
          configurable: true,
        });
        return holder;
      },
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.DESCRIPTOR_REJECTED,
      secret: 'verstecktesfeld',
    },
    {
      name: 'Null-Prototyp',
      build: () => Object.assign(Object.create(null), { erlaubt: 1 }),
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.PROTOTYPE_REJECTED,
    },
    {
      name: 'Custom-Prototyp (Klasseninstanz)',
      build: () => {
        class FixtureKlasse {
          readonly wert = 1;
        }
        return new FixtureKlasse();
      },
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.PROTOTYPE_REJECTED,
    },
    {
      name: 'sparse Array',
      build: () => {
        const sparse: unknown[] = new Array(3);
        sparse[1] = 1;
        return sparse;
      },
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.ARRAY_SHAPE_REJECTED,
    },
    {
      name: 'undefined',
      build: () => undefined,
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.VALUE_TYPE_REJECTED,
    },
    {
      name: 'Funktion',
      build: () => () => {},
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.VALUE_TYPE_REJECTED,
    },
    {
      name: 'BigInt',
      build: () => 1n,
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.VALUE_TYPE_REJECTED,
    },
    {
      name: 'NaN',
      build: () => Number.NaN,
      expectedCode: OBJECT_GRAPH_DIAGNOSTIC_CODES.VALUE_TYPE_REJECTED,
    },
  ];

  for (const violation of cases) {
    it(`weist fail-closed ab: ${violation.name}`, async () => {
      const result = await processClass2OscalValue(violation.build(), context);

      expect(result).toMatchObject({
        ok: false,
        diagnostic: {
          code: violation.expectedCode,
          stage: 'object-structure',
          path: '/',
        },
      });
    });
  }

  it('redigiert jede Strukturdiagnose: kein Pfadsegment, kein Parameter, kein Marker', async () => {
    for (const violation of cases) {
      const result = await processClass2OscalValue(violation.build(), context);
      if (result.ok) throw new Error(`erwartete Ablehnung für: ${violation.name}`);

      const { diagnostic } = result;
      const serialized = JSON.stringify(diagnostic);

      expect(diagnostic.path).toBe('/');
      expect(Object.keys(diagnostic.params)).toHaveLength(0);
      if (violation.secret !== undefined) {
        expect(serialized).not.toContain(violation.secret);
      }
    }
  });

  it('bewahrt die Baumform des Positivfalls: dasselbe Dokument ohne Verletzung läuft durch', async () => {
    const document = makeValidCatalog();
    const result = await processClass2OscalValue(document, context);

    expect(result).toMatchObject({ ok: true });
  });
});
