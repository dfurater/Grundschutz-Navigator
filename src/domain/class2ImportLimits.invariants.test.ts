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
    const encodedLength = (CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes / 3) * 4;
    const document = {
      catalog: {
        'back-matter': {
          resources: [{ uuid: 'gspp-382-fixture', base64: { value: 'A'.repeat(encodedLength) } }],
        },
      },
    };
    const bytes = new TextEncoder().encode(JSON.stringify(document));
    const parsed = parseClass2OscalInput(bytes);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(enforceClass2ObjectGraphInvariants(parsed.source)).toBeNull();
  });
});
