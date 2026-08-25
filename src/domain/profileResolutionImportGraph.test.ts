import { describe, expect, it } from 'vitest';
import {
  buildProfileResolutionPlan,
  PROFILE_RESOLUTION_DIAGNOSTIC_CODES,
} from './profileResolutionImportGraph';

function catalog(version: string): Record<string, unknown> {
  return { catalog: { metadata: { 'oscal-version': version } } };
}

function profileWithImports(
  version: string,
  imports: readonly { href: string }[],
): Record<string, unknown> {
  return {
    profile: {
      uuid: '11111111-1111-4111-8111-111111111111',
      metadata: { 'oscal-version': version },
      imports: imports.map((imp) => ({ href: imp.href, 'include-all': {} })),
    },
  };
}

describe('Deterministischer Importgraph der Profile Resolution', () => {
  it('ordnet eine Profil-zu-Katalog-Kante ihr Ziel in fester Reihenfolge zu', () => {
    const plan = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-a',
      documents: new Map<string, unknown>([
        ['profile-a', profileWithImports('1.1.3', [{ href: '../c.json' }])],
        ['catalog-c', catalog('1.1.3')],
      ]),
      edgesByArtifactKey: new Map([
        ['profile-a', [{ href: '../c.json', artifactKey: 'catalog-c' }]],
      ]),
    });

    expect(plan).toMatchObject({
      ok: true,
      order: ['profile-a', 'catalog-c'],
      oscalVersion: '1.1.3',
    });
  });

  it('bricht bei einem Profilzyklus mit strukturierter Diagnose ab — ohne Teilergebnis', () => {
    const plan = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-a',
      documents: new Map<string, unknown>([
        [
          'profile-a',
          profileWithImports('1.1.3', [{ href: '#b' }]),
        ],
        [
          'profile-b',
          profileWithImports('1.1.3', [{ href: '#a' }]),
        ],
      ]),
      edgesByArtifactKey: new Map([
        ['profile-a', [{ href: '#b', artifactKey: 'profile-b' }]],
        ['profile-b', [{ href: '#a', artifactKey: 'profile-a' }]],
      ]),
    });

    expect(plan).toMatchObject({
      ok: false,
      diagnostic: { code: PROFILE_RESOLUTION_DIAGNOSTIC_CODES.CYCLE, stage: 'profile-resolution' },
    });
  });

  it('lehnt ein fehlendes Importziel fail-closed ab', () => {
    const plan = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-a',
      documents: new Map([['profile-a', profileWithImports('1.1.3', [{ href: '../x.json' }])]]),
      edgesByArtifactKey: new Map([
        ['profile-a', [{ href: '../x.json', artifactKey: 'catalog-x' }]],
      ]),
    });

    expect(plan).toMatchObject({
      ok: false,
      diagnostic: { code: PROFILE_RESOLUTION_DIAGNOSTIC_CODES.TARGET_MISSING },
    });
  });

  it('lehnt einen Root-Type-Mismatch des Ziels ab', () => {
    const plan = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-a',
      documents: new Map<string, unknown>([
        ['profile-a', profileWithImports('1.1.3', [{ href: '../w.json' }])],
        ['target-w', { mappingCollection: {} }],
      ]),
      edgesByArtifactKey: new Map([
        ['profile-a', [{ href: '../w.json', artifactKey: 'target-w' }]],
      ]),
    });

    expect(plan).toMatchObject({
      ok: false,
      diagnostic: { code: PROFILE_RESOLUTION_DIAGNOSTIC_CODES.ROOT_TYPE_MISMATCH },
    });
  });

  it('lehnt einen gemischten Versionsgraph vor jeder Semantik ab', () => {
    const plan = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-a',
      documents: new Map<string, unknown>([
        ['profile-a', profileWithImports('1.1.3', [{ href: '../c.json' }])],
        ['catalog-c', catalog('1.2.1')],
      ]),
      edgesByArtifactKey: new Map([
        ['profile-a', [{ href: '../c.json', artifactKey: 'catalog-c' }]],
      ]),
    });

    expect(plan).toMatchObject({
      ok: false,
      diagnostic: { code: PROFILE_RESOLUTION_DIAGNOSTIC_CODES.VERSION_MISMATCH },
    });
  });

  it('meldet eine fehlende Zielversion als eigene Diagnose statt als Versionskonflikt', () => {
    const plan = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-a',
      documents: new Map<string, unknown>([
        ['profile-a', profileWithImports('1.1.3', [{ href: '../c.json' }])],
        ['catalog-c', { catalog: {} }],
      ]),
      edgesByArtifactKey: new Map([
        ['profile-a', [{ href: '../c.json', artifactKey: 'catalog-c' }]],
      ]),
    });

    expect(plan).toMatchObject({
      ok: false,
      diagnostic: { code: PROFILE_RESOLUTION_DIAGNOSTIC_CODES.VERSION_MISSING },
    });
  });

  it('löst Profilketten deterministisch in Importreihenfolge auf', () => {
    const plan = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-top',
      documents: new Map<string, unknown>([
        [
          'profile-top',
          profileWithImports('1.1.3', [{ href: '#mid' }, { href: '#base-catalog' }]),
        ],
        ['profile-mid', profileWithImports('1.1.3', [{ href: '#base-catalog' }])],
        ['catalog-base', catalog('1.1.3')],
      ]),
      edgesByArtifactKey: new Map([
        [
          'profile-top',
          [
            { href: '#mid', artifactKey: 'profile-mid' },
            { href: '#base-catalog', artifactKey: 'catalog-base' },
          ],
        ],
        ['profile-mid', [{ href: '#base-catalog', artifactKey: 'catalog-base' }]],
      ]),
    });

    expect(plan).toMatchObject({
      ok: true,
      order: ['profile-top', 'profile-mid', 'catalog-base'],
      oscalVersion: '1.1.3',
    });
  });
});
