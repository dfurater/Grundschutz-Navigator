import { describe, expect, it } from 'vitest';
import {
  PROFILE_RESOLUTION_NAMESPACE_UUID,
  deriveUuidV5,
} from './uuidV5';
import { buildProfileResolutionPlan } from './profileResolutionImportGraph';
import type { ProfileResolutionEdge } from './profileResolutionImportGraph';
import { parseProfileDocument } from '@/adapters/oscalProfileDocument';
import { resolveProfile } from './profileResolutionEngine';
import { isDerivedProducedContainer } from './oscalDerivedGraph';

const VERSION = '1.1.3';
const TOP_UUID = '11111111-1111-5111-8111-111111111111';

function controlNode(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, class: 'SP800-53', title: id.toUpperCase(), ...extra };
}

function catalogDoc(...controls: Record<string, unknown>[]): Record<string, unknown> {
  return { catalog: { metadata: { 'oscal-version': VERSION }, controls } };
}

interface ImportSpec {
  href: string;
  includeAll?: boolean;
  withIds?: string[];
}

function profileDoc(spec: {
  imports: ImportSpec[];
  merge?: Record<string, unknown>;
  modify?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    profile: {
      uuid: TOP_UUID,
      metadata: { title: 'Testprofil', 'oscal-version': VERSION },
      imports: spec.imports.map((imp) => ({
        href: imp.href,
        ...(imp.includeAll
          ? { 'include-all': {} }
          : { 'include-controls': [{ 'with-ids': imp.withIds ?? [] }] }),
      })),
      ...(spec.merge !== undefined && { merge: spec.merge }),
      ...(spec.modify !== undefined && { modify: spec.modify }),
    },
  };
}

interface WorldSpec {
  documents: Record<string, unknown>;
  edges: Record<string, ProfileResolutionEdge[]>;
  topKey?: string;
}

function resolveWorld(
  spec: WorldSpec,
): ReturnType<typeof resolveProfile> {
  const documents = new Map(Object.entries(spec.documents));
  const edgesByArtifactKey = new Map(Object.entries(spec.edges));
  const plan = buildProfileResolutionPlan({
    topProfileArtifactKey: spec.topKey ?? 'profile-top',
    documents,
    edgesByArtifactKey,
  });
  if (!plan.ok) throw new Error(`Plan scheiterte: ${plan.diagnostic.code}`);

  const profileViews = new Map(
    [...plan.order]
      .filter((key) => key.startsWith('profile'))
      .map((key) => [
        key,
        parseProfileDocument(documents.get(key), { trustClass: 'class-1-verified-public' }),
      ]),
  );

  return resolveProfile({ plan, edgesByArtifactKey, profileViews });
}

function bodyOf(okResult: Extract<ReturnType<typeof resolveProfile>, { ok: true }>): Record<string, unknown> {
  return (okResult.output.tree as Record<string, unknown>)['catalog'] as Record<string, unknown>;
}

describe('Auflösung — flat-Struktur', () => {
  it('use-first ist der Default und behält die erste Definition', () => {
    const world: WorldSpec = {
      documents: {
        'profile-top': profileDoc({
          imports: [
            { href: './a.json', includeAll: true },
            { href: './b.json', withIds: ['ac-1'] },
          ],
          merge: { flat: {} },
        }),
        'cat-a': catalogDoc(controlNode('ac-1', { title: 'ERSTE' }), controlNode('vpn')),
        'cat-b': catalogDoc(controlNode('ac-1', { title: 'ZWEITE' })),
      },
      edges: {
        'profile-top': [
          { href: './a.json', artifactKey: 'cat-a' },
          { href: './b.json', artifactKey: 'cat-b' },
        ],
      },
    };

    const outcome = resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = bodyOf(outcome)['controls'] as Record<string, unknown>[];
    expect(controls.map((control) => control['title'])).toEqual(['ERSTE', 'VPN']);
  });

  it('combine=keep erhält beide kollidierenden Definitionen', () => {
    const world: WorldSpec = {
      documents: {
        'profile-top': profileDoc({
          imports: [
            { href: './a.json', withIds: ['ac-1'] },
            { href: './b.json', withIds: ['ac-1'] },
          ],
          merge: { flat: {}, combine: { method: 'keep' } },
        }),
        'cat-a': catalogDoc(controlNode('ac-1', { title: 'A-FASSUNG' })),
        'cat-b': catalogDoc(controlNode('ac-1', { title: 'B-FASSUNG' })),
      },
      edges: {
        'profile-top': [
          { href: './a.json', artifactKey: 'cat-a' },
          { href: './b.json', artifactKey: 'cat-b' },
        ],
      },
    };

    const outcome = resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = bodyOf(outcome)['controls'] as Record<string, unknown>[];
    expect(controls.map((control) => control['title'])).toEqual(['A-FASSUNG', 'B-FASSUNG']);
  });
});

