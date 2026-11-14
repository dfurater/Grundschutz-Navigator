import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { buildWorkspaceDocumentUrl } from '@/app/routes';
import { BackdropTint } from '@/components/BackdropTint';
import { Button } from '@/components/Button';
import { ModalPortal } from '@/components/ModalPortal';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { useModalDialog } from '@/hooks/useModalDialog';
import { useScrollLock } from '@/hooks/useScrollLock';
import { useWorkspace } from '@/hooks/useWorkspace';
import type { ExclusiveEntry } from '@/state/workspaceSession';
import type { RestoreInput, RestoreScope } from '@/state/workspaceRestore';
import { isVerbundName } from '@/domain/workspaceModel';
import { BUTTON, ClarifyItem, ClarifyRow, Message, inputKey } from '@/features/workspace/RestoreSheetParts';
import { useBackupExport } from '@/features/workspace/WorkspaceNotices';

/** Stabiler Code der gesperrten Gesamtlöschung ohne belastbare Prüfung auf weitere Tabs. */
export const WORKSPACE_SESSION_UNAVAILABLE = 'WORKSPACE_SESSION_UNAVAILABLE';

const WHOLE_WORKSPACE: RestoreScope = { kind: 'workspace', documents: [] };
/** Markiert den gescheiterten Versuch, den Namen im Anlegeformular anzulegen. */
const NEW_NAME = { kind: 'new-name' } as const;

type Backup =
  | { readonly step: 'idle' | 'saving' | 'started' | 'save-failed' | 'export-failed' }
  | {
    readonly step: 'clarify';
    readonly inputs: readonly RestoreInput[];
    /** Offener Name im Anlegeformular; ohne Anlegen enthielte die Sicherung ihn nicht. */
    readonly newName?: string;
    readonly failed?: RestoreInput | typeof NEW_NAME;
  };

const WAITING = {
  deleting: {
    title: 'Lokale Daten werden gelöscht',
    text: 'Die Löschung wurde gestartet. Warten Sie auf die Bestätigung.',
  },
  pending: {
    title: 'Löschung wartet',
    text: 'Eine andere Verbindung hält den Arbeitsbestand noch geöffnet. Schließen Sie weitere Tabs oder Fenster mit diesem Arbeitsbereich.',
  },
} as const;

/**
 * Bestätigung der Gesamtlöschung mit Sicherungsangebot. Öffnen und Abbrechen schreiben nichts; erst
 * „Vorher sichern“ speichert oder klärt offene Eingaben. Nach dem Start bietet der Dialog keinen Abbruch.
 */
