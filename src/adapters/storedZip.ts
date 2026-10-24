export interface ZipEntrySize { readonly name: string; readonly byteLength: number }
export interface ZipEntry { readonly name: string; readonly data: Uint8Array }

const encoder = new TextEncoder();
const SAFE_NAME = /^(?:document\.json|evidence\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.bin)$/;
const invalid = (): never => { throw new Error('EVIDENCE_ZIP_INVALID'); };
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

/** Exact size of ZIP STORE: local headers, central directory and EOCD; no extra fields. */
export function storedZipByteLength(entries: readonly ZipEntrySize[]): number {
  if (entries.length > 0xffff) return invalid();
  const names = new Set<string>();
  let bytes = 22;
  for (const { name, byteLength } of entries) {
    if (!SAFE_NAME.test(name) || names.has(name) || !Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > 0xffffffff) return invalid();
    names.add(name);
    bytes += 76 + 2 * encoder.encode(name).length + byteLength;
  }
  if (bytes > 0xffffffff) return invalid();
  return bytes;
}

/** Bounded ZIP STORE encoder with fixed timestamp (1980-01-01), UTF-8 names and CRC-32. */
export function createStoredZip(entries: readonly ZipEntry[], maxBytes: number): Uint8Array<ArrayBuffer> {
  const size = storedZipByteLength(entries.map(({ name, data }) => ({ name, byteLength: data.length })));
  if (!Number.isSafeInteger(maxBytes) || size > maxBytes) return invalid();
  const output = new Uint8Array(size);
  const view = new DataView(output.buffer);
  const directory = entries.map(({ name, data }) => ({ name: encoder.encode(name), data, crc: crc32(data), offset: 0 }));
  let position = 0;
  for (const entry of directory) {
    entry.offset = position;
    view.setUint32(position, 0x04034b50, true);
    view.setUint16(position + 4, 20, true);
    view.setUint16(position + 6, 0x0800, true);
    view.setUint16(position + 12, 33, true);
    view.setUint32(position + 14, entry.crc, true);
    view.setUint32(position + 18, entry.data.length, true);
    view.setUint32(position + 22, entry.data.length, true);
    view.setUint16(position + 26, entry.name.length, true);
    output.set(entry.name, position + 30);
    output.set(entry.data, position + 30 + entry.name.length);
    position += 30 + entry.name.length + entry.data.length;
  }
  const directoryStart = position;
  for (const entry of directory) {
    view.setUint32(position, 0x02014b50, true);
    view.setUint16(position + 4, 20, true);
    view.setUint16(position + 6, 20, true);
    view.setUint16(position + 8, 0x0800, true);
    view.setUint16(position + 14, 33, true);
    view.setUint32(position + 16, entry.crc, true);
    view.setUint32(position + 20, entry.data.length, true);
    view.setUint32(position + 24, entry.data.length, true);
    view.setUint16(position + 28, entry.name.length, true);
    view.setUint32(position + 42, entry.offset, true);
    output.set(entry.name, position + 46);
    position += 46 + entry.name.length;
  }
  view.setUint32(position, 0x06054b50, true);
  view.setUint16(position + 8, entries.length, true);
  view.setUint16(position + 10, entries.length, true);
  view.setUint32(position + 12, position - directoryStart, true);
  view.setUint32(position + 16, directoryStart, true);
  return output;
}
