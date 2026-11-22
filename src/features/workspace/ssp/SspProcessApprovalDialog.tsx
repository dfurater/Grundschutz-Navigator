import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { ProcessDecisionInput } from '@/domain/sspProcessApproval';
import { PROCESS_GOALS, PROCESS_GOAL_KEYS } from '@/domain/sspProcessEditing';
import { processContentHash } from '@/domain/sspProcessProjection';
import type { ProcessProtection } from '@/domain/sspProcessProtection';
import { DECISION_ROLE, formatDecisionDate, shortHash, type ProcessDecisionView } from '@/features/workspace/ssp/SspProcessApproval';
import { ProcessSelect, ProcessText } from '@/features/workspace/ssp/SspProcessFields';
import type { LocalId } from '@/domain/workspaceModel';
import { decisionDrafts, type DecisionDialogDraft, type DecisionParty } from '@/state/processDecisionDrafts';

const ERRORS: Readonly<Record<string, string>> = {
  WORKSPACE_SAVE_CONFLICT: 'Nicht gespeichert. Das Dokument wurde in einem anderen Tab geändert. Die Entscheidung wurde nicht geschrieben; Dokument und Eingaben sind unverändert.',
  SSP_PROCESS_DECISION_BLOCKED: 'Nicht gespeichert. Eine Entscheidung braucht einen gespeicherten, technisch gültigen Stand ohne offenen Entwurf.',
  SSP_CATEGORY_CONTEXT_UNAVAILABLE: 'Nicht gespeichert. Der Kategorienkontext zum gebundenen Katalogstand ist nicht geladen; die Zuordnungen sind nicht prüfbar.',
};
function errorText(code: string): string {
  return ERRORS[code] ?? `Nicht gespeichert. Befund: ${code}.`;
}
const PARTY_SAVED_AS_DRAFT = 'Die Partei ist gespeichert. Das SSP ist dabei als Entwurf gespeichert worden; eine Entscheidung braucht einen technisch gültigen gespeicherten Stand. Behebe die Befunde im SSP und speichere es erneut.';
function hashFailedText(code: string): string {
  return `Der gebundene Stand ist nicht berechenbar. Befund: ${code}. Der Prozess verweist auf eine Anwendung, Rolle oder Partei, die im SSP fehlt, doppelt vorkommt oder keinen Namen beziehungsweise Titel hat. Korrigiere den Verweis am Prozess, an der Anwendung oder unter Metadaten und speichere das SSP; der Dialog berechnet den Stand danach neu.`;
}
const PARTY_TYPES = [{ value: 'organization', label: 'Organisation' }, { value: 'person', label: 'Person' }];
const TEXT = {
  approved: { title: 'Freigabe dokumentieren', remarks: 'Begründung', missing: 'Begründung fehlt.', variant: 'primary' },
  withdrawn: { title: 'Freigabe zurücknehmen', remarks: 'Anlass der Rücknahme', missing: 'Anlass fehlt.', variant: 'danger' },
} as const;
const BOX = 'rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-subtle)] p-3';
const TERM = 'text-[var(--color-text-secondary)]';
const FACTS = 'grid gap-x-4 gap-y-1 sm:grid-cols-[12rem_minmax(0,1fr)]';

export type ProcessDecisionMode = keyof typeof TEXT;
type PartyOption = { readonly value: string; readonly label: string };
type NewParty = DecisionParty;
type DialogDraft = DecisionDialogDraft;

function initialParty(parties: readonly PartyOption[], affected: ProcessDecisionView | undefined): string {
  const previous = parties.find(option => affected?.partyUuids.some(uuid => uuid.toLowerCase() === option.value.toLowerCase()));
  if (previous) return previous.value;
  return parties.length === 1 ? parties[0].value : '';
}

type BoundHash = { readonly value?: string; readonly failed?: string };

/** Hash des gespeicherten Stands für die gewählte Partei; gilt nur für genau diesen Stand und diese Partei. */
function useBoundHash(source: unknown, processUuid: string, party: string, enabled: boolean): BoundHash {
  const [hash, setHash] = useState<{ source: unknown; party: string } & BoundHash>();
  useEffect(() => {
    if (!enabled || !party) return;
    let active = true;
    void processContentHash(source, processUuid, [{ 'role-id': DECISION_ROLE, 'party-uuids': [party] }])
      .then((value): BoundHash => ({ value }), (error: unknown): BoundHash => ({ failed: error instanceof Error ? error.message : 'SSP_PROCESS_BINDING_INVALID' }))
      .then(result => { if (active) setHash({ source, party, ...result }); });
    return () => { active = false; };
  }, [enabled, party, processUuid, source]);
  return hash && hash.source === source && hash.party === party ? hash : {};
}

