import { createHash } from 'node:crypto';
import { sha1Bytes } from '../src/domain/sha1.mjs';

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Git-Objekt-ID; die Inhaltsvertrauensprüfung erfolgt separat über SHA-256. */
export function computeGitBlobSha(contents) {
  const header = new TextEncoder().encode(`blob ${contents.length}\0`);
  const framed = new Uint8Array(header.length + contents.length);
  framed.set(header);
  framed.set(contents, header.length);
  return Buffer.from(sha1Bytes(framed)).toString('hex');
}
