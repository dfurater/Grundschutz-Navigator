import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { CLASS_2_IMPORT_LIMITS } from './class2ImportLimits.mjs';

/**
 * Die Grenzwerte selbst stehen in `class2ImportLimits.mjs` — reines ESM, damit
 * der Messapparat aus GSPP-382 sie in einer nackten Node-Laufzeit ohne
 * Aliasauflösung und ohne TypeScript aus derselben Quelle lesen kann. Hier nur
 * die Weiterreichung: Verbraucher im Anwendungspfad importieren die Grenzen
 * weiterhin über den Importvertrag.
 */
export { CLASS_2_IMPORT_LIMITS };

export const CLASS_2_IMPORT_VALIDATOR = Object.freeze({
  name: 'gspp-class-2-import',
  version: '1',
});

/** Verhindert einen dauerhaft hängenden Klasse-2-Import im Main-Thread. */
export const CLASS_2_IMPORT_WORKER_TIMEOUT_MS = 30_000;

export function createClass2ByteLimitDiagnostic(): OscalDiagnostic {
  return createOscalDiagnostic({
    code: 'OSCAL_BYTE_LIMIT_EXCEEDED',
    stage: 'resource-limit',
    validator: CLASS_2_IMPORT_VALIDATOR,
    path: '/',
    params: { limitBytes: CLASS_2_IMPORT_LIMITS.maxBytes },
  });
}
