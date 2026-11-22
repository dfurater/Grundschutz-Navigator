import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import {
  SCOPE_BOUNDARY_DETAILS, scopeBoundaryInput, scopeBoundarySourceText, scopeBoundaryState,
  boundaryDraftBase, startBoundaryDraft, type ScopeBoundaryDraft, type ScopeBoundaryInput, type ScopeBoundaryItem,
} from '@/domain/scopeBoundary';
import type { WorkspaceScope } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { INPUT, ROW_BUTTON } from '@/features/workspace/WorkspaceForms';
import { WorkspaceNotices } from '@/features/workspace/WorkspaceNotices';

const PANEL = 'rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]';
const MARK = 'inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-xs leading-4';
const LABEL = 'text-xs font-medium text-[var(--color-text-secondary)]';

/** Statusvokabular nach Zielbild Ansicht 3: „Fehlt“ hervorgehoben, „Offen“ umrandet, „Erfasst“ zurückgenommen. */
function BoundaryChip({ kind }: Readonly<{ kind: 'missing' | 'open' | 'complete' }>) {
  if (kind === 'complete') return <span className={`${MARK} border-[var(--color-border-default)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]`}>Erfasst</span>;
  const tone = kind === 'missing' ? 'font-semibold' : 'font-medium';
  return <span className={`${MARK} border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-primary)] ${tone}`}>{kind === 'missing' ? 'Fehlt' : 'Offen'}</span>;
}

function Row({ term, children }: Readonly<{ term: string; children: ReactNode }>) {
  return (
    <>
      <dt className="text-[var(--color-text-secondary)]">{term}</dt>
      <dd className="mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 break-words text-[var(--color-text-primary)] sm:mb-0">{children}</dd>
    </>
  );
}

function boundaryAction(writable: boolean, present: boolean): string {
  if (!present) return 'Abgrenzung erfassen';
  return writable ? 'Abgrenzung bearbeiten' : 'Abgrenzung ansehen';
}

/** Karte „Abgrenzung“ der Anwendungsbereichsübersicht; der Quellenstand stammt nur aus `source`, nie aus `savedAt`. */
export function ScopeBoundaryCard({ scope, writable, onEdit }: Readonly<{ scope: WorkspaceScope; writable: boolean; onEdit: (trigger: HTMLButtonElement) => void }>) {
  const item: ScopeBoundaryItem | undefined = scope.items[0];
  const state = scopeBoundaryState(item);
  const source = scopeBoundarySourceText(item?.source);
  const responsibility = [item?.responsibility?.role, item?.responsibility?.party].filter(Boolean).join(' · ');
  return (
    <section aria-labelledby="scope-abgrenzung" className={`${PANEL} space-y-3 p-4`}>
      <h2 id="scope-abgrenzung" className="text-base font-semibold leading-snug text-[var(--color-text-primary)]">Abgrenzung</h2>
      {item?.content && <p className="whitespace-pre-line break-words text-sm text-[var(--color-text-primary)]">{item.content}</p>}
      <dl className="grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-[auto_1fr] sm:gap-y-2">
        <Row term="Abgrenzung"><BoundaryChip kind={state.kind} />{source && <span>{source}</span>}</Row>
        {state.kind === 'open' && <Row term="Noch offen">{state.missing.join(', ')}</Row>}
        <Row term="Zuständigkeit">{responsibility ? <span>{responsibility}</span> : <BoundaryChip kind="missing" />}</Row>
      </dl>
      {/* Bei Schreibsperre bleibt eine vorhandene Abgrenzung im schreibgeschützten Editor lesbar. */}
      <button type="button" disabled={!writable && !item} onClick={(event) => onEdit(event.currentTarget)}
        className={`flex min-h-touch items-center rounded text-sm font-semibold catalog-prose-link disabled:cursor-not-allowed disabled:opacity-60 desktop:min-h-0 ${FOCUS_RING}`}>
        {boundaryAction(writable, item !== undefined)}<span aria-hidden="true">&nbsp;→</span>
      </button>
    </section>
  );
}

