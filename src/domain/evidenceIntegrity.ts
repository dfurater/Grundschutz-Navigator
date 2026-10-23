// =============================================================================
// Hashprüfung für Klasse-2-Evidenzressourcen (GSPP-349). Prüft die an einem
// `rlink` deklarierten Hashes gegen die eingebettete `base64`-Nutzlast derselben
// `back-matter`-Ressource. Getrennt von `integrity.ts`, das Klasse-1-exklusiv
// bleibt. Kein Netz, kein Speicher, keine Ausgabe von Hash- oder Inhaltswerten.
// =============================================================================

import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import { readDeclaredHashes, type ResolvedResourceLink } from '@/domain/referenceResolution';

/** Projektentscheidung, keine NIST-Vorgabe: die Algorithmen, die `crypto.subtle.digest` berechnet, mit ihrer Hex-Länge. */
export const EVIDENCE_HASH_ALGORITHMS = {
  'SHA-256': 64,
  'SHA-384': 96,
  'SHA-512': 128,
} as const;

export type EvidenceHashAlgorithm = keyof typeof EVIDENCE_HASH_ALGORITHMS;

export type EvidenceNotVerifiableReason =
  | 'no-hash'
  | 'algorithm-not-allowed'
  | 'no-local-content'
  | 'malformed-hash';

export type EvidenceHashCheck =
  | { readonly status: 'verified-match' }
  | { readonly status: 'verified-mismatch' }
  | { readonly status: 'not-verifiable'; readonly reason: EvidenceNotVerifiableReason };

type DeclaredHashes = ResolvedResourceLink['hashes'];

function isAllowedAlgorithm(algorithm: string): algorithm is EvidenceHashAlgorithm {
  return Object.hasOwn(EVIDENCE_HASH_ALGORITHMS, algorithm);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Prüft deklarierte Hashes gegen `content`. Vorrang bei mehreren Hashes:
 * Abweichung vor fehlgeformtem Wert vor Übereinstimmung vor nicht zugelassenem
 * Algorithmus; nicht zugelassene Algorithmen neben zugelassenen bleiben unbewertet.
 */
export async function verifyEvidenceHashes(
  hashes: DeclaredHashes,
  content: Uint8Array<ArrayBuffer> | undefined,
): Promise<EvidenceHashCheck> {
  if (hashes.length === 0) return { status: 'not-verifiable', reason: 'no-hash' };
  if (!content) return { status: 'not-verifiable', reason: 'no-local-content' };

  let matched = false;
  let malformed = false;
  for (const { algorithm, value } of hashes) {
    if (!isAllowedAlgorithm(algorithm)) continue;
    if (!new RegExp(`^[0-9a-f]{${EVIDENCE_HASH_ALGORITHMS[algorithm]}}$`, 'i').test(value)) {
      malformed = true;
      continue;
    }
    const digest = toHex(await crypto.subtle.digest(algorithm, content));
    if (digest !== value.toLowerCase()) return { status: 'verified-mismatch' };
    matched = true;
  }
  if (malformed) return { status: 'not-verifiable', reason: 'malformed-hash' };
  if (matched) return { status: 'verified-match' };
  return { status: 'not-verifiable', reason: 'algorithm-not-allowed' };
}

/** Dekodiert `base64.value` im Speicher; fehlender oder ungültiger Wert ergibt `undefined`. */
function decodeEmbeddedContent(resource: JsonObject): Uint8Array<ArrayBuffer> | undefined {
  const encoded = isJsonObject(resource.base64) ? readString(resource.base64.value) : undefined;
  if (encoded === undefined) return undefined;
  try {
    return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/**
 * Ein Ergebnis je `rlink` der rohen `back-matter`-Ressource in Quellreihenfolge,
 * geprüft gegen die eigene `base64`-Nutzlast.
 */
export async function verifyResourceIntegrity(
  resource: JsonObject,
): Promise<readonly EvidenceHashCheck[]> {
  const rlinks = readArray(resource.rlinks).filter(isJsonObject);
  if (rlinks.length === 0) return [];
  const content = decodeEmbeddedContent(resource);
  return Promise.all(rlinks.map((rlink) => verifyEvidenceHashes(readDeclaredHashes(rlink), content)));
}
