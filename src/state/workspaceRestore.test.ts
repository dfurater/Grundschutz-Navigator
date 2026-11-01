import { expect, it } from 'vitest';
import type { LocalId, VerbundId, WorkspaceVerbund } from '@/domain/workspaceModel';
import { collectRestoreInputs } from '@/state/workspaceRestore';

const target = { verbundId: '11111111-1111-4111-8111-111111111111' as VerbundId, name: 'Ziel', createdAt: '', savedAt: '' } as WorkspaceVerbund;
const other = { ...target, verbundId: '22222222-2222-4222-8222-222222222222' as VerbundId, name: 'Anderer' };
const removed = '33333333-3333-4333-8333-333333333333' as LocalId;
const foreign = '44444444-4444-4444-8444-444444444444' as LocalId;

it('erfasst ein offenes Importziel eines anderswo gelöschten Dokuments, das die Sicherung zurückbringt', () => {
  const pending = new Map([['/profile/imports/0/href', {}]]);
  const inputs = collectRestoreInputs({
    scope: { kind: 'verbund', verbundId: target.verbundId, documents: [{ localId: removed, verbundId: target.verbundId, rootType: 'profile' }] },
    renameDrafts: new Map([[target.verbundId, 'Ziel'], [other.verbundId, 'Bleibt']]),
    importTargets: new Map([[removed, pending], [foreign, pending]]),
    verbuende: [target, other],
    documents: [{ localId: foreign, verbundId: other.verbundId, rootType: 'profile' } as never],
  });
  // Der unveränderte Name ist keine offene Eingabe; der andere Verbund gehört nicht zum Zielbereich.
  expect(inputs).toEqual([{ kind: 'import', verbundId: target.verbundId, localId: removed, rootType: 'profile', count: 1 }]);
});
