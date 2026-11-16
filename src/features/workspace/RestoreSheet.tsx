import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { buildWorkspaceDocumentUrl } from '@/app/routes';
import { Button } from '@/components/Button';
import { useWorkspace } from '@/hooks/useWorkspace';
import { inputVerbundName, saveNamedInput, type NamedInput, type RestoreInput, type RestorePreview, type RestoreScope } from '@/state/workspaceRestore';
import { OriginLabel } from '@/features/workspace/DocumentMarks';
import { WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';
import { useBackupExport } from '@/features/workspace/WorkspaceNotices';
import { useVerbundExport } from '@/features/workspace/VerbundExportDialog';
import {
  Actions, BUTTON, ClarifyRow, Facts, Mark, Message, PreviewBody, REJECTION_TEXT, Section, doneText, fileInfo, fileSize, formatDate, plural,
  inputKey, scopeConflict, scopeOf, type BackupState, type FileInfo,
} from '@/features/workspace/RestoreSheetParts';

/** Ergebnis einer Wiederherstellung für die Statusmeldung der Übersicht. */
export interface RestoreDone { readonly text: string; readonly verbundId?: string }

type Phase =
  | { readonly step: 'checking' | 'flush-failed' | 'reading' | 'collision' | 'stale' | 'read-failed' }
  | { readonly step: 'rejected'; readonly code: string }
  | { readonly step: 'clarify'; readonly inputs: readonly RestoreInput[]; readonly failed?: RestoreInput }
  | { readonly step: 'preview' | 'running'; readonly preview: RestorePreview }
  | { readonly step: 'write-failed'; readonly preview: RestorePreview; readonly quota: boolean };

const WORKER_FAILURE = 'WORKSPACE_BACKUP_WORKER_FAILURE';
const STALE_CODES = new Set(['WORKSPACE_SAVE_CONFLICT', 'WORKSPACE_CONFIRMATION_REQUIRED']);

/**
 * Prüfblatt „Sicherung wiederherstellen“: Datei prüfen, offene Eingaben des Zielbereichs klären,
 * Vorschau lesen und genau diese Vorschau bestätigen. Ansichtszustand der Übersicht ohne eigene Route.
 */
export function RestoreSheet({ file: initialFile, rowDrafts, onCancel, onDone }: Readonly<{
  file: File;
  /** Offene Umbenennungen der Übersichtszeilen; die Klärung schließt eine Zeile, indem sie ihren Eintrag löscht. */
  rowDrafts: Map<string, string>;
  onCancel: () => void;
  onDone: (done: RestoreDone) => void;
}>) {
  const {
    verbuende, writable, flushAutosaves, previewRestore, restoreBackup, pendingRestoreInputs, discardRestoreInput, renameVerbund, renameScope, createScope,
  } = useWorkspace();
  const backupExport = useBackupExport();
  const { exportVerbund, exportDialog, dismissExport } = useVerbundExport(backupExport);
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Jede neue Prüfung verwirft die Ergebnisse älterer Läufe; `bytes` gehört zur aktuellen Datei.
  const generation = useRef(0);
  const bytes = useRef<Uint8Array | null>(null);
  const scope = useRef<RestoreScope | null>(null);
  const running = useRef(false);
  const [file, setFile] = useState(initialFile);
  const [info, setInfo] = useState<FileInfo>();
  const [phase, setPhase] = useState<Phase>({ step: 'checking' });
  const [backup, setBackup] = useState<BackupState>('idle');
  useEffect(() => { heading.current?.focus(); }, []);

  /** Liest die Vorschau zu den aktuellen Bytes; offene Eingaben im Zielbereich halten sie zurück, außer ein Zuordnungskonflikt blockiert jeden Restore. */
  const readPreview = async (run: number, clarify: boolean): Promise<void> => {
    const current = bytes.current;
    if (!current) return;
    const result = await previewRestore(current);
    if (run !== generation.current) return;
    if (!result.ok) {
      const { code } = result.diagnostic;
      if (code === 'WORKSPACE_BACKUP_CONFLICT') setPhase({ step: 'collision' });
      else if (code in REJECTION_TEXT || code === WORKER_FAILURE) setPhase({ step: 'rejected', code });
      else setPhase({ step: 'read-failed' });
      return;
    }
    const preview = result.value;
    setInfo(fileInfo(preview));
    scope.current = scopeOf(preview);
    if (clarify && !scopeConflict(preview)) {
      const inputs = await pendingRestoreInputs(scope.current, rowDrafts);
      if (run !== generation.current) return;
      if (!inputs.ok) { setPhase({ step: 'read-failed' }); return; }
      if (inputs.value.length > 0) { setPhase({ step: 'clarify', inputs: inputs.value }); return; }
    }
    setPhase({ step: 'preview', preview });
  };

  const process = async (next: File, run: number): Promise<void> => {
    bytes.current = null;
    scope.current = null;
    if (!await flushAutosaves()) {
      if (run === generation.current) setPhase({ step: 'flush-failed' });
      return;
    }
    // Eine zu große Datei wird nicht erst in den Arbeitsspeicher gelesen.
    let read: Uint8Array | null = null;
    if (next.size <= WORKSPACE_BACKUP_MAX_BYTES) {
      try { read = new Uint8Array(await next.arrayBuffer()); } catch { read = null; }
    }
    // Ein älterer Lauf darf die Bytes einer inzwischen gewählten Datei nicht ersetzen.
    if (run !== generation.current) return;
    if (!read) { setPhase({ step: 'rejected', code: 'WORKSPACE_BACKUP_INPUT_REJECTED' }); return; }
    bytes.current = read;
    await readPreview(run, true);
  };

  const check = (next: File) => {
    setInfo(undefined);
    setBackup('idle');
    setPhase({ step: 'checking' });
    void process(next, ++generation.current);
  };

  useEffect(() => {
    const counter = generation;
    void process(initialFile, ++counter.current);
    return () => { counter.current++; };
    // Die erste Prüfung läuft genau einmal; weitere Dateien starten über `check`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Nach jeder Klärung: offene Eingaben neu lesen, ohne Rest die Vorschau gegen den jetzigen Stand lesen. */
  const afterClarify = async (failed?: RestoreInput): Promise<void> => {
    const run = generation.current;
    const target = scope.current;
    if (!target) return;
    const inputs = await pendingRestoreInputs(target, rowDrafts);
    if (run !== generation.current) return;
    if (!inputs.ok) { setPhase({ step: 'read-failed' }); return; }
    if (inputs.value.length > 0) { setPhase({ step: 'clarify', inputs: inputs.value, failed }); return; }
    setPhase({ step: 'reading' });
    await readPreview(run, false);
  };

  const saveRename = async (entry: NamedInput) => {
    const saved = await saveNamedInput(entry, { renameVerbund, renameScope, createScope });
    if (saved) discardRestoreInput(entry, rowDrafts);
    await afterClarify(saved ? undefined : entry);
  };

  const confirm = async (preview: RestorePreview) => {
    if (running.current) return;
    running.current = true;
    const run = generation.current;
    // Ab der Bestätigung ist alles gesperrt; eine nach der Vorschau entstandene Eingabe im Zielbereich verwirft die Vorschau.
    setPhase({ step: 'running', preview });
    const inputs = await pendingRestoreInputs(scopeOf(preview), rowDrafts);
    if (run !== generation.current) { running.current = false; return; }
    if (!inputs.ok || inputs.value.length > 0) {
      running.current = false;
      setPhase(inputs.ok ? { step: 'clarify', inputs: inputs.value } : { step: 'read-failed' });
      return;
    }
    const result = await restoreBackup(preview);
    running.current = false;
    if (run !== generation.current) return;
    if (result.ok) { onDone({ text: doneText(preview), verbundId: preview.kind === 'verbund' ? preview.verbundId : undefined }); return; }
    const { code } = result.diagnostic;
    if (STALE_CODES.has(code)) setPhase({ step: 'stale' });
    else if (code === 'WORKSPACE_BACKUP_CONFLICT') setPhase({ step: 'collision' });
    else setPhase({ step: 'write-failed', preview, quota: code === 'WORKSPACE_QUOTA_EXCEEDED' });
  };

  /** „Vorher sichern“; eine Verbundsicherung läuft wie die Zeilenaktion. Ein Dateiwechsel verwirft die erstellte Datei und schließt ihren offenen Umfangsdialog. */
  const backupFirst = (preview: RestorePreview, trigger: HTMLElement) => {
    const run = generation.current;
    const current = () => run === generation.current;
    setBackup('idle');
    void (preview.kind === 'workspace' ? backupExport.exportBackup(current).then((started) => (started ? 'started' : 'failed')) : exportVerbund(preview.verbundId, trigger, current))
      .then((outcome) => { if (current()) setBackup(outcome === 'canceled' ? 'idle' : outcome); });
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0];
    event.target.value = '';
    if (!next || running.current) return;
    dismissExport();
    setFile(next);
    check(next);
  };

  const rejected = phase.step === 'rejected';
  const otherFile = <Button variant="secondary" className={BUTTON} disabled={phase.step === 'running'} onClick={() => input.current?.click()}>Andere Datei…</Button>;
  const cancel = <Button variant="secondary" className={BUTTON} disabled={phase.step === 'running'} onClick={onCancel}>Abbrechen</Button>;
  const shown = phase.step === 'preview' || phase.step === 'running' || phase.step === 'write-failed' ? phase : null;
  const clarifying = phase.step === 'clarify';
  const previewNumber = clarifying ? 3 : 2;

  let fileMark: ReactNode = <Mark>Geprüft</Mark>;
  if (phase.step === 'checking') fileMark = <Mark>Wird geprüft</Mark>;
  else if (rejected) fileMark = <Mark danger>{phase.code === WORKER_FAILURE ? 'Nicht geprüft' : 'Abgelehnt'}</Mark>;
  else if (phase.step === 'flush-failed' || (phase.step === 'read-failed' && !info) || (phase.step === 'collision' && !info)) fileMark = null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
      <header className="space-y-2">
        <h1 ref={heading} tabIndex={-1} className="type-page-title focus:outline-none">Sicherung wiederherstellen</h1>
        <OriginLabel />
      </header>
      <input ref={input} aria-label="Sicherungsdatei" type="file" accept="application/json,.json" className="hidden" tabIndex={-1} onChange={chooseFile} />

      <div className="divide-y divide-[var(--color-border-subtle)] rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
        <Section number={1} title="Datei">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-[var(--color-text-primary)]">{file.name}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">{fileSize(file.size)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {fileMark}
              {otherFile}
            </div>
          </div>
          {phase.step === 'checking' && <output className="block text-sm text-[var(--color-text-secondary)]">Wird geprüft…</output>}
          {phase.step === 'flush-failed' && (
            <>
              <Message tone="alert" title="Nicht gespeichert">Ein offener Entwurf konnte nicht gespeichert werden. Die Eingabe bleibt offen; die Datei wurde nicht geprüft.</Message>
              <Actions>{cancel}<Button className={BUTTON} onClick={() => check(file)}>Erneut prüfen</Button></Actions>
            </>
          )}
          {rejected && phase.code === WORKER_FAILURE && (
            <>
              <Message tone="alert" title="Prüfung abgebrochen">Die Datei wurde nicht geprüft.</Message>
              <Actions>{cancel}<Button className={BUTTON} onClick={() => check(file)}>Erneut prüfen</Button></Actions>
            </>
          )}
          {rejected && phase.code !== WORKER_FAILURE && (
            <>
              <Message tone="alert" title="Datei abgelehnt">{REJECTION_TEXT[phase.code]}</Message>
              <Actions>{cancel}</Actions>
            </>
          )}
          {info && (
            <Facts rows={[
              ['Art', info.kind === 'workspace' ? 'Gesamtsicherung' : 'Verbundsicherung'],
              ['Stand der Datei', formatDate(info.savedAt)],
              ['Speicherversion', String(info.version)],
            ]}
            />
          )}
        </Section>

        {clarifying && (
          <Section number={2} title={`Offene Eingaben · ${phase.inputs.length}`}>
            <ul className="divide-y divide-[var(--color-border-subtle)] border-t border-[var(--color-border-subtle)]">
              {phase.inputs.map((entry) => (
                <ClarifyRow
                  key={inputKey(entry)}
                  entry={entry}
                  verbundName={inputVerbundName(entry, verbuende)}
                  failed={phase.failed !== undefined && inputKey(phase.failed) === inputKey(entry)}
                  writable={writable}
                  onSave={saveRename}
                  onDiscard={() => { discardRestoreInput(entry, rowDrafts); void afterClarify(); }}
                  onOpen={(imported) => void navigate(buildWorkspaceDocumentUrl(imported.verbundId, imported.localId))}
                />
              ))}
            </ul>
            <Actions>{cancel}</Actions>
          </Section>
        )}

        {!rejected && phase.step !== 'checking' && phase.step !== 'flush-failed' && (
          <Section number={previewNumber} title="Vorschau">
            {clarifying && <p className="text-sm text-[var(--color-text-secondary)]">Wartet auf {plural(phase.inputs.length, 'offene Eingabe', 'offene Eingaben')}</p>}
            {phase.step === 'reading' && <output className="block text-sm text-[var(--color-text-secondary)]">Vorschau wird gelesen…</output>}
            {phase.step === 'collision' && (
              <>
                <Message tone="alert" title="Kollision">Dokumente der Datei gehören zu einem anderen Verbund in diesem Browser. Nichts wird überschrieben.</Message>
                <Actions>{cancel}{otherFile}</Actions>
              </>
            )}
            {phase.step === 'stale' && (
              <>
                <Message tone="alert" title="Zielbereich inzwischen geändert">Nichts wurde überschrieben. Die Vorschau gilt nicht mehr.</Message>
                <Actions>{cancel}<Button className={BUTTON} onClick={() => check(file)}>Neue Vorschau erstellen</Button></Actions>
              </>
            )}
            {phase.step === 'read-failed' && (
              <>
                <Message tone="alert" title="Speicher nicht verfügbar">Die Vorschau konnte nicht gelesen werden. Der bisherige Bestand ist unverändert.</Message>
                <Actions>{cancel}<Button className={BUTTON} onClick={() => check(file)}>Erneut prüfen</Button></Actions>
              </>
            )}
            {shown && (
              <PreviewBody
                preview={shown.preview}
                verbundCount={verbuende?.length ?? 0}
                phase={shown.step}
                quota={shown.step === 'write-failed' && shown.quota}
                writable={writable}
                backup={backupExport.exporting ? 'running' : backup}
                cancel={cancel} otherFile={otherFile}
                onBackup={(trigger) => backupFirst(shown.preview, trigger)}
                onConfirm={() => void confirm(shown.preview)}
              />
            )}
          </Section>
        )}
      </div>
      {exportDialog}
    </div>
  );
}
