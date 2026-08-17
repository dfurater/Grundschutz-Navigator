// =============================================================================
// Fail-closed Pfade der Stufe 3, die einen ersetzten Bundle-Loader brauchen
// (GSPP-343)
//
// Eigene Datei, weil hier der Bundle-Loader ersetzt wird. Mit den echten Zellen
// sind eine zurückgewiesene Schemaladung und ein nicht kompilierbares Schema
// nicht auslösbar: Alle 30 Zellen liegen eingecheckt vor und alle kompilieren —
// genau das prüft `oscalSchemaValidation.test.ts` mit den echten Loadern. Der
// `catch` in `getCompiledCell()` bleibt dort deshalb unerreicht, obwohl er der
// fail-closed Pfad des Vertrags ist.
//
// Die geprüfte Zusage: Beide Ursachen enden mit `OSCAL_SCHEMA_UNAVAILABLE` auf
// Stufe `json-schema`, nie als bestandenes Ergebnis — und die Ursache verlässt
// die Diagnose nicht. Ein Ladefehler kann einen lokalen Pfad tragen, ein
// Ajv-Kompilierfehler einen Schemaschlüssel.
//
// Derselbe Loader-Ersatz belegt zusätzlich die Schreibweise des Keywords
// `false schema` in der Codetabelle. Kein gepinntes Schema kann diesen Befund
// erzeugen, der Eintrag wäre sonst also unbelegt.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loaderOverride } = vi.hoisted(() => ({
  loaderOverride: { current: null as null | (() => Promise<{ readonly default: unknown }>) },
}));

vi.mock('@/domain/oscalSchemaBundle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/oscalSchemaBundle')>();

  return {
    ...actual,
    // Ohne Override bleibt der echte Loader zuständig; nur so kann derselbe
    // Testlauf belegen, dass ein Fehlversuch die Zelle nicht dauerhaft
    // verbrennt.
    getOscalSchemaLoader: (pin: Parameters<typeof actual.getOscalSchemaLoader>[0]) =>
      loaderOverride.current ?? actual.getOscalSchemaLoader(pin),
  } satisfies typeof actual;
});

import {
  JSON_SCHEMA_VALIDATOR,
  SCHEMA_VALIDATION_DIAGNOSTIC_CODES,
  resetCompiledSchemaCache,
  validateAgainstPinnedSchema,
} from './oscalSchemaValidation';
import { getSchemaPin } from './oscalVersionMatrix';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';

const pin = getSchemaPin('catalog', '1.2.2')!;

/**
 * Ein **schemavalides** Dokument. Damit ist der einzige Grund für ein
 * Fehlschlagen der nicht verfügbare Validator — ein Durchwinken auf `ok: true`
 * fiele hier auf.
 */
const validDocument = makeSchemaValidOscalDocument('catalog', '1.2.2');

const unavailableDiagnostic = {
  ok: false,
  diagnostic: {
    code: SCHEMA_VALIDATION_DIAGNOSTIC_CODES.SCHEMA_UNAVAILABLE,
    stage: 'json-schema',
    severity: 'error',
    path: '/',
    validator: JSON_SCHEMA_VALIDATOR,
    artifact: { rootType: 'catalog', oscalVersion: '1.2.2' },
  },
};

/**
 * Die Ursache darf auch nicht über die Konsole entweichen. Ajv 8.20.0 wirft
 * seine Kompilierfehler und schreibt sie nicht — nachgeprüft; diese Spione
 * halten das fest, falls eine künftige Version zusätzlich protokolliert.
 */
function spyOnConsole() {
  return {
    error: vi.spyOn(console, 'error'),
    warn: vi.spyOn(console, 'warn'),
    log: vi.spyOn(console, 'log'),
  };
}

function expectSilentConsole(spies: ReturnType<typeof spyOnConsole>): void {
  expect(spies.error).not.toHaveBeenCalled();
  expect(spies.warn).not.toHaveBeenCalled();
  expect(spies.log).not.toHaveBeenCalled();
}

