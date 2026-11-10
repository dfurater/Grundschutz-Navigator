import { useEffect, useId, useReducer, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { PageTitle } from '@/app/PageTitle';
import { PAGE_TITLES } from '@/app/pageTitles';
import { buildVerbundUrl } from '@/app/routes';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useWorkspace } from '@/hooks/useWorkspace';
import type { WorkspaceContextValue } from '@/state/WorkspaceContext';
import { isVerbundName, type WorkspaceVerbund } from '@/domain/workspaceModel';
import { FOCUS_RING, OriginLabel } from '@/features/workspace/DocumentMarks';
import { WorkspaceNotices, useBackupExport } from '@/features/workspace/WorkspaceNotices';
import { RestoreSheet, type RestoreDone } from '@/features/workspace/RestoreSheet';
import { WorkspaceDeleteDialog } from '@/features/workspace/WorkspaceDeleteDialog';

const INPUT = `min-h-touch w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] px-3 py-2 text-base text-[var(--color-text-primary)] shadow-sm placeholder:text-[var(--color-text-muted)] focus-visible:border-[var(--color-focus-ring)] sm:text-sm desktop:min-h-0 ${FOCUS_RING}`;
const ROW_BUTTON = 'min-h-touch desktop:min-h-0';

/** Namensfeld für Anlegen und Umbenennen; `onCancel` macht daraus ein Umbenennen-Formular. */
export function NameForm({ label, submitLabel, initial = '', disabled, onSubmit, onCancel, onChange }: Readonly<{
  label: string;
  submitLabel: string;
  initial?: string;
  disabled: boolean;
  onSubmit: (name: string) => Promise<boolean>;
  onCancel?: () => void;
  /** Meldet jede Eingabe, etwa um sie über einen Routenwechsel zu erhalten. */
  onChange?: (name: string) => void;
}>) {
  const inputId = useId();
  const [name, setName] = useState(initial);
  // Während des Speicherns ist das Formular gesperrt: ein Doppelklick legt keinen zweiten Verbund an.
  const [saving, setSaving] = useState(false);
  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !isVerbundName(name)) return;
    setSaving(true);
    void onSubmit(name.trim()).then((saved) => {
      setSaving(false);
      if (saved && !onCancel) setName('');
    });
  };
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</label>
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={name}
          disabled={disabled}
          autoFocus={onCancel !== undefined}
          onChange={(event) => { setName(event.target.value); onChange?.(event.target.value); }}
          onKeyDown={(event) => { if (event.key === 'Escape' && onCancel) { event.preventDefault(); onCancel(); } }}
          className={`mt-1 ${INPUT}`}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" className={ROW_BUTTON} disabled={disabled || saving || !isVerbundName(name)}>{submitLabel}</Button>
        {onCancel && <Button variant="secondary" className={ROW_BUTTON} onClick={onCancel}>Abbrechen</Button>}
      </div>
    </form>
  );
}

