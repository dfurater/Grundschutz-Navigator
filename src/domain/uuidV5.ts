// =============================================================================
// Deterministische UUIDv5-Ableitung (RFC 4122 §4.3) — GSPP-291 Commit B
//
// Der aufgelöste Katalog braucht eine eigene Dokument-UUID, die bei
// byte-identischem Doppel-Lauf identisch ausfällt. Ein Zufallswert scheidet
// aus; stattdessen wird die UUID deterministisch aus einem festen
// Projektnamensraum und dem Namen abgeleitet.
//
// Die SHA-1-Kompression kommt synchron aus `sha1.mjs`: crypto.subtle wäre
// asynchron und würde den synchronen Auflösungsweg aufreißen. SHA-1 ist hier kein Sicherheitsmittel,
// sondern ein RFC-konformer Identitätsverdichter — die Vertrauensklasse des
// Ergebnisses hängt nicht an dieser Hashfunktion (ADR-2 §10).
// =============================================================================

import { sha1Bytes } from '@/domain/sha1.mjs';

/** Fester, einmal erzeugter Namensraum dieses Projekts (UUIDv4, offline gezogen). */
export const PROFILE_RESOLUTION_NAMESPACE_UUID = '5af20882-7a1e-44b1-9f9e-148b5c49b428';

const HEX_ALPHABET = '0123456789abcdef';

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replaceAll('-', '');
  if (!/^[0-9a-f]{32}$/.test(clean)) {
    throw new TypeError('Ungültiges Hexformat im UUID-Namensraum');
  }
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Bildet eine UUIDv5 aus hexadezimalem Namensraum und Namen. Version- und
 * Variantennibble werden gemäß RFC 4122 §4.3 gesetzt.
 */
export function deriveUuidV5(namespace: string, name: string): string {
  const hash = sha1Bytes(concatBytes(hexToBytes(namespace), utf8Bytes(name)));

  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;

  let out = '';
  for (let index = 0; index < 16; index += 1) {
    if (index === 4 || index === 6 || index === 8 || index === 10) out += '-';
    out += HEX_ALPHABET[hash[index]! >> 4]! + HEX_ALPHABET[hash[index]! & 0x0f];
  }
  return out;
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left);
  merged.set(right, left.length);
  return merged;
}
