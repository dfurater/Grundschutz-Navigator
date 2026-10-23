// =============================================================================
// Hashprüfung für Klasse-2-Evidenzressourcen (GSPP-349). Prüft die an einem
// `rlink` deklarierten Hashes gegen die eingebettete `base64`-Nutzlast derselben
// `back-matter`-Ressource. Getrennt von `integrity.ts`, das Klasse-1-exklusiv
// bleibt. Kein Netz, kein Speicher, keine Ausgabe von Hash- oder Inhaltswerten.
// =============================================================================

import { isJsonObject, readArray, type JsonObject } from '@/domain/jsonGuards';
import { decodeEvidenceContent } from '@/domain/evidencePreview';
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

type DigestOf = (algorithm: EvidenceHashAlgorithm) => Promise<string>;

/** Berechnet jeden Algorithmus über `content` höchstens einmal. */
function digestCache(content: Uint8Array<ArrayBuffer>): DigestOf {
  const digests = new Map<EvidenceHashAlgorithm, Promise<string>>();
  return (algorithm) => {
    let digest = digests.get(algorithm);
    if (!digest) {
      digest = crypto.subtle.digest(algorithm, content).then(toHex);
      digests.set(algorithm, digest);
    }
    return digest;
  };
}

/**
 * Vorrang bei mehreren Hashes: Abweichung vor fehlgeformtem Wert vor
 * Übereinstimmung vor nicht zugelassenem Algorithmus; nicht zugelassene
 * Algorithmen neben zugelassenen bleiben unbewertet.
 */
async function checkHashes(hashes: DeclaredHashes, digestOf: DigestOf | undefined): Promise<EvidenceHashCheck> {
  if (hashes.length === 0) return { status: 'not-verifiable', reason: 'no-hash' };
  if (!digestOf) return { status: 'not-verifiable', reason: 'no-local-content' };

  let matched = false;
  let malformed = false;
  for (const { algorithm, value } of hashes) {
    if (!isAllowedAlgorithm(algorithm)) continue;
    if (!new RegExp(`^[0-9a-f]{${EVIDENCE_HASH_ALGORITHMS[algorithm]}}$`, 'i').test(value)) {
      malformed = true;
      continue;
    }
    if ((await digestOf(algorithm)) !== value.toLowerCase()) return { status: 'verified-mismatch' };
    matched = true;
  }
  if (malformed) return { status: 'not-verifiable', reason: 'malformed-hash' };
  if (matched) return { status: 'verified-match' };
  return { status: 'not-verifiable', reason: 'algorithm-not-allowed' };
}

/** Prüft deklarierte Hashes gegen `content` nach der Vorrangregel von `checkHashes()`. */
export function verifyEvidenceHashes(
  hashes: DeclaredHashes,
  content: Uint8Array<ArrayBuffer> | undefined,
): Promise<EvidenceHashCheck> {
  return checkHashes(hashes, content && digestCache(content));
}

/**
 * Ein Ergebnis je `rlink` der rohen `back-matter`-Ressource in Quellreihenfolge,
 * geprüft gegen die eigene `base64`-Nutzlast; jeder Algorithmus wird je
 * Ressource einmal berechnet.
 */
export async function verifyResourceIntegrity(
  resource: JsonObject,
): Promise<readonly EvidenceHashCheck[]> {
  const rlinks = readArray(resource.rlinks).filter(isJsonObject);
  if (rlinks.length === 0) return [];
  const content = decodeEvidenceContent(resource);
  const digestOf = content && digestCache(content);
  return Promise.all(rlinks.map((rlink) => checkHashes(readDeclaredHashes(rlink), digestOf)));
}
