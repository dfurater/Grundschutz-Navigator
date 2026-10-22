import { describe, expect, it } from 'vitest';
import { setSelectedControl } from '@/domain/profileAuthoring';
import { addImport } from '@/domain/profileImportList';
import { deriveProfileAnalysis, profileAnalysisSnapshot, withProfileAnalysisInput } from '@/state/workspaceProfileAnalysis';
import { bind, body, member } from '@/test/fixtures/workspaceGraph';
import type { WorkspacePort } from '@/state/workspaceVerbundView';

describe('Profilanalyse über zwei Importziele', () => {
  it('setzt Quelle und Bindungen ohne Mutation der wiederverwendeten Basis ein', async () => {
    const profile = member('profile', 'p');
    const catalog = member('catalog', 'a');
    const bindings = [bind(profile, '/profile/imports/0/href', catalog)];
    const basis = { members: [profile, catalog], bindings, class1Artifacts: [], delivery: new Map() };
    const input = { verbundId: profile.verbundId, localId: profile.localId, source: {}, bindings: [] };
    const port = {
      listDocuments: async () => ({ ok: true, value: [profile, catalog] }),
      getDocument: async (id: string) => ({ ok: true, value: basis.members.find((m) => m.localId === id) }),
      listBindings: async () => ({ ok: true, value: bindings }),
    } as unknown as WorkspacePort;
    const expected = await profileAnalysisSnapshot(port, input);
    expect(expected).toEqual({ ok: true, value: withProfileAnalysisInput(basis, input) });
    expect(basis.members[0]).toBe(profile);
    expect(basis.bindings).toEqual(bindings);
    expect(withProfileAnalysisInput(basis, { ...input, source: profile.source, bindings }).members[0].source).toEqual(profile.source);
  });

  it('führt gleichlautende control/@id zweier Ziele nicht zusammen', async () => {
    const profile = member('profile', 'p');
    const first = member('catalog', 'a');
    const second = member('catalog', 'b');
    (body(first).metadata as { title: string }).title = 'Erster Katalog';
    const added = addImport(profile.source, { resourceUuid: '0b0b0b0b-0000-4000-8000-000000000001', title: 'Zweiter Katalog' });
    const source = setSelectedControl(added.source, 1, 'exclude', 'ac-1', true);
    const working = { ...profile, source };
    const bindings = [bind(working, '/profile/imports/0/href', first), bind(working, '/profile/imports/1/href', second)];

    const analysis = await deriveProfileAnalysis({ localId: profile.localId, source, members: [working, first, second], bindings, class1Artifacts: [], delivery: new Map() });

    const [first0, second1] = ['/profile/imports/0/href', '/profile/imports/1/href'].map((pointer) => analysis.targets.get(pointer));
    expect(first0?.ids).toEqual(['ac-1']);
    expect(second1?.ids).toEqual(['ac-1']);
    expect(first0).not.toBe(second1);
    expect(analysis.imports.map((edge) => edge.state)).toEqual(['resolved', 'resolved']);
    // Der Ausschluss gilt nur im zweiten Import; ac-1 aus dem ersten Ziel bleibt Teil des Pakets.
    expect(analysis.resolution).toMatchObject({ status: 'resolved', index: { ids: ['ac-1'] } });
    expect(analysis.schema).toEqual({ status: 'passed' });
  });
});
