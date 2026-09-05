// =============================================================================
// Erreichbarkeitsinvarianten der Klasse-2-Ressourcengrenzen (GSPP-382)
//
// Eine Grenze, die ein Dokument über den öffentlichen Byte-Eintrittspunkt gar
// nicht überschreiten KANN, ist keine Kontrolle. Genau das war
// `maxDecodedBase64Bytes` bis zu diesem Issue: auf denselben Wert wie
// `maxBytes` gesetzt und damit arithmetisch unerreichbar. Diese Datei hält die
// Erreichbarkeit als dauerhafte Invariante fest, damit die Grenze nicht
// unbemerkt wieder tot gestellt wird.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { enforceClass2ObjectGraphInvariants } from '@/domain/oscalObjectGraph';
import { parseClass2OscalInput } from '@/domain/oscalImportProcessing';

/**
 * Arithmetik von `accountEmbeddedBase64`: `floor(len / 4) * 3` abzüglich
 * Polsterung. Ohne Polsterung ist das die dekodierte Obergrenze.
 */
function maxDecodedBytesForEncodedLength(encodedLength: number): number {
  return Math.floor(encodedLength / 4) * 3;
}

/**
 * Kodierter Text, dessen dekodierte Größe exakt `decodedBytes` beträgt.
 *
 * Bewusst hier und nicht aus dem Messwerkzeug importiert: `src/` hängt nicht
 * an `scripts/`. Die Polsterung trägt den Rest — Rest 1 zwei Zeichen, Rest 2
 * eines, Rest 3 eine volle Gruppe.
 */
function encodedBase64ForDecodedBytes(decodedBytes: number): string {
  const fullGroups = Math.floor((decodedBytes - 1) / 3);
  const remainder = decodedBytes - fullGroups * 3;
  const tail = remainder === 1 ? 'AA==' : remainder === 2 ? 'AAA=' : 'AAAA';
  return `${'A'.repeat(fullGroups * 4)}${tail}`;
}

/** Dieselbe Rechnung einschließlich Polsterung, für Kantenprüfungen. */
function decodedBytesOf(encoded: string): number {
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return maxDecodedBytesForEncodedLength(encoded.length) - padding;
}

describe('Erreichbarkeit der Klasse-2-Grenzen', () => {
  it('lässt die Base64-Grenze unter der Byte-Obergrenze auslösen', () => {
    // Selbst wenn das GESAMTE zugelassene Dokument aus base64-Text bestünde —
    // ohne Schlüssel, Klammern und Anführungszeichen — bliebe die dekodierte
    // Summe bei drei Vierteln davon. Liegt die Grenze darüber, ist sie tot.
    const decodedCeiling = maxDecodedBytesForEncodedLength(CLASS_2_IMPORT_LIMITS.maxBytes);

    expect(CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes).toBeLessThan(decodedCeiling);
  });

  it('weist ein Dokument über die Base64-Grenze am echten Byte-Eintrittspunkt ab', () => {
    // Kein Umweg an Stufe 1 vorbei: Das Dokument geht als Bytes hinein und
    // muss allein deshalb scheitern, weil seine base64-Nutzlast die Grenze
    // reißt — nicht weil es zu groß, zu tief oder zu knotenreich wäre.
    const encodedLength =
      Math.ceil((CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes + 1) / 3) * 4;
    const document = {
      catalog: {
        'back-matter': {
          resources: [{ uuid: 'gspp-382-fixture', base64: { value: 'A'.repeat(encodedLength) } }],
        },
      },
    };
    const bytes = new TextEncoder().encode(JSON.stringify(document));

    expect(bytes.byteLength).toBeLessThanOrEqual(CLASS_2_IMPORT_LIMITS.maxBytes);

    const parsed = parseClass2OscalInput(bytes);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(enforceClass2ObjectGraphInvariants(parsed.source)).toMatchObject({
      code: 'OSCAL_RESOURCE_BASE64_LIMIT_EXCEEDED',
      stage: 'resource-limit',
    });
  });

  it('lässt eine Nutzlast genau auf der Base64-Grenze passieren', () => {
    // `maxDecodedBase64Bytes` ist nicht durch drei teilbar. Eine Länge aus
    // `(grenze / 3) * 4` wäre gebrochen, würde von `repeat` abgeschnitten und
    // läge damit ein Byte UNTER der Grenze — der Test hätte die Kante nie
    // berührt. Die Polsterung trifft sie punktgenau (Gitar- und
    // Greptile-Befund zu 6643714).
    const encoded = encodedBase64ForDecodedBytes(
      CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes,
    );
    expect(decodedBytesOf(encoded)).toBe(CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes);

    const document = {
      catalog: {
        'back-matter': { resources: [{ uuid: 'gspp-382-fixture', base64: { value: encoded } }] },
      },
    };
    const parsed = parseClass2OscalInput(new TextEncoder().encode(JSON.stringify(document)));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(enforceClass2ObjectGraphInvariants(parsed.source)).toBeNull();
  });

  it('weist eine Nutzlast ein Byte über der Base64-Grenze ab', () => {
    const encoded = encodedBase64ForDecodedBytes(
      CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes + 1,
    );
    const document = {
      catalog: {
        'back-matter': { resources: [{ uuid: 'gspp-382-fixture', base64: { value: encoded } }] },
      },
    };
    const parsed = parseClass2OscalInput(new TextEncoder().encode(JSON.stringify(document)));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(enforceClass2ObjectGraphInvariants(parsed.source)).toMatchObject({
      code: 'OSCAL_RESOURCE_BASE64_LIMIT_EXCEEDED',
    });
  });
});
