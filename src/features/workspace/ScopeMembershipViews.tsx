import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { ScopeId, VerbundId, WorkspaceResult, WorkspaceScope, WorkspaceVerbund } from '@/domain/workspaceModel';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { Facts, plural } from '@/features/workspace/RestoreSheetParts';
import { NameForm, ROW_BUTTON, SectionHead } from '@/features/workspace/WorkspaceForms';
import { WorkspaceNotices } from '@/features/workspace/WorkspaceNotices';
import { usePendingWrite } from '@/features/workspace/usePendingWrite';
import { useWorkspace } from '@/hooks/useWorkspace';
import { scopedVerbundDraftKey } from '@/state/workspaceRestore';

type MembershipView =
  | { readonly kind: 'assign' | 'create'; readonly scope: WorkspaceScope }
  | { readonly kind: 'move'; readonly verbundId: VerbundId; readonly remove?: boolean };

type OpenMembershipView = (view: MembershipView, trigger: HTMLButtonElement) => void;
type ViewActions = Readonly<{ onClose: () => void; onSaved: () => void }>;
type InventoryRefresh = 'save' | 'conflict';

const PANEL = 'rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]';
const CHOICE = 'flex min-h-touch cursor-pointer items-center gap-2 rounded-md border border-[var(--color-border-default)] px-3 py-2 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-60 has-checked:border-[var(--color-accent-default)] has-checked:bg-[var(--color-accent-soft)]';
const CHOICE_INPUT = `shrink-0 accent-[var(--color-accent-default)] ${FOCUS_RING}`;

export function ScopeMembershipArea({ children, onSaved }: Readonly<{
  children: (open: OpenMembershipView) => ReactNode;
  onSaved?: () => void;
}>) {
  const [action, setAction] = useState<{ view: MembershipView | null; trigger: HTMLButtonElement; saved?: boolean }>();
  const view = action?.view;
  const overview = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!action || action.view) return;
    if (!action.saved) action.trigger.focus();
    if (action.saved || document.activeElement !== action.trigger) overview.current?.querySelector('h1')?.focus();
  }, [action]);

  const open: OpenMembershipView = (next, trigger) => setAction({ view: next, trigger });
  const actions: ViewActions = {
    onClose: () => setAction(current => current && { ...current, view: null }),
    onSaved: () => {
      onSaved?.();
      setAction(current => current && { ...current, view: null, saved: true });
    },
  };

  return (
    <>
      <div ref={overview} hidden={Boolean(view)}>{children(open)}</div>
      {view?.kind === 'assign' && <AssignVerbuendeView scope={view.scope} {...actions} />}
      {view?.kind === 'move' && <ChangeVerbundScopeView verbundId={view.verbundId} remove={view.remove ?? false} {...actions} />}
      {view?.kind === 'create' && <CreateScopedVerbundView scope={view.scope} {...actions} />}
    </>
  );
}

function MembershipPage({ title, refreshed, children }: Readonly<{ title: string; refreshed: boolean; children: ReactNode }>) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-4 p-4 desktop:px-7 desktop:py-6">
      <h1 ref={heading} tabIndex={-1} className="type-page-title focus:outline-none">{title}</h1>
      <WorkspaceNotices refreshOnConflict={refreshed} />
      {children}
    </div>
  );
}

function useMembershipInventory() {
  const { scopes, verbuende, scopesFailed, writable } = useWorkspace();
  const [snapshot, setSnapshot] = useState(() => ({ scopes, verbuende, refresh: null as InventoryRefresh | null }));
  const refreshing = snapshot.refresh !== null;
  return {
    scopes: (refreshing ? scopes : snapshot.scopes) ?? [],
    verbuende: (refreshing ? verbuende : snapshot.verbuende) ?? [],
    writable: writable && !scopesFailed && scopes !== null && verbuende !== null && (!refreshing || snapshot.verbuende !== verbuende),
    refreshed: snapshot.refresh === 'conflict',
    refresh: (refresh: InventoryRefresh = 'conflict') => setSnapshot({ scopes, verbuende, refresh }),
  };
}

interface Confirmation {
  readonly title: string;
  readonly label: string;
  readonly description: ReactNode;
  readonly write: () => Promise<WorkspaceResult<unknown>>;
}