function Field({ label, value, onChange, multiline = false, type = 'text' }: Readonly<{
  label: string; value: string; onChange: (value: string) => void; multiline?: boolean; type?: 'text' | 'date';
}>) {
  const id = useId();
  const common = { id, value, autoComplete: 'off', spellCheck: false, className: `mt-1 ${INPUT}` } as const;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={LABEL}>{label}</label>
      {multiline
        ? <textarea {...common} rows={3} onChange={(event) => onChange(event.target.value)} />
        : <input {...common} type={type} onChange={(event) => onChange(event.target.value)} />}
    </div>
  );
}

/**
 * Ansicht „Abgrenzung erfassen“ als lokaler Zustand der Übersicht. Konflikt, Speicherfehler und Routenwechsel
 * behalten die Eingabe; „Abbrechen“ verwirft sie ohne Schreibvorgang.
 */
export function ScopeBoundaryEditor({ scopeId, onClose, onSaved }: Readonly<{ scopeId: string; onClose: () => void; onSaved: () => void }>) {
  const { writable, scopes, saveScopeBoundary, boundaryDrafts } = useWorkspace();
  const scope = scopes?.find((entry) => entry.scopeId === scopeId);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  // Eingabe und Vergleichsstand bleiben ein Paar und überdauern Routenwechsel; nur „Abbrechen“ oder Speichern verwirft sie.
  const [draft, setDraft] = useState<ScopeBoundaryDraft | undefined>(() => boundaryDrafts.get(scopeId) ?? (scope && startBoundaryDraft(scope)));
  const [failure, setFailure] = useState<'conflict' | 'failed' | null>(null);
  const [busy, setBusy] = useState(false);
  const input = draft?.input ?? scopeBoundaryInput(undefined);
  const change = (next: ScopeBoundaryDraft) => { boundaryDrafts.set(scopeId, next); setDraft(next); };
  const set = (key: keyof ScopeBoundaryInput) => (value: string) => { if (draft) change({ ...draft, input: { ...draft.input, [key]: value } }); };
  // Neuerer Inhalt gilt erst nach ausdrücklichem Laden und ersetzt dann die Eingabe; ein nur fortgeschriebener Stempel gilt sofort.
  const base = scope && draft ? boundaryDraftBase(draft, scope) : null;
  const newer = scope && draft && base === null ? scope : undefined;
  const loadCurrent = () => {
    if (!newer) return;
    change(startBoundaryDraft(newer));
    setFailure(null);
  };

  const save = async () => {
    if (busy || !scope || !draft) return;
    setBusy(true);
    const saved = draft;
    const result = await saveScopeBoundary(scope.scopeId, base ?? saved.base, saved.input);
    setBusy(false);
    if (result.ok) {
      // Ein nach einem Routenwechsel neu begonnener Entwurf ersetzt den Eintrag und bleibt erhalten.
      if (boundaryDrafts.get(scopeId) === saved) boundaryDrafts.delete(scopeId);
      onSaved();
    } else setFailure(result.diagnostic.code === 'WORKSPACE_SAVE_CONFLICT' ? 'conflict' : 'failed');
  };
  const cancel = () => {
    boundaryDrafts.delete(scopeId);
    onClose();
  };

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-4 p-4 desktop:px-7 desktop:py-6">
      <h1 ref={heading} tabIndex={-1} className="type-page-title focus:outline-none">{boundaryAction(writable, scope?.items[0] !== undefined)}</h1>
      <WorkspaceNotices />
      <form className="max-w-3xl space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset disabled={!writable || busy || !draft} className="space-y-4">
          <section aria-labelledby="abgrenzung-inhalt" className={`${PANEL} space-y-3 p-4`}>
            <h2 id="abgrenzung-inhalt" className="text-base font-semibold">Abgrenzung</h2>
            <Field label="Zusammenfassung" value={input.content} onChange={set('content')} multiline />
            {SCOPE_BOUNDARY_DETAILS.map(([key, label]) => (
              <Field key={key} label={label} value={input[key]} onChange={set(key)} multiline />
            ))}
          </section>
          <section aria-labelledby="abgrenzung-quelle" className={`${PANEL} grid gap-3 p-4 sm:grid-cols-3`}>
            <h2 id="abgrenzung-quelle" className="text-base font-semibold sm:col-span-3">Quelle und Stand</h2>
            <Field label="Quelle" value={input.sourceLabel} onChange={set('sourceLabel')} />
            <Field label="Version" value={input.sourceVersion} onChange={set('sourceVersion')} />
            <Field label="Datum" type="date" value={input.sourceIssuedAt} onChange={set('sourceIssuedAt')} />
          </section>
          <section aria-labelledby="abgrenzung-zustaendigkeit" className={`${PANEL} grid gap-3 p-4 sm:grid-cols-2`}>
            <h2 id="abgrenzung-zustaendigkeit" className="text-base font-semibold sm:col-span-2">Zuständigkeit</h2>
            <Field label="Rolle" value={input.role} onChange={set('role')} />
            <Field label="Zuständige Stelle" value={input.party} onChange={set('party')} />
          </section>
        </fieldset>
        {failure === 'conflict' && (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-[var(--color-danger-text)]">
              {newer
                ? 'Abgrenzung inzwischen geändert. Nichts gespeichert. Die Eingabe bleibt erhalten; „Aktuellen Stand laden“ ersetzt sie durch die gespeicherte Abgrenzung.'
                : 'Anwendungsbereich inzwischen geändert. Nichts gespeichert. Die Eingabe bleibt erhalten.'}
            </p>
            {newer && <Button variant="secondary" className={ROW_BUTTON} disabled={busy} onClick={loadCurrent}>Aktuellen Stand laden</Button>}
          </div>
        )}
        {failure === 'failed' && <p role="alert" className="text-sm text-[var(--color-danger-text)]">Lokal speichern fehlgeschlagen. Die Eingabe bleibt erhalten.</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className={ROW_BUTTON} disabled={!writable || busy || !draft}>Speichern</Button>
          {/* Gesperrt während des Speicherns: Ein später eintreffendes Ergebnis darf keine neu geöffnete Ansicht schließen. */}
          <Button variant="secondary" className={ROW_BUTTON} disabled={busy} onClick={cancel}>Abbrechen</Button>
        </div>
      </form>
    </div>
  );
}

