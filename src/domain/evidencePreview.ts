import { isJsonObject, readString, type JsonObject } from '@/domain/jsonGuards';
import { decodedBase64ByteLength } from '@/domain/oscalBackMatterBase64';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';

/** Projektentscheidung: nur diese deklarierten Medienarten dürfen eine Vorschau erhalten. */
export const EVIDENCE_PREVIEW_MEDIA_TYPES: readonly string[] = Object.freeze([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain',
]);

export type EvidencePreviewDecision =
  | { readonly kind: 'preview' }
  | { readonly kind: 'metadata'; readonly reason: 'media-type-missing' | 'media-type-not-allowed' };

export function decideEvidencePreview(mediaType: unknown): EvidencePreviewDecision {
  if (typeof mediaType !== 'string' || !mediaType.trim()) return { kind: 'metadata', reason: 'media-type-missing' };
  return EVIDENCE_PREVIEW_MEDIA_TYPES.includes(mediaType.trim().toLowerCase())
    ? { kind: 'preview' }
    : { kind: 'metadata', reason: 'media-type-not-allowed' };
}

/**
 * Dekodiert `base64.value` im Speicher; ein fehlender, ungültiger oder über
 * `maxDecodedBase64Bytes` liegender Wert ergibt `undefined`. Die eigene
 * Größenprüfung hält die Funktion auch für Aufrufer außerhalb der Importkette fail-closed.
 */
export function decodeEvidenceContent(resource: JsonObject): Uint8Array<ArrayBuffer> | undefined {
  const encoded = isJsonObject(resource.base64) ? readString(resource.base64.value) : undefined;
  if (encoded === undefined) return undefined;
  if (decodedBase64ByteLength(encoded) > CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes) return undefined;
  try {
    return Uint8Array.from(atob(encoded), (char) => char.codePointAt(0)!);
  } catch {
    return undefined;
  }
}