export function WorkspaceDeleteDialog({ rowDrafts, createDraft, writes, track, createName, onCreateDraftDone, onPrepared, onClose }: Readonly<{
  /** Offene Umbenennungen der Übersichtszeilen. */
  rowDrafts: Map<string, string>;
  /** Eingabe im Anlegeformular der Übersicht. */
  createDraft: { readonly current: string };
  /** Laufende Anlagen und Umbenennungen der Übersicht; „Vorher sichern“ wartet sie ab, bevor es offene Eingaben liest. */
  writes: ReadonlySet<Promise<unknown>>;
  /** Meldet eine Speicherung aus der Klärung in `writes`; sie kann den Dialog überdauern. */
  track: <T>(run: Promise<T>) => Promise<T>;
  /** Legt einen Namen über denselben Weg wie das Anlegeformular an; `onCreated` läuft vor dem Ende der Anlage. */
  createName: (name: string, onCreated: () => void) => Promise<boolean>;
  /** `name` aus dem Anlegeformular wurde angelegt oder verworfen; eine danach geänderte Eingabe bleibt stehen. */
  onCreateDraftDone: (name: string) => void;
  /** „Vorher sichern“ hat eine Eingabe gespeichert; kann nach dem Schließen eintreffen, wenn die Speicherung noch lief. */
  onPrepared: () => void;
  /** `confirmed`: Die Löschung wurde bestätigt und gestartet. */
  onClose: (confirmed: boolean) => void;
}>) {
  const {
    status, verbuende, writable, deletion, enterWorkspaceDeletion, leaveWorkspaceDeletion, deleteWorkspace, dismissDeletionFailure,
    flushAutosaves, pendingRestoreInputs, discardRestoreInput, renameVerbund,
  } = useWorkspace();
  const { exportBackup } = useBackupExport();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const backupHeading = useRef<HTMLHeadingElement>(null);
  const clarifyHeading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [check, setCheck] = useState<ExclusiveEntry['status'] | 'checking'>('checking');
  const [backup, setBackup] = useState<Backup>({ step: 'idle' });
  // Nach Abbruch oder Aushängen: gestartete Speicherungen bleiben, die Sicherung läuft nicht weiter.
  const closed = useRef(false);
  const started = deletion === 'deleting' || deletion === 'pending';

  // Die Sperrmeldung bleibt bis zum Ergebnis stehen: Bei fortbestehender Sperre behält „Erneut prüfen“ den Fokus.
  const runCheck = () => { void enterWorkspaceDeletion().then(setCheck); };
  useEffect(() => {
    // Ein während der Löschung wieder eingehängter Dialog prüft nicht erneut.
    closed.current = false;
    if (deletion === 'idle') void enterWorkspaceDeletion().then(setCheck);
    return () => { closed.current = true; leaveWorkspaceDeletion(); };
    // Die Prüfung läuft einmal je Öffnen; „Erneut prüfen“ startet sie ausdrücklich.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Ohne Aktion im Dialog erhält die Überschrift den Fokus, damit der Zustand angesagt wird.
  useEffect(() => { if (started) heading.current?.focus(); }, [started, deletion]);
  // Die Klärung sagt mit ihrer Überschrift die offenen Eingaben an; verschwindet sonst der fokussierte Button, bleibt der Fokus im Sicherungsabschnitt.
  useEffect(() => {
    if (backup.step === 'clarify') clarifyHeading.current?.focus();
    else if (!dialogRef.current?.contains(document.activeElement)) backupHeading.current?.focus();
  }, [backup, check]);

  const cancel = () => {
    if (started) return;
    if (deletion === 'failed') dismissDeletionFailure();
    closed.current = true;
    onClose(false);
  };
  useModalDialog(dialogRef, true, cancel);
  useScrollLock(true);
  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key === 'Escape') cancel();
  }, true);

  /** Nach Speichern und Klären: verbleibende Eingaben zeigen, ohne Rest die Gesamtsicherung exportieren. */
  const continueBackup = async (failed?: RestoreInput | typeof NEW_NAME): Promise<void> => {
    if (closed.current) return;
    const inputs = await pendingRestoreInputs(WHOLE_WORKSPACE, rowDrafts);
    if (closed.current) return;
    if (!inputs.ok) { setBackup({ step: 'export-failed' }); return; }
    const newName = createDraft.current.trim() || undefined;
    if (inputs.value.length > 0 || newName) { setBackup({ step: 'clarify', inputs: inputs.value, newName, failed }); return; }
    setBackup({ step: 'saving' });
    // Ein Abbruch während des Exports verwirft die Datei vor dem Download.
    const downloaded = await exportBackup(() => !closed.current);
    if (!closed.current) setBackup({ step: downloaded ? 'started' : 'export-failed' });
  };

  const backupFirst = async () => {
    setBackup({ step: 'saving' });
    await Promise.allSettled(writes);
    if (closed.current) return;
    if (!await flushAutosaves()) { setBackup({ step: 'save-failed' }); return; }
    await continueBackup();
  };

  // Jede Klärungsaktion blendet die Liste bis zum erneuten Lesen aus: Sie setzt die Sicherung genau einmal fort.
  const saveRename = async (entry: Extract<RestoreInput, { kind: 'rename' }>) => {
    setBackup({ step: 'saving' });
    const saved = await track(renameVerbund(entry.verbundId, entry.draft.trim()).then(({ ok }) => {
      if (ok) { onPrepared(); discardRestoreInput(entry, rowDrafts); }
      return ok;
    }));
    await continueBackup(saved ? undefined : entry);
  };

  const saveNewName = async (name: string) => {
    setBackup({ step: 'saving' });
    const created = await createName(name, () => { onPrepared(); onCreateDraftDone(name); });
    await continueBackup(created ? undefined : NEW_NAME);
  };

  const discardNewName = (name: string) => {
    setBackup({ step: 'saving' });
    onCreateDraftDone(name);
    void continueBackup();
  };

  const confirm = () => {
    closed.current = true;
    onClose(true);
    void deleteWorkspace();
  };

  const backupBlocked = backup.step === 'clarify' || backup.step === 'saving';
  const clarifying = backup.step === 'clarify' ? backup : null;
  const newName = clarifying?.newName;
  const openInputs = (clarifying?.inputs.length ?? 0) + (newName ? 1 : 0);
  const deleteBlocked = check !== 'granted' || status !== 'ready' || backupBlocked || backup.step === 'save-failed' || backup.step === 'export-failed';
  let title = 'Alle lokalen Daten löschen?';
  if (started) title = WAITING[deletion].title;
  else if (deletion === 'failed') title = 'Löschung fehlgeschlagen';

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-40" style={{ opacity: 0.3 }} onClick={cancel} aria-hidden="true">
        <BackdropTint className="bg-black" />
      </div>
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-3 sm:px-4">
        <dialog
          open
          ref={dialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          data-deletion={deletion}
          className="pointer-events-auto static m-0 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-overlay)] p-4 text-inherit shadow-overlay sm:max-h-[calc(100dvh-2rem)] sm:p-5"
        >
          <div className="min-h-0 overflow-y-auto text-sm leading-relaxed text-[var(--color-text-primary)]">
            <h2 ref={heading} id={titleId} tabIndex={-1} className="text-lg font-semibold leading-snug focus:outline-none">{title}</h2>

            {started && (
              <>
                <output id={descriptionId} className="mt-3 block">{WAITING[deletion].text}</output>
                <p className="mt-3 text-xs text-[var(--color-text-secondary)]">Die gestartete Löschung kann nicht zurückgenommen werden. Der Arbeitsbereich bleibt bis zum Abschluss gesperrt.</p>
              </>
            )}

            {deletion === 'failed' && (
              <>
                <p id={descriptionId} role="alert" className="mt-2">Die Löschung konnte nicht abgeschlossen werden. Ein gelöschter Bestand wurde nicht bestätigt.</p>
                <p className="mt-3 text-xs text-[var(--color-text-secondary)]">Schließen Sie andere Arbeitsbereich-Tabs. Laden Sie anschließend die Anwendung neu und prüfen Sie den vorhandenen Bestand.</p>
              </>
            )}

            {deletion === 'idle' && (
              <>
                <p id={descriptionId} className="mt-2">Alle Anwendungsbereiche, Informationsverbünde und ihre Inhalte werden aus diesem Browserprofil gelöscht. Das lässt sich nicht rückgängig machen.</p>
                <div className="my-4 border-y border-[var(--color-border-default)] py-3">
                  <p className="font-semibold">Gesamter lokaler Arbeitsbestand</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>Anwendungsbereiche, Informationsverbünde, Dokumente und Entwürfe</li>
                    <li>Verknüpfungen, Prüfspuren und Vergleichsstände</li>
                    <li>Offene Eingaben und geladene Arbeitsstände</li>
                    <li>Metadaten des Arbeitsbereichs</li>
                  </ul>
                  <p className="mt-2 text-xs text-[var(--color-text-secondary)]">Exportierte Dateien und ihre Kopien bleiben erhalten.</p>
                </div>

                {/* Die Statusregion ist schon vor dem Prüfergebnis eingehängt; „Erneut prüfen“ nennt die Sperre zusätzlich beim Fokus. */}
                <div className={check === 'other-sessions' ? 'mb-3 rounded-md border border-[var(--color-border-strong)] p-3' : undefined}>
                  <output id={`${titleId}-tabs`} className="block">
                    {check === 'other-sessions' && <span className="block font-semibold text-[var(--color-warning-text)]">Andere Arbeitsbereich-Tabs schließen</span>}
                    {check === 'other-sessions' && <span className="mt-1 block">Sichern Sie dort offene Arbeit und schließen Sie die Tabs. Danach werden hier Sicherung und Löschung freigegeben.</span>}
                  </output>
                  {check === 'other-sessions' && <Button variant="secondary" className={`mt-2 ${BUTTON}`} aria-describedby={`${titleId}-tabs`} onClick={runCheck}>Erneut prüfen</Button>}
                </div>
                {check === 'unavailable' && (
                  <div role="alert" data-diagnostic={WORKSPACE_SESSION_UNAVAILABLE} className="mb-3 rounded-md border border-[var(--color-border-strong)] p-3">
                    <h3 className="font-semibold">Löschung hier nicht verfügbar</h3>
                    <p className="mt-1">Dieser Browser kann weitere Arbeitsbereich-Tabs nicht sicher erkennen. Die Löschung bleibt gesperrt. „Sicherung exportieren“ im Bestand bleibt verfügbar.</p>
                  </div>
                )}

                <section aria-labelledby={`${titleId}-backup`} className="py-3">
                  <h3 ref={backupHeading} id={`${titleId}-backup`} tabIndex={-1} className="font-semibold focus:outline-none">Vor dem Löschen sichern</h3>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">„Vorher sichern“ speichert oder klärt auch offene Eingaben. Bei einem späteren Abbruch bleiben diese Speicherungen erhalten.</p>
                  <Button variant="secondary" className={`mt-3 ${BUTTON}`} disabled={check !== 'granted' || backupBlocked} onClick={() => void backupFirst()}>Vorher sichern</Button>
                  <output className="mt-3 block empty:hidden">
                    {backup.step === 'saving' && 'Offene Eingaben werden gespeichert. Die Sicherung wird vorbereitet…'}
                    {backup.step === 'started' && 'Download gestartet. Bewahren Sie die Datei auf.'}
                  </output>
                </section>

                {backup.step === 'clarify' && (
                  <div className="rounded-md border border-[var(--color-border-strong)] p-3">
                    <h3 ref={clarifyHeading} tabIndex={-1} className="font-semibold focus:outline-none">{openInputs === 1 ? 'Eine offene Eingabe klären' : `${openInputs} offene Eingaben klären`}</h3>
                    <ul className="mt-1 divide-y divide-[var(--color-border-subtle)]">
                      {newName && (
                        <ClarifyItem label={<><span className="font-semibold">Neuer Informationsverbund</span> · „{newName}“</>} failed={backup.failed === NEW_NAME}>
                          <Button variant="secondary" size="sm" className={BUTTON} disabled={!writable || !isVerbundName(newName)} onClick={() => void saveNewName(newName)}>Anlegen</Button>
                          <Button variant="ghost" size="sm" className={BUTTON} onClick={() => discardNewName(newName)}>Verwerfen</Button>
                        </ClarifyItem>
                      )}
                      {backup.inputs.map((entry) => (
                        <ClarifyRow
                          key={inputKey(entry)}
                          entry={entry}
                          verbundName={entry.kind === 'orphan' ? '' : verbuende?.find((candidate) => candidate.verbundId === entry.verbundId)?.name ?? ''}
                          failed={entry.kind === 'rename' && backup.failed?.kind === 'rename' && backup.failed.verbundId === entry.verbundId && backup.failed.row === entry.row}
                          writable={writable}
                          onSave={saveRename}
                          onDiscard={() => { setBackup({ step: 'saving' }); discardRestoreInput(entry, rowDrafts); void continueBackup(); }}
                          onOpen={(imported) => { cancel(); void navigate(buildWorkspaceDocumentUrl(imported.verbundId, imported.localId)); }}
                        />
                      ))}
                    </ul>
                  </div>
                )}
                {backup.step === 'save-failed' && (
                  <Message tone="alert" title="Sicherung nicht erstellt">Eine offene Eingabe konnte nicht gespeichert werden. Sie bleibt erhalten. Die Löschung wurde nicht gestartet.</Message>
                )}
                {backup.step === 'export-failed' && (
                  <Message tone="alert" title="Sicherung nicht erstellt">Die Sicherungsdatei konnte nicht erstellt werden. Die Löschung wurde nicht gestartet.</Message>
                )}
              </>
            )}
          </div>

          {!started && (
            <div className="mt-4 flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--color-border-default)] pt-4 md:flex-row md:flex-wrap md:justify-end">
              {deletion === 'failed'
                ? <Button variant="secondary" className={BUTTON} onClick={cancel} autoFocus>Schließen</Button>
                : (
                  <>
                    {/* Abbrechen steht zuerst und erhält den Fokus: Enter löscht nichts. */}
                    <Button variant="secondary" className={BUTTON} onClick={cancel} autoFocus>Abbrechen</Button>
                    <Button variant="danger" className={BUTTON} disabled={deleteBlocked} onClick={confirm}>Alle lokalen Daten endgültig löschen</Button>
                  </>
                )}
            </div>
          )}
        </dialog>
      </div>
    </ModalPortal>
  );
}
