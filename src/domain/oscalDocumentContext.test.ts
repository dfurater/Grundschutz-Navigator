import { describe, expect, it } from 'vitest';
import { acceptsOscalVersionPrefix, type TrustClass } from './oscalDocumentContext';

describe('acceptsOscalVersionPrefix', () => {
  it('lässt das v-Präfix nur für lokale Klasse-2-Dokumente zu (GSPP-357)', () => {
    expect(acceptsOscalVersionPrefix({ trustClass: 'class-2-local-user' })).toBe(true);
  });

  it.each<TrustClass>(['class-1-verified-public', 'class-1-unverified-public'])(
    'verlangt von %s die exakte Version, auch unverifiziert',
    (trustClass) => {
      expect(acceptsOscalVersionPrefix({ trustClass })).toBe(false);
    },
  );
});
