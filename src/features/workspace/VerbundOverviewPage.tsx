import { useEffect, useId, useReducer, useRef, useState, type ChangeEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { PageTitle } from '@/app/PageTitle';
import { PAGE_TITLES } from '@/app/pageTitles';
import { buildScopeUrl, buildVerbundUrl } from '@/app/routes';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useWorkspace } from '@/hooks/useWorkspace';
import type { WorkspaceContextValue } from '@/state/WorkspaceContext';
import { NEW_SCOPE_DRAFT } from '@/state/workspaceRestore';
import type { WorkspaceScope, WorkspaceVerbund } from '@/domain/workspaceModel';
import { FOCUS_RING, OriginLabel } from '@/features/workspace/DocumentMarks';
import { WorkspaceNotices, useBackupExport, type PreparedBackup } from '@/features/workspace/WorkspaceNotices';
import { RestoreSheet, type RestoreDone } from '@/features/workspace/RestoreSheet';
import { VerbundExportDialog, scopedVerbundBackup, type PreparedVerbundBackup } from '@/features/workspace/VerbundExportDialog';
import { WorkspaceDeleteDialog } from '@/features/workspace/WorkspaceDeleteDialog';
import { NameForm, ROW_BUTTON, SectionHead } from '@/features/workspace/WorkspaceForms';
import { ScopeCreateView } from '@/features/workspace/ScopeOverviewPage';

const DELETED_TITLE = 'Lokale Daten gelöscht';
const SCOPES_UNREADABLE = 'Anwendungsbereiche nicht lesbar';
const DELETED_TEXT = 'Der gesamte Arbeitsbestand wurde aus diesem Browserprofil entfernt. Exportierte Dateien bleiben erhalten.';
const ABORTED_TEXT = 'Löschung abgebrochen. Vorbereitend gespeicherte Eingaben bleiben erhalten.';
const SCOPE_DELETED_TEXT = 'Anwendungsbereich gelöscht.';

function workspaceStatusText(deleted: boolean, aborted: boolean, restored: RestoreDone | null, scopeDeleted: boolean): string {
  if (deleted) return `${DELETED_TITLE}. ${DELETED_TEXT}`;
  if (aborted) return ABORTED_TEXT;
  if (restored) return `Wiederhergestellt: ${restored.text}`;
  return scopeDeleted ? SCOPE_DELETED_TEXT : '';
}

/** Laufende Anlage eines Namens aus Anlegeformular oder Klärungszeile; `run` liefert, ob er angelegt ist. */
type CreateRun = { readonly name: string; readonly run: Promise<boolean> };

const UNASSIGNED = 'inline-flex items-center whitespace-nowrap rounded border border-[var(--color-border-strong)] px-2 py-0.5 text-xs font-medium leading-4 text-[var(--color-text-secondary)]';

function ScopeRow({ scope, count }: Readonly<{ scope: WorkspaceScope; count: number }>) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
      <Link
        to={buildScopeUrl(scope.scopeId)}
        className={`flex min-h-touch min-w-0 flex-1 basis-48 items-center rounded text-sm font-semibold text-[var(--color-text-primary)] hover:underline desktop:min-h-8 ${FOCUS_RING}`}
      >
        <span className="min-w-0 break-words">{scope.name}</span>
      </Link>
      <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">
        {count} {count === 1 ? 'Informationsverbund' : 'Informationsverbünde'}
      </span>
    </li>
  );
}

