import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import { addSspItem, readSspValue } from '@/domain/sspAuthoring';
import { deriveProcessApproval, processActionChain, type ProcessApprovalState } from '@/domain/sspProcessApproval';
import { processProps } from '@/domain/sspProcessProjection';
import { SECTION_LABEL } from '@/features/workspace/profile/ProfileMarks';
import { StatusChip } from '@/features/workspace/ssp/SspProcessFields';
import type { SspEditor } from '@/features/workspace/ssp/useSspEditor';

export const DECISION_ROLE = 'institution-management';
const DATE = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

export interface ProcessDecisionView {
  readonly date: string;
  readonly partyUuids: readonly string[];
  readonly parties: readonly string[];
  readonly remarks: string;
  readonly hash?: string;
}

export interface ProcessApprovalView {
  readonly state: ProcessApprovalState;
  /** Zuletzt gebundene Aktion: Freigabe oder Rücknahme. */
  readonly last?: ProcessDecisionView;
  /** Freigabe, die eine Rücknahme nennen würde. */
  readonly withdrawable?: ProcessDecisionView;
}

export function formatDecisionDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DATE.format(date);
}

export function shortHash(hash: string | undefined): string {
  const match = /^(.*:)([0-9a-f]{64})$/.exec(hash ?? '');
  return match ? `${match[1]}${match[2].slice(0, 4)}…${match[2].slice(-4)}` : hash ?? 'nicht berechenbar';
}

function decisionView(source: unknown, action: JsonObject): ProcessDecisionView {
  const parties = readArray(readSspValue(source, ['metadata', 'parties'])).filter(isJsonObject);
  const partyUuids = readArray(action['responsible-parties']).filter(isJsonObject)
    .flatMap(assignment => readArray(assignment['party-uuids']))
    .filter((uuid): uuid is string => typeof uuid === 'string');
  return {
    date: readString(action.date) ?? '',
    partyUuids,
    parties: partyUuids.map(uuid => readString(parties.find(party => readString(party.uuid)?.toLowerCase() === uuid.toLowerCase())?.name) ?? uuid),
    remarks: readString(action.remarks) ?? '',
    hash: readString(processProps(action, 'process-cia-content-hash')[0]?.value),
  };
}

async function readProcessApproval(source: unknown, processUuid: string): Promise<ProcessApprovalView> {
  const { state } = await deriveProcessApproval(source, processUuid);
  if (state === 'missing' || state === 'invalid') return { state };
  const chain = processActionChain(source, processUuid);
  return {
    state,
    last: chain.action && decisionView(source, chain.action),
    withdrawable: chain.withdrawable && decisionView(source, chain.withdrawable),
  };
}

/** Freigabestand je Prozess-UUID, immer aus dem gespeicherten Stand gelesen. */
export function useProcessApprovals(source: unknown, uuids: readonly string[]): ReadonlyMap<string, ProcessApprovalView> | undefined {
  const key = uuids.join('|');
  const [result, setResult] = useState<{ source: unknown; key: string; value: ReadonlyMap<string, ProcessApprovalView> }>();
  useEffect(() => {
    let active = true;
    const targets = key ? key.split('|') : [];
    void Promise.all(targets.map(async uuid => [uuid.toLowerCase(), await readProcessApproval(source, uuid)
      .catch((): ProcessApprovalView => ({ state: 'invalid' }))] as const))
      .then(entries => { if (active) setResult({ source, key, value: new Map(entries) }); });
    return () => { active = false; };
  }, [source, key]);
  return result && result.source === source && result.key === key ? result.value : undefined;
}

function decisionRoles(source: unknown) {
  return readArray(readSspValue(source, ['metadata', 'roles'])).filter(role => isJsonObject(role) && role.id === DECISION_ROLE);
}
function hasDecisionRole(source: unknown): boolean {
  return decisionRoles(source).some(role => isJsonObject(role) && Boolean(readString(role.title)?.trim()));
}

export interface DecisionGate {
  /** Fehlende Rolle im gespeicherten SSP; eine fehlende Partei legt der Dialog an. */
  readonly reasons: readonly string[];
  readonly blocked?: string;
  readonly onAddRole?: () => void;
}

