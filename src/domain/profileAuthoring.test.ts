import { describe, expect, it } from 'vitest';
import {
  addPattern, importModesFor, readProfileImports, removePattern, setImportMode, setPattern, setSelectedControl, setSelectedControls, setWithChildControls, ProfilePatchError,
} from '@/domain/profileAuthoring';
import { addImport, alignImportBindings, createProfileSource, removeImport, shiftImportBindings } from '@/domain/profileImportList';
import { processClass2OscalBytes } from '@/domain/oscalClass2Import';
import { makeProfileSource, profileSpecFor } from '@/test/fixtures/profiles';
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';

const RESOURCE = 'aaaaaaaa-0000-4000-8000-000000000001';
const SECOND = 'aaaaaaaa-0000-4000-8000-000000000002';

function newProfile(oscalVersion: PinnedOscalVersion) {
  return createProfileSource({
    uuid: 'bbbbbbbb-0000-4000-8000-000000000001', resourceUuid: RESOURCE, title: 'Anwenderkatalog',
    profileTitle: 'Paket', oscalVersion, lastModified: '2026-10-20T10:00:00.000Z',
  }).source;
}

async function schemaValid(source: unknown): Promise<boolean> {
  return (await processClass2OscalBytes(new TextEncoder().encode(JSON.stringify(source)), { trustClass: 'class-2-local-user' })).ok;
}

describe('Neues Profil', () => {
  it.each(['1.1.3', '1.2.2'] as const)('ist in %s schemagültig und trägt Version, Fragment-href und Ressource', async (version) => {
    const source = newProfile(version) as { profile: Record<string, never> };
    expect(source.profile.metadata).toMatchObject({ 'oscal-version': version, title: 'Paket' });
    expect(source.profile.imports).toEqual([{ href: `#${RESOURCE}`, 'include-all': {} }]);
    expect(source.profile['back-matter']).toEqual({ resources: [{ uuid: RESOURCE, title: 'Anwenderkatalog' }] });
    expect(await schemaValid(source)).toBe(true);
  });

  it('verlangt einen Titel', () => {
    expect(() => createProfileSource({
      uuid: RESOURCE, resourceUuid: SECOND, title: 'x', profileTitle: '  ', oscalVersion: '1.1.3', lastModified: '2026-10-20T10:00:00Z',
    })).toThrow(ProfilePatchError);
  });
});

describe('Import-Formular entlang der Schemastruktur', () => {
  it('bietet „keine Auswahl“ nur in 1.1.x an und lehnt sie in 1.2.x ab', () => {
    expect(importModesFor('1.1.3')).toEqual(['controls', 'all', 'none']);
    expect(importModesFor('1.2.2')).toEqual(['controls', 'all']);
    expect(() => setImportMode(newProfile('1.2.2'), 0, 'none', '1.2.2')).toThrow('PROFILE_IMPORT_MODE_UNSUPPORTED');
  });

  it.each(['1.1.3', '1.2.2'] as const)('hält in %s genau einen Zweig und bleibt schemagültig', async (version) => {
    let source = setImportMode(newProfile(version), 0, 'controls', version);
    source = setSelectedControls(source, 0, 'include', ['A.1', 'A.2'], true);
    expect(readProfileImports(source)[0]).toMatchObject({ mode: 'controls', include: { withIds: ['A.1', 'A.2'] } });
    expect(await schemaValid(source)).toBe(true);
    source = setImportMode(source, 0, 'all', version);
    const entry = (source as { profile: { imports: Record<string, unknown>[] } }).profile.imports[0];
    expect(Object.keys(entry).sort()).toEqual(['href', 'include-all']);
    expect(await schemaValid(source)).toBe(true);
    if (version === '1.1.3') expect(await schemaValid(setImportMode(source, 0, 'none', version))).toBe(true);
  });

  it('setzt exclude-controls auch neben include-all, schemagültig in 1.2.2', async () => {
    let source = setSelectedControl(newProfile('1.2.2'), 0, 'exclude', 'A.2', true);
    source = addPattern(source, 0, 'exclude');
    source = setPattern(source, 0, 'exclude', { selector: 0, item: 0 }, 'GEB.*');
    expect(readProfileImports(source)[0]).toMatchObject({
      mode: 'all', exclude: { withIds: ['A.2'], patterns: [{ selector: 0, item: 0, pattern: 'GEB.*' }] },
    });
    expect(await schemaValid(source)).toBe(true);
    source = removePattern(setSelectedControl(source, 0, 'exclude', 'A.2', false), 0, 'exclude', { selector: 0, item: 0 });
    expect(Object.hasOwn((source as { profile: { imports: object[] } }).profile.imports[0], 'exclude-controls')).toBe(false);
  });

  it('akzeptiert für with-child-controls nur yes und no', async () => {
    const source = setWithChildControls(setImportMode(newProfile('1.2.2'), 0, 'controls', '1.2.2'), 0, 'include', 'yes');
    expect(readProfileImports(source)[0].include.withChildControls).toBe('yes');
    expect(await schemaValid(setSelectedControl(source, 0, 'include', 'A.1', true))).toBe(true);
    expect(() => setWithChildControls(source, 0, 'include', 'ja')).toThrow('PROFILE_WITH_CHILD_CONTROLS_INVALID');
  });

  it('zeigt einen gemischten with-child-controls-Zustand und schreibt den Wert in jeden Selektor', () => {
    const source = setImportMode(newProfile('1.2.2'), 0, 'controls', '1.2.2') as { profile: { imports: Record<string, unknown>[] } };
    source.profile.imports[0]['include-controls'] = [{ 'with-ids': ['A'], 'with-child-controls': 'no' }, { 'with-ids': ['B'], 'with-child-controls': 'yes' }];
    expect(readProfileImports(source)[0].include.withChildControls).toBe('mixed');
    const written = setWithChildControls(source, 0, 'include', 'yes');
    expect(readProfileImports(written)[0].include.withChildControls).toBe('yes');
  });

  it('entfernt eine Anforderung aus jedem Selektor und lässt Fremdfelder unverändert', () => {
    const source = makeProfileSource(profileSpecFor('profile-gspp'));
    const imports = (source.profile as { imports: Record<string, unknown>[] }).imports;
    imports[2]['x-extension'] = { kept: true };
    const [first] = readProfileImports(source)[2].include.withIds;
    const patched = setSelectedControl(source, 2, 'include', first, false) as typeof source;
    const after = (patched.profile as { imports: Record<string, unknown>[] }).imports[2];
    expect(after['x-extension']).toEqual({ kept: true });
    expect(readProfileImports(patched)[2].include.withIds).not.toContain(first);
    expect((patched.profile as Record<string, unknown>)['back-matter']).toEqual((source.profile as Record<string, unknown>)['back-matter']);
    expect(readProfileImports(source)[2].include.withIds).toContain(first);
  });
});

