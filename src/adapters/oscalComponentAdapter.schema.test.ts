// =============================================================================
// Stufe 3 für Component Definitions (GSPP-248)
//
// Der Adapter bringt keine eigene Schemaprüfung mit — er reicht die in Stufe 2
// gebundene Matrixzelle an `validateAgainstPinnedSchema()` weiter (GSPP-343).
// Der Nachweis hier ist deshalb ein Versionsnachweis, kein Validatornachweis:
// **Dasselbe Feld** ist unter 1.1.2 ein Schemabefund und unter 1.2.1/1.2.2
// gültig. Genau das kann ein Adapter mit einer globalen Modellversionskonstante
// nicht leisten.
// =============================================================================

import { beforeEach, describe, expect, it } from 'vitest';
import {
  parseComponentDefinitionDocument,
  validateComponentDefinitionSchema,
} from './oscalComponentDocument';
import {
  JSON_SCHEMA_VALIDATOR,
  REDACTED_PATH_SEGMENT,
  resetCompiledSchemaCache,
} from '@/domain/oscalSchemaValidation';
import type { OscalDocumentContext } from '@/domain/models';
import {
  COMPONENT_ARTIFACT_SPECS,
  makeComponentDefinitionSource,
  makeComponentDefinitionWithImportRemarks,
} from '@/test/fixtures/componentDefinitions';

const context: OscalDocumentContext = { trustClass: 'class-1-verified-public' };

beforeEach(() => {
  resetCompiledSchemaCache();
});

function validateFixture(artifactKey: string) {
  const specification = COMPONENT_ARTIFACT_SPECS.find(
    (entry) => entry.artifactKey === artifactKey,
  );
  if (!specification) throw new Error(`Unbekanntes Fixture: ${artifactKey}`);

  return validateComponentDefinitionSchema(
    parseComponentDefinitionDocument(makeComponentDefinitionSource(specification), {
      ...context,
      upstreamPath: specification.upstreamPath,
    }),
  );
}

describe('import-component-definition.remarks — derselbe Inhalt, zwei Ergebnisse', () => {
  it('akzeptiert das Feld unter 1.2.1 und 1.2.2', async () => {
    for (const version of ['1.2.1', '1.2.2'] as const) {
      const document = parseComponentDefinitionDocument(
        makeComponentDefinitionWithImportRemarks(version),
        context,
      );

      expect(document.pin.oscalVersion).toBe(version);
      await expect(validateComponentDefinitionSchema(document)).resolves.toEqual({ ok: true });
    }
  });

  it('weist dasselbe Feld unter 1.1.2 und 1.1.3 als schemawidrig aus', async () => {
    for (const version of ['1.1.2', '1.1.3'] as const) {
      const document = parseComponentDefinitionDocument(
        makeComponentDefinitionWithImportRemarks(version),
        context,
      );
      const result = await validateComponentDefinitionSchema(document);

      expect(result.ok, version).toBe(false);
      if (result.ok) continue;
      expect(result.diagnostic.code).toBe('OSCAL_SCHEMA_ADDITIONAL_PROPERTY');
      expect(result.diagnostic.artifact.oscalVersion).toBe(version);
      expect(result.diagnostic.validator).toEqual(JSON_SCHEMA_VALIDATOR);
    }
  });

  it('behält das Feld in beiden Fällen in der Projektion', () => {
    for (const version of ['1.1.2', '1.2.2'] as const) {
      const { view } = parseComponentDefinitionDocument(
        makeComponentDefinitionWithImportRemarks(version),
        context,
      );

      // Verlustfreiheit gilt unabhängig von der Schemavalidität (ADR-2, ADR-7).
      expect(view.importComponentDefinitions[0]?.remarks, version).toBe(
        'Nachnutzung des Grundmoduls.',
      );
    }
  });
});

describe('Schemastand der sechs registrierten Definitionen', () => {
  it('validiert AWS Security Hub, Keycloak, Netzarchitektur und Passwortrichtlinie', async () => {
    for (const artifactKey of [
      'component-aws-security-hub',
      'component-keycloak',
      'component-netzarchitektur',
      'component-passwortrichtlinie',
    ]) {
      await expect(validateFixture(artifactKey), artifactKey).resolves.toEqual({ ok: true });
    }
  });

  it('weist den GA-Lotse-Befund am gemessenen Pointer aus (BSI #70)', async () => {
    const result = await validateFixture('component-ga-lotse-grundmodul');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe('OSCAL_SCHEMA_ADDITIONAL_PROPERTY');
    // Ajv zeigt bei `additionalProperties` auf das Elternobjekt; der
    // beanstandete Name selbst ist Dokumentinhalt und bleibt redigiert.
    expect(result.diagnostic.path).toBe(
      `/component-definition/import-component-definitions/0/${REDACTED_PATH_SEGMENT}`,
    );
    expect(result.diagnostic.artifact.oscalVersion).toBe('1.1.2');
    expect(result.diagnostic.artifact.key).toBe('component-ga-lotse-grundmodul');
  });

  it('weist den Lieferketten-Befund am gemessenen Pointer aus (BSI #71)', async () => {
    const result = await validateFixture('component-lieferkette');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe('OSCAL_SCHEMA_TYPE_MISMATCH');
    expect(result.diagnostic.path).toBe(
      '/component-definition/components/1/control-implementations/0/implemented-requirements/0/links',
    );
    expect(result.diagnostic.artifact.oscalVersion).toBe('1.1.2');
  });

  it('parst beide gesperrten Definitionen trotz Schemainvalidität verlustfrei', () => {
    for (const artifactKey of ['component-ga-lotse-grundmodul', 'component-lieferkette']) {
      const specification = COMPONENT_ARTIFACT_SPECS.find(
        (entry) => entry.artifactKey === artifactKey,
      )!;
      const source = makeComponentDefinitionSource(specification);

      const document = parseComponentDefinitionDocument(source, {
        ...context,
        upstreamPath: specification.upstreamPath,
      });

      // Die Sperrung aus ADR-7 betrifft die Auslieferung, nicht das Parsen.
      expect(document.source, artifactKey).toBe(source);
      expect(JSON.stringify(document.source)).toBe(JSON.stringify(source));
      expect(document.view.components.length).toBeGreaterThan(0);
    }
  });
});

describe('Versionsbindung der Schemaprüfung', () => {
  it('prüft jede Definition gegen ihre eigene deklarierte Version', async () => {
    const bound = new Map<string, string>();

    for (const specification of COMPONENT_ARTIFACT_SPECS) {
      const document = parseComponentDefinitionDocument(
        makeComponentDefinitionSource(specification),
        { ...context, upstreamPath: specification.upstreamPath },
      );

      expect(document.pin.rootKey).toBe('component-definition');
      expect(document.pin.oscalVersion).toBe(specification.oscalVersion);
      expect(document.pin.vendorPath).toContain(`v${specification.oscalVersion}`);
      bound.set(specification.artifactKey, document.pin.oscalVersion);

      const result = await validateComponentDefinitionSchema(document);
      expect(result.ok, specification.artifactKey).toBe(specification.schemaValid);
    }

    expect(Object.fromEntries(bound)).toEqual({
      'component-aws-security-hub': '1.1.3',
      'component-ga-lotse-grundmodul': '1.1.2',
      'component-keycloak': '1.2.2',
      'component-lieferkette': '1.1.2',
      'component-netzarchitektur': '1.2.2',
      'component-passwortrichtlinie': '1.1.2',
    });
  });
});