describe('validateAgainstPinnedSchema — Lade- und Kompilierfehler', () => {
  beforeEach(() => {
    resetCompiledSchemaCache();
  });

  afterEach(() => {
    loaderOverride.current = null;
    vi.restoreAllMocks();
  });

  it('endet fail-closed, wenn die Schemaladung zurückgewiesen wird', async () => {
    // Ein Chunk-Ladefehler kommt als abgewiesenes Promise an. Der Marker steht
    // für den lokalen Pfad, den eine solche Fehlermeldung trägt.
    const marker = 'STUFE-3-LADEFEHLER-LECKMARKER';
    const consoleSpies = spyOnConsole();
    const loader = vi.fn(() => Promise.reject(new Error(`/assets/${marker}-Cd4f21.js`)));
    loaderOverride.current = loader;

    const result = await validateAgainstPinnedSchema(validDocument, pin, {
      artifactKey: 'catalog-gspp',
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject(unavailableDiagnostic);
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(JSON.stringify(result)).not.toContain('/assets/');
    expectSilentConsole(consoleSpies);
  });

  it('endet fail-closed, wenn das geladene Schema nicht kompilierbar ist', async () => {
    // Ajv 8.20.0 wirft in der produktiven Konfiguration
    // `strict mode: unknown keyword: "<Name>"` — die Fehlermeldung trägt also
    // einen Schemaschlüssel. Der Marker steht hier als dieser Schlüssel.
    const marker = 'STUFE_3_KOMPILIERFEHLER_LECKMARKER';
    const consoleSpies = spyOnConsole();
    let loaded = false;
    loaderOverride.current = () => {
      loaded = true;
      return Promise.resolve({
        default: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          [marker]: 'x',
        },
      });
    };

    const result = await validateAgainstPinnedSchema(validDocument, pin, {
      artifactKey: 'catalog-gspp',
    });

    // Die Ladung gelang; erst das Kompilieren scheiterte. Damit ist dieser Lauf
    // vom Ladefehler-Fall oben unterschieden und nicht bloß dessen Wiederholung.
    expect(loaded).toBe(true);
    expect(result).toMatchObject(unavailableDiagnostic);
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(JSON.stringify(result)).not.toContain('strict mode');
    expectSilentConsole(consoleSpies);
  });

  it('verbrennt die Zelle nicht: nach einem Fehlversuch kompiliert sie wieder', async () => {
    // Der Cache wird nur bei Erfolg beschrieben. Ein Fehlversuch darf Stufe 3
    // für diese Zelle also nicht dauerhaft ausfallen lassen.
    loaderOverride.current = () => Promise.reject(new Error('Chunk-Ladefehler'));
    await expect(validateAgainstPinnedSchema(validDocument, pin)).resolves.toMatchObject(
      unavailableDiagnostic,
    );

    loaderOverride.current = null;
    await expect(validateAgainstPinnedSchema(validDocument, pin)).resolves.toEqual({ ok: true });
  });
});

describe('validateAgainstPinnedSchema — Keyword „false schema"', () => {
  beforeEach(() => {
    resetCompiledSchemaCache();
  });

  afterEach(() => {
    loaderOverride.current = null;
  });

  it('führt ein Teilschema false als Kombinatorbefund, nicht als Werkzeugfehler', async () => {
    // Ajv schreibt das Keyword mit Leerzeichen. Ein Eintrag `false_schema`
    // würde nie greifen und der Befund fiele auf
    // `OSCAL_VALIDATOR_OUTPUT_UNRECOGNIZED` durch. Die gepinnten Schemas setzen
    // `false` nur an `additionalProperties`, deshalb braucht dieser Beleg ein
    // synthetisches Schema.
    loaderOverride.current = () =>
      Promise.resolve({
        default: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: { catalog: false },
        },
      });

    await expect(validateAgainstPinnedSchema(validDocument, pin)).resolves.toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_SCHEMA_COMBINATOR_MISMATCH',
        stage: 'json-schema',
        path: '/catalog',
      },
    });
  });
});
