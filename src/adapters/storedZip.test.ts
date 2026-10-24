import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createStoredZip, storedZipByteLength } from '@/adapters/storedZip';

const encode = (text: string) => new TextEncoder().encode(text);

describe('stored ZIP', () => {
  it('is independently readable with correct CRC, Unicode content and empty files', () => {
    const entries = [
      { name: 'document.json', data: encode('{"title":"Prüfung"}') },
      { name: 'evidence/00000000-0000-4000-8000-000000000001.bin', data: new Uint8Array([0, 255, 1]) },
      { name: 'evidence/00000000-0000-4000-8000-000000000002.bin', data: new Uint8Array() },
    ];
    const size = storedZipByteLength(entries.map(({ name, data }) => ({ name, byteLength: data.length })));
    const zip = createStoredZip(entries, size);
    expect(zip).toHaveLength(size);
    const decoded = JSON.parse(execFileSync('python3', ['-c',
      'import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:list(z.read(n)) for n in z.namelist()}))',
    ], { input: zip, encoding: 'utf8' }));
    expect(decoded).toEqual(Object.fromEntries(entries.map(({ name, data }) => [name, [...data]])));
    expect(createStoredZip(entries, size)).toEqual(zip);
    expect(() => createStoredZip(entries, size - 1)).toThrow('EVIDENCE_ZIP_INVALID');
  });

  it('accepts exactly 16 MiB and rejects one byte more before allocating an archive', () => {
    const maxBytes = 16 * 1024 * 1024;
    const overhead = storedZipByteLength([{ name: 'document.json', byteLength: 0 }]);
    const data = new Uint8Array(maxBytes - overhead);
    expect(createStoredZip([{ name: 'document.json', data }], maxBytes)).toHaveLength(maxBytes);
    expect(() => createStoredZip([{ name: 'document.json', data: new Uint8Array(data.length + 1) }], maxBytes)).toThrow('EVIDENCE_ZIP_INVALID');
  });

  it.each(['/absolute', '../escape', 'evidence/../../escape', 'a\\b', 'a\u0000b', 'document.json/child'])('rejects unsafe name %s', name => {
    expect(() => createStoredZip([{ name, data: encode('x') }], 1024)).toThrow('EVIDENCE_ZIP_INVALID');
  });

  it('rejects invalid archive budgets', () => {
    for (const maxBytes of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createStoredZip([{ name: 'document.json', data: encode('x') }], maxBytes)).toThrow('EVIDENCE_ZIP_INVALID');
    }
  });

  it('bounds the complete ZIP to 32-bit offsets using metadata without large allocations', () => {
    const overhead = storedZipByteLength([{ name: 'document.json', byteLength: 0 }]);
    const byteLength = 0xffffffff - overhead;
    expect(storedZipByteLength([{ name: 'document.json', byteLength }])).toBe(0xffffffff);
    expect(() => storedZipByteLength([{ name: 'document.json', byteLength: byteLength + 1 }])).toThrow('EVIDENCE_ZIP_INVALID');
  });

  it('rejects duplicate names, excessive entries and invalid size metadata', () => {
    const entry = { name: 'document.json', data: encode('x') };
    expect(() => createStoredZip([entry, entry], 1024)).toThrow('EVIDENCE_ZIP_INVALID');
    expect(() => storedZipByteLength(Array.from({ length: 65_536 }, () => ({ name: 'document.json', byteLength: 0 })))).toThrow('EVIDENCE_ZIP_INVALID');
    for (const byteLength of [-1, NaN, 0x100000000, 1.5]) {
      expect(() => storedZipByteLength([{ name: 'document.json', byteLength }])).toThrow('EVIDENCE_ZIP_INVALID');
    }
  });
});
