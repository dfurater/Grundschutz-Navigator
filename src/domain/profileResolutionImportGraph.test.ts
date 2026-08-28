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
      order: ['catalog-c', 'profile-a'],
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
      order: ['catalog-base', 'profile-mid', 'profile-top'],
      oscalVersion: '1.1.3',
    });
  });

  it('ordnet einen Diamantgraphen in Postorder — jedes Profilziel vor allen Importeuren', () => {
    const plan = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-top',
      documents: new Map<string, unknown>([
        ['profile-top', profileWithImports('1.1.3', [{ href: '#sub' }, { href: '#mid' }])],
        ['profile-mid', profileWithImports('1.1.3', [{ href: '#sub' }])],
        ['profile-sub', profileWithImports('1.1.3', [{ href: '#catalog' }])],
        ['catalog-a', catalog('1.1.3')],
      ]),
      edgesByArtifactKey: new Map([
        ['profile-top', [
          { href: '#sub', artifactKey: 'profile-sub' },
          { href: '#mid', artifactKey: 'profile-mid' },
        ]],
        ['profile-mid', [{ href: '#sub', artifactKey: 'profile-sub' }]],
        ['profile-sub', [{ href: '#catalog', artifactKey: 'catalog-a' }]],
      ]),
    });

    expect(plan).toMatchObject({
      ok: true,
      order: ['catalog-a', 'profile-sub', 'profile-mid', 'profile-top'],
    });
  });

  it('führt keine Dokument-Accessoren aus — werfender Root-Getter bleibt strukturell', () => {
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'profile', {
      get() {
        throw new Error('Getter wurde ausgeführt');
      },
      enumerable: true,
      configurable: true,
    });

    const plan = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-hostile',
      documents: new Map([['profile-hostile', hostile]]),
      edgesByArtifactKey: new Map(),
    });

    expect(plan).toMatchObject({
      ok: false,
      diagnostic: { stage: 'profile-resolution' },
    });
  });

  it('antwortet auf eine tiefe azyklische Kette kontrolliert statt mit Stapelüberlauf', () => {
    // Greptile-Befund zu 9da9883: Die Rekursion warf bei 12.000 Kettengliedern
    // einen RangeError; der Planer muss tiefe Graphen mit einer stabilen
    // Grenzdiagnose tragen oder ordnen.
    const depth = 12_000;
    const documents = new Map<string, unknown>();
    const edges = new Map<string, { href: string; artifactKey: string }[]>();
    for (let index = 0; index < depth; index += 1) {
      const key = `profile-${index}`;
      const nextKey = `profile-${index + 1}`;
      documents.set(key, profileWithImports('1.1.3', [{ href: `#${nextKey}` }]));
      edges.set(key, [{ href: `#${nextKey}`, artifactKey: nextKey }]);
    }
    documents.set(
      `profile-${depth}`,
      profileWithImports('1.1.3', []),
    );

    const plan = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-0',
      documents,
      edgesByArtifactKey: edges,
    });

    // Die iterative Traversierung trägt die tiefe Kette kontrolliert und
    // ordnet sie vollständig — kein Stapelüberlauf, kein Teilergebnis.
    expect(plan).toMatchObject({ ok: true });
    if (plan.ok) {
      expect(plan.order).toHaveLength(depth + 1);
      expect(plan.order[0]).toBe(`profile-${depth}`);
      expect(plan.order.at(-1)).toBe('profile-0');
    }
  });

  it('trägt den angeforderten Top-Schlüssel und die geprüften Roottypen im Plan', () => {
    const plan = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-a',
      documents: new Map<string, unknown>([
        ['profile-a', profileWithImports('1.1.3', [{ href: '#catalog-c' }])],
        ['catalog-c', catalog('1.1.3')],
      ]),
      edgesByArtifactKey: new Map([
        ['profile-a', [{ href: '#catalog-c', artifactKey: 'catalog-c' }]],
      ]),
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.topProfileArtifactKey).toBe('profile-a');
    expect(plan.rootTypesByArtifactKey).toEqual(new Map([
      ['profile-a', 'profile'],
      ['catalog-c', 'catalog'],
    ]));
  });
});