function VerbundRow({ verbund, scopeName, writable, rowDrafts, onRowDraft, track, restored, exporting, onExport, onDelete }: Readonly<{
  verbund: WorkspaceVerbund;
  /** Beschriftung der Zuordnung; `undefined` bei unzugeordneten Verbünden. */
  scopeName: string | undefined;
  writable: boolean;
  /** Offene Zeilenumbenennungen der Seite; ein Eintrag hält das Formular dieser Zeile offen. */
  rowDrafts: Map<string, string>;
  onRowDraft: (verbundId: string, draft: string | null) => void;
  /** Meldet eine laufende Umbenennung, damit „Vorher sichern“ sie abwartet. */
  track: <T>(run: Promise<T>) => Promise<T>;
  /** Zuletzt wiederhergestellt; hinterlegt, bis die Seite verlassen wird. */
  restored: boolean;
  exporting: boolean;
  onExport: (verbund: WorkspaceVerbund, trigger: HTMLButtonElement) => void;
  onDelete: (verbund: WorkspaceVerbund) => void;
}>) {
  const { renameVerbund, renameDrafts } = useWorkspace();
  const draft = rowDrafts.get(verbund.verbundId);
  if (draft !== undefined) {
    return (
      <li className="px-4 py-3">
        <NameForm
          label="Neuer Name"
          submitLabel="Speichern"
          initial={draft}
          disabled={!writable}
          onChange={(name) => rowDrafts.set(verbund.verbundId, name)}
          onSubmit={(name) => track((async () => {
            // Der neue Name ersetzt nur den Entwurf, der beim Speichern offen war; ein danach getippter bleibt.
            const sessionDraft = renameDrafts.get(verbund.verbundId);
            const result = await renameVerbund(verbund.verbundId, name);
            if (!result.ok) return false;
            if (renameDrafts.get(verbund.verbundId) === sessionDraft) renameDrafts.delete(verbund.verbundId);
            if (rowDrafts.get(verbund.verbundId)?.trim() === name) onRowDraft(verbund.verbundId, null);
            return true;
          })())}
          onCancel={() => onRowDraft(verbund.verbundId, null)}
        />
      </li>
    );
  }
  return (
    <li data-restored={restored || undefined} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 ${restored ? 'bg-[var(--color-surface-subtle)]' : ''}`}>
      <Link
        to={buildVerbundUrl(verbund.verbundId)}
        className={`flex min-h-touch min-w-0 flex-1 basis-48 items-center rounded text-sm font-semibold text-[var(--color-text-primary)] hover:underline desktop:min-h-8 ${FOCUS_RING}`}
      >
        <span className="min-w-0 break-words">{verbund.name}</span>
      </Link>
      <span className="min-w-0 basis-40 break-words text-sm text-[var(--color-text-secondary)]">
        {scopeName ?? <span className={UNASSIGNED}>Unzugeordnet</span>}
      </span>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" className={ROW_BUTTON} disabled={!writable} onClick={() => onRowDraft(verbund.verbundId, verbund.name)}>Umbenennen</Button>
        {/* Die Beschriftung folgt der angezeigten Zuordnung; ob der Dialog erscheint, entscheidet die erstellte Datei. */}
        <Button variant="ghost" size="sm" className={ROW_BUTTON} disabled={exporting} aria-label={`${verbund.name} sichern${verbund.scopeId === undefined ? '' : '…'}`} onClick={(event) => onExport(verbund, event.currentTarget)}>
          {verbund.scopeId === undefined ? 'Sichern' : 'Sichern…'}
        </Button>
        <button
          type="button"
          disabled={!writable}
          onClick={() => onDelete(verbund)}
          className={`${ROW_BUTTON} inline-flex items-center justify-center rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--color-danger-text)] transition-colors hover:bg-[var(--color-danger-surface)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
        >
          Löschen…
        </button>
      </div>
    </li>
  );
}

/** Abschnitt „Anwendungsbereiche“; ein Lesefehler erscheint als solcher, nie als leerer Bestand. */
function ScopeSection({ ready, failed, scopes, verbuende, writable, onCreate }: Readonly<{
  ready: boolean;
  failed: boolean;
  scopes: readonly WorkspaceScope[];
  verbuende: readonly WorkspaceVerbund[];
  writable: boolean;
  onCreate: (trigger: HTMLButtonElement) => void;
}>) {
  let content;
  if (failed) {
    content = <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">{SCOPES_UNREADABLE}</p>;
  } else if (scopes.length === 0) {
    content = (
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <p className="text-sm text-[var(--color-text-secondary)]">Kein Anwendungsbereich angelegt</p>
        <Button variant="ghost" className={ROW_BUTTON} disabled={!writable} onClick={(event) => onCreate(event.currentTarget)}>Anwendungsbereich anlegen</Button>
      </div>
    );
  } else {
    content = (
      <ul className="divide-y divide-[var(--color-border-subtle)]">
        {scopes.map((scope) => (
          <ScopeRow key={scope.scopeId} scope={scope} count={verbuende.filter((verbund) => verbund.scopeId === scope.scopeId).length} />
        ))}
      </ul>
    );
  }
  return (
    <section aria-labelledby="scope-liste">
      <SectionHead id="scope-liste" title="Anwendungsbereiche" count={ready && !failed ? scopes.length : null} />
      {ready && <div className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]">{content}</div>}
    </section>
  );
}

