import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { BackdropTint } from '@/components/BackdropTint';
import { Button } from '@/components/Button';
import { ModalPortal } from '@/components/ModalPortal';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { useModalDialog } from '@/hooks/useModalDialog';
import { useScrollLock } from '@/hooks/useScrollLock';
import type { VerbundId, WorkspaceVerbundBackup } from '@/domain/workspaceModel';
import type { PreparedBackup, useBackupExport } from '@/features/workspace/WorkspaceNotices';
import { ROW_BUTTON } from '@/features/workspace/WorkspaceForms';
import { Facts, plural } from '@/features/workspace/RestoreSheetParts';

/** Erstellte Verbundsicherung mit mitgeführter Scopezeile; alle Angaben des Dialogs stammen aus dieser Datei. */
export interface PreparedVerbundBackup extends PreparedBackup {
  readonly verbundName: string;
  readonly scopeName: string;
  readonly documents: number;
}

/** Liest die Angaben des Dialogs aus der erstellten Datei; `null`, wenn sie keine Scopezeile mitführt. */
export function scopedVerbundBackup(prepared: PreparedBackup): PreparedVerbundBackup | null {
  const file = JSON.parse(prepared.text) as WorkspaceVerbundBackup;
  const scope = file.methodikScopes?.[0];
  return scope ? { ...prepared, verbundName: file.verbuende[0].name, scopeName: scope.name, documents: file.documents.length } : null;
}

/** Ausgang einer Verbundsicherung: Download übergeben, im Dialog abgebrochen oder verworfen, Sicherung nicht erstellt. */
export type VerbundExportOutcome = 'started' | 'canceled' | 'failed';

/**
 * Sichert einen Verbund für jeden Einstieg gleich: Die erstellte Datei entscheidet, ob vor dem Download der Dialog
 * ihren Umfang nennt. Nach dem Dialog erhält der Auslöser den Fokus zurück. `wanted` wird nach dem Erstellen gelesen;
 * `false` verwirft die Datei ohne Dialog und Download. `dismissExport` schließt einen offenen Dialog ohne Download und
 * ohne Fokusrückgabe.
 */
export function useVerbundExport({ prepareVerbund, saveBackup }: Pick<ReturnType<typeof useBackupExport>, 'prepareVerbund' | 'saveBackup'>): {
  readonly exportVerbund: (verbundId: VerbundId, trigger: HTMLElement, wanted?: () => boolean) => Promise<VerbundExportOutcome>;
  readonly exportDialog: ReactNode;
  readonly dismissExport: () => void;
} {
  const [pending, setPending] = useState<{ readonly backup: PreparedVerbundBackup; readonly settle: (download: boolean) => void } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  // Erst nach dem Abbau des Dialogs ist der Hintergrund nicht mehr inert und der Auslöser fokussierbar.
  useEffect(() => {
    if (pending || !trigger.current) return;
    trigger.current.focus();
    trigger.current = null;
  }, [pending]);
  const exportVerbund = async (verbundId: VerbundId, from: HTMLElement, wanted: () => boolean = () => true): Promise<VerbundExportOutcome> => {
    const created = await prepareVerbund(verbundId);
    if (!created) return 'failed';
    if (!wanted()) return 'canceled';
    const scoped = scopedVerbundBackup(created);
    const download = scoped === null || await new Promise<boolean>((settle) => {
      trigger.current = from;
      setPending({ backup: scoped, settle });
    });
    if (!download) return 'canceled';
    saveBackup(created);
    return 'started';
  };
  const exportDialog = pending && (
    <VerbundExportDialog backup={pending.backup} onClose={(download) => { setPending(null); pending.settle(download); }} />
  );
  const dismissExport = () => {
    if (!pending) return;
    trigger.current = null;
    setPending(null);
    pending.settle(false);
  };
  return { exportVerbund, exportDialog, dismissExport };
}

/**
 * Umfang der Sicherung eines Verbunds, dessen Datei den gemeinsamen Anwendungsbereich mitführt, vor dem Download.
 * `onClose(true)` heißt: herunterladen.
 */
export function VerbundExportDialog({ backup, onClose }: Readonly<{
  backup: PreparedVerbundBackup;
  onClose: (download: boolean) => void;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const cancel = () => onClose(false);
  useModalDialog(dialogRef, true, cancel);
  useScrollLock(true);
  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key === 'Escape') cancel();
  }, true);

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-40" style={{ opacity: 0.3 }} onClick={cancel} aria-hidden="true">
        <BackdropTint className="bg-black" />
      </div>
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-4">
        <dialog
          open
          ref={dialogRef}
          aria-modal="true"
          aria-labelledby={titleId}
          className="pointer-events-auto static m-0 flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-overlay)] p-4 text-inherit shadow-overlay"
        >
          <h2 id={titleId} className="shrink-0 break-words text-base font-semibold leading-snug text-[var(--color-text-primary)]">„{backup.verbundName}“ sichern</h2>
          <div className="mt-3 min-h-0 overflow-y-auto">
            <Facts rows={[
              ['Informationsverbund', `${backup.verbundName} · ${plural(backup.documents, 'Dokument', 'Dokumente')}`],
              ['Anwendungsbereich', `${backup.scopeName} · gemeinsame Daten werden mitgesichert`],
              ['Nicht enthalten', 'Andere Informationsverbünde'],
              ['Datei', <span key="datei" className="font-mono text-xs">{backup.filename}</span>],
            ]}
            />
          </div>
          <div className="mt-4 flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--color-border-subtle)] pt-4 md:flex-row md:justify-end">
            {/* `data-dialog-close`: Der Fokus beginnt auf dem Download, nicht auf dem Abbruch. */}
            <Button variant="secondary" data-dialog-close className={ROW_BUTTON} onClick={cancel}>Abbrechen</Button>
            <Button className={ROW_BUTTON} onClick={() => onClose(true)}>Sicherung herunterladen</Button>
          </div>
        </dialog>
      </div>
    </ModalPortal>
  );
}