function VerbundRow({ verbund, writable, rowDrafts, onRowDraft, restored, exporting, onExport, onDelete }: Readonly<{
  verbund: WorkspaceVerbund;
  writable: boolean;
  /** Offene Zeilenumbenennungen der Seite; ein Eintrag hält das Formular dieser Zeile offen. */
  rowDrafts: Map<string, string>;
  onRowDraft: (verbundId: string, draft: string | null) => void;
  /** Zuletzt wiederhergestellt; hinterlegt, bis die Seite verlassen wird. */
  restored: boolean;
  exporting: boolean;
  onExport: (verbund: WorkspaceVerbund) => void;
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
          onSubmit={async (name) => {
            // Der neue Name ersetzt nur den Entwurf, der beim Speichern offen war; ein danach getippter bleibt.
            const sessionDraft = renameDrafts.get(verbund.verbundId);
            const result = await renameVerbund(verbund.verbundId, name);
            if (!result.ok) return false;
            if (renameDrafts.get(verbund.verbundId) === sessionDraft) renameDrafts.delete(verbund.verbundId);
            onRowDraft(verbund.verbundId, null);
            return true;
          }}
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
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" className={ROW_BUTTON} disabled={!writable} onClick={() => onRowDraft(verbund.verbundId, verbund.name)}>Umbenennen</Button>
        <Button variant="ghost" size="sm" className={ROW_BUTTON} disabled={exporting} aria-label={`${verbund.name} sichern`} onClick={() => onExport(verbund)}>Sichern</Button>
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

function inventoryLabel(status: WorkspaceContextValue['status'], verbuende: readonly WorkspaceVerbund[] | null): string {
  if (status === 'unavailable') return 'Speicher nicht verfügbar';
  if ((status !== 'ready' && status !== 'deleted') || verbuende === null) return 'Speicher wird geöffnet…';
  return `${verbuende.length} ${verbuende.length === 1 ? 'Informationsverbund' : 'Informationsverbünde'}`;
}

/** Übersicht des Bereichs: Verbünde anlegen, umbenennen, sichern, wiederherstellen und einzeln oder insgesamt mit Bestätigung löschen. */
export function VerbundOverviewPage() {
  const { status, verbuende, writable, deletion, createVerbund, deleteVerbund } = useWorkspace();
  const { exporting, exportBackup, exportVerbund } = useBackupExport();
  const [pendingDelete, setPendingDelete] = useState<WorkspaceVerbund | null>(null);
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
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  const setRowDraft = (verbundId: string, draft: string | null) => {
    if (draft === null) rowDrafts.delete(verbundId);
    else rowDrafts.set(verbundId, draft);
    rerender();
  };
  // Fokus nach dem Prüfblatt: Überschrift nach Erfolg, Einstieg nach Abbruch.
  const focusTarget = useRef<'heading' | 'restore' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const ready = (status === 'ready' || deleted) && verbuende !== null;
  // Mit der Gesamtlöschung fallen auch die Eingaben und Meldungen der Seite zum gelöschten Bestand.
  if (deleted !== wasDeleted) {
    setWasDeleted(deleted);
    if (deleted) {
      setRestored(null);
      setPrepared(false);
      setFormRun((run) => run + 1);
    }
  }
  const count = verbuende?.length ?? 0;

  useEffect(() => {
    if (restoreFile || !focusTarget.current) return;
    (focusTarget.current === 'heading' ? heading : restoreButton).current?.focus();
    focusTarget.current = null;
  }, [restoreFile]);

  // Nach der Gesamtlöschung: keine Zeilenentwürfe des gelöschten Bestands, Fokus auf der Überschrift.
  useEffect(() => {
    if (!deleted) return;
    rowDrafts.clear();
    heading.current?.focus();
  }, [deleted, rowDrafts]);

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
            focusTarget.current = 'heading'; setRestored(done); setRestoreFile(null);
          }}
        />
      )}
      {/* Die Übersicht bleibt eingehängt, damit offene Formulareingaben das Prüfblatt überstehen. */}
      <div hidden={restoreFile !== null} className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        <header className="space-y-2">
          <h1 ref={heading} tabIndex={-1} className="type-page-title focus:outline-none">Informationsverbünde</h1>
          <div className="flex flex-wrap items-center gap-2">
            <OriginLabel />
            <span aria-live="polite" className="text-xs font-medium tabular-nums text-[var(--color-text-secondary)]">
              {inventoryLabel(status, verbuende)}
            </span>
          </div>
        </header>

        <WorkspaceNotices />

        {/* S6819: <output> trägt die implizite Rolle "status". Sie steht vorab und außerhalb des Layoutflusses,
            damit die Ergebnismeldung angesagt wird, ohne dass die leere Fläche einen Abstand erzeugt. */}
        <output className="sr-only">{restored ? `Wiederhergestellt: ${restored.text}` : ''}</output>
        {deleted && (
          <output className="block rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] p-4">
            <span className="block text-sm font-semibold text-[var(--color-text-primary)]">Lokale Daten gelöscht</span>
            <span className="mt-1 block text-sm text-[var(--color-text-secondary)]">Der gesamte Arbeitsbestand wurde aus diesem Browserprofil entfernt. Exportierte Dateien bleiben erhalten.</span>
          </output>
        )}
        {prepared && !deleteShown && !deleted && (
          <output className="block rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] p-4 text-sm text-[var(--color-text-primary)]">
            Löschung abgebrochen. Vorbereitend gespeicherte Eingaben bleiben erhalten.
          </output>
        )}
        {restored && (
          <div aria-hidden="true" className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] p-4">
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Wiederhergestellt</p>
            <p className="mt-1 break-words text-sm text-[var(--color-text-secondary)]">{restored.text}</p>
          </div>
        )}

        <section aria-labelledby="verbund-anlegen" className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-4">
          <h2 id="verbund-anlegen" className="text-base font-semibold leading-snug">Informationsverbund anlegen</h2>
          <div className="mt-3">
            <NameForm
              key={formRun}
              label="Name"
              submitLabel="Anlegen"
              disabled={!ready || !writable}
              onSubmit={async (name) => (await createVerbund(name)).ok}
            />
          </div>
        </section>

        <section aria-labelledby="verbund-liste" className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
          <div className="flex min-h-panel-head flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4 py-2 md:py-0">
            <h2 id="verbund-liste" className="basis-full text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)] md:basis-auto">Bestand</h2>
            <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row">
              <Button variant="secondary" size="sm" className={ROW_BUTTON} onClick={() => void exportBackup()} disabled={status !== 'ready' || exporting}>
                Sicherung exportieren
              </Button>
              <input ref={fileInput} aria-label="Sicherungsdatei" type="file" accept="application/json,.json" className="hidden" tabIndex={-1} onChange={chooseFile} />
              <Button ref={restoreButton} variant="secondary" size="sm" className={ROW_BUTTON} onClick={() => fileInput.current?.click()} disabled={!ready || !writable || deleted}>
                Sicherung wiederherstellen…
              </Button>
            </div>
          </div>
          {ready && count === 0 && (
            <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">{deleted ? 'Keine Informationsverbünde vorhanden.' : 'Noch kein Informationsverbund angelegt.'}</p>
          )}
          {ready && count > 0 && (
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {verbuende.map((verbund) => (
                <VerbundRow
                  key={verbund.verbundId}
                  verbund={verbund}
                  writable={writable}
                  rowDrafts={rowDrafts}
                  onRowDraft={setRowDraft}
                  restored={restored?.verbundId === verbund.verbundId}
                  exporting={exporting}
                  onExport={(entry) => void exportVerbund(entry.verbundId)}
                  onDelete={setPendingDelete}
                />
              ))}
            </ul>
          )}
          {!deleted && (
            <div className="flex flex-col gap-3 border-t border-[var(--color-border-default)] p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Lokale Daten löschen</h3>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Alle Informationsverbünde dieses Browserprofils entfernen.</p>
              </div>
              <Button variant="danger" className={`${ROW_BUTTON} shrink-0`} disabled={status !== 'ready'} onClick={() => { setPrepared(false); setDeleteOpen(true); }}>
                Alle lokalen Daten löschen…
              </Button>
            </div>
          )}
        </section>
      </div>

      {deleteShown && (
        <WorkspaceDeleteDialog
          rowDrafts={rowDrafts}
          onPrepared={() => setPrepared(true)}
          onClose={(confirmed) => { if (confirmed) setPrepared(false); setDeleteOpen(false); }}
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