describe('Auflösung — as-is-Struktur', () => {
  const hierarchicalSource = (): Record<string, unknown> => ({
    catalog: {
      metadata: { 'oscal-version': VERSION },
      groups: [
        {
          id: 'g-1',
          class: 'family',
          title: 'Gruppe 1',
          props: [{ name: 'status', value: 'ready' }],
          controls: [controlNode('ac-1'), controlNode('ac-drop')],
        },
      ],
    },
  });

  it('erhält die Quellhierarchie und levelt nicht Inkludiertes hoch', () => {
    const world: WorldSpec = {
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './a.json', withIds: ['ac-1'] }],
          merge: { 'as-is': true },
        }),
        'cat-a': hierarchicalSource(),
      },
      edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
    };

    const outcome = resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const groups = bodyOf(outcome)['groups'] as Record<string, unknown>[];
    expect(groups).toHaveLength(1);
    expect(groups[0]!['id']).toBe('g-1');
    expect(groups[0]!['props']).toEqual([{ name: 'status', value: 'ready' }]);
    const controls = groups[0]!['controls'] as Record<string, unknown>[];
    expect(controls.map((control) => control['id'])).toEqual(['ac-1']);
  });

  it('fehlende Merge-Direktive bedeutet as-is (Projektentscheidung)', () => {
    const world: WorldSpec = {
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
        }),
        'cat-a': hierarchicalSource(),
      },
      edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
    };

    const outcome = resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(bodyOf(outcome)['groups']).toHaveLength(1);
  });
});

describe('Auflösung — custom-Struktur', () => {
  it('kopiert Raw-Gruppen exakt und setzt insert-controls gegen den Pool ab', () => {
    const world: WorldSpec = {
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
          merge: {
            custom: {
              groups: [
                {
                  id: 'asm-1',
                  title: 'Zusammenbau',
                  'unbekanntes-mitglied': { bleibt: true },
                  'insert-controls': [{ 'include-all': {} }],
                },
              ],
              'insert-controls': [{ 'include-all': {}, order: 'ascending' }],
            },
          },
        }),
        'cat-a': catalogDoc(controlNode('zz-1'), controlNode('aa-1')),
      },
      edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
    };

    const outcome = resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const body = bodyOf(outcome);
    const groups = body['groups'] as Record<string, unknown>[];
    expect(groups).toEqual([
      { id: 'asm-1', title: 'Zusammenbau', 'unbekanntes-mitglied': { bleibt: true } },
    ]);
    const controls = body['controls'] as Record<string, unknown>[];
    expect(controls.map((control) => control['id'])).toEqual(['aa-1', 'zz-1']);
    expect(JSON.stringify(outcome.output.tree)).not.toContain('insert-controls');
  });
});

describe('Ergebnisvertrag', () => {
  const baseWorld = (): WorldSpec => ({
    documents: {
      'profile-top': profileDoc({
        imports: [{ href: './a.json', includeAll: true }],
        merge: { flat: {} },
      }),
      'cat-a': catalogDoc(controlNode('ac-1')),
    },
    edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
  });

  it('trägt eigene UUID (UUIDv5), Stempelzeitpunkt, Version und Provenienzträger', () => {
    const outcome = resolveWorld(baseWorld());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.output.trustClass).toBe('class-2-local-user');
    expect(outcome.output.oscalVersion).toBe(VERSION);

    const metadata = bodyOf(outcome)['metadata'] as Record<string, unknown>;
    expect(metadata['uuid']).toBe(
      deriveUuidV5(PROFILE_RESOLUTION_NAMESPACE_UUID, TOP_UUID),
    );
    expect(metadata['last-modified']).toBe('1970-01-01T00:00:00.000Z');
    expect(metadata['oscal-version']).toBe(VERSION);

    const props = metadata['props'] as Record<string, unknown>[];
    expect(props).toContainEqual({
      name: 'resolution-tool',
      value: 'gspp-profile-resolution@1',
    });

    const links = metadata['links'] as Record<string, unknown>[];
    expect(links).toContainEqual({
      rel: 'source-profile',
      href: `urn:uuid:${TOP_UUID}`,
    });

    const serialized = JSON.stringify(outcome.output.tree);
    expect(serialized).not.toContain('source-profile-uuid');
  });

  it('gibt die Wurzel ausschließlich als registriertes Builder-Derivat heraus', () => {
    const outcome = resolveWorld(baseWorld());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(isDerivedProducedContainer(outcome.output.tree)).toBe(true);
    const metadata = bodyOf(outcome)['metadata'];
    expect(isDerivedProducedContainer(metadata as object)).toBe(true);
  });

  it('liefert bei zweifacher Ausführung ein byte-identisches Ergebnis', () => {
    const first = resolveWorld(baseWorld());
    const second = resolveWorld(baseWorld());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(first.output.tree)).toBe(JSON.stringify(second.output.tree));
  });
});