/** Was eine Entscheidung im gespeicherten Stand verhindert; gilt für alle Prozesse eines SSP. */
export function decisionGate(editor: SspEditor, lock: string | undefined): DecisionGate {
  const saved = editor.unadoptedDecision?.source ?? editor.envelope?.source;
  const role = hasDecisionRole(saved);
  const reasons = role ? [] : [`Rolle ${DECISION_ROLE} mit Titel unter Metadaten`];
  let blocked = lock;
  if (!blocked && editor.unadoptedDecision) blocked = 'Eine gespeicherte Entscheidung ist noch nicht in den Editor übernommen; angezeigt ist der gespeicherte Freigabestand. Offene Eingaben verwerfen; danach übernimmt der Editor den gespeicherten Stand. Bis dahin sind Freigabe, Rücknahme und Export gesperrt.';
  if (!blocked && editor.dirty) blocked = 'Ungespeicherte Änderungen: Der Freigabestand gilt für den gespeicherten Stand. Bitte zuerst speichern; Freigabe und Rücknahme sind bis dahin nicht verfügbar.';
  if (!blocked && editor.saveState.kind !== 'stored' && editor.saveState.kind !== 'saved') blocked = 'Ein automatisch gesicherter Entwurf liegt vor. Bitte zuerst speichern; Freigabe und Rücknahme sind bis dahin nicht verfügbar.';
  if (!blocked && editor.envelope?.documentState === 'draft') blocked = 'Das SSP ist als Entwurf gespeichert. Freigabe und Rücknahme brauchen einen technisch gültigen gespeicherten Stand.';
  if (!blocked && editor.busy) blocked = 'Speichern läuft.';
  // Eine vorhandene Rolle ohne Titel wird unter Metadaten ergänzt; eine zweite Rolle derselben ID wäre ungültig.
  const onAddRole = decisionRoles(saved).length > 0 || decisionRoles(editor.working).length > 0 ? undefined
    : () => { editor.apply(source => addSspItem(source, ['metadata', 'roles'], { id: DECISION_ROLE, title: 'Institutionsleitung' })); };
  return { reasons, blocked, onAddRole };
}

const STATES = {
  missing: { text: 'Fehlt', tone: 'neutral' },
  current: { text: 'Aktuell', tone: 'complete' },
  stale: { text: 'Überholt', tone: 'open' },
  withdrawn: { text: 'Zurückgenommen', tone: 'neutral' },
  invalid: { text: 'Ungültig', tone: 'error' },
  impossible: { text: 'Nicht möglich', tone: 'neutral' },
} as const;

function chipState(approval: ProcessApprovalView, possible: boolean): keyof typeof STATES {
  return approval.state === 'missing' && !possible ? 'impossible' : approval.state;
}

export function ApprovalChip({ approval, possible }: Readonly<{ approval: ProcessApprovalView; possible: boolean }>) {
  const { text, tone } = STATES[chipState(approval, possible)];
  return <StatusChip text={`Freigabe ${text.toLowerCase()}`} tone={tone} />;
}

function explanation({ state, last }: ProcessApprovalView): string | undefined {
  if (state === 'current') return 'Der gebundene Prozessstand stimmt mit dem gespeicherten Prozess überein.';
  if (state === 'stale') return `Der Prozess wurde nach der Freigabe geändert. Die Freigabe vom ${formatDecisionDate(last?.date ?? '')} gilt für den früheren Stand.`;
  if (state === 'withdrawn') return 'Die Prozessübergabe bleibt vorläufig, bis neu freigegeben wird.';
  if (state === 'invalid') return 'Die Aktionskette ist ungültig. Die importierte Aktion bleibt unverändert erhalten.';
  return undefined;
}

const TERM = 'text-[var(--color-text-secondary)]';

