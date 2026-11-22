import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { ProcessDecisionInput } from '@/domain/sspProcessApproval';
import { PROCESS_GOALS, PROCESS_GOAL_KEYS } from '@/domain/sspProcessEditing';
import { processContentHash } from '@/domain/sspProcessProjection';
import type { ProcessProtection } from '@/domain/sspProcessProtection';
import { DECISION_ROLE, formatDecisionDate, shortHash, type ProcessDecisionView } from '@/features/workspace/ssp/SspProcessApproval';
import { ProcessSelect, ProcessText } from '@/features/workspace/ssp/SspProcessFields';

const ERRORS: Readonly<Record<string, string>> = {
  WORKSPACE_SAVE_CONFLICT: 'Nicht gespeichert. Das Dokument wurde in einem anderen Tab geändert. Die Entscheidung wurde nicht geschrieben; Dokument und Eingaben sind unverändert.',
  SSP_PROCESS_DECISION_BLOCKED: 'Nicht gespeichert. Eine Entscheidung braucht einen gespeicherten, technisch gültigen Stand ohne offenen Entwurf.',
  SSP_CATEGORY_CONTEXT_UNAVAILABLE: 'Nicht gespeichert. Der Kategorienkontext zum gebundenen Katalogstand ist nicht geladen; die Zuordnungen sind nicht prüfbar.',
};
const TEXT = {
  approved: { title: 'Freigabe dokumentieren', remarks: 'Begründung', missing: 'Begründung fehlt.', variant: 'primary' },
  withdrawn: { title: 'Freigabe zurücknehmen', remarks: 'Anlass der Rücknahme', missing: 'Anlass fehlt.', variant: 'danger' },
} as const;
const BOX = 'rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-subtle)] p-3';
const TERM = 'text-[var(--color-text-secondary)]';
const FACTS = 'grid gap-x-4 gap-y-1 sm:grid-cols-[12rem_minmax(0,1fr)]';

export type ProcessDecisionMode = keyof typeof TEXT;
type PartyOption = { readonly value: string; readonly label: string };

function initialParty(parties: readonly PartyOption[], affected: ProcessDecisionView | undefined): string {
  const previous = parties.find(option => affected?.partyUuids.some(uuid => uuid.toLowerCase() === option.value.toLowerCase()));
  if (previous) return previous.value;
  return parties.length === 1 ? parties[0].value : '';
}

/** Hash des gespeicherten Prozessstands für die gewählte Partei; die Partei gehört zur Bindung. */
function useBoundHash(source: unknown, processUuid: string, party: string, enabled: boolean): string | undefined {
  const [hash, setHash] = useState<{ party: string; value?: string }>();
  useEffect(() => {
    if (!enabled || !party) return;
    let active = true;
    void processContentHash(source, processUuid, [{ 'role-id': DECISION_ROLE, 'party-uuids': [party] }])
      .then(value => value, () => undefined)
      .then(value => { if (active) setHash({ party, value }); });
    return () => { active = false; };
  }, [enabled, party, processUuid, source]);
  return hash?.party === party ? hash.value : undefined;
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
export function SspProcessApprovalDialog({ mode, label, processUuid, source, protection, parties, affected, onDecide, onClose }: Readonly<{
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
  onClose: () => void;
}>) {
  const approve = mode === 'approved';
  const text = TEXT[mode];
  const [party, setParty] = useState(() => initialParty(parties, affected));
  const [remarks, setRemarks] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const computed = useBoundHash(source, processUuid, party, approve);
  const bound = approve ? computed : affected?.hash;
  const confirm = async () => {
    setTried(true);
    if (!party || !remarks.trim()) return;
    setBusy(true);
    setError(undefined);
    const code = await onDecide({ processUuid, type: mode, uuid: crypto.randomUUID(), date: new Date().toISOString(), partyUuids: [party], remarks: remarks.trim() });
    setBusy(false);
    if (code) setError(ERRORS[code] ?? `Nicht gespeichert. Befund: ${code}.`);
    else onClose();
  };
  return <ConfirmDialog open title={`${text.title} · ${label}`} confirmLabel={text.title} confirmVariant={text.variant}
    busy={busy} wide onCancel={onClose} onConfirm={() => { void confirm(); }}>
    <div className="space-y-3 text-[var(--color-text-primary)]">
      {approve && <div className={BOX}>
        <p className="font-medium">Gebundener Stand</p>
        <p>Die Freigabe gilt für den Prozess in diesem gespeicherten Stand: <span className="break-all font-mono text-xs">{party ? shortHash(bound) : 'nach Wahl der Partei'}</span>. Ändert sich der Prozess, wird sie „überholt“.</p>
      </div>}
      <DecisionFacts approve={approve} label={label} protection={protection} affected={affected} bound={bound} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">Rolle</p>
          <p className="min-h-touch rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-subtle)] px-3 py-2 font-mono text-xs desktop:min-h-0">{DECISION_ROLE}</p>
        </div>
        <ProcessSelect label="Partei" value={party} options={parties} onChange={setParty} emptyLabel="Partei wählen" error={tried && !party ? 'Partei wählen.' : undefined} />
      </div>
      <ProcessText label={text.remarks} multiline value={remarks} onChange={setRemarks} error={tried && !remarks.trim() ? text.missing : undefined} />
      <p className={BOX}>Die Anwendung dokumentiert die erklärte Entscheidung der Institutionsleitung. Weder Identität noch Befugnis werden geprüft; es entsteht keine Signatur.</p>
      {error && <p role="alert" className="text-sm text-[var(--color-danger-text)]">{error}</p>}
    </div>
  </ConfirmDialog>;
}
