// =============================================================================
// Strikte CI-Policy für bekannte BSI-Schemaabweichungen (GSPP-336).
//
// Die Policy ist kein Validator und ändert niemals das Schemaergebnis. Sie
// entscheidet ausschließlich, ob genau dokumentierte additive Befunde die
// spätere Verarbeitung fortsetzen dürfen bzw. im separaten Policy-Gate
// akzeptiert werden. Rohe go-oscal-Ausgaben verlassen dieses Modul nie.
// =============================================================================

import { createOscalDiagnostic } from './oscalDiagnostics.mjs';

export const GO_OSCAL_VALIDATOR = Object.freeze({ name: 'go-oscal', version: '0.7.1' });

const ADDITIONAL_PROPERTIES_KEYWORD_LOCATION =
  '/oneOf/1/properties/mapping-collection/$ref/properties/provenance/$ref/additionalProperties';
const PROVENANCE_PATH = '/mapping-collection/provenance';
const EXPECTED_AGGREGATE_MESSAGE =
  '"additional properties \'qa-reviewed\', \'qa-note\' not allowed"';
const EXCEPTION_KEYS = Object.freeze([
  'artifactKey',
  'rootType',
  'oscalVersion',
  'path',
  'signature',
  'continuationEligible',
  'reason',
  'recordedAt',
]);

function exceptionFor(propertyName) {
  return Object.freeze({
    artifactKey: 'mapping-iso27001-annex-a-zu-gspp',
    rootType: 'mapping-collection',
    oscalVersion: '1.2.2',
    path: `${PROVENANCE_PATH}/${propertyName}`,
    signature: `go-oscal@0.7.1|additionalProperties|${PROVENANCE_PATH}|${propertyName}`,
    continuationEligible: true,
    reason: 'bekannte additive BSI-QA-Erweiterung',
    recordedAt: '2026-08-01',
  });
}

export const KNOWN_BSI_SCHEMA_EXCEPTIONS = Object.freeze([
  exceptionFor('qa-reviewed'),
  exceptionFor('qa-note'),
]);

function assertExceptionList(entries = KNOWN_BSI_SCHEMA_EXCEPTIONS) {
  if (!Array.isArray(entries) || entries.length !== 2) {
    throw new Error('Known BSI schema exceptions must contain exactly two entries');
  }

  const signatures = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Known BSI schema exception must be an object');
    }
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify([...EXCEPTION_KEYS].sort())) {
      throw new Error('Known BSI schema exception has missing or unexpected fields');
    }
    if (
      typeof entry.artifactKey !== 'string' ||
      typeof entry.rootType !== 'string' ||
      typeof entry.oscalVersion !== 'string' ||
      typeof entry.path !== 'string' ||
      typeof entry.signature !== 'string' ||
      typeof entry.continuationEligible !== 'boolean' ||
      typeof entry.reason !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.recordedAt) ||
      signatures.has(entry.signature)
    ) {
      throw new Error('Known BSI schema exception is malformed or duplicated');
    }
    signatures.add(entry.signature);
  }
}

assertExceptionList();

function isKnownAggregateError(error) {
  return (
    error &&
    typeof error === 'object' &&
    error.keywordLocation === ADDITIONAL_PROPERTIES_KEYWORD_LOCATION &&
    error.instanceLocation === PROVENANCE_PATH &&
    error.error === EXPECTED_AGGREGATE_MESSAGE
  );
}

function safeArtifactContext(artifact) {
  return {
    key: typeof artifact?.artifactKey === 'string' ? artifact.artifactKey : null,
    rootType: typeof artifact?.rootType === 'string' ? artifact.rootType : null,
    oscalVersion: typeof artifact?.oscalVersion === 'string' ? artifact.oscalVersion : null,
  };
}

function unrecognizedValidatorOutput(error, artifact) {
  // Nur der vollständig bekannte Parent-Pfad ist strukturell freigegeben.
  // Alle anderen Feldpfade bleiben aus der Diagnose heraus.
  const path = error?.instanceLocation === PROVENANCE_PATH ? PROVENANCE_PATH : '/';
  return createOscalDiagnostic({
    code: 'OSCAL_VALIDATOR_OUTPUT_UNRECOGNIZED',
    stage: 'json-schema',
    validator: GO_OSCAL_VALIDATOR,
    path,
    artifact: safeArtifactContext(artifact),
  });
}

function knownAdditionalPropertyDiagnostic(propertyName, artifact) {
  return createOscalDiagnostic({
    code: 'OSCAL_SCHEMA_ADDITIONAL_PROPERTY',
    stage: 'json-schema',
    validator: GO_OSCAL_VALIDATOR,
    path: `${PROVENANCE_PATH}/${propertyName}`,
    artifact: safeArtifactContext(artifact),
    signatureParts: ['additionalProperties', PROVENANCE_PATH, propertyName],
    params: { keyword: 'additionalProperties', propertyName },
  });
}

/**
 * Redigiert go-oscal-Befunde. Die einzige strukturelle Zerlegung ist der
 * vertraglich festgelegte Zwei-Eigenschaften-Aggregatbefund. Abweichende
 * Meldungen bleiben eine sichtbare, aber nicht weiter spezifizierte Diagnose.
 */
export function normalizeGoOscalSchemaErrors(validationResult, artifact) {
  const errors = Array.isArray(validationResult?.errors) ? validationResult.errors : [];

  return errors.flatMap((error) => {
    if (!isKnownAggregateError(error)) {
      return [unrecognizedValidatorOutput(error, artifact)];
    }

    return [
      knownAdditionalPropertyDiagnostic('qa-reviewed', artifact),
      knownAdditionalPropertyDiagnostic('qa-note', artifact),
    ];
  });
}

function findExactException(diagnostic) {
  return KNOWN_BSI_SCHEMA_EXCEPTIONS.find(
    (entry) =>
      entry.artifactKey === diagnostic?.artifact?.key &&
      entry.rootType === diagnostic?.artifact?.rootType &&
      entry.oscalVersion === diagnostic?.artifact?.oscalVersion &&
      entry.path === diagnostic?.path &&
      entry.signature === diagnostic?.signature,
  );
}

/**
 * Liefert ausschließlich das Schema-Policy-Ergebnis dieses CI-Laufs. Es ist
 * absichtlich kein vollständiger Fünf-Stufen-Validierungsstatus.
 */
export function evaluateSchemaExceptionPolicy(diagnostics) {
  if (!Array.isArray(diagnostics)) {
    throw new Error('Schema diagnostics must be an array');
  }
  if (diagnostics.length === 0) {
    return Object.freeze({
      schemaStatus: 'passed',
      continuationAllowed: false,
      policyAccepted: true,
    });
  }

  const matchingExceptions = diagnostics.map(findExactException);
  const policyAccepted = matchingExceptions.every(Boolean);
  const continuationAllowed =
    policyAccepted && matchingExceptions.every((entry) => entry.continuationEligible === true);

  return Object.freeze({
    schemaStatus: 'failed',
    continuationAllowed,
    policyAccepted,
  });
}