function MembershipConfirmation({ confirmation, writable, onCancel, onSaved, onConflict }: Readonly<{
  confirmation: Confirmation;
  writable: boolean;
  onCancel: () => void;
  onSaved: () => void;
  onConflict: () => void;
}>) {
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);
  const confirm = async () => {
    if (!writable || submitted.current) return;
    submitted.current = true;
    setBusy(true);
    const result = await confirmation.write();
    if (result.ok) onSaved();
    else {
      if (result.diagnostic.code === 'WORKSPACE_SAVE_CONFLICT') onConflict();
      onCancel();
    }
  };
  return (
    <ConfirmDialog open title={confirmation.title} confirmLabel={confirmation.label} confirmVariant="primary"
      confirmDisabled={!writable} busy={busy} onCancel={onCancel} onConfirm={() => void confirm()}>
      {confirmation.description}
    </ConfirmDialog>
  );
}

function AssignVerbuendeView({ scope: openedScope, onClose, onSaved }: Readonly<{ scope: WorkspaceScope }> & ViewActions) {
  const { assignVerbuende } = useWorkspace();
  const inventory = useMembershipInventory();
  const scope = inventory.scopes.find(row => row.scopeId === openedScope.scopeId);
  const [selected, setSelected] = useState<readonly WorkspaceVerbund[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const candidates = inventory.verbuende.filter(row => !row.scopeId);
  const assigned = inventory.verbuende.filter(row => row.scopeId);
  const chosen = candidates.filter(row => selected.some(choice => choice.verbundId === row.verbundId));
  const unavailable = selected.filter(row => !candidates.some(candidate => candidate.verbundId === row.verbundId));
  const toggle = (row: WorkspaceVerbund, checked: boolean) => {
    setSelected(current => checked ? [...current, row] : current.filter(choice => choice.verbundId !== row.verbundId));
  };
  const openConfirmation = () => {
    if (!inventory.writable || !scope || chosen.length === 0) return;
    setConfirmation({
      title: 'Informationsverbünde zuordnen?',
      label: 'Zuordnen',
      description: <p className="tabular-nums">{plural(chosen.length, 'Informationsverbund', 'Informationsverbünde')} dem Anwendungsbereich „{scope.name}“ zuordnen?</p>,
      write: () => assignVerbuende(scope.scopeId, { scopeSavedAt: scope.savedAt, verbuende: chosen }),
    });
  };

  return (
    <ScopeMembershipArea onSaved={() => inventory.refresh('save')}>
      {(open) => (
        <MembershipPage title="Vorhandene Verbünde zuordnen" refreshed={inventory.refreshed}>
          <p className="break-words text-sm text-[var(--color-text-secondary)]">Ziel: {scope?.name ?? openedScope.name}</p>
          <form className={`space-y-3 p-4 ${PANEL}`} onSubmit={(event) => { event.preventDefault(); openConfirmation(); }}>
            <fieldset disabled={!inventory.writable || !scope} className="space-y-2">
              <legend className="mb-2 text-base font-semibold">Unzugeordnet · <span className="tabular-nums">{candidates.length}</span></legend>
              {candidates.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">Keine unzugeordneten Informationsverbünde</p>}
              {candidates.map(row => (
                <label key={row.verbundId} className={CHOICE}>
                  <input type="checkbox" className={CHOICE_INPUT}
                    checked={selected.some(choice => choice.verbundId === row.verbundId)}
                    onChange={(event) => toggle(row, event.currentTarget.checked)}
                  />
                  <span className="min-w-0 break-words">{row.name}</span>
                </label>
              ))}
            </fieldset>
            {unavailable.length > 0 && (
              <p className="break-words text-sm text-[var(--color-text-secondary)]">Auswahl nicht mehr verfügbar: {unavailable.map(row => row.name).join(', ')}</p>
            )}
            {!scope && <p className="text-sm text-[var(--color-text-secondary)]">Der Anwendungsbereich ist nicht mehr verfügbar.</p>}
            <div className="flex flex-wrap gap-2">
              {candidates.length > 0 ? (
                <Button type="submit" disabled={!inventory.writable || chosen.length === 0 || !scope} className={`${ROW_BUTTON} tabular-nums`}>{chosen.length} zuordnen</Button>
              ) : scope && (
                <Button variant="secondary" disabled={!inventory.writable} className={ROW_BUTTON}
                  onClick={(event) => open({ kind: 'create', scope }, event.currentTarget)}>Informationsverbund hier anlegen</Button>
              )}
              <Button variant="secondary" className={ROW_BUTTON} onClick={onClose}>{candidates.length > 0 ? 'Abbrechen' : 'Zurück'}</Button>
            </div>
          </form>
          <section aria-labelledby="membership-already-assigned" className={PANEL}>
            <div className="px-4 pt-4">
              <SectionHead id="membership-already-assigned" title="Bereits zugeordnet" count={assigned.length} />
            </div>
            {assigned.length > 0 ? (
              <ul className="divide-y divide-[var(--color-border-subtle)]">
                {assigned.map(row => (
                  <li key={row.verbundId} className="flex flex-wrap items-center gap-x-4 px-4 py-2 text-sm">
                    <span className="min-w-0 flex-1 basis-36 break-words font-semibold">{row.name}</span>
                    <span className="min-w-0 flex-1 basis-36 break-words text-[var(--color-text-secondary)]">
                      {inventory.scopes.find(item => item.scopeId === row.scopeId)?.name ?? 'Anwendungsbereich nicht lesbar'}
                    </span>
                    <Button variant="ghost" disabled={!inventory.writable} className={ROW_BUTTON}
                      onClick={(event) => open({ kind: 'move', verbundId: row.verbundId }, event.currentTarget)}>Zuordnung ändern…</Button>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 pb-4 text-sm text-[var(--color-text-secondary)]">Keine zugeordneten Informationsverbünde</p>}
          </section>
          {confirmation && (
            <MembershipConfirmation confirmation={confirmation} writable={inventory.writable}
              onCancel={() => setConfirmation(null)} onConflict={inventory.refresh} onSaved={onSaved} />
          )}
        </MembershipPage>
      )}
    </ScopeMembershipArea>
  );
}

function ChangeVerbundScopeView({ verbundId, remove, onClose, onSaved }: Readonly<{ verbundId: VerbundId; remove: boolean }> & ViewActions) {
  const { changeVerbundScope, listDocuments, verbuende } = useWorkspace();
  const inventory = useMembershipInventory();
  const [selectedVerbund, setSelectedVerbund] = useState(verbundId);
  const [selection, setSelection] = useState<{ id: ScopeId | null; name: string } | undefined>(
    remove ? { id: null, name: 'Keiner' } : undefined,
  );
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [count, setCount] = useState<{ verbundId: VerbundId; verbuende: typeof verbuende; documents: number } | null>(null);
  const verbund = inventory.verbuende.find(row => row.verbundId === selectedVerbund);
  const from = inventory.scopes.find(row => row.scopeId === verbund?.scopeId);
  const targets = inventory.scopes.filter(row => row.scopeId !== verbund?.scopeId);
  const to = targets.find(row => row.scopeId === selection?.id);
  const removable = selection?.id === null && from !== undefined;
  const documents = count?.verbundId === selectedVerbund && count.verbuende === verbuende ? count.documents : null;
  const writable = inventory.writable && Boolean(verbund) && (!verbund?.scopeId || from !== undefined);
  const ready = writable && documents !== null && (to !== undefined || removable);
  const changeLabel = removable ? 'Zuordnung aufheben' : 'Zuordnung ändern';
  const label = from ? changeLabel : 'Zuordnen';
  const selectId = useId();
  const targetsName = useId();

  useEffect(() => {
    let current = true;
    void listDocuments(selectedVerbund).then(result => {
      if (current) setCount(result.ok ? { verbundId: selectedVerbund, verbuende, documents: result.value.length } : null);
    });
    return () => { current = false; };
  }, [selectedVerbund, listDocuments, verbuende]);

  const openConfirmation = () => {
    if (!ready || !verbund) return;
    setConfirmation({
      title: `${label}?`,
      label,
      description: <Facts rows={[
        ['Informationsverbund', verbund.name],
        ['Bisher', from?.name ?? 'keiner'],
        ['Neu', to?.name ?? 'Keiner'],
        ['Bleibt erhalten', `Verbundidentität · ${plural(documents, 'Dokument', 'Dokumente')}`],
      ]} />,
      write: () => changeVerbundScope(verbund.verbundId, from ?? null, to ?? null, verbund.savedAt),
    });
  };

  return (
    <MembershipPage title="Zuordnung ändern" refreshed={inventory.refreshed}>
      <form className={`max-w-2xl space-y-4 p-4 ${PANEL}`} onSubmit={(event) => { event.preventDefault(); openConfirmation(); }}>
        <div>
          <label htmlFor={selectId} className="mb-1 block text-sm font-medium">Informationsverbund</label>
          <select id={selectId} value={selectedVerbund} disabled={!inventory.writable}
            className={`min-h-touch w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] px-3 text-sm ${FOCUS_RING}`}
            onChange={(event) => {
              setSelectedVerbund(event.currentTarget.value as VerbundId);
              setSelection(undefined);
            }}>
            {!verbund && <option value={selectedVerbund}>Informationsverbund nicht mehr verfügbar</option>}
            {inventory.verbuende.map(row => <option key={row.verbundId} value={row.verbundId}>{row.name}</option>)}
          </select>
        </div>
        {verbund && (
          <>
            <Facts rows={ [['Bisher', from?.name ?? (verbund.scopeId ? 'Anwendungsbereich nicht lesbar' : 'keiner')]] } />
            <fieldset disabled={!writable} className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">Neu</legend>
              {targets.map(row => (
                <label key={row.scopeId} className={CHOICE}>
                  <input type="radio" name={targetsName} checked={selection?.id === row.scopeId}
                    className={CHOICE_INPUT}
                    onChange={() => setSelection({ id: row.scopeId, name: row.name })} />
                  <span className="min-w-0 break-words">{row.name}</span>
                </label>
              ))}
              {from && (
                <label className={CHOICE}>
                  <input type="radio" name={targetsName} checked={selection?.id === null}
                    className={CHOICE_INPUT}
                    onChange={() => setSelection({ id: null, name: 'Keiner' })} /> Keiner
                </label>
              )}
              {targets.length === 0 && !from && <p className="text-sm text-[var(--color-text-secondary)]">Kein Anwendungsbereich verfügbar</p>}
            </fieldset>
            {selection && !to && !removable && (
              <p className="break-words text-sm text-[var(--color-text-secondary)]">Auswahl nicht mehr verfügbar: {selection.name}</p>
            )}
            <Facts rows={ [['Bleibt erhalten', documents === null ? 'Verbundidentität' : `Verbundidentität · ${plural(documents, 'Dokument', 'Dokumente')}`]] } />
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!ready} className={ROW_BUTTON}>{label}…</Button>
          <Button variant="secondary" className={ROW_BUTTON} onClick={onClose}>Abbrechen</Button>
        </div>
      </form>
      {confirmation && (
        <MembershipConfirmation confirmation={confirmation} writable={inventory.writable}
          onCancel={() => setConfirmation(null)} onConflict={inventory.refresh} onSaved={onSaved} />
      )}
    </MembershipPage>
  );
}

function CreateScopedVerbundView({ scope: openedScope, onClose, onSaved }: Readonly<{ scope: WorkspaceScope }> & ViewActions) {
  const { createVerbund, scopeDrafts, pendingVerbundWrite } = useWorkspace();
  const inventory = useMembershipInventory();
  const scope = inventory.scopes.find(row => row.scopeId === openedScope.scopeId);
  const draftKey = scopedVerbundDraftKey(openedScope.scopeId);
  const afterSave = (result: WorkspaceResult<WorkspaceVerbund>) => {
    if (!result.ok) {
      if (result.diagnostic.code === 'WORKSPACE_SAVE_CONFLICT') inventory.refresh();
      return;
    }
    if (scopeDrafts.has(draftKey)) inventory.refresh('save');
    else onSaved();
  };
  const busy = usePendingWrite(() => pendingVerbundWrite(draftKey), afterSave);
  return (
    <MembershipPage title="Informationsverbund hier anlegen" refreshed={inventory.refreshed}>
      <p className="break-words text-sm text-[var(--color-text-secondary)]">Anwendungsbereich: {scope?.name ?? openedScope.name}</p>
      <div className={`p-4 ${PANEL}`}>
        <NameForm label="Name des Informationsverbunds" submitLabel="Anlegen" disabled={!inventory.writable || !scope}
          initial={scopeDrafts.get(draftKey)} busy={busy} onChange={(name) => scopeDrafts.set(draftKey, name)}
          onCancel={() => { scopeDrafts.delete(draftKey); onClose(); }}
          onSubmit={async (name) => {
            if (!inventory.writable || !scope) return false;
            const result = await createVerbund(name, scope);
            afterSave(result);
            return result.ok;
          }} />
      </div>
    </MembershipPage>
  );
}
