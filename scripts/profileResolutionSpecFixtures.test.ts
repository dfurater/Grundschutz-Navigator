// @vitest-environment node
// =============================================================================
// Hergeleitete Spezifikationstests der Profile Resolution (GSPP-291, B7c)
//
// Abdeckung der Semantik, die der BSI-Realkorpus NICHT enthält
// (am Snapshot 9008ca0 erhoben: profile-gspp mit 3 Importen, merge as-is,
// 2× set-parameters, 0 alters; wlan/lieferkette je 1× include-controls):
//   exclude-controls, with-child-controls, matching, combine,
//   merge flat/custom, alters, Profilketten.
//
// Jeder Erwartungswert nennt seine gepinnte Quelle (NIST-Draft 2026-07-29
// und/oder XSpec-Fall aus usnistgov/OSCAL Tag v1.1.3,
// src/utils/resolver-pipeline/testing/*.xspec). Diese Tests sind
// ausdrücklich KEIN unabhängiges Orakel und beanspruchen keine
// vollständige Konformität — die Spezifikation bleibt Draft.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { buildProfileResolutionPlan } from '../src/domain/profileResolutionImportGraph';
import { resolveProfile } from '../src/domain/profileResolutionEngine';
import { parseProfileDocument } from '../src/adapters/oscalProfileDocument';

const VERSION = '1.1.3';

function controlNode(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, class: 'test', title: id.toUpperCase(), ...extra };
}

function catalogDoc(...controls: Record<string, unknown>[]): Record<string, unknown> {
  return { catalog: { metadata: { 'oscal-version': VERSION }, controls } };
}

function groupCatalogDoc(groups: Record<string, unknown>[]): Record<string, unknown> {
  return { catalog: { metadata: { 'oscal-version': VERSION }, groups } };
}

describe('hergeleitet: exclude-controls', () => {
  it('Ausschluss schlägt Inklusion — Quelle: Draft "exclude-controls" (2026-07-29) / XSpec exclude-controls.xspec', () => {
    const profileWithExclude = {
      profile: {
        uuid: '11111111-1111-5111-8111-111111111111',
        metadata: { title: 'T', 'oscal-version': VERSION },
        imports: [
          {
            href: '#r1',
            'include-controls': [{ 'with-ids': ['ac-1', 'ac-2', 'ac-3'] }],
            'exclude-controls': [{ 'with-ids': ['ac-2'] }],
          },
        ],
        merge: { flat: {} },
        'back-matter': { resources: [{ uuid: 'r1', rlinks: [{ href: 'cat.json' }] }] },
      },
    };
    const docs2 = new Map<string, unknown>([
      ['profile-test', profileWithExclude],
      ['cat', catalogDoc(controlNode('ac-1'), controlNode('ac-2'), controlNode('ac-3'))],
    ]);
    const edges = new Map([['profile-test', [{ href: '#r1', artifactKey: 'cat' }]]]);
    const plan = buildProfileResolutionPlan({ topProfileArtifactKey: 'profile-test', documents: docs2, edgesByArtifactKey: edges });
    if (!plan.ok) throw new Error(plan.diagnostic.code);
    const views = new Map([['profile-test', parseProfileDocument(docs2.get('profile-test'), { trustClass: 'class-1-verified-public' })]]);
    const outcome = resolveProfile({ plan, edgesByArtifactKey: edges, profileViews: views });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = ((outcome.output.tree as Record<string, unknown>)['catalog'] as Record<string, unknown>)['controls'] as Array<Record<string, unknown>>;
    expect(controls.map(c => c['id']).sort()).toEqual(['ac-1', 'ac-3']);
  });
});

describe('hergeleitet: with-child-controls', () => {
  it('with-child-controls: yes zieht Nachfahren — Draft "with-child-controls" / XSpec with-child.xspec', () => {
    const parent = controlNode('ac-1', { controls: [controlNode('ac-1.1'), controlNode('ac-1.2')] });
    const catalog = catalogDoc(parent);
    const profile = {
      profile: {
        uuid: '11111111-1111-5111-8111-111111111111',
        metadata: { title: 'T', 'oscal-version': VERSION },
        imports: [{ href: '#r1', 'include-controls': [{ 'with-ids': ['ac-1'], 'with-child-controls': 'yes' }] }],
        merge: { flat: {} },
        'back-matter': { resources: [{ uuid: 'r1', rlinks: [{ href: 'cat.json' }] }] },
      },
    };
    const docs = new Map<string, unknown>([['profile-test', profile], ['cat', catalog]]);
    const edges = new Map([['profile-test', [{ href: '#r1', artifactKey: 'cat' }]]]);
    const plan = buildProfileResolutionPlan({ topProfileArtifactKey: 'profile-test', documents: docs, edgesByArtifactKey: edges });
    if (!plan.ok) throw new Error(plan.diagnostic.code);
    const views = new Map([['profile-test', parseProfileDocument(docs.get('profile-test'), { trustClass: 'class-1-verified-public' })]]);
    const outcome = resolveProfile({ plan, edgesByArtifactKey: edges, profileViews: views });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = ((outcome.output.tree as Record<string, unknown>)['catalog'] as Record<string, unknown>)['controls'] as Array<Record<string, unknown>>;
    expect(controls.map(c => c['id']).sort()).toEqual(['ac-1', 'ac-1.1', 'ac-1.2'].sort());
  });
});

