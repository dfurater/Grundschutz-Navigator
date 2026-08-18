import { beforeEach, describe, expect, it } from 'vitest';
import {
  JSON_SCHEMA_VALIDATOR,
  REDACTED_PATH_SEGMENT,
  SCHEMA_VALIDATION_DIAGNOSTIC_CODES,
  redactInstancePath,
  resetCompiledSchemaCache,
  validateAgainstPinnedSchema,
} from './oscalSchemaValidation';
import {
  getOscalSchemaLoader,
  listOscalSchemaCellKeys,
  toSchemaCellKey,
} from './oscalSchemaBundle';
import { getSchemaPin, listSchemaPins } from './oscalVersionMatrix';
import type { OscalSchemaPin } from './oscalVersionMatrix';
import {
  makeSchemaInvalidOscalDocument,
  makeSchemaLeakProbeDocument,
  makeSchemaValidOscalDocument,
} from '@/test/fixtures/oscalSchemaFixtures';

const pins = listSchemaPins();

describe('Schema-Bundle', () => {
  it('führt exakt die 30 existierenden Matrixzellen', () => {
    expect(listOscalSchemaCellKeys().slice().sort()).toEqual(
      pins.map((pin) => toSchemaCellKey(pin.rootKey, pin.oscalVersion)).sort(),
    );
    expect(pins).toHaveLength(30);
  });

  it('lädt jede gepinnte Zelle als draft-07-Schema mit passender $id', async () => {
    for (const pin of pins) {
      const loader = getOscalSchemaLoader(pin);
      expect(loader, `${pin.rootKey} @ ${pin.oscalVersion}`).not.toBeNull();

      const schema = (await loader!()).default as Record<string, unknown>;
      expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
      expect(schema.$id).toBe(pin.schemaId);
    }
  });
});

describe('validateAgainstPinnedSchema', () => {
  beforeEach(() => {
    resetCompiledSchemaCache();
  });

  it(
    'kompiliert alle 30 gepinnten Schemas mit der produktiven Konfiguration',
    async () => {
      // Kompilierfehler enden fail-closed als OSCAL_SCHEMA_UNAVAILABLE; dass
      // keine Zelle diesen Code liefert, ist der Kompilierbeleg.
      for (const pin of pins) {
        const result = await validateAgainstPinnedSchema(
          makeSchemaValidOscalDocument(pin.rootKey, pin.oscalVersion),
          pin,
        );
        expect(result, `${pin.rootKey} @ ${pin.oscalVersion}`).toEqual({ ok: true });
      }
    },
    // 30 echte Ajv-Kompilierungen in einem Test liegen lokal bei ~950ms, auf
    // den GitHub-Actions-Runnern aber beobachtet bei 4,7–5,2s (Runs 32069019414,
    // 32128784915) — zu nah am 5000ms-Default, um zuverlässig zu bestehen.
    20000,
  );

  it('lehnt je Root-Modell ein schemawidriges Dokument fail-closed ab', async () => {
    for (const pin of pins) {
      const result = await validateAgainstPinnedSchema(
        makeSchemaInvalidOscalDocument(pin.rootKey, pin.oscalVersion),
        pin,
      );

      expect(result, `${pin.rootKey} @ ${pin.oscalVersion}`).toMatchObject({
        ok: false,
        diagnostic: {
          code: 'OSCAL_SCHEMA_REQUIRED_PROPERTY_MISSING',
          stage: 'json-schema',
          severity: 'error',
          path: `/${pin.rootKey}/metadata`,
          validator: JSON_SCHEMA_VALIDATOR,
          artifact: { rootType: pin.rootKey, oscalVersion: pin.oscalVersion },
        },
      });
    }
  });

  it('führt den Registry-Schlüssel und den Validatorpin in der Signatur', async () => {
    const pin = getSchemaPin('catalog', '1.1.3')!;
    const result = await validateAgainstPinnedSchema(
      makeSchemaInvalidOscalDocument('catalog', '1.1.3'),
      pin,
      { artifactKey: 'catalog-gspp' },
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        artifact: { key: 'catalog-gspp', rootType: 'catalog', oscalVersion: '1.1.3' },
        signature: 'ajv@8.20.0|OSCAL_SCHEMA_REQUIRED_PROPERTY_MISSING|/catalog/metadata',
        messageKey: 'oscal.jsonSchema.schemaRequiredPropertyMissing',
      },
    });
  });

  it('beweist mit einer gewöhnlichen id, dass TokenDatatype mit u-Flag ausgewertet wird', async () => {
    // Ohne `unicodeRegExp` liest die Engine `\p{L}` als `p` und `ac-1` fällt
    // durch — dieser Positivlauf schlägt dann fehl.
    const pin = getSchemaPin('catalog', '1.2.2')!;
    const document = makeSchemaValidOscalDocument('catalog', '1.2.2');
    const groups = (document.catalog as Record<string, unknown>).groups as Record<string, unknown>[];
    const controls = groups[0]!.controls as Record<string, unknown>[];

    expect(controls[0]!.id).toBe('ac-1');
    await expect(validateAgainstPinnedSchema(document, pin)).resolves.toEqual({ ok: true });
  });

  it('endet fail-closed, wenn die Zelle nicht im Bundle liegt', async () => {
    // Ein Pin, den das Bundle nicht führt, steht für Ladefehler und
    // Kompilierfehler gleichermaßen: Stufe 3 gilt als technisch nicht
    // verfügbar und niemals als bestanden.
    const unknownCell = {
      ...getSchemaPin('catalog', '1.2.2')!,
      rootKey: 'catalog',
      oscalVersion: '9.9.9',
    } as unknown as OscalSchemaPin;

    await expect(validateAgainstPinnedSchema({}, unknownCell)).resolves.toMatchObject({
      ok: false,
      diagnostic: {
        code: SCHEMA_VALIDATION_DIAGNOSTIC_CODES.SCHEMA_UNAVAILABLE,
        stage: 'json-schema',
        path: '/',
      },
    });
  });

  it('lässt weder Ajvs message noch params in eine Diagnose', async () => {
    const marker = 'STUFE-3-LECKMARKER';
    const pin = getSchemaPin('catalog', '1.2.2')!;

    const result = await validateAgainstPinnedSchema(
      makeSchemaLeakProbeDocument(marker, '1.2.2'),
      pin,
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_SCHEMA_ADDITIONAL_PROPERTY',
        stage: 'json-schema',
        path: `/catalog/metadata/${REDACTED_PATH_SEGMENT}`,
        params: {},
      },
    });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(JSON.stringify(result)).not.toContain('must NOT have additional properties');
  });
});

describe('redactInstancePath', () => {
  const known = new Set(['catalog', 'metadata', 'title', 'a/b', 'a~b']);

  it.each([
    ['', '/'],
    ['/catalog/metadata/title', '/catalog/metadata/title'],
    ['/catalog/groups/0/controls/12', `/catalog/${REDACTED_PATH_SEGMENT}/0/${REDACTED_PATH_SEGMENT}/12`],
    ['/catalog/geheim', `/catalog/${REDACTED_PATH_SEGMENT}`],
    ['/a~1b', '/a~1b'],
    ['/a~0b', '/a~0b'],
    ['/a~1c', `/${REDACTED_PATH_SEGMENT}`],
    ['/catalog/01', `/catalog/${REDACTED_PATH_SEGMENT}`],
  ])('redigiert %s zu %s', (instancePath, expected) => {
    expect(redactInstancePath(instancePath, known)).toBe(expected);
  });
});
