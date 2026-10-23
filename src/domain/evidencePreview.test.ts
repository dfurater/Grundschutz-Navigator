import { afterEach, describe, expect, it, vi } from 'vitest';
import { decideEvidencePreview, decodeEvidenceContent, EVIDENCE_PREVIEW_MEDIA_TYPES } from '@/domain/evidencePreview';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';

afterEach(() => vi.restoreAllMocks());

describe('decideEvidencePreview', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain'])('erlaubt ausschließlich den deklarierten Typ %s', mediaType => {
    expect(decideEvidencePreview(mediaType)).toEqual({ kind: 'preview' });
    expect(decideEvidencePreview(` ${mediaType.toUpperCase()} `)).toEqual({ kind: 'preview' });
  });
  it.each([undefined, '', '  ', null, 42])('verweigert einen fehlenden Typ %s', mediaType => {
    expect(decideEvidencePreview(mediaType)).toEqual({ kind: 'metadata', reason: 'media-type-missing' });
  });
  it.each(['image/svg+xml', 'text/html', 'application/pdf', 'application/zip', 'application/x-msdownload', 'application/octet-stream', 'text/plain; charset=utf-8', 'photo.png', 'image/png\0'])('verweigert %s ohne Sniffing oder Endungsableitung', mediaType => {
    expect(decideEvidencePreview(mediaType)).toEqual({ kind: 'metadata', reason: 'media-type-not-allowed' });
  });
  it('hält die Allowlist unveränderlich', () => {
    expect(Object.isFrozen(EVIDENCE_PREVIEW_MEDIA_TYPES)).toBe(true);
    expect(EVIDENCE_PREVIEW_MEDIA_TYPES).toHaveLength(5);
  });
});

describe('decodeEvidenceContent', () => {
  it.each([{}, { base64: {} }, { base64: { value: 1 } }, { base64: { value: '%%%' } }])('verwirft fehlende und ungültige Inhalte', resource => {
    expect(decodeEvidenceContent(resource)).toBeUndefined();
  });
  it('dekodiert ausschließlich beim Aufruf und erhält Bytes', () => {
    const decode = vi.spyOn(globalThis, 'atob');
    expect(decodeEvidenceContent({ base64: { value: 'AP+A' } })).toEqual(new Uint8Array([0, 255, 128]));
    expect(decode).toHaveBeenCalledOnce();
  });
  it('akzeptiert die Grenze und verweigert auch ungepolsterte Übergrößen vor atob', () => {
    const limit = CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes;
    const encoded = Buffer.alloc(limit).toString('base64');
    expect(decodeEvidenceContent({ base64: { value: encoded } })).toHaveLength(limit);
    const decode = vi.spyOn(globalThis, 'atob');
    expect(decodeEvidenceContent({ base64: { value: Buffer.alloc(limit + 1).toString('base64').replace(/=+$/, '') } })).toBeUndefined();
    expect(decode).not.toHaveBeenCalled();
  });
});