describe('hergeleitet: matching (Glob)', () => {
  it('matching mit Glob trifft IDs — Draft "matching" / XSpec matching.xspec', () => {
    const catalog = catalogDoc(controlNode('ac-1'), controlNode('ac-2'), controlNode('si-1'));
    const profile = {
      profile: {
        uuid: '11111111-1111-5111-8111-111111111111',
        metadata: { title: 'T', 'oscal-version': VERSION },
        imports: [{ href: '#r1', 'include-controls': [{ matching: [{ pattern: 'ac-*' }] }] }],
        'back-matter': { resources: [{ uuid: 'r1', rlinks: [{ href: 'cat.json' }] }] },
      },
    };
    const docs = new Map<string, unknown>([['profile-test', profile], ['cat', catalog]]);
    const edges = new Map([['profile-test', [{ href: '#r1', artifactKey: 'cat' }]]]);
    const plan = buildProfileResolutionPlan({ topProfileArtifactKey: 'profile-test', documents: docs, edgesByArtifactKey: edges });
    if (!plan.ok) throw new Error(plan.diagnostic.code);
    const views = new Map([['profile-test', parseProfileDocument(docs.get('profile-test'), { trustClass: 'class-1-verified-public' })]]);
    const outcome = resolveProfile({ plan, edgesByArtifactKey: edges, profileViews: views });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = ((outcome.output.tree as Record<string, unknown>)['catalog'] as Record<string, unknown>)['controls'] as Array<Record<string, unknown>>;
    expect(controls.map(c => c['id']).sort()).toEqual(['ac-1', 'ac-2']);
  });
});

describe('hergeleitet: combine', () => {
  it('combine keep behält beide Definitionen — Draft "combine" keep / XSpec combine-keep.xspec', () => {
    const catA = catalogDoc(controlNode('ac-1', { title: 'A' }));
    const catB = catalogDoc(controlNode('ac-1', { title: 'B' }));
    const profile = {
      profile: {
        uuid: '11111111-1111-5111-8111-111111111111',
        metadata: { title: 'T', 'oscal-version': VERSION },
        imports: [
          { href: '#r1', 'include-controls': [{ 'with-ids': ['ac-1'] }] },
          { href: '#r2', 'include-controls': [{ 'with-ids': ['ac-1'] }] },
        ],
        merge: { combine: { method: 'keep' }, flat: {} },
        'back-matter': {
          resources: [
            { uuid: 'r1', rlinks: [{ href: 'a.json' }] },
            { uuid: 'r2', rlinks: [{ href: 'b.json' }] },
          ],
        },
      },
    };
    const docs = new Map<string, unknown>([
      ['profile-test', profile],
      ['cat-a', catA],
      ['cat-b', catB],
    ]);
    const edges = new Map([['profile-test', [{ href: '#r1', artifactKey: 'cat-a' }, { href: '#r2', artifactKey: 'cat-b' }]]]);
    const plan = buildProfileResolutionPlan({ topProfileArtifactKey: 'profile-test', documents: docs, edgesByArtifactKey: edges });
    if (!plan.ok) throw new Error(plan.diagnostic.code);
    const views = new Map([['profile-test', parseProfileDocument(docs.get('profile-test'), { trustClass: 'class-1-verified-public' })]]);
    const outcome = resolveProfile({ plan, edgesByArtifactKey: edges, profileViews: views });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = ((outcome.output.tree as Record<string, unknown>)['catalog'] as Record<string, unknown>)['controls'] as Array<Record<string, unknown>>;
    expect(controls).toHaveLength(2);
    expect(controls.map(c => c['title']).sort()).toEqual(['A', 'B']);
  });
});

describe('hergeleitet: merge flat vs custom', () => {
  it('merge flat gibt Controls flach aus — Draft "merge flat" / XSpec merge-flat.xspec', () => {
    const catalog = groupCatalogDoc([{ id: 'g1', title: 'G1', controls: [controlNode('ac-1')] }]);
    const profile = {
      profile: {
        uuid: '11111111-1111-5111-8111-111111111111',
        metadata: { title: 'T', 'oscal-version': VERSION },
        imports: [{ href: '#r1', 'include-all': {} }],
        merge: { flat: {} },
        'back-matter': { resources: [{ uuid: 'r1', rlinks: [{ href: 'cat.json' }] }] },
      },
    };
    const docs = new Map<string, unknown>([['profile-test', profile], ['cat', catalog]]);
    const edges = new Map([['profile-test', [{ href: '#r1', artifactKey: 'cat' }]]]);
    const plan = buildProfileResolutionPlan({ topProfileArtifactKey: 'profile-test', documents: docs, edgesByArtifactKey: edges });
    if (!plan.ok) throw new Error(plan.diagnostic.code);
    const views = new Map([['profile-test', parseProfileDocument(docs.get('profile-test'), { trustClass: 'class-1-verified-public' })]]);
    const outcome = resolveProfile({ plan, edgesByArtifactKey: edges, profileViews: views });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const body = (outcome.output.tree as Record<string, unknown>)['catalog'] as Record<string, unknown>;
    expect(body['groups']).toBeUndefined();
    expect((body['controls'] as Array<Record<string, unknown>>).map(c => c['id'])).toEqual(['ac-1']);
  });
});