describe('Modify-Phase', () => {
  it('überträgt set-parameter einschließlich kebab-case-Feldern auf getroffene Controls', () => {
    const world: WorldSpec = {
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
          merge: { flat: {} },
          modify: {
            'set-parameters': [
              {
                'param-id': 'p1',
                label: 'Neu',
                usage: 'Verwendung',
                'depends-on': 'd0',
                values: ['x'],
              },
            ],
          },
        }),
        'cat-a': catalogDoc(
          controlNode('ac-1', {
            params: [{ id: 'p1', label: 'Alt' }],
          }),
        ),
      },
      edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
    };

    const outcome = resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = bodyOf(outcome)['controls'] as Record<string, unknown>[];
    expect(controls[0]!['params']).toEqual([
      { id: 'p1', label: 'Neu', usage: 'Verwendung', 'depends-on': 'd0', values: ['x'] },
    ]);
  });

  it('hängt alters-Anhänge ans Ende und hält kanonische Schlüsselordnung', () => {
    const world: WorldSpec = {
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
          merge: { flat: {} },
          modify: {
            alters: [
              {
                'control-id': 'ac-1',
                adds: [{ parts: [{ id: 'neu-part', name: 'note' }] }],
              },
            ],
          },
        }),
        'cat-a': catalogDoc(controlNode('ac-1')),
      },
      edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
    };

    const outcome = resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = bodyOf(outcome)['controls'] as Record<string, unknown>[];
    expect(Object.keys(controls[0]!)).toEqual([
      'id',
      'class',
      'title',
      'parts',
    ]);
    expect(controls[0]!['parts']).toEqual([{ id: 'neu-part', name: 'note' }]);
  });
});

describe('Profilketten', () => {
  it('löst Profil-zu-Profil-Ketten nachgelagert auf (Kind vor Eltern)', () => {
    const world: WorldSpec = {
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './child.json', includeAll: true }],
          merge: { flat: {} },
        }),
        'profile-child': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
          merge: { flat: {} },
        }),
        'cat-a': catalogDoc(controlNode('deep-1')),
      },
      edges: {
        'profile-top': [{ href: './child.json', artifactKey: 'profile-child' }],
        'profile-child': [{ href: './a.json', artifactKey: 'cat-a' }],
      },
    };

    const outcome = resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = bodyOf(outcome)['controls'] as Record<string, unknown>[];
    expect(controls.map((control) => control['id'])).toEqual(['deep-1']);
  });
});

describe('fail-closed Diagnosen der Engine', () => {
  it('lehnt eine mehrdeutige Merge-Struktur ab', () => {
    const world: WorldSpec = {
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
          merge: { flat: {}, 'as-is': true },
        }),
        'cat-a': catalogDoc(controlNode('ac-1')),
      },
      edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
    };
    const outcome = resolveWorld(world);
    expect(outcome).toMatchObject({
      ok: false,
      diagnostic: { code: 'PROFILE_RESOLUTION_MERGE_STRUCTURE_UNRESOLVED' },
    });
  });

  it('lehnt eine unbekannte combine-Methode ab', () => {
    const world: WorldSpec = {
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
          merge: { flat: {}, combine: { method: 'gewinner' } },
        }),
        'cat-a': catalogDoc(controlNode('ac-1')),
      },
      edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
    };
    const outcome = resolveWorld(world);
    expect(outcome).toMatchObject({
      ok: false,
      diagnostic: { code: 'PROFILE_RESOLUTION_COMBINE_METHOD_INVALID' },
    });
  });

  it('lehnt einen Import ohne zugeordnete Kante ab', () => {
    const world: WorldSpec = {
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './fehlt.json', includeAll: true }],
          merge: { flat: {} },
        }),
        'cat-a': catalogDoc(controlNode('ac-1')),
      },
      edges: { 'profile-top': [] },
    };
    const outcome = resolveWorld(world);
    expect(outcome).toMatchObject({
      ok: false,
      diagnostic: { code: 'PROFILE_RESOLUTION_IMPORT_UNMAPPED' },
    });
  });
});
