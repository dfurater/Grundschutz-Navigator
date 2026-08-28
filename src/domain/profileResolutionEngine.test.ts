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
  withChildControls?: string;
}

function profileDoc(spec: {
  imports: ImportSpec[];
  uuid?: string;
  merge?: Record<string, unknown>;
  modify?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  backMatter?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    profile: {
      uuid: spec.uuid ?? TOP_UUID,
      metadata: {
        title: 'Testprofil',
        version: '1.0.0',
        'oscal-version': VERSION,
        ...spec.metadata,
      },
      imports: spec.imports.map((imp) => ({
        href: imp.href,
        ...(imp.includeAll
          ? { 'include-all': {} }
          : {
              'include-controls': [{
                'with-ids': imp.withIds ?? [],
                ...(imp.withChildControls !== undefined && {
                  'with-child-controls': imp.withChildControls,
                }),
              }],
            }),
      })),
      ...(spec.merge !== undefined && { merge: spec.merge }),
      ...(spec.modify !== undefined && { modify: spec.modify }),
      ...(spec.backMatter !== undefined && { 'back-matter': spec.backMatter }),
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

function bodyOf(okResult: Extract<Awaited<ReturnType<typeof resolveProfile>>, { ok: true }>): Record<string, unknown> {
  return (okResult.output.tree as Record<string, unknown>)['catalog'] as Record<string, unknown>;
}

function expectTopProfileDiagnostic(
  outcome: Awaited<ReturnType<typeof resolveProfile>>,
  code: string,
  path?: string,
): void {
  expect(outcome).toMatchObject({
    ok: false,
    diagnostic: {
      code,
      artifact: { key: 'profile-top', rootType: 'profile', oscalVersion: VERSION },
      ...(path !== undefined && { path }),
    },
  });
}

describe('Auflösung — flat-Struktur', () => {
  it('use-first ist der Default und behält die erste Definition', async () => {
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

    const outcome = await resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = bodyOf(outcome)['controls'] as Record<string, unknown>[];
    expect(controls.map((control) => control['title'])).toEqual(['ERSTE', 'VPN']);
  });

  it('combine=keep erhält beide kollidierenden Definitionen', async () => {
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

    const outcome = await resolveWorld(world);
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

  it('erhält die Quellhierarchie und levelt nicht Inkludiertes hoch', async () => {
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

    const outcome = await resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const groups = bodyOf(outcome)['groups'] as Record<string, unknown>[];
    expect(groups).toHaveLength(1);
    expect(groups[0]!['id']).toBe('g-1');
    expect(groups[0]!['props']).toEqual([{ name: 'status', value: 'ready' }]);
    const controls = groups[0]!['controls'] as Record<string, unknown>[];
    expect(controls.map((control) => control['id'])).toEqual(['ac-1']);
  });

  it('fehlende Merge-Direktive bedeutet as-is (Projektentscheidung)', async () => {
    const world: WorldSpec = {
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
        }),
        'cat-a': hierarchicalSource(),
      },
      edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
    };

    const outcome = await resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(bodyOf(outcome)['groups']).toHaveLength(1);
  });
});

describe('Auflösung — custom-Struktur', () => {
  it('kopiert Raw-Gruppen exakt und setzt insert-controls gegen den Pool ab', async () => {
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
                  props: [{
                    name: 'projekterweiterung',
                    ns: 'https://grundschutz.plus/ns/test',
                    value: 'bleibt',
                  }],
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

    const outcome = await resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const body = bodyOf(outcome);
    // Die Gruppe führt ihr eigenes insert-controls aus und trägt ihre
    // eingefügten Controls mit Positions-Labels; schema-gültige Erweiterungen
    // bleiben erhalten.
    const groups = body['groups'] as Record<string, unknown>[];
    expect(groups).toEqual([
      {
        id: 'asm-1',
        title: 'Zusammenbau',
        props: [
          {
            name: 'projekterweiterung',
            ns: 'https://grundschutz.plus/ns/test',
            value: 'bleibt',
          },
        ],
        controls: [
          {
            id: 'zz-1',
            class: 'SP800-53',
            title: 'ZZ-1',
            props: [{ name: 'label', value: 'asm-1.1' }],
          },
          {
            id: 'aa-1',
            class: 'SP800-53',
            title: 'AA-1',
            props: [{ name: 'label', value: 'asm-1.2' }],
          },
        ],
      },
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

  it('trägt eigene UUID (UUIDv5), Stempelzeitpunkt, Version und Provenienzträger', async () => {
    const outcome = await resolveWorld(baseWorld());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.output.trustClass).toBe('class-2-local-user');
    expect(outcome.output.oscalVersion).toBe(VERSION);

    const body = bodyOf(outcome);
    expect(body['uuid']).toBe(
      deriveUuidV5(PROFILE_RESOLUTION_NAMESPACE_UUID, TOP_UUID),
    );
    const metadata = body['metadata'] as Record<string, unknown>;
    expect(metadata).not.toHaveProperty('uuid');
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

  it('gibt die Wurzel ausschließlich als registriertes Builder-Derivat heraus', async () => {
    const outcome = await resolveWorld(baseWorld());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(isDerivedProducedContainer(outcome.output.tree)).toBe(true);
    const metadata = bodyOf(outcome)['metadata'];
    expect(isDerivedProducedContainer(metadata as object)).toBe(true);
  });

  it('weist ein schema-ungültiges Resolver-Ergebnis über die gemeinsame Klasse-2-Kette ab', async () => {
    const outcome = await resolveWorld({
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
          merge: { flat: {} },
          metadata: { 'unbekanntes-mitglied': true },
        }),
        'cat-a': catalogDoc(controlNode('ac-1')),
      },
      edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
    });

    expect(outcome).toMatchObject({
      ok: false,
      diagnostic: { code: 'OSCAL_SCHEMA_ADDITIONAL_PROPERTY' },
    });
  });

  it('führt referenzierte Back-matter-Ressourcen des Quellkatalogs mit', async () => {
    const referencedUuid = '22222222-2222-4222-8222-222222222222';
    const unusedUuid = '33333333-3333-4333-8333-333333333333';
    const world: WorldSpec = {
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
          merge: { flat: {} },
        }),
        'cat-a': {
          catalog: {
            metadata: { 'oscal-version': VERSION },
            controls: [
              controlNode('ac-1', {
                parts: [{ name: 'guidance', prose: `Siehe [Quelle](#${referencedUuid}).` }],
              }),
            ],
            'back-matter': {
              resources: [
                { uuid: referencedUuid, title: 'Verwendet' },
                { uuid: unusedUuid, title: 'Nicht verwendet' },
              ],
            },
          },
        },
      },
      edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
    };

    const outcome = await resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(bodyOf(outcome)['back-matter']).toEqual({
      resources: [{ uuid: referencedUuid, title: 'Verwendet' }],
    });
  });

  it('schließt referenzierte Quellressourcen transitiv über ihre Citation', async () => {
    const firstUuid = '22222222-2222-4222-8222-222222222222';
    const transitiveUuid = '33333333-3333-4333-8333-333333333333';
    const outcome = await resolveWorld({
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
          merge: { flat: {} },
        }),
        'cat-a': {
          catalog: {
            metadata: { 'oscal-version': VERSION },
            controls: [
              controlNode('ac-1', {
                parts: [{ name: 'guidance', prose: `Siehe [A](#${firstUuid}).` }],
              }),
            ],
            'back-matter': {
              resources: [
                {
                  uuid: firstUuid,
                  title: 'A',
                  citation: { text: `Siehe [B](#${transitiveUuid}).` },
                },
                { uuid: transitiveUuid, title: 'B' },
              ],
            },
          },
        },
      },
      edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(bodyOf(outcome)['back-matter']).toEqual({
      resources: [
        {
          uuid: firstUuid,
          title: 'A',
          citation: { text: `Siehe [B](#${transitiveUuid}).` },
        },
        { uuid: transitiveUuid, title: 'B' },
      ],
    });
  });

  it('schließt Referenzen aus unverbrauchtem Profil-Back-matter gegen Quellressourcen', async () => {
    const sourceUuid = '22222222-2222-4222-8222-222222222222';
    const profileUuid = '33333333-3333-4333-8333-333333333333';
    const outcome = await resolveWorld({
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
          merge: { flat: {} },
          backMatter: {
            resources: [
              {
                uuid: profileUuid,
                title: 'Profilquelle',
                citation: { text: `Siehe [Quelle](#${sourceUuid}).` },
              },
            ],
          },
        }),
        'cat-a': {
          catalog: {
            metadata: { 'oscal-version': VERSION },
            controls: [controlNode('ac-1')],
            'back-matter': { resources: [{ uuid: sourceUuid, title: 'Quelle' }] },
          },
        },
      },
      edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(bodyOf(outcome)['back-matter']).toEqual({
      resources: [
        { uuid: sourceUuid, title: 'Quelle' },
        {
          uuid: profileUuid,
          title: 'Profilquelle',
          citation: { text: `Siehe [Quelle](#${sourceUuid}).` },
        },
      ],
    });
  });

  it('behandelt die UUID einer verbrauchten Importbindung case-insensitiv', async () => {
    const resourceUuid = 'abcdef01-4444-4444-8444-444444444444';
    const outcome = await resolveWorld({
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: '#ABCDEF01-4444-4444-8444-444444444444', includeAll: true }],
          merge: { flat: {} },
          backMatter: {
            resources: [{ uuid: resourceUuid, title: 'Verbrauchte Importbindung', rlinks: [{ href: 'cat.json' }] }],
          },
        }),
        'cat-a': catalogDoc(controlNode('ac-1')),
      },
      edges: {
        'profile-top': [{ href: '#ABCDEF01-4444-4444-8444-444444444444', artifactKey: 'cat-a' }],
      },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(bodyOf(outcome)).not.toHaveProperty('back-matter');
  });

  it('übernimmt überlappende Quellressourcen nur einmal und bewahrt die erste', async () => {
    const sharedUuid = '22222222-2222-4222-8222-222222222222';
    const sourceCatalog = (controlId: string, title: string) => ({
      catalog: {
        metadata: { 'oscal-version': VERSION },
        controls: [
          controlNode(controlId, {
            parts: [{ name: 'guidance', prose: `Siehe [Quelle](#${sharedUuid}).` }],
          }),
        ],
        'back-matter': { resources: [{ uuid: sharedUuid, title }] },
      },
    });
    const outcome = await resolveWorld({
      documents: {
        'profile-top': profileDoc({
          imports: [
            { href: './a.json', includeAll: true },
            { href: './b.json', includeAll: true },
          ],
          merge: { flat: {} },
        }),
        'cat-a': sourceCatalog('ac-1', 'Erste Quelle'),
        'cat-b': sourceCatalog('ac-2', 'Zweite Quelle'),
      },
      edges: {
        'profile-top': [
          { href: './a.json', artifactKey: 'cat-a' },
          { href: './b.json', artifactKey: 'cat-b' },
        ],
      },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(bodyOf(outcome)['back-matter']).toEqual({
      resources: [{ uuid: sharedUuid, title: 'Erste Quelle' }],
    });
  });

  it('liefert bei zweifacher Ausführung ein byte-identisches Ergebnis', async () => {
    const first = await resolveWorld(baseWorld());
    const second = await resolveWorld(baseWorld());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(JSON.stringify(first.output.tree)).toBe(JSON.stringify(second.output.tree));
  });
});

