import { describe, expect, it } from 'vitest';
import { decodedBase64ByteLength } from '@/domain/oscalBackMatterBase64';

describe('decodedBase64ByteLength', () => {
  it.each(Array.from({ length: 13 }, (_, bytes) => bytes))(
    'trifft die von atob dekodierte Größe für %i Byte gepolstert und ungepolstert',
    (bytes) => {
      const padded = Buffer.alloc(bytes).toString('base64');
      const unpadded = padded.replace(/=+$/, '');

      expect(decodedBase64ByteLength(padded)).toBe(atob(padded).length);
      expect(decodedBase64ByteLength(unpadded)).toBe(atob(unpadded).length);
    },
  );

  it('überschätzt eingestreuten Whitespace, den atob ignoriert, nie', () => {
    const encoded = 'aGFs\nbG8';

    expect(decodedBase64ByteLength(encoded)).toBeGreaterThanOrEqual(atob(encoded).length);
  });
});
