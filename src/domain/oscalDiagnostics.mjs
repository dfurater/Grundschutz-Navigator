// =============================================================================
// Diagnosemodell des OSCAL-Validierungsvertrags (GSPP-282, GSPP-285, GSPP-336)
//
// Reines ESM, damit App und Node-CI-Skripte dieselben redigierten Diagnosen
// erzeugen. Die Typen liegen in oscalDiagnostics.d.mts; oscalDiagnostics.ts
// bleibt der typsichere Einstiegspunkt für TypeScript-Importe.
// =============================================================================

export const OSCAL_DIAGNOSTIC_STAGES = Object.freeze([
  'resource-limit',
  'json-syntax',
  'root-dispatch',
  'json-schema',
  'oscal-constraint',
  'reference',
  'domain',
]);

const STRUCTURAL_SIGNATURE_PART = /^[A-Za-z0-9./:@_-]+$/;

function toCamelCase(value) {
  return value.toLowerCase().replace(/[-_](.)/g, (_match, character) => character.toUpperCase());
}

export function toDiagnosticMessageKey(stage, code) {
  return `oscal.${toCamelCase(stage)}.${toCamelCase(code.replace(/^OSCAL_/, ''))}`;
}

/**
 * Leitet die stabile Signatur aus freigegebenen Strukturteilen ab. Ohne
 * Zusatzteile bleibt der lang etablierte Standard `name@version|code|path`
 * unverändert. Zusatzteile sind ausschließlich für fest verdrahtete externe
 * Validator-Formate vorgesehen und dürfen keine Dokumentwerte transportieren.
 */
export function toDiagnosticSignature(validator, code, path, signatureParts) {
  const prefix = `${validator.name}@${validator.version}`;

  if (signatureParts === undefined) {
    return `${prefix}|${code}|${path}`;
  }
  if (
    !Array.isArray(signatureParts) ||
    signatureParts.length === 0 ||
    signatureParts.some(
      (part) => typeof part !== 'string' || !STRUCTURAL_SIGNATURE_PART.test(part),
    )
  ) {
    throw new Error('Diagnostic signature parts must be non-empty approved structural tokens');
  }

  return `${prefix}|${signatureParts.join('|')}`;
}

export function createOscalDiagnostic(input) {
  return Object.freeze({
    code: input.code,
    severity: 'error',
    stage: input.stage,
    artifact: Object.freeze({
      key: input.artifact?.key ?? null,
      rootType: input.artifact?.rootType ?? null,
      oscalVersion: input.artifact?.oscalVersion ?? null,
    }),
    path: input.path,
    validator: Object.freeze({ ...input.validator }),
    signature: toDiagnosticSignature(
      input.validator,
      input.code,
      input.path,
      input.signatureParts,
    ),
    messageKey: toDiagnosticMessageKey(input.stage, input.code),
    params: Object.freeze({ ...input.params }),
  });
}