describe('Modify-Phase', () => {
  it('überträgt set-parameter einschließlich kebab-case-Feldern auf getroffene Controls', async () => {
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

    const outcome = await resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = bodyOf(outcome)['controls'] as Record<string, unknown>[];
    expect(controls[0]!['params']).toEqual([
      { id: 'p1', label: 'Neu', usage: 'Verwendung', 'depends-on': 'd0', values: ['x'] },
    ]);
  });

  it('hängt alters-Anhänge ans Ende und hält kanonische Schlüsselordnung', async () => {
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

    const outcome = await resolveWorld(world);
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
  it('löst Profil-zu-Profil-Ketten nachgelagert auf (Kind vor Eltern)', async () => {
    const topUuid = '11111111-1111-5111-8111-111111111111';
    const childUuid = '22222222-2222-5222-8222-222222222222';
    const world: WorldSpec = {
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './child.json', includeAll: true }],
          uuid: topUuid,
          merge: { flat: {} },
        }),
        'profile-child': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
          uuid: childUuid,
          merge: { flat: {} },
        }),
        'cat-a': catalogDoc(controlNode('deep-1')),
      },
      edges: {
        'profile-top': [{ href: './child.json', artifactKey: 'profile-child' }],
        'profile-child': [{ href: './a.json', artifactKey: 'cat-a' }],
      },
    };

    const outcome = await resolveWorld(world);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = bodyOf(outcome)['controls'] as Record<string, unknown>[];
    expect(controls.map((control) => control['id'])).toEqual(['deep-1']);
    expect(bodyOf(outcome)['uuid']).toBe(
      deriveUuidV5(PROFILE_RESOLUTION_NAMESPACE_UUID, topUuid),
    );
    expect(bodyOf(outcome)['uuid']).not.toBe(
      deriveUuidV5(PROFILE_RESOLUTION_NAMESPACE_UUID, childUuid),
    );
  });

  it('löst einen Diamantgraphen ohne stilles Profil-Fallback vollständig auf', async () => {
    const subProfile = profileDoc({
      imports: [{ href: './catalog.json', includeAll: true }],
      merge: { flat: {} },
    });
    const midProfile = profileDoc({
      imports: [{ href: './sub.json', includeAll: true }],
      merge: { flat: {} },
    });
    const topProfile = profileDoc({
      imports: [
        { href: './sub.json', includeAll: true },
        { href: './mid.json', includeAll: true },
      ],
      merge: { flat: {}, combine: { method: 'keep' } },
    });
    const outcome = await resolveWorld({
      documents: {
        'profile-top': topProfile,
        'profile-mid': midProfile,
        'profile-sub': subProfile,
        'cat-a': catalogDoc(controlNode('ac-1'), controlNode('ac-2')),
      },
      edges: {
        'profile-top': [
          { href: './sub.json', artifactKey: 'profile-sub' },
          { href: './mid.json', artifactKey: 'profile-mid' },
        ],
        'profile-mid': [{ href: './sub.json', artifactKey: 'profile-sub' }],
        'profile-sub': [{ href: './catalog.json', artifactKey: 'cat-a' }],
      },
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = bodyOf(outcome)['controls'] as Record<string, unknown>[];
    expect(controls.map((control) => control['id'])).toEqual([
      'ac-1',
      'ac-2',
      'ac-1',
      'ac-2',
    ]);
  });
});