describe('Importe hinzufügen und entfernen', () => {
  it('hängt Import und Ressource an und behält mindestens einen Import', async () => {
    const added = addImport(newProfile('1.1.3'), { resourceUuid: SECOND, title: 'Lieferkette' });
    expect(added).toMatchObject({ index: 1, href: `#${SECOND}` });
    expect(readProfileImports(added.source).map((entry) => entry.resourceTitle)).toEqual(['Anwenderkatalog', 'Lieferkette']);
    expect(await schemaValid(added.source)).toBe(true);
    const removed = removeImport(added.source, 0);
    expect(readProfileImports(removed).map((entry) => entry.href)).toEqual([`#${SECOND}`]);
    expect(() => removeImport(removed, 0)).toThrow('PROFILE_IMPORTS_REQUIRED');
  });

  it('verschiebt Bindungen beim Entfernen und richtet sie an einem verschobenen Entwurf aus', () => {
    const at = (index: number, href: string, target: string) => ({ pointer: `/profile/imports/${index}/href`, href, target });
    const other = { pointer: '/profile/other', href: 'x', target: 'o' };
    expect(shiftImportBindings([at(0, '#a', 'A'), at(1, '#a', 'B'), other], 0)).toEqual([at(0, '#a', 'B'), other]);

    const doc = (...hrefs: string[]) => ({ profile: { imports: hrefs.map((href) => ({ href })) } });
    const stored = doc('#a', '#a', '#c');
    expect(alignImportBindings([at(0, '#a', 'A'), at(1, '#a', 'B')], stored, doc('#a', '#a', '#c'))).toEqual([at(0, '#a', 'A'), at(1, '#a', 'B')]);
    // Angehängt: Anfang unverändert, beide Duplikate behalten ihre Ziele.
    expect(alignImportBindings([at(0, '#a', 'A'), at(1, '#a', 'B')], doc('#a', '#a'), doc('#a', '#a', '#d'))).toEqual([at(0, '#a', 'A'), at(1, '#a', 'B')]);
    // Vorn entfernt: Das Ende rückt nach, ein eindeutiger href folgt seiner Bindung.
    expect(alignImportBindings([at(0, '#x', 'X'), at(1, '#a', 'A'), at(2, '#c', 'C'), other], doc('#x', '#a', '#c'), doc('#a', '#c'))).toEqual([at(0, '#a', 'A'), at(1, '#c', 'C'), other]);
    // Mehrdeutig: Welches von zwei gleichen Duplikaten entfernt wurde, ist nicht entscheidbar.
    expect(alignImportBindings([at(0, '#a', 'A')], doc('#a', '#a'), doc('#a'))).toEqual([]);
    expect(alignImportBindings([at(0, '#a', 'A'), at(1, '#a', 'B'), at(2, '#c', 'C')], stored, doc('#a', '#c'))).toEqual([at(1, '#c', 'C')]);
    // Entfernen plus Anhängen: Der verbliebene Duplikat-Import ist nicht zuzuordnen, der eindeutige folgt.
    expect(alignImportBindings([at(0, '#a', 'A'), at(1, '#a', 'B'), at(2, '#b', 'C')], doc('#a', '#a', '#b'), doc('#a', '#b', '#n'))).toEqual([at(1, '#b', 'C')]);
    expect(alignImportBindings([at(0, '#a', 'A'), at(1, '#a', 'B'), at(2, '#c', 'C')], stored, doc('#a', '#c', '#d'))).toEqual([at(1, '#c', 'C')]);
  });

  it('erzeugt keinen Import ohne href', () => {
    const source = addImport(newProfile('1.2.2'), { resourceUuid: SECOND, title: 'Ziel' }).source;
    expect(readProfileImports(source).every((entry) => entry.href?.startsWith('#'))).toBe(true);
  });
});
