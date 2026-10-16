// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { computeGitBlobSha, sha256Hex } from './contentHashes.mjs';

describe('content hashes', () => {
  it('uses standard SHA-256 for text and the exact binary view', () => {
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(sha256Hex('abc')).toBe(expected);
    expect(sha256Hex(Buffer.from('abc'))).toBe(expected);
    expect(sha256Hex(new Uint8Array([0, 97, 98, 99, 0]).subarray(1, 4))).toBe(expected);
    expect(() => sha256Hex(42)).toThrow();
  });

  it('uses Git blob framing and byte length including non-ASCII bytes', () => {
    expect(computeGitBlobSha(Buffer.from('ä😀\n'))).toBe('a58700df26da25e881a6e6b40ff4cdd46f2e407e');
    expect(computeGitBlobSha(Buffer.from(''))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(computeGitBlobSha(Buffer.from('test content\n'))).toBe('d670460b4b4aece5915caf5c68d12f560a9fe3e4');
  });
});