/** Zuordnungsspalte: Name, „Unzugeordnet“ oder bei nicht gelesenem Bestand „nicht lesbar“. */
function scopeLabel(verbund: WorkspaceVerbund, names: ReadonlyMap<string, string>): string | undefined {
  if (verbund.scopeId === undefined) return undefined;
  return names.get(verbund.scopeId) ?? SCOPES_UNREADABLE;
}

function inventoryLabel(status: WorkspaceContextValue['status'], ready: boolean): string {
  if (status === 'unavailable') return 'Speicher nicht verfügbar';
  return ready ? '' : 'Speicher wird geöffnet…';
}

/** Arbeitsbereich: Anwendungsbereiche anlegen und öffnen; Verbünde anlegen, umbenennen, sichern, wiederherstellen und einzeln oder insgesamt mit Bestätigung löschen. */
export function VerbundOverviewPage() {
  const { status, verbuende, scopes, scopesFailed, scopeDrafts, writable, deletion, createVerbund, deleteVerbund } = useWorkspace();
  const { state: locationState } = useLocation();
  const navigate = useNavigate();
  const [scopeDeleted, setScopeDeleted] = useState(() => locationState?.scopeDeleted === true);
  // Die Meldung gilt für die aktuelle Rückkehr. Reload und Browser-Zurück lesen einen Eintrag ohne Löschmarkierung.
  useEffect(() => {
    if (locationState?.scopeDeleted === true) void navigate('.', { replace: true, state: null, preventScrollReset: true });
  }, [locationState, navigate]);
  // „Anwendungsbereich anlegen“ ist Ansichtszustand dieser Seite wie das Prüfblatt: keine Route, kein Name im Titel.
  // Eine offene Anlage aus dem Provider öffnet die Ansicht beim Zurückkehren wieder.
  const [creatingScope, setCreatingScope] = useState(() => !scopeDeleted && scopeDrafts.has(NEW_SCOPE_DRAFT));
  const { exporting, exportBackup, prepareVerbund, saveBackup } = useBackupExport();
  const [pendingDelete, setPendingDelete] = useState<WorkspaceVerbund | null>(null);
  const [pendingExport, setPendingExport] = useState<PreparedVerbundBackup | null>(null);
  const [exportStarted, setExportStarted] = useState(false);
  // Während der Export läuft, ist der Zeilenknopf gesperrt und verliert den Fokus; nach dem Dialog erhält er ihn zurück.
  const exportTrigger = useRef<HTMLButtonElement | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // „Vorher sichern“ hat eine Eingabe gespeichert und die Löschung wurde nicht bestätigt.
  const [prepared, setPrepared] = useState(false);
  const [formRun, setFormRun] = useState(0);
  const [wasDeleted, setWasDeleted] = useState(false);
  // Eine laufende Gesamtlöschung hält ihren Dialog offen, auch nach einem Routenwechsel zurück auf diese Seite.
  const deleteShown = deleteOpen || deletion !== 'idle';
  const deleted = status === 'deleted';
  // Das Prüfblatt ist Ansichtszustand dieser Seite: keine Route, kein Seitentitel mit Organisationsdaten.
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restored, setRestored] = useState<RestoreDone | null>(null);
  // Zeilenentwürfe stehen auf Seitenebene, damit das Prüfblatt sie klären und nach Erfolg zurücksetzen kann.
  const [rowDrafts] = useState(() => new Map<string, string>());
  // Eingabe im Anlegeformular; „Vorher sichern“ legt sie zum Anlegen oder Verwerfen vor.
  const createDraft = useRef('');
  // Laufende Anlage aus Anlegeformular oder Klärungszeile; ein zweiter Einstieg mit demselben Namen schließt sich ihr an.
  const creating = useRef<CreateRun | null>(null);
  // Laufende Anlagen und Umbenennungen; „Vorher sichern“ wartet sie ab, bevor es offene Eingaben liest.
  const [writes] = useState(() => new Set<Promise<unknown>>());
  const track = <T,>(run: Promise<T>): Promise<T> => {
    writes.add(run);
    const done = () => writes.delete(run);
    void run.then(done, done);
    return run;
  };
  /** Legt `name` an; läuft dieselbe Eingabe schon über den anderen Einstieg, wird deren Ergebnis abgewartet statt erneut angelegt. */
  const createOnce = (name: string, onCreated: () => void): Promise<boolean> => {
    const previous = creating.current;
    const entry: CreateRun = {
      name,
      run: (async () => {
        if (previous?.name === name && await previous.run) return true;
        const created = (await createVerbund(name)).ok;
        if (created) {
          setScopeDeleted(false);
          onCreated();
        }
        return created;
      })(),
    };
    creating.current = entry;
    void entry.run.finally(() => { if (creating.current === entry) creating.current = null; });
    return track(entry.run);
  };
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  const setRowDraft = (verbundId: string, draft: string | null) => {
    if (draft === null) rowDrafts.delete(verbundId);
    else rowDrafts.set(verbundId, draft);
    rerender();
  };
  // Fokus nach Prüfblatt und Löschdialog: Überschrift nach Erfolg, Einstieg nach Abbruch, Speichermeldung nach Löschfehler.
  const focusTarget = useRef<'heading' | 'restore' | 'delete' | 'reload' | 'create-scope' | null>(null);
  const page = useRef<HTMLDivElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const createScopeButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const statusId = useId();
  const ready = (status === 'ready' || deleted) && verbuende !== null && scopes !== null;
  const scopeNames = new Map((scopes ?? []).map((scope) => [scope.scopeId as string, scope.name]));
  // Der Abbruch gibt den Fokus an den auslösenden Einstieg zurück (Kopf oder Leerzustand).
  const createTrigger = useRef<HTMLButtonElement | null>(null);
  const startScopeCreation = (trigger: HTMLButtonElement) => {
    createTrigger.current = trigger;
    setScopeDeleted(false);
    setCreatingScope(true);
  };
  // Mit der Gesamtlöschung fallen auch die Eingaben und Meldungen der Seite zum gelöschten Bestand.
  if (deleted !== wasDeleted) {
    setWasDeleted(deleted);
    if (deleted) {
      setScopeDeleted(false);
      setRestored(null);
      setPrepared(false);
      setFormRun((run) => run + 1);
    }
  }
  const count = verbuende?.length ?? 0;
  const aborted = prepared && !deleteShown && !deleted;
  const statusText = workspaceStatusText(deleted, aborted, restored, scopeDeleted);

  useEffect(() => {
    if (restoreFile || deleteShown || creatingScope || !focusTarget.current) return;
    if (focusTarget.current === 'reload') page.current?.querySelector<HTMLButtonElement>('[data-notice="storage-failed"] button')?.focus();
    else if (focusTarget.current === 'create-scope') (createTrigger.current ?? createScopeButton.current)?.focus();
    else ({ heading, restore: restoreButton, delete: deleteButton })[focusTarget.current].current?.focus();
    focusTarget.current = null;
  }, [restoreFile, deleteShown, creatingScope]);

  // Betreten der Seite setzt den Fokus auf die Überschrift, außer eine wiedergeöffnete Anlage oder Löschung führt ihn.
  const [focusOnEntry] = useState(!creatingScope && !deleteShown);
  useEffect(() => { if (focusOnEntry) heading.current?.focus(); }, [focusOnEntry]);

  // Nach der Gesamtlöschung: keine Zeilenentwürfe des gelöschten Bestands, Fokus auf der Überschrift.
  useEffect(() => {
    if (!deleted) return;
    rowDrafts.clear();
    createDraft.current = '';
    heading.current?.focus();
  }, [deleted, rowDrafts]);

  // Erst nach dem Abbau des Dialogs ist der Hintergrund nicht mehr inert und der Zeilenknopf fokussierbar.
  useEffect(() => {
    if (pendingExport || !exportTrigger.current) return;
    exportTrigger.current.focus();
    exportTrigger.current = null;
  }, [pendingExport]);
  const downloadStarted = (created: PreparedBackup) => {
    saveBackup(created);
    setExportStarted(true);
  };
  /** Die erstellte Datei entscheidet: Führt sie eine Scopezeile mit, nennt der Dialog sie vor dem Download. */
  const exportVerbund = async (verbund: WorkspaceVerbund, trigger: HTMLButtonElement) => {
    // Die vor jedem Export geleerte Statusregion sagt auch eine wiederholte Meldung erneut an.
    setExportStarted(false);
    const created = await prepareVerbund(verbund.verbundId);
    if (!created) return;
    const scoped = scopedVerbundBackup(created);
    if (!scoped) { downloadStarted(created); return; }
    exportTrigger.current = trigger;
    setPendingExport(scoped);
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !writable) return;
    setRestored(null);
    setRestoreFile(file);
  };

  return (
    <>
      <PageTitle title={PAGE_TITLES.workspace} />
      {restoreFile && (
        <RestoreSheet
          file={restoreFile}
          rowDrafts={rowDrafts}
          onCancel={() => { focusTarget.current = 'restore'; setRestoreFile(null); }}
          onDone={(done) => {
            // Der Restore ersetzt den Zielbereich; dessen offene Zeilenformulare gelten nicht mehr.
            if (done.verbundId) rowDrafts.delete(done.verbundId);
            else rowDrafts.clear();
            // Das neuere Ergebnis ersetzt den Abbruchhinweis einer früheren Löschvorbereitung in der Statusregion.
            setScopeDeleted(false);
            setPrepared(false);
            focusTarget.current = 'heading'; setRestored(done); setRestoreFile(null);
          }}
        />
      )}
      {creatingScope && (
        <ScopeCreateView writable={writable} onCancel={() => { focusTarget.current = 'create-scope'; setCreatingScope(false); }} />
      )}
      {/* Die Übersicht bleibt eingehängt, damit offene Formulareingaben Prüfblatt und Anlageansicht überstehen. */}
      <div ref={page} hidden={restoreFile !== null || creatingScope} className="mx-auto w-full max-w-screen-2xl space-y-6 p-4 desktop:px-7 desktop:py-6">
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-[var(--color-border-default)] pb-4">
          <div className="space-y-2">
            {/* Ein gleichzeitiger Fokuswechsel verdrängt die Statusansage; Überschrift und Löscheinstieg tragen sie als Beschreibung mit. */}
            <h1 ref={heading} tabIndex={-1} aria-describedby={statusText ? statusId : undefined} className="type-page-title focus:outline-none">Arbeitsbereich</h1>
            <div className="flex flex-wrap items-center gap-2">
              <OriginLabel />
              <span aria-live="polite" className="text-xs font-medium text-[var(--color-text-secondary)]">
                {inventoryLabel(status, ready)}
              </span>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row">
            <Button variant="secondary" className={ROW_BUTTON} onClick={() => void exportBackup()} disabled={status !== 'ready' || exporting}>
              Sicherung exportieren
            </Button>
            <input ref={fileInput} aria-label="Sicherungsdatei" type="file" accept="application/json,.json" className="hidden" tabIndex={-1} onChange={chooseFile} />
            <Button ref={restoreButton} variant="secondary" className={ROW_BUTTON} onClick={() => fileInput.current?.click()} disabled={!ready || !writable}>
              Sicherung wiederherstellen…
            </Button>
            <Button ref={createScopeButton} className={ROW_BUTTON} onClick={(event) => startScopeCreation(event.currentTarget)} disabled={!ready || !writable}>
              Anwendungsbereich anlegen
            </Button>
          </div>
        </header>

        <WorkspaceNotices />

        {/* S6819: <output> trägt die implizite Rolle "status". Die erste Region steht vorab und außerhalb des Layoutflusses
            und sagt Lösch-, Abbruch- und Wiederherstellungsmeldung an; die sichtbaren Flächen sind aria-hidden-Spiegel.
            Die zweite meldet den Start eines Verbund-Downloads, ohne die Seitenüberschrift zu beschreiben. */}
        <output id={statusId} className="sr-only">{statusText}</output>
        <output className="sr-only">{exportStarted ? 'Download gestartet' : ''}</output>
        {statusText === SCOPE_DELETED_TEXT && (
          <p aria-hidden="true" className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] p-4 text-sm text-[var(--color-text-primary)]">
            {SCOPE_DELETED_TEXT}
          </p>
        )}
        {deleted && (
          <div aria-hidden="true" className="block rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] p-4">
            <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{DELETED_TITLE}</span>
            <span className="mt-1 block text-sm text-[var(--color-text-secondary)]">{DELETED_TEXT}</span>
          </div>
        )}
        {aborted && (
          <p aria-hidden="true" className="block rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] p-4 text-sm text-[var(--color-text-primary)]">
            {ABORTED_TEXT}
          </p>
        )}
        {restored && (
          <div aria-hidden="true" className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] p-4">
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Wiederhergestellt</p>
            <p className="mt-1 break-words text-sm text-[var(--color-text-secondary)]">{restored.text}</p>
          </div>
        )}

        <ScopeSection ready={ready} failed={scopesFailed} scopes={scopes ?? []} verbuende={verbuende ?? []} writable={writable} onCreate={startScopeCreation} />

        <section aria-labelledby="verbund-liste" className="space-y-4">
          <div>
            <SectionHead id="verbund-liste" title="Alle Informationsverbünde" count={ready ? count : null} />
            {ready && (
              <div className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
                {count === 0 ? (
                  <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">{deleted ? 'Keine Informationsverbünde vorhanden.' : 'Noch kein Informationsverbund angelegt.'}</p>
                ) : (
                  <ul className="divide-y divide-[var(--color-border-subtle)]">
                    {verbuende.map((verbund) => (
                      <VerbundRow
                        key={verbund.verbundId}
                        verbund={verbund}
                        scopeName={scopeLabel(verbund, scopeNames)}
                        writable={writable}
                        rowDrafts={rowDrafts}
                        onRowDraft={setRowDraft}
                        track={track}
                        restored={restored?.verbundId === verbund.verbundId}
                        exporting={exporting}
                        onExport={(entry, trigger) => void exportVerbund(entry, trigger)}
                        onDelete={setPendingDelete}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <section aria-labelledby="verbund-anlegen" className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-4">
            <h3 id="verbund-anlegen" className="text-sm font-semibold text-[var(--color-text-primary)]">Informationsverbund anlegen</h3>
            <div className="mt-3">
              <NameForm
                key={formRun}
                label="Name"
                submitLabel="Anlegen"
                disabled={!ready || !writable}
                onChange={(name) => { createDraft.current = name; }}
                onSubmit={(name) => createOnce(name, () => {
                  // Ein nach dem Absenden getippter Name bleibt für Formular und Klärung erhalten.
                  if (createDraft.current.trim() === name) createDraft.current = '';
                })}
              />
            </div>
          </section>

          {!deleted && (
            <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Lokale Daten löschen</h3>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Alle Anwendungsbereiche und Informationsverbünde dieses Browserprofils entfernen.</p>
              </div>
              <Button ref={deleteButton} variant="danger" className={`${ROW_BUTTON} shrink-0`} disabled={status !== 'ready'} aria-describedby={aborted ? statusId : undefined} onClick={() => { setPrepared(false); setDeleteOpen(true); }}>
                Alle lokalen Daten löschen…
              </Button>
            </div>
          )}
        </section>
      </div>

      {deleteShown && (
        <WorkspaceDeleteDialog
          rowDrafts={rowDrafts}
          createDraft={createDraft}
          writes={writes}
          track={track}
          createName={createOnce}
          onCreateDraftDone={(name) => {
            // Ein nach dem Start von „Anlegen“ getippter Name bleibt im Formular.
            if (createDraft.current.trim() !== name) return;
            createDraft.current = '';
            setFormRun((run) => run + 1);
          }}
          onPrepared={() => setPrepared(true)}
          onClose={(confirmed) => {
            if (confirmed) setPrepared(false);
            // Der Dialog setzt den Fokus beim Öffnen selbst; nach einem Abbruch kehrt er zum Einstieg zurück,
            // nach einem Löschfehler zu „Neu laden“, weil der Einstieg dann gesperrt ist.
            else focusTarget.current = deletion === 'failed' ? 'reload' : 'delete';
            setDeleteOpen(false);
          }}
        />
      )}

      {pendingExport && (
        <VerbundExportDialog
          backup={pendingExport}
          onClose={(download) => {
            if (download) downloadStarted(pendingExport);
            setPendingExport(null);
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Informationsverbund endgültig löschen?"
        confirmLabel="Endgültig löschen"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) void deleteVerbund(target.verbundId);
        }}
      >
        <p>
          „{pendingDelete?.name}“ wird mit allen Dokumenten, Entwürfen und Verknüpfungen aus diesem Browser gelöscht. Das lässt sich nicht rückgängig machen. Bereits exportierte Dateien bleiben erhalten.
        </p>
      </ConfirmDialog>
    </>
  );
}
