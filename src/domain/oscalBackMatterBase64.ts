// =============================================================================
// Base64-Buchhaltung des Klasse-2-Ressourcenlimits (GSPP-289, fortgeführt in
// GSPP-291). Erkennt die Payload über die Pfad-Adjazenz
// `'back-matter' → 'resources' → <Index> → 'base64'` und summiert ihre
// dekodierte Größe rein arithmetisch — ohne Dekodierung, fail-closed am Limit.
// =============================================================================

import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { CLASS_2_IMPORT_LIMITS, CLASS_2_IMPORT_VALIDATOR } from '@/domain/oscalImportContract';

/**
 * Pfadfenster für die Base64-Erkennung über die Adjazenz
 * `'back-matter' → 'resources' → <Index> → 'base64'`, ohne volle Pfadarrays.
 */
export type PathWindow =
  | 'none'
  | 'after-back-matter-key'
  | 'in-resources-array'
  | 'in-resource-element';

export function windowForKey(window: PathWindow, key: string): PathWindow | 'base64-payload' {
  if (key === 'back-matter') return 'after-back-matter-key';
  if (key === 'resources' && window === 'after-back-matter-key') return 'in-resources-array';
  if (key === 'base64' && window === 'in-resource-element') return 'base64-payload';
  return 'none';
}

/** Fenster eines Arrayelements: nur Elemente des `resources`-Arrays tragen weiter. */
export function windowForElement(window: PathWindow): PathWindow {
  return window === 'in-resources-array' ? 'in-resource-element' : 'none';
}

function countBase64Padding(encoded: string): number {
  if (encoded.endsWith('==')) return 2;
  if (encoded.endsWith('=')) return 1;
  return 0;
}

function decodedBase64ByteLength(encoded: string): number {
  return Math.max(0, Math.floor(encoded.length / 4) * 3 - countBase64Padding(encoded));
}

type EmbeddedBase64Accounting =
  | { readonly kind: 'accounted'; readonly totalBytes: number }
  | { readonly kind: 'exceeded'; readonly diagnostic: OscalDiagnostic };

/** Summiert dekodierte Back-matter-base64-Größen ohne Dekodierung, fail-closed am Limit. */
export function accountEmbeddedBase64(
  payload: Record<string, unknown>,
  totalBytesSoFar: number,
): EmbeddedBase64Accounting {
  const encoded = payload['value'];
  if (typeof encoded !== 'string') {
    return { kind: 'accounted', totalBytes: totalBytesSoFar };
  }

  const totalBytes = totalBytesSoFar + decodedBase64ByteLength(encoded);
  if (totalBytes > CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes) {
    return {
      kind: 'exceeded',
      diagnostic: createOscalDiagnostic({
        code: 'OSCAL_RESOURCE_BASE64_LIMIT_EXCEEDED',
        stage: 'resource-limit',
        validator: CLASS_2_IMPORT_VALIDATOR,
        path: '/',
        params: { limitDecodedBase64Bytes: CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes },
      }),
    };
  }
  return { kind: 'accounted', totalBytes };
}
