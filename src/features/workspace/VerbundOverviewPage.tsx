import { useId, useState } from 'react';
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

function VerbundRow({ verbund, writable, onDelete }: Readonly<{
  verbund: WorkspaceVerbund;
  writable: boolean;
  onDelete: (verbund: WorkspaceVerbund) => void;
}>) {
  const { renameVerbund, renameDrafts } = useWorkspace();
  const [renaming, setRenaming] = useState(false);
  if (renaming) {
    return (
      <li className="px-4 py-3">
        <NameForm
          label="Neuer Name"
          submitLabel="Speichern"
          initial={verbund.name}
          disabled={!writable}
          onSubmit={async (name) => {
            const result = await renameVerbund(verbund.verbundId, name);
            if (!result.ok) return false;
            // Der neue Name ersetzt einen offenen Entwurf aus der Verbund-Übersicht.
            renameDrafts.delete(verbund.verbundId);
            setRenaming(false);
            return true;
          }}
          onCancel={() => setRenaming(false)}
        />
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
      <Link
        to={buildVerbundUrl(verbund.verbundId)}
        className={`flex min-h-touch min-w-0 flex-1 items-center rounded text-sm font-semibold text-[var(--color-text-primary)] hover:underline desktop:min-h-8 ${FOCUS_RING}`}
      >
        <span className="min-w-0 break-words">{verbund.name}</span>
      </Link>
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" className={ROW_BUTTON} disabled={!writable} onClick={() => setRenaming(true)}>Umbenennen</Button>
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
  if (status !== 'ready' || verbuende === null) return 'Speicher wird geöffnet…';
  return `${verbuende.length} ${verbuende.length === 1 ? 'Informationsverbund' : 'Informationsverbünde'}`;
}

/** Übersicht des Bereichs: Verbünde anlegen, umbenennen und mit Bestätigung löschen. */
export function VerbundOverviewPage() {
  const { status, verbuende, writable, createVerbund, deleteVerbund } = useWorkspace();
  const { exporting, exportBackup } = useBackupExport();
  const [pendingDelete, setPendingDelete] = useState<WorkspaceVerbund | null>(null);
  const ready = status === 'ready' && verbuende !== null;
  const count = verbuende?.length ?? 0;

  return (
    <>
      <PageTitle title={PAGE_TITLES.workspace} />
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        <header className="space-y-2">
          <h1 className="type-page-title">Informationsverbünde</h1>
          <div className="flex flex-wrap items-center gap-2">
            <OriginLabel />
            <span aria-live="polite" className="text-xs font-medium tabular-nums text-[var(--color-text-secondary)]">
              {inventoryLabel(status, verbuende)}
            </span>
          </div>
        </header>

        <WorkspaceNotices />

        <section aria-labelledby="verbund-anlegen" className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-4">
          <h2 id="verbund-anlegen" className="text-base font-semibold leading-snug">Informationsverbund anlegen</h2>
          <div className="mt-3">
            <NameForm
              label="Name"
              submitLabel="Anlegen"
              disabled={!ready || !writable}
              onSubmit={async (name) => (await createVerbund(name)).ok}
            />
          </div>
        </section>

        <section aria-labelledby="verbund-liste" className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
          <div className="flex min-h-panel-head items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4">
            <h2 id="verbund-liste" className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Bestand</h2>
            <Button variant="secondary" size="sm" className={ROW_BUTTON} onClick={exportBackup} disabled={status !== 'ready' || exporting}>
              Sicherung exportieren
            </Button>
          </div>
          {ready && count === 0 && (
            <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">Noch kein Informationsverbund angelegt.</p>
          )}
          {ready && count > 0 && (
            <ul className="divide-y divide-[var(--color-border-subtle)]">
              {verbuende.map((verbund) => (
                <VerbundRow key={verbund.verbundId} verbund={verbund} writable={writable} onDelete={setPendingDelete} />
              ))}
            </ul>
          )}
        </section>
      </div>

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
