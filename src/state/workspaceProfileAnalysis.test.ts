import { describe, expect, it } from 'vitest';
import { setSelectedControl } from '@/domain/profileAuthoring';
import { addImport } from '@/domain/profileImportList';
import { deriveProfileAnalysis } from '@/state/workspaceProfileAnalysis';
import { bind, body, member } from '@/test/fixtures/workspaceGraph';

describe('Profilanalyse über zwei Importziele', () => {
  it('führt gleichlautende control/@id zweier Ziele nicht zusammen', async () => {
    const profile = member('profile', 'p');
    const first = member('catalog', 'a');
    const second = member('catalog', 'b');
    (body(first).metadata as { title: string }).title = 'Erster Katalog';
    const added = addImport(profile.source, { resourceUuid: '0b0b0b0b-0000-4000-8000-000000000001', title: 'Zweiter Katalog' });
    const source = setSelectedControl(added.source, 1, 'exclude', 'ac-1', true);
    const working = { ...profile, source };
    const bindings = [bind(working, '/profile/imports/0/href', first), bind(working, '/profile/imports/1/href', second)];

    const analysis = await deriveProfileAnalysis({ localId: profile.localId, source, members: [working, first, second], bindings, class1Artifacts: [] });

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
