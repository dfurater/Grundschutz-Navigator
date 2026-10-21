import { describe, expect, it } from 'vitest';
import { documentContent } from '@/domain/documentContent';
import { OSCAL_ROOT_KEYS } from '@/domain/oscalVersionMatrix';

describe('documentContent', () => {
  it.each(OSCAL_ROOT_KEYS)('entfernt Root-uuid und last-modified unter %s', (rootType) => {
    const source = { [rootType]: { uuid: 'root-uuid', metadata: { title: 'Titel', 'last-modified': '2026-01-01T00:00:00Z' }, extra: 1 } };
    expect(documentContent(source, rootType)).toEqual({ [rootType]: { metadata: { title: 'Titel' }, extra: 1 } });
  });

  it('lässt ein fehlendes Root-Objekt unverändert', () => {
    expect(documentContent({ other: 1 }, 'profile')).toEqual({ other: 1 });
  });

  it('behält Inhalt ohne Metadaten', () => {
    expect(documentContent({ profile: { uuid: 'root-uuid' } }, 'profile')).toEqual({ profile: {} });
  });

  it('behält nicht-objektartige Metadaten', () => {
    expect(documentContent({ profile: { uuid: 'root-uuid', metadata: 'roh' } }, 'profile')).toEqual({ profile: { metadata: 'roh' } });
  });
});