describe('fail-closed Diagnosen der Engine', () => {
  it('berichtet eine fehlende UUID eines Zwischenprofils nicht als Top-Profil-Fehler', async () => {
    const middleProfile = profileDoc({
      imports: [{ href: './a.json', includeAll: true }],
      merge: { flat: {} },
    });
    delete (middleProfile['profile'] as Record<string, unknown>)['uuid'];
    const outcome = await resolveWorld({
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './middle.json', includeAll: true }],
          merge: { flat: {} },
        }),
        'profile-middle': middleProfile,
        'cat-a': catalogDoc(controlNode('ac-1')),
      },
      edges: {
        'profile-top': [{ href: './middle.json', artifactKey: 'profile-middle' }],
        'profile-middle': [{ href: './a.json', artifactKey: 'cat-a' }],
      },
    });

    expect(outcome).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'PROFILE_RESOLUTION_PROFILE_UUID_MISSING',
        artifact: { key: 'profile-middle', rootType: 'profile' },
        path: '/uuid',
      },
    });
  });

  it('ordnet eine Klasse-2-Diagnose dem erzeugenden Zwischenprofil zu', async () => {
    const outcome = await resolveWorld({
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './middle.json', includeAll: true }],
          merge: { flat: {} },
        }),
        'profile-middle': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
          merge: { flat: {} },
          metadata: { 'unbekanntes-mitglied': true },
        }),
        'cat-a': catalogDoc(controlNode('ac-1')),
      },
      edges: {
        'profile-top': [{ href: './middle.json', artifactKey: 'profile-middle' }],
        'profile-middle': [{ href: './a.json', artifactKey: 'cat-a' }],
      },
    });

    expect(outcome).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_SCHEMA_ADDITIONAL_PROPERTY',
        stage: 'json-schema',
        artifact: { key: 'profile-middle', rootType: 'catalog', oscalVersion: VERSION },
      },
    });
  });

  it('verwendet den geplanten Top-Profil-Schlüssel statt der letzten Postorder-Position', async () => {
    const documents = new Map<string, unknown>([
      ['profile-top', profileDoc({ imports: [{ href: './a.json', includeAll: true }], merge: { flat: {} } })],
      ['cat-a', catalogDoc(controlNode('ac-1'))],
    ]);
    const edgesByArtifactKey = new Map<string, readonly ProfileResolutionEdge[]>([
      ['profile-top', [{ href: './a.json', artifactKey: 'cat-a' }]],
    ]);
    const built = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-top',
      documents,
      edgesByArtifactKey,
    });
    if (!built.ok) throw new Error(built.diagnostic.code);
    const alteredPlan = { ...built, order: [...built.order, 'cat-a'] } as const;
    const profileViews = new Map([
      ['profile-top', parseProfileDocument(documents.get('profile-top'), { trustClass: 'class-1-verified-public' })],
    ]);

    const outcome = await resolveProfile({ plan: alteredPlan, edgesByArtifactKey, profileViews });

    expect(outcome).toMatchObject({
      ok: true,
      output: { topProfileArtifactKey: 'profile-top' },
    });
  });

  it('ordnet ein noch nicht aufgelöstes Profilziel dem importierenden Profilpfad zu', async () => {
    const documents = new Map<string, unknown>([
      ['profile-top', profileDoc({ imports: [{ href: './child.json', includeAll: true }], merge: { flat: {} } })],
      ['profile-child', profileDoc({ imports: [{ href: './a.json', includeAll: true }], merge: { flat: {} } })],
      ['cat-a', catalogDoc(controlNode('ac-1'))],
    ]);
    const edgesByArtifactKey = new Map<string, readonly ProfileResolutionEdge[]>([
      ['profile-top', [{ href: './child.json', artifactKey: 'profile-child' }]],
      ['profile-child', [{ href: './a.json', artifactKey: 'cat-a' }]],
    ]);
    const built = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-top',
      documents,
      edgesByArtifactKey,
    });
    if (!built.ok) throw new Error(built.diagnostic.code);
    documents.set('profile-child', catalogDoc(controlNode('replaced')));
    const alteredPlan = { ...built, order: ['profile-top', 'profile-child', 'cat-a'] } as const;
    const profileViews = new Map([
      ['profile-top', parseProfileDocument(documents.get('profile-top'), { trustClass: 'class-1-verified-public' })],
    ]);

    const outcome = await resolveProfile({ plan: alteredPlan, edgesByArtifactKey, profileViews });

    expectTopProfileDiagnostic(
      outcome,
      'PROFILE_RESOLUTION_IMPORT_PROFILE_UNRESOLVED',
      '/profile/imports/0',
    );
  });

  it('lehnt ein noch nicht aufgelöstes Profilziel am Import ab', async () => {
    const documents = new Map<string, unknown>([
      ['profile-top', profileDoc({ imports: [{ href: './child.json', includeAll: true }] })],
      ['profile-child', profileDoc({ imports: [{ href: './a.json', includeAll: true }] })],
      ['cat-a', catalogDoc(controlNode('ac-1'))],
    ]);
    const edgesByArtifactKey = new Map<string, readonly ProfileResolutionEdge[]>([
      ['profile-top', [{ href: './child.json', artifactKey: 'profile-child' }]],
      ['profile-child', [{ href: './a.json', artifactKey: 'cat-a' }]],
    ]);
    const built = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-top',
      documents,
      edgesByArtifactKey,
    });
    if (!built.ok) throw new Error(built.diagnostic.code);
    const invalidPlan = {
      ...built,
      order: ['profile-top', 'profile-child', 'cat-a'],
    } as const;
    const profileViews = new Map([
      ['profile-top', parseProfileDocument(documents.get('profile-top'), { trustClass: 'class-1-verified-public' })],
      ['profile-child', parseProfileDocument(documents.get('profile-child'), { trustClass: 'class-1-verified-public' })],
    ]);

    const outcome = await resolveProfile({ plan: invalidPlan, edgesByArtifactKey, profileViews });

    expectTopProfileDiagnostic(
      outcome,
      'PROFILE_RESOLUTION_IMPORT_PROFILE_UNRESOLVED',
      '/profile/imports/0',
    );
  });

  it('ordnet ein im manipulierten Plan fehlendes Importziel dem importierenden Profilpfad zu', async () => {
    const documents = new Map<string, unknown>([
      ['profile-top', profileDoc({ imports: [{ href: './a.json', includeAll: true }] })],
      ['cat-a', catalogDoc(controlNode('ac-1'))],
    ]);
    const edgesByArtifactKey = new Map<string, readonly ProfileResolutionEdge[]>([
      ['profile-top', [{ href: './a.json', artifactKey: 'cat-a' }]],
    ]);
    const built = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-top',
      documents,
      edgesByArtifactKey,
    });
    if (!built.ok) throw new Error(built.diagnostic.code);
    const invalidPlan = {
      ...built,
      documents: new Map<string, unknown>(),
    } as const;
    const profileViews = new Map([
      ['profile-top', parseProfileDocument(documents.get('profile-top'), { trustClass: 'class-1-verified-public' })],
    ]);

    const outcome = await resolveProfile({ plan: invalidPlan, edgesByArtifactKey, profileViews });

    expectTopProfileDiagnostic(
      outcome,
      'PROFILE_RESOLUTION_IMPORT_UNMAPPED',
      '/profile/imports/0',
    );
  });

  it('ergänzt Selektionsdiagnosen um den Kontext des importierenden Profils', async () => {
    const outcome = await resolveWorld({
      documents: {
        'profile-top': profileDoc({
          imports: [{
            href: './a.json',
            withIds: ['ac-1'],
            withChildControls: 'vielleicht',
          }],
        }),
        'cat-a': catalogDoc(controlNode('ac-1')),
      },
      edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
    });

    expectTopProfileDiagnostic(outcome, 'PROFILE_RESOLUTION_WITH_CHILD_CONTROLS_INVALID');
  });

  it('ergänzt Custom-Assembly-Diagnosen um den Kontext des steuernden Profils', async () => {
    const outcome = await resolveWorld({
      documents: {
        'profile-top': profileDoc({
          imports: [{ href: './a.json', includeAll: true }],
          merge: {
            custom: {
              'insert-controls': [{
                'include-controls': [{
                  'with-ids': ['ac-1'],
                  'with-child-controls': 'vielleicht',
                }],
              }],
            },
          },
        }),
        'cat-a': catalogDoc(controlNode('ac-1')),
      },
      edges: { 'profile-top': [{ href: './a.json', artifactKey: 'cat-a' }] },
    });

    expectTopProfileDiagnostic(outcome, 'PROFILE_RESOLUTION_WITH_CHILD_CONTROLS_INVALID');
  });

  it('unterscheidet ein nicht aufgelöstes Top-Profil von einer fehlenden Profil-UUID', async () => {
    const documents = new Map<string, unknown>([
      ['profile-top', profileDoc({ imports: [{ href: './a.json', includeAll: true }] })],
      ['cat-a', catalogDoc(controlNode('ac-1'))],
    ]);
    const edgesByArtifactKey = new Map<string, readonly ProfileResolutionEdge[]>([
      ['profile-top', [{ href: './a.json', artifactKey: 'cat-a' }]],
    ]);
    const plan = buildProfileResolutionPlan({
      topProfileArtifactKey: 'profile-top',
      documents,
      edgesByArtifactKey,
    });
    if (!plan.ok) throw new Error(`Plan scheiterte: ${plan.diagnostic.code}`);

    const outcome = await resolveProfile({ plan, edgesByArtifactKey, profileViews: new Map() });

    expectTopProfileDiagnostic(outcome, 'PROFILE_RESOLUTION_TOP_PROFILE_UNRESOLVED');
  });

  it('lehnt eine mehrdeutige Merge-Struktur ab', async () => {
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
    const outcome = await resolveWorld(world);
    expectTopProfileDiagnostic(outcome, 'PROFILE_RESOLUTION_MERGE_STRUCTURE_UNRESOLVED');
  });

  it('lehnt eine unbekannte combine-Methode ab', async () => {
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
    const outcome = await resolveWorld(world);
    expectTopProfileDiagnostic(outcome, 'PROFILE_RESOLUTION_COMBINE_METHOD_INVALID');
  });

  it('lehnt einen Import ohne zugeordnete Kante ab', async () => {
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
    const outcome = await resolveWorld(world);
    expectTopProfileDiagnostic(outcome, 'PROFILE_RESOLUTION_IMPORT_UNMAPPED');
  });
});
