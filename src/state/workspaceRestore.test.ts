import { expect, it, vi } from 'vitest';
import type { LocalId, ScopeId, VerbundId, WorkspaceScope, WorkspaceVerbund } from '@/domain/workspaceModel';
import { NEW_SCOPE_DRAFT, collectRestoreInputs, saveNamedInput, scopeDraftKey, scopedVerbundDraftKey } from '@/state/workspaceRestore';

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

it('erfasst offene Zeilenumbenennungen getrennt von den Sitzungsentwürfen', () => {
  const inputs = collectRestoreInputs({
    scope: { kind: 'verbund', verbundId: target.verbundId, documents: [] },
    renameDrafts: new Map(),
    rowDrafts: new Map([[target.verbundId, 'Neu'], [other.verbundId, 'Bleibt']]),
    importTargets: new Map(),
    verbuende: [target, other],
    documents: [],
  });
  expect(inputs).toEqual([{ kind: 'rename', verbundId: target.verbundId, name: 'Ziel', draft: 'Neu', row: true }]);
});

it('führt beim Gesamt-Restore Importziele ohne bekanntes Dokument als verwaiste Eingabe, beim Verbund-Restore nicht', () => {
  const pending = new Map([['/profile/imports/0/href', {}]]);
  const base = { renameDrafts: new Map(), importTargets: new Map([[removed, pending]]), verbuende: [target], documents: [] };
  expect(collectRestoreInputs({ ...base, scope: { kind: 'workspace', documents: [] } })).toEqual([{ kind: 'orphan', localId: removed, count: 1 }]);
  expect(collectRestoreInputs({ ...base, scope: { kind: 'verbund', verbundId: target.verbundId, documents: [] } })).toEqual([]);
});

it('führt offene Namen von Anwendungsbereichen nur beim Gesamt-Restore und nur bei Abweichung', () => {
  const scope: WorkspaceScope = {
    scopeId: '55555555-5555-4555-8555-555555555555' as ScopeId, name: 'Netz', savedAt: 's1', createdAt: '', items: [], evidence: [],
  };
  const createVerbundKey = scopedVerbundDraftKey(scope.scopeId);
  const base = {
    renameDrafts: new Map(), importTargets: new Map(), verbuende: [target], documents: [], scopes: [scope],
    scopeDrafts: new Map([[scope.scopeId, 'Netz Nord'], [NEW_SCOPE_DRAFT, 'Anlage'], [createVerbundKey, 'Rechenzentrum'], ['66666666-6666-4666-8666-666666666666', 'Verwaist']]),
  };
  const inputs = collectRestoreInputs({ ...base, scope: { kind: 'workspace', documents: [] } });
  expect(inputs).toEqual([
    { kind: 'scope', scope: { scopeId: '55555555-5555-4555-8555-555555555555', name: 'Netz', savedAt: 's1' }, draft: 'Netz Nord' },
    { kind: 'scope', scope: null, draft: 'Anlage' },
    { kind: 'scope', scope: { scopeId: scope.scopeId, name: 'Netz', savedAt: 's1' }, draft: 'Rechenzentrum', newVerbund: true },
  ]);
  expect(inputs.filter(entry => entry.kind === 'scope').map(scopeDraftKey)).toEqual([scope.scopeId, NEW_SCOPE_DRAFT, createVerbundKey]);
  expect(collectRestoreInputs({ ...base, scope: { kind: 'verbund', verbundId: target.verbundId, documents: [] } })).toEqual([]);
  const unchanged = new Map([['55555555-5555-4555-8555-555555555555', ' Netz '], [NEW_SCOPE_DRAFT, '  ']]);
  expect(collectRestoreInputs({ ...base, scopeDrafts: unchanged, scope: { kind: 'workspace', documents: [] } })).toEqual([]);
});

it('führt nur vom gespeicherten Stand abweichende Abgrenzungsentwürfe und nur beim Gesamt-Restore als Eingabe', async () => {
  const { scopeBoundaryInput, startBoundaryDraft } = await import('@/domain/scopeBoundary');
  const scope = { scopeId: '66666666-6666-4666-8666-666666666666' as ScopeId, name: 'Netz', createdAt: '', savedAt: 's2', items: [], evidence: [] } as WorkspaceScope;
  const name = { scopeId: scope.scopeId, name: 'Netz', savedAt: 's2' };
  const empty = scopeBoundaryInput(undefined);
  const portal = { ...empty, interfaces: 'Portal' };
  // Veralteter Vergleichsstand, aber Eingabe gleich dem gespeicherten Inhalt: nichts geht verloren.
  const unchanged = { input: empty, base: 's1', baseInput: empty, baseItemId: null };
  // Nur der Stempel ist fortgeschrieben (etwa durch eine Zuordnung): gespeichert wird mit dem neuen Stempel.
  const restamped = { input: portal, base: 's1', baseInput: empty, baseItemId: null };
  // Ein anderer Tab hat die Abgrenzung geändert: gespeichert wird mit dem alten Stempel und scheitert als Konflikt.
  const outdated = { input: portal, base: 's1', baseInput: { ...empty, interfaces: 'Alt' }, baseItemId: null };
  const base = { renameDrafts: new Map(), importTargets: new Map(), verbuende: [], documents: [], scopes: [scope] };
  const whole = { kind: 'workspace', documents: [] } as const;
  expect(collectRestoreInputs({ ...base, scope: whole, boundaryDrafts: new Map([[scope.scopeId, unchanged]]) })).toEqual([]);
  expect(collectRestoreInputs({ ...base, scope: whole, boundaryDrafts: new Map([[scope.scopeId, restamped], ['77777777-7777-4777-8777-777777777777', restamped]]) }))
    .toEqual([{ kind: 'boundary', scope: name, draft: restamped, base: 's2' }]);
  expect(collectRestoreInputs({ ...base, scope: whole, boundaryDrafts: new Map([[scope.scopeId, outdated]]) }))
    .toEqual([{ kind: 'boundary', scope: name, draft: outdated, base: 's1' }]);
  expect(collectRestoreInputs({ ...base, scope: { kind: 'verbund', verbundId: target.verbundId, documents: [] }, boundaryDrafts: new Map([[scope.scopeId, restamped]]) })).toEqual([]);
  expect(startBoundaryDraft(scope)).toEqual({ input: empty, base: 's2', baseInput: empty, baseItemId: null });
});

it('speichert einen Abgrenzungsentwurf aus der Klärung mit dessen Vergleichsstand', async () => {
  const { scopeBoundaryInput } = await import('@/domain/scopeBoundary');
  const input = { ...scopeBoundaryInput(undefined), interfaces: 'Portal' };
  const saveScopeBoundary = vi.fn(() => Promise.resolve({ ok: true as const, value: {} as WorkspaceScope }));
  const entry = { kind: 'boundary' as const, scope: { scopeId: '66666666-6666-4666-8666-666666666666' as ScopeId, name: 'Netz', savedAt: 's2' }, draft: { input, base: 's1', baseInput: input, baseItemId: null }, base: 's2' };
  const unused = vi.fn();
  expect(await saveNamedInput(entry, { renameVerbund: unused, renameScope: unused, createScope: unused, createVerbund: unused, saveScopeBoundary })).toBe(true);
  expect(saveScopeBoundary).toHaveBeenCalledExactlyOnceWith(entry.scope.scopeId, 's2', input);
});
