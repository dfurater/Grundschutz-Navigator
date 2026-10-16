import { describe, expect, it } from 'vitest';
import { sha1Bytes } from '@/domain/sha1.mjs';

const sha1Hex = (text: string): string =>
  Array.from(sha1Bytes(new TextEncoder().encode(text)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

describe('sha1Bytes', () => {
  it('bildet die FIPS-180-Beispielvektoren ab', () => {
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(sha1Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    );
  });

  it('trifft die Blockgrenzen des Paddings', () => {
    expect(sha1Hex('a'.repeat(55))).toBe('c1c8bbdc22796e28c0e15163d20899b65621d65a');
    expect(sha1Hex('a'.repeat(56))).toBe('c2db330f6083854c99d4b5bfb6e8f29f201be699');
    expect(sha1Hex('a'.repeat(64))).toBe('0098ba824b5c16427bd7a1122a5a442a25ec644d');
  });
});
