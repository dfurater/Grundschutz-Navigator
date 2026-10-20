import { describe, expect, it } from 'vitest';
import { setSelectedControl } from '@/domain/profileAuthoring';
import { commitExplicitSave, respectsChangeOnWrite, sameProfileContent } from '@/domain/profileSave';
import { makeProfileSource, profileSpecFor } from '@/test/fixtures/profiles';

const STAMP = { uuid: 'cccccccc-0000-4000-8000-000000000001', lastModified: '2026-10-20T12:00:00.000Z' };

function profile(source: unknown) {
  return (source as { profile: { uuid: string; metadata: Record<string, string> } }).profile;
}

describe('Explizites Speichern (change-on-write)', () => {
  const stored = makeProfileSource(profileSpecFor('profile-gspp'));

  it('lässt UUID und last-modified ohne Inhaltsänderung unverändert, auch bei anderer Schlüsselreihenfolge', () => {
    const reordered = JSON.parse(JSON.stringify({ profile: Object.fromEntries(Object.entries(stored.profile as object).reverse()) }));
    expect(sameProfileContent(stored, reordered)).toBe(true);
    const saved = commitExplicitSave(stored, reordered, STAMP);
    expect(saved.changed).toBe(false);
    expect(profile(saved.source).uuid).toBe(profile(stored).uuid);
    expect(profile(saved.source).metadata['last-modified']).toBe(profile(stored).metadata['last-modified']);
    expect(respectsChangeOnWrite(stored, saved.source)).toBe(true);
  });

  it('vergibt bei Inhaltsänderung eine neue UUID und setzt last-modified', () => {
    const working = setSelectedControl(stored, 2, 'include', 'NEU.1', true);
    const saved = commitExplicitSave(stored, working, STAMP);
    expect(saved.changed).toBe(true);
    expect(profile(saved.source).uuid).toBe(STAMP.uuid);
    expect(profile(saved.source).metadata['last-modified']).toBe(STAMP.lastModified);
    expect(respectsChangeOnWrite(stored, saved.source)).toBe(true);
  });

  it('weist einen Schreibvorgang zurück, der bei Inhaltsänderung die UUID behält', () => {
    const working = setSelectedControl(stored, 2, 'include', 'NEU.1', true);
    expect(respectsChangeOnWrite(stored, working)).toBe(false);
    const stampOnly = structuredClone(working);
    profile(stampOnly).metadata['last-modified'] = STAMP.lastModified;
    expect(respectsChangeOnWrite(stored, stampOnly)).toBe(false);
  });
});
