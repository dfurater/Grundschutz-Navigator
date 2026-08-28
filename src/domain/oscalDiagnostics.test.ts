import { describe, expect, it } from 'vitest';
import {
  createOscalDiagnostic,
  OSCAL_DIAGNOSTIC_STAGES,
  toDiagnosticMessageKey,
  toDiagnosticSignature,
} from './oscalDiagnostics';

const validator = { name: 'test-validator', version: '9' };

describe('Diagnosemodell', () => {
  it('führt genau die Stufen des Validierungsvertrags', () => {
    // docs/OSCAL_VALIDATION.md, Abschnitt „Diagnostic-Vertrag“. Die Stufe
    // `object-structure` kommt mit der gemeinsamen objektorientierten
    // Prüfkette hinzu (GSPP-291 Commit A, ADR-8 Festlegung 1+3), die Stufe
    // `profile-resolution` mit dem Importgraphen des Ableitungswegs
    // (GSPP-291 Commit B).
    expect([...OSCAL_DIAGNOSTIC_STAGES]).toEqual([
      'resource-limit',
      'json-syntax',
      'object-structure',
      'root-dispatch',
      'json-schema',
      'oscal-constraint',
      'reference',
      'domain',
      'profile-resolution',
    ]);
  });

  it('leitet den Message-Key deterministisch aus Stufe und Code ab', () => {
    expect(toDiagnosticMessageKey('root-dispatch', 'OSCAL_ROOT_VERSION_IMPOSSIBLE')).toBe(
      'oscal.rootDispatch.rootVersionImpossible',
    );
    expect(toDiagnosticMessageKey('json-schema', 'OSCAL_SCHEMA_ADDITIONAL_PROPERTY')).toBe(
      'oscal.jsonSchema.schemaAdditionalProperty',
    );
  });

  it('baut die Signatur aus Validatorpin, Code und Pfad', () => {
    expect(toDiagnosticSignature(validator, 'OSCAL_ROOT_KEY_MISSING', '/')).toBe(
      'test-validator@9|OSCAL_ROOT_KEY_MISSING|/',
    );
  });

  it('füllt den Artefaktkontext fail-closed mit null statt mit Vermutungen', () => {
    const diagnostic = createOscalDiagnostic({
      code: 'OSCAL_ROOT_KEY_MISSING',
      stage: 'root-dispatch',
      validator,
      path: '/',
    });

    expect(diagnostic.artifact).toEqual({ key: null, rootType: null, oscalVersion: null });
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.params).toEqual({});
  });

  it('friert die Diagnose ein, damit sie nachträglich nicht umgeschrieben wird', () => {
    const diagnostic = createOscalDiagnostic({
      code: 'OSCAL_ROOT_KEY_MISSING',
      stage: 'root-dispatch',
      validator,
      path: '/',
      artifact: { rootType: 'catalog', oscalVersion: '1.1.3' },
      params: { rootKeyCount: 2 },
    });

    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(Object.isFrozen(diagnostic.artifact)).toBe(true);
    expect(Object.isFrozen(diagnostic.params)).toBe(true);
  });
});