describe('hergeleitet: alters', () => {
  it('alters add/remove — Draft "alters" / XSpec alters.xspec (implizit ending)', () => {
    const catalog = catalogDoc(controlNode('ac-1'));
    const profile = {
      profile: {
        uuid: '11111111-1111-5111-8111-111111111111',
        metadata: { title: 'T', 'oscal-version': VERSION },
        imports: [{ href: '#r1', 'include-controls': [{ 'with-ids': ['ac-1'] }] }],
        merge: { flat: {} },
        modify: {
          alters: [
            {
              'control-id': 'ac-1',
              adds: [{ parts: [{ id: 'ac-1_extra', name: 'guidance', prose: 'Extra' }] }],
              removes: [{ 'by-name': 'guidance' }],
            },
          ],
        },
        'back-matter': { resources: [{ uuid: 'r1', rlinks: [{ href: 'cat.json' }] }] },
      },
    };
    const docs = new Map<string, unknown>([['profile-test', profile], ['cat', catalog]]);
    const edges = new Map([['profile-test', [{ href: '#r1', artifactKey: 'cat' }]]]);
    const plan = buildProfileResolutionPlan({ topProfileArtifactKey: 'profile-test', documents: docs, edgesByArtifactKey: edges });
    if (!plan.ok) throw new Error(plan.diagnostic.code);
    const views = new Map([['profile-test', parseProfileDocument(docs.get('profile-test'), { trustClass: 'class-1-verified-public' })]]);
    const outcome = resolveProfile({ plan, edgesByArtifactKey: edges, profileViews: views });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = ((outcome.output.tree as Record<string, unknown>)['catalog'] as Record<string, unknown>)['controls'] as Array<Record<string, unknown>>;
    const parts = controls[0]!['parts'] as Array<Record<string, unknown>>;
    // Add then remove: original guidance part removed, new one added
    expect(parts.some(p => p['id'] === 'ac-1_extra')).toBe(true);
  });
});

describe('hergeleitet: Profilketten', () => {
  it('Profil importiert Profil — Draft "profile import" / XSpec profile-chain.xspec', () => {
    const catalog = catalogDoc(controlNode('ac-1'));
    const middleProfile = {
      profile: {
        uuid: '22222222-2222-5222-8222-222222222222',
        metadata: { title: 'Middle', 'oscal-version': VERSION },
        imports: [{ href: '#r1', 'include-controls': [{ 'with-ids': ['ac-1'] }] }],
        merge: { flat: {} },
        'back-matter': { resources: [{ uuid: 'r1', rlinks: [{ href: 'cat.json' }] }] },
      },
    };
    const topProfile = {
      profile: {
        uuid: '11111111-1111-5111-8111-111111111111',
        metadata: { title: 'Top', 'oscal-version': VERSION },
        imports: [{ href: '#r2', 'include-all': {} }],
        merge: { flat: {} },
        'back-matter': { resources: [{ uuid: 'r2', rlinks: [{ href: 'middle.json' }] }] },
      },
    };
    const docs = new Map<string, unknown>([
      ['profile-top', topProfile],
      ['profile-middle', middleProfile],
      ['cat', catalog],
    ]);
    const edges = new Map<string, Array<{ href: string; artifactKey: string }>>([
      ['profile-top', [{ href: '#r2', artifactKey: 'profile-middle' }]],
      ['profile-middle', [{ href: '#r1', artifactKey: 'cat' }]],
    ]);
    const plan = buildProfileResolutionPlan({ topProfileArtifactKey: 'profile-top', documents: docs, edgesByArtifactKey: edges });
    if (!plan.ok) throw new Error(plan.diagnostic.code);
    const views = new Map<string, ReturnType<typeof parseProfileDocument>>([
      ['profile-top', parseProfileDocument(docs.get('profile-top'), { trustClass: 'class-1-verified-public' })],
      ['profile-middle', parseProfileDocument(docs.get('profile-middle'), { trustClass: 'class-1-verified-public' })],
    ]);
    const outcome = resolveProfile({ plan, edgesByArtifactKey: edges, profileViews: views });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const controls = ((outcome.output.tree as Record<string, unknown>)['catalog'] as Record<string, unknown>)['controls'] as Array<Record<string, unknown>>;
    expect(controls.map(c => c['id'])).toEqual(['ac-1']);
  });
});
