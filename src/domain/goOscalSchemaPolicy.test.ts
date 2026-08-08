import { describe, expect, it } from 'vitest';
import {
  GO_OSCAL_VALIDATOR,
  KNOWN_BSI_SCHEMA_EXCEPTIONS,
  evaluateSchemaExceptionPolicy,
  normalizeGoOscalSchemaErrors,
} from './goOscalSchemaPolicy.mjs';

const artifact = Object.freeze({
  artifactKey: 'mapping-iso27001-annex-a-zu-gspp',
  rootType: 'mapping-collection',
  oscalVersion: '1.2.2',
});

const knownAggregateResult = Object.freeze({
  valid: false,
  errors: [
    {
      instanceLocation: '/mapping-collection/provenance',
      keywordLocation:
        '/oneOf/1/properties/mapping-collection/$ref/properties/provenance/$ref/additionalProperties',
      error: '"additional properties \'qa-reviewed\', \'qa-note\' not allowed"',
    },
  ],
});

describe('go-oscal BSI-Schemaausnahmepolicy', () => {
  it('führt genau die zwei dokumentierten Ausnahmen mit allen Matchfeldern', () => {
    expect(GO_OSCAL_VALIDATOR).toEqual({ name: 'go-oscal', version: '0.7.1' });
    expect(KNOWN_BSI_SCHEMA_EXCEPTIONS).toHaveLength(2);
    expect(KNOWN_BSI_SCHEMA_EXCEPTIONS).toEqual([
      expect.objectContaining({
        artifactKey: artifact.artifactKey,
        rootType: artifact.rootType,
        oscalVersion: artifact.oscalVersion,
        path: '/mapping-collection/provenance/qa-reviewed',
        signature:
          'go-oscal@0.7.1|additionalProperties|/mapping-collection/provenance|qa-reviewed',
        continuationEligible: true,
        reason: 'bekannte additive BSI-QA-Erweiterung',
        recordedAt: '2026-08-01',
      }),
      expect.objectContaining({
        artifactKey: artifact.artifactKey,
        rootType: artifact.rootType,
        oscalVersion: artifact.oscalVersion,
        path: '/mapping-collection/provenance/qa-note',
        signature: 'go-oscal@0.7.1|additionalProperties|/mapping-collection/provenance|qa-note',
        continuationEligible: true,
        reason: 'bekannte additive BSI-QA-Erweiterung',
        recordedAt: '2026-08-01',
      }),
    ]);
  });

  it('lässt den Schematest fehlgeschlagen und akzeptiert nur die separate Policy', () => {
    const diagnostics = normalizeGoOscalSchemaErrors(knownAggregateResult, artifact);

    expect(diagnostics.map((diagnostic) => diagnostic.signature)).toEqual([
      'go-oscal@0.7.1|additionalProperties|/mapping-collection/provenance|qa-reviewed',
      'go-oscal@0.7.1|additionalProperties|/mapping-collection/provenance|qa-note',
    ]);
    expect(evaluateSchemaExceptionPolicy(diagnostics)).toEqual({
      schemaStatus: 'failed',
      continuationAllowed: true,
      policyAccepted: true,
    });
  });

  it('lehnt eine zusätzliche Diagnose selbst am bekannten Parent-Pfad ab', () => {
    const diagnostics = normalizeGoOscalSchemaErrors(
      {
        ...knownAggregateResult,
        errors: [
          ...knownAggregateResult.errors,
          {
            instanceLocation: '/mapping-collection/provenance',
            keywordLocation:
              '/oneOf/1/properties/mapping-collection/$ref/properties/provenance/$ref/additionalProperties',
            error: '"additional properties \'qa-reviewed\', \'qa-note\', \'qa-extra\' not allowed"',
          },
        ],
      },
      artifact,
    );

    expect(diagnostics).toHaveLength(3);
    expect(diagnostics[2]).toMatchObject({
      code: 'OSCAL_VALIDATOR_OUTPUT_UNRECOGNIZED',
      path: '/mapping-collection/provenance',
    });
    expect(JSON.stringify(diagnostics[2])).not.toContain('qa-extra');
    expect(evaluateSchemaExceptionPolicy(diagnostics)).toEqual({
      schemaStatus: 'failed',
      continuationAllowed: false,
      policyAccepted: false,
    });
  });

  it('lehnt eine bloße Pfadfreigabe mit anderer Diagnosesignatur ab', () => {
    const [covered] = normalizeGoOscalSchemaErrors(knownAggregateResult, artifact);
    const differentSignature = { ...covered, signature: `${covered.signature}-different` };

    expect(evaluateSchemaExceptionPolicy([differentSignature])).toEqual({
      schemaStatus: 'failed',
      continuationAllowed: false,
      policyAccepted: false,
    });
  });

  it('zerlegt nur die exakt bekannte Zwei-Eigenschaften-Aggregatmeldung', () => {
    const diagnostics = normalizeGoOscalSchemaErrors(
      {
        valid: false,
        errors: [
          {
            ...knownAggregateResult.errors[0],
            error: '"additional properties \'qa-note\', \'qa-reviewed\' not allowed"',
          },
        ],
      },
      artifact,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'OSCAL_VALIDATOR_OUTPUT_UNRECOGNIZED',
      path: '/mapping-collection/provenance',
    });
    expect(evaluateSchemaExceptionPolicy(diagnostics).continuationAllowed).toBe(false);
  });
});