/** Legt eine Partei im SSP an; sie wird mit dem SSP gespeichert, bevor eine Entscheidung sie bindet. */
function NewPartyFields({ value, onChange, onSave, onCancel }: Readonly<{ value: NewParty; onChange: (party: NewParty) => void; onSave: () => void; onCancel: () => void }>) {
  const [tried, setTried] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Der auslösende Knopf verschwindet; der Fokus geht in das erste Feld statt aus dem Dialog.
  useEffect(() => { box.current?.querySelector('input')?.focus(); }, []);
  return <div ref={box} className={`${BOX} space-y-3`}>
    <p className="text-sm font-medium">Partei im SSP anlegen</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <ProcessText label="Name der Partei" value={value.name} onChange={name => onChange({ ...value, name })} error={tried && !value.name.trim() ? 'Name fehlt.' : undefined} />
      <ProcessSelect label="Art" value={value.type} options={PARTY_TYPES} onChange={type => onChange({ ...value, type: type === 'person' ? 'person' : 'organization' })} />
    </div>
    <p className="text-sm">Die Partei wird mit dem SSP gespeichert und steht danach unter Metadaten.</p>
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button variant="secondary" className="min-h-touch desktop:min-h-0" onClick={() => { setTried(true); if (value.name.trim()) onSave(); }}>Partei speichern</Button>
      <Button variant="ghost" className="min-h-touch desktop:min-h-0" onClick={onCancel}>Anlegen abbrechen</Button>
    </div>
  </div>;
}

function DecisionFacts({ approve, label, protection, affected, bound }: Readonly<{
  approve: boolean; label: string; protection: ProcessProtection; affected?: ProcessDecisionView; bound?: string;
}>) {
  if (approve) return <dl className={FACTS}>
    <dt className={TERM}>Prozess</dt><dd className="break-words">{label}</dd>
    <dt className={TERM}>Schutzziele</dt>
    <dd>{PROCESS_GOAL_KEYS.map(goal => `${PROCESS_GOALS[goal]} ${protection.objectives[goal].value}`).join(' · ')}</dd>
    <dt className={TERM}>Kontext</dt><dd>vollständig</dd>
  </dl>;
  return <dl className={FACTS}>
    <dt className={TERM}>Betroffene Freigabe</dt>
    <dd className="break-words">{affected ? `${formatDecisionDate(affected.date)} · ${DECISION_ROLE} · ${affected.parties.join(', ')}` : 'nicht lesbar'}</dd>
    <dt className={TERM}>Gebundener Stand</dt><dd className="break-all font-mono text-xs">{shortHash(bound)}</dd>
    <dt className={TERM}>Folge</dt><dd>Die Prozessübergabe bleibt vorläufig, bis neu freigegeben wird.</dd>
  </dl>;
}

