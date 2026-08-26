// =============================================================================
// Deterministische UUIDv5-Ableitung (RFC 4122 §4.3) — GSPP-291 Commit B
//
// Der aufgelöste Katalog braucht eine eigene Dokument-UUID, die bei
// byte-identischem Doppel-Lauf identisch ausfällt. Ein Zufallswert scheidet
// aus; stattdessen wird die UUID deterministisch aus einem festen
// Projektnamensraum und dem Namen abgeleitet.
//
// Die SHA-1-Implementierung ist absichtlich rein lokal und ohne
// Plattformabhängigkeit gehalten: crypto.subtle wäre asynchron und würde den
// synchronen Auflösungsweg aufreißen. SHA-1 ist hier kein Sicherheitsmittel,
// sondern ein RFC-konformer Identitätsverdichter — die Vertrauensklasse des
// Ergebnisses hängt nicht an dieser Hashfunktion (ADR-2 §10).
// =============================================================================

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

/** Rein lokale SHA-1-Kompression (FIPS 180-4) über Bytes, big-endian. */
export function sha1Bytes(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8;
  const paddedLength = (((input.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;

  // 64-Bit-Längenfeld big-endian — für realistische Eingaben reicht der
  // niederwertige Teil; der hochwertige bleibt 0.
  const lengthView = new DataView(padded.buffer);
  lengthView.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const words = new Uint32Array(80);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = lengthView.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 80; index += 1) {
      const mixed = words[index - 3]! ^ words[index - 8]! ^ words[index - 14]! ^ words[index - 16]!;
      words[index] = ((mixed << 1) | (mixed >>> 31)) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let index = 0; index < 80; index += 1) {
      let f: number;
      let k: number;
      if (index < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (index < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (index < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const rotated = ((a << 5) | (a >>> 27)) >>> 0;
      const temp = (((rotated + f) >>> 0) + e + k + words[index]!) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const digest = new Uint8Array(20);
  const view = new DataView(digest.buffer);
  view.setUint32(0, h0, false);
  view.setUint32(4, h1, false);
  view.setUint32(8, h2, false);
  view.setUint32(12, h3, false);
  view.setUint32(16, h4, false);
  return digest;
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
