import { describe, expect, it } from 'vitest';
import {
  enforceClass2ObjectGraphInvariants,
  OBJECT_GRAPH_DIAGNOSTIC_CODES,
} from './oscalObjectGraph';
import { CLASS_2_IMPORT_LIMITS } from './oscalImportContract';

// Die exotischen Graphformen sind auf dem Byteweg sprachlich unmöglich:
// JSON.parse erzeugt ausschließlich Plain-Structures, die die Positivdefinition
// erfüllt (ADR-8). Ihr Nachweisort ist deshalb die Invariante als Einheit —
// die Postcondition gegen Builderfehler des Ableitungswegs (GSPP-291 Commit B),
// dessen kontrollierter Builder beliebige dieser Formen konstruieren könnte.
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

    expect(enforceClass2ObjectGraphInvariants(source)).toMatchObject({
      code: 'OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED',
      stage: 'resource-limit',
      path: '/',
    });
  });
});

describe('enforceClass2ObjectGraphInvariants — Negativkorpus der Objektgraphform', () => {
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
    it(`weist fail-closed ab: ${violation.name}`, () => {
      expect(enforceClass2ObjectGraphInvariants(violation.build())).toMatchObject({
        code: violation.expectedCode,
        stage: 'object-structure',
        path: '/',
      });
    });
  }

  it('redigiert jede Strukturdiagnose: kein Pfadsegment, kein Parameter, kein Marker', () => {
    for (const violation of cases) {
      const diagnostic = enforceClass2ObjectGraphInvariants(violation.build());
      if (diagnostic === null) throw new Error(`erwartete Ablehnung für: ${violation.name}`);

      const serialized = JSON.stringify(diagnostic);

      expect(diagnostic.path).toBe('/');
      expect(Object.keys(diagnostic.params)).toHaveLength(0);
      if (violation.secret !== undefined) {
        expect(serialized).not.toContain(violation.secret);
      }
    }
  });
});
