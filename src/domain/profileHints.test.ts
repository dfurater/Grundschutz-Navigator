import { describe, expect, it } from 'vitest';
import { collectProfileHints, PROFILE_HINT_CODES } from '@/domain/profileHints';
import { processClass2OscalBytes } from '@/domain/oscalClass2Import';
import { makeSyntheticProfile, SYNTHETIC_RESOURCE_HREF } from '@/test/fixtures/profiles';

describe('Unterbestimmte Konstrukte', () => {
  const underdetermined = makeSyntheticProfile('1.2.2', {
    imports: [{
      href: SYNTHETIC_RESOURCE_HREF,
      'include-controls': [{}, { matching: [{ remarks: 'ohne Muster' }] }],
    }],
    modify: { alters: [{ 'control-id': 'A.1' }, { 'control-id': 'A.2', removes: [{}] }] },
  });

  it('nimmt die schemagültige Quelle an und meldet jedes Konstrukt als Hinweis', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(underdetermined));
    const imported = await processClass2OscalBytes(bytes, { trustClass: 'class-2-local-user' });
    expect(imported.ok).toBe(true);
    expect(collectProfileHints(underdetermined)).toEqual([
      { code: PROFILE_HINT_CODES.selectionEmpty, path: '/profile/imports/0/include-controls/0' },
      { code: PROFILE_HINT_CODES.matchingWithoutPattern, path: '/profile/imports/0/include-controls/1/matching/0' },
      { code: PROFILE_HINT_CODES.alterWithoutEffect, path: '/profile/modify/alters/0' },
      { code: PROFILE_HINT_CODES.removeWithoutCriteria, path: '/profile/modify/alters/1/removes/0' },
    ]);
  });

  it('meldet ein leeres modify und keinen Dokumentwert', () => {
    const hints = collectProfileHints(makeSyntheticProfile('1.1.3', { modify: {} }));
    expect(hints).toEqual([{ code: PROFILE_HINT_CODES.modifyEmpty, path: '/profile/modify' }]);
    expect(JSON.stringify(collectProfileHints(underdetermined))).not.toContain('ohne Muster');
  });
});