export function ProcessApprovalBlock({ approval, processReasons, decisionReasons, blocked, risk, notice, onApprove, onWithdraw, onAddRole }: Readonly<{
  approval: ProcessApprovalView | undefined;
  /** Fehlende Prozessangaben; sie sperren nur eine neue Freigabe. */
  processReasons: readonly string[];
  /** Fehlende Rolle im gespeicherten SSP; sie sperrt Freigabe und Rücknahme. */
  decisionReasons: readonly string[];
  /** Grund, warum gerade keine Entscheidung geschrieben werden kann. */
  blocked?: string;
  risk: boolean;
  notice?: string;
  onApprove: () => void;
  onWithdraw: () => void;
  onAddRole?: () => void;
}>) {
  const frame = (children: ReactNode) => <section aria-label="Leitungsfreigabe" className="space-y-3 rounded-md border border-[var(--color-border-subtle)] p-3">
    <h3 className={SECTION_LABEL}>Leitungsfreigabe des Prozess-Schutzbedarfs</h3>
    {children}
  </section>;
  if (!approval) return frame(<output className="block text-sm text-[var(--color-text-secondary)]">Freigabestand wird gelesen…</output>);
  const { state, last } = approval;
  const reasons = [...processReasons, ...decisionReasons];
  const canApprove = state !== 'current' && state !== 'invalid' && reasons.length === 0;
  // Auch nach einer Rücknahme bleibt eine ältere, noch nicht zurückgenommene Freigabe ausdrücklich zurücknehmbar.
  const canWithdraw = state !== 'missing' && state !== 'invalid' && approval.withdrawable !== undefined && decisionReasons.length === 0;
  const { text, tone } = STATES[chipState(approval, reasons.length === 0)];
  const detail = explanation(approval);
  return frame(<>
    <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className={TERM}>Stand</dt>
      <dd className="flex flex-wrap items-center gap-2"><StatusChip text={text} tone={tone} />{detail && <span>{detail}</span>}</dd>
      {state === 'invalid' && <>
        <dt className={TERM}>Befund</dt>
        <dd className="break-all font-mono text-xs">SSP_PROCESS_BINDING_INVALID · /system-security-plan/metadata/actions</dd>
      </>}
      {last && <>
        <dt className={TERM}>{state === 'withdrawn' ? 'Zurückgenommen am' : 'Freigegeben am'}</dt><dd>{formatDecisionDate(last.date)}</dd>
        <dt className={TERM}>Rolle</dt><dd className="font-mono text-xs">{DECISION_ROLE}</dd>
        <dt className={TERM}>Partei</dt><dd className="break-words">{last.parties.join(', ')}</dd>
        <dt className={TERM}>{state === 'withdrawn' ? 'Anlass' : 'Begründung'}</dt><dd className="break-words">{last.remarks}</dd>
      </>}
      {last?.hash && <>
        <dt className={TERM}>Gebundener Stand</dt><dd className="break-all font-mono text-xs">{shortHash(last.hash)}</dd>
      </>}
    </dl>
    {reasons.length > 0 && state !== 'current' && state !== 'invalid' && <p className="text-sm">Keine Freigabe möglich. Es fehlen: {reasons.join(' · ')}</p>}
    {blocked && (canApprove || canWithdraw) && <p className="text-sm text-[var(--color-warning-text)]">{blocked}</p>}
    {(canApprove || canWithdraw || onAddRole) && <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {canApprove && <Button variant="secondary" className="min-h-touch" disabled={blocked !== undefined} onClick={onApprove}>{state === 'missing' ? 'Freigabe dokumentieren…' : 'Neu freigeben…'}</Button>}
      {canWithdraw && <Button variant="secondary" className="min-h-touch" disabled={blocked !== undefined} onClick={onWithdraw}>Freigabe zurücknehmen…</Button>}
      {onAddRole && <Button variant="ghost" className="min-h-touch" onClick={onAddRole}>Rolle {DECISION_ROLE} anlegen</Button>}
    </div>}
    {risk && <p className="text-sm text-[var(--color-warning-text)]">Explizite Risikobetrachtung erforderlich · bleibt offen. Die Freigabe bewertet kein Risiko.</p>}
    {notice && <output className="block text-sm">{notice}</output>}
    <p className="text-xs text-[var(--color-text-secondary)]">Die Anwendung dokumentiert die erklärte Entscheidung der Institutionsleitung. Identität und Befugnis werden nicht geprüft.</p>
  </>);
}
