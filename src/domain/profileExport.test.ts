import { describe, expect, it } from 'vitest';
import { createProfileSource } from '@/domain/profileImportList';
import { exportProfileDocument, PROFILE_EXPORT_CODES, toDerivedOscalTree, validateProfileExportTree } from '@/domain/profileExport';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { makeProfileSource, makeProfileWithoutImports, makeProfileWithUnpinnedVersion, profileSpecFor } from '@/test/fixtures/profiles';
import { runNoOpRoundTrip } from '@/test/oscalRoundTrip';

const NEW = createProfileSource({
  uuid: 'dddddddd-0000-4000-8000-000000000001', resourceUuid: 'dddddddd-0000-4000-8000-000000000002',
  title: 'Ziel', profileTitle: 'Paket', oscalVersion: '1.1.3', lastModified: '2026-10-20T10:00:00.000Z',
}).source;

const ready = (source: unknown) => ({ documentState: 'export-ready' as const, rootType: 'profile', source });

describe('Validierter Profil-Export', () => {
  it('exportiert reines OSCAL-JSON ohne Envelope, mit Schema- und Referenzbefund', async () => {
    const result = await exportProfileDocument({ ...ready(NEW), localId: 'l', verbundId: 'v', savedAt: 'x' } as never);
    expect(result).toMatchObject({ ok: true, report: { schema: 'passed', references: { resolved: 1, total: 1 }, constraints: 'not-checked' } });
    if (!result.ok) return;
    const parsed = JSON.parse(result.json);
    expect(Object.keys(parsed)).toEqual(['profile']);
    expect(result.json).not.toMatch(/localId|verbundId|savedAt|documentState|binding/);
  });

  it('exportiert aus draft und imported nichts', async () => {
    for (const documentState of ['draft', 'imported'] as const) {
      expect(await exportProfileDocument({ documentState, rootType: 'profile', source: NEW })).toEqual({ ok: false, code: PROFILE_EXPORT_CODES.notReady, path: '/' });
    }
  });

  it('weist ein Profil ohne imports und eine unbekannte oscal-version ab', async () => {
    expect((await exportProfileDocument(ready(makeProfileWithoutImports()))).ok).toBe(false);
    expect(await exportProfileDocument(ready(makeProfileWithUnpinnedVersion('1.0.4')))).toMatchObject({ ok: false });
    expect(await exportProfileDocument(ready(makeProfileWithUnpinnedVersion('v1.1.3x')))).toMatchObject({ ok: false });
  });

  it('weist ein unaufgelöstes href-Fragment ab', async () => {
    const dangling = structuredClone(NEW) as { profile: { 'back-matter': { resources: unknown[] } } };
    dangling.profile['back-matter'].resources = [{ uuid: 'eeeeeeee-0000-4000-8000-000000000001' }];
    expect(await exportProfileDocument(ready(dangling))).toEqual({ ok: false, code: PROFILE_EXPORT_CODES.referenceUnresolved, path: '/profile/imports/0/href' });
  });

  it('weist ein href-Fragment auf eine mehrfach vergebene Ressourcen-UUID ab', async () => {
    const doubled = structuredClone(NEW) as { profile: { 'back-matter': { resources: { uuid: string }[] } } };
    const [resource] = doubled.profile['back-matter'].resources;
    doubled.profile['back-matter'].resources.push({ ...resource, uuid: resource.uuid.toUpperCase() });
    expect(await exportProfileDocument(ready(doubled))).toEqual({ ok: false, code: PROFILE_EXPORT_CODES.referenceAmbiguous, path: '/profile/imports/0/href' });
  });

  it('lehnt einen Graphen ohne Builder-Herkunft mit OSCAL_OBJECT_UNPROVENANCED ab', async () => {
    expect(await validateProfileExportTree(structuredClone(NEW))).toMatchObject({ ok: false, code: 'OSCAL_OBJECT_UNPROVENANCED' });
  });

  it('besteht den No-op-Round-trip verlustfrei, auch mit Fremdfeldern und back-matter', async () => {
    const source = makeProfileSource(profileSpecFor('profile-gspp'));
    Object.assign((source.profile as { metadata: object }).metadata, {
      props: [{ name: 'fremd', ns: 'https://example.invalid/ns', value: 'x', remarks: 'Bemerkung' }],
      links: [{ href: '#dddddddd-0000-4000-8000-0000000000ff', 'resource-fragment': 'abschnitt-2' }],
    });
    const run = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(source),
      exportDocument: (parsed) => JSON.parse(serializeWorkspaceJson(toDerivedOscalTree(parsed))),
    });
    expect(run.graph.status).toBe('passed');
    expect(run.identities.status).toBe('passed');
    const exported = await exportProfileDocument(ready(source));
    expect(exported.ok && JSON.parse(exported.json)).toEqual(source);
  });
});