/**
 * Übersicht mit der Ansicht „Abgrenzung erfassen“ als lokalem Zustand, keine Route. Die Rückkehr fokussiert
 * den Auslöser, nach dem Speichern die Seitenüberschrift.
 */
export function ScopeBoundaryArea({ scopeId, title, children }: Readonly<{
  scopeId: string;
  title: ReactNode;
  children: (edit: (trigger: HTMLButtonElement) => void, editing: boolean) => ReactNode;
}>) {
  const [edit, setEdit] = useState<{ open: boolean; trigger: HTMLButtonElement; saved?: boolean }>();
  const overview = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!edit || edit.open) return;
    if (!edit.saved) edit.trigger.focus();
    if (edit.saved || document.activeElement !== edit.trigger) overview.current?.querySelector('h1')?.focus();
  }, [edit]);
  const editing = edit?.open === true;
  return (
    <>
      {title}
      {editing && (
        <ScopeBoundaryEditor scopeId={scopeId}
          onClose={() => setEdit((current) => current && { ...current, open: false })}
          onSaved={() => setEdit((current) => current && { ...current, open: false, saved: true })} />
      )}
      <div ref={overview} hidden={editing}>{children((trigger) => setEdit({ open: true, trigger }), editing)}</div>
    </>
  );
}