/** Prüfblatt vor dem Schreiben: gebundener Stand, feste Rolle, Partei und Begründung. */
export function SspProcessApprovalDialog({ localId, mode, label, processUuid, source, protection, parties, affected, onDecide, onAddParty, onClose }: Readonly<{
  /** Dokument, dessen Entwurfsablage den Dialogentwurf über Routenwechsel trägt. */
  localId: LocalId;
  mode: ProcessDecisionMode;
  label: string;
  processUuid: string;
  /** Gespeicherter Stand, an den die Entscheidung gebunden wird. */
  source: unknown;
  protection: ProcessProtection;
  parties: readonly PartyOption[];
  /** Zurückzunehmende Freigabe; bei einer Freigabe die vorige Entscheidung. */
  affected?: ProcessDecisionView;
  onDecide: (input: ProcessDecisionInput) => Promise<string | undefined>;
  onAddParty: (party: NewParty) => Promise<{ readonly uuid?: string; readonly code?: string }>;
  onClose: () => void;
}>) {
  const approve = mode === 'approved';
  const text = TEXT[mode];
  const draftKey = `${processUuid}:${mode}`;
  const [draft, setDraft] = useState<DialogDraft>(() => decisionDrafts(localId).get(draftKey) ?? { party: initialParty(parties, affected), remarks: '' });
  useEffect(() => { decisionDrafts(localId).set(draftKey, draft); }, [localId, draftKey, draft]);
  const { party, remarks, newParty } = draft;
  const setParty = (value: string) => setDraft(current => ({ ...current, party: value }));
  const setRemarks = (value: string) => setDraft(current => ({ ...current, remarks: value }));
  const creating = newParty !== undefined;
  const discard = () => { decisionDrafts(localId).delete(draftKey); onClose(); };
  // Ein spät eintreffender Erfolg verwirft nur den abgesendeten Entwurf, nie einen inzwischen neueren.
  const finish = (submitted: DialogDraft) => {
    const store = decisionDrafts(localId);
    if (store.get(draftKey) === submitted) store.delete(draftKey);
    onClose();
  };
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const addButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (creating || !returnFocus.current) return;
    returnFocus.current = false;
    addButton.current?.focus();
  }, [creating]);
  const closeCreation = (created?: string) => {
    returnFocus.current = true;
    setDraft(current => ({ ...current, newParty: undefined, party: created ?? current.party }));
  };
  const computed = useBoundHash(source, processUuid, party, approve);
  const bound = approve ? computed.value : affected?.hash;
  const hashFailed = approve && party !== '' ? computed.failed : undefined;
  let boundLabel = 'nach Wahl der Partei';
  if (party) boundLabel = bound === undefined && hashFailed === undefined ? 'wird berechnet …' : shortHash(bound);
  const confirm = async () => {
    setTried(true);
    if (!party || !remarks.trim()) return;
    const submitted = draft;
    setBusy(true);
    setError(undefined);
    let code: string | undefined;
    try {
      code = await onDecide({ processUuid, type: mode, uuid: crypto.randomUUID(), date: new Date().toISOString(), partyUuids: [party], remarks: remarks.trim() });
    } catch {
      code = 'WORKSPACE_STORAGE_FAILED';
    } finally {
      setBusy(false);
    }
    if (code) setError(errorText(code));
    else finish(submitted);
  };
  const addParty = async (next: NewParty) => {
    setBusy(true);
    setError(undefined);
    let result: { readonly uuid?: string; readonly code?: string };
    try {
      result = await onAddParty(next);
    } catch {
      result = { code: 'WORKSPACE_STORAGE_FAILED' };
    } finally {
      setBusy(false);
    }
    if (!result.uuid) {
      setError(`${errorText(result.code ?? 'WORKSPACE_STORAGE_FAILED')} Die Partei steht im Arbeitsstand unter Metadaten.`);
      return;
    }
    closeCreation(result.uuid);
    if (result.code) setError(PARTY_SAVED_AS_DRAFT);
  };
  return <ConfirmDialog open title={`${text.title} · ${label}`} confirmLabel={text.title} confirmVariant={text.variant}
    busy={busy} wide confirmDisabled={creating || (approve && party !== '' && bound === undefined)} onCancel={discard} onDismiss={onClose} onConfirm={() => { void confirm(); }}>
    <fieldset disabled={busy} className="min-w-0 space-y-3 text-[var(--color-text-primary)]">
      {approve && <div className={BOX}>
        <p className="font-medium">Gebundener Stand</p>
        <p>Die Freigabe gilt für den Prozess in diesem gespeicherten Stand: <span className="break-all font-mono text-xs">{boundLabel}</span>. Ändert sich der Prozess, wird sie „überholt“.</p>
        {hashFailed && <p role="alert" className="mt-2 text-sm text-[var(--color-danger-text)]">{hashFailedText(hashFailed)}</p>}
      </div>}
      <DecisionFacts approve={approve} label={label} protection={protection} affected={affected} bound={bound} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">Rolle</p>
          <p className="min-h-touch rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-subtle)] px-3 py-2 font-mono text-xs desktop:min-h-0">{DECISION_ROLE}</p>
        </div>
        <ProcessSelect label="Partei" value={party} options={parties} onChange={setParty} emptyLabel="Partei wählen" error={tried && !party ? 'Partei wählen.' : undefined} />
      </div>
      {creating
        ? <NewPartyFields value={newParty} onChange={value => setDraft(current => ({ ...current, newParty: value }))}
          onSave={() => { void addParty({ ...newParty, name: newParty.name.trim() }); }} onCancel={() => closeCreation()} />
        : <Button ref={addButton} variant="secondary" className="min-h-touch w-full sm:w-auto desktop:min-h-0"
          onClick={() => setDraft(current => ({ ...current, newParty: { uuid: crypto.randomUUID(), type: 'organization', name: '' } }))}>+ Partei im SSP anlegen</Button>}
      <ProcessText label={text.remarks} multiline value={remarks} onChange={setRemarks} error={tried && !remarks.trim() ? text.missing : undefined} />
      <p className={BOX}>Die Anwendung dokumentiert die erklärte Entscheidung der Institutionsleitung. Weder Identität noch Befugnis werden geprüft; es entsteht keine Signatur.</p>
      {error && <p role="alert" className="text-sm text-[var(--color-danger-text)]">{error}</p>}
    </fieldset>
  </ConfirmDialog>;
}
