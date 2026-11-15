import { useEffect, useId, useRef, useState } from 'react';
import { downloadBlob } from '@/adapters/browserDownload';
import { BackdropTint } from '@/components/BackdropTint';
import { Button } from '@/components/Button';
import { ModalPortal } from '@/components/ModalPortal';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { useModalDialog } from '@/hooks/useModalDialog';
import { useScrollLock } from '@/hooks/useScrollLock';
import { useWorkspace } from '@/hooks/useWorkspace';
import type { WorkspaceVerbund } from '@/domain/workspaceModel';
import { VERBUND_BACKUP_PREFIX, backupFilename } from '@/features/workspace/WorkspaceNotices';
import { ROW_BUTTON } from '@/features/workspace/WorkspaceForms';
import { Facts, plural } from '@/features/workspace/RestoreSheetParts';

/**
 * Umfang der Sicherung eines zugeordneten Verbunds vor dem Download: Die Datei führt die gemeinsame
 * Scopezeile mit. Die Sicherung entsteht beim Öffnen; Dokumentzahl und Download stammen aus derselben Datei.
 * `onClose` meldet, ob der Download übergeben wurde; ein Exportfehler erscheint als Speichermeldung des Bereichs.
 */
export function VerbundExportDialog({ verbund, scopeName, onClose }: Readonly<{
  verbund: WorkspaceVerbund;
  scopeName: string;
  onClose: (started: boolean) => void;
}>) {
  const { exportVerbundBackup } = useWorkspace();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [filename] = useState(() => backupFilename(VERBUND_BACKUP_PREFIX));
  const [prepared] = useState(() => exportVerbundBackup(verbund.verbundId));
  const [documents, setDocuments] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = () => { if (!busy) onClose(false); };
  useModalDialog(dialogRef, true, cancel);
  useScrollLock(true);
  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key === 'Escape') cancel();
  }, true);
  useEffect(() => {
    let live = true;
    void prepared.then((result) => {
      if (live && result.ok) setDocuments((JSON.parse(result.value) as { documents: unknown[] }).documents.length);
    });
    return () => { live = false; };
  }, [prepared]);

  const download = async () => {
    if (busy) return;
    setBusy(true);
    const result = await prepared;
    if (result.ok) downloadBlob(new Blob([result.value], { type: 'application/json' }), filename);
    onClose(result.ok);
  };

  const verbundFact = documents === null ? verbund.name : `${verbund.name} · ${plural(documents, 'Dokument', 'Dokumente')}`;
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
          aria-busy={busy || undefined}
          aria-labelledby={titleId}
          className="pointer-events-auto static m-0 flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-overlay)] p-4 text-inherit shadow-overlay"
        >
          <h2 id={titleId} className="shrink-0 break-words text-base font-semibold leading-snug text-[var(--color-text-primary)]">„{verbund.name}“ sichern</h2>
          <div className="mt-3 min-h-0 overflow-y-auto">
            <Facts rows={[
              ['Informationsverbund', verbundFact],
              ['Anwendungsbereich', `${scopeName} · gemeinsame Daten werden mitgesichert`],
              ['Nicht enthalten', 'Andere Informationsverbünde'],
              ['Datei', <span key="datei" className="font-mono text-xs">{filename}</span>],
            ]}
            />
          </div>
          <div className="mt-4 flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--color-border-subtle)] pt-4 md:flex-row md:justify-end">
            {/* `data-dialog-close`: Der Fokus beginnt auf dem Download, nicht auf dem Abbruch. */}
            <Button variant="secondary" data-dialog-close className={ROW_BUTTON} disabled={busy} onClick={cancel}>Abbrechen</Button>
            <Button className={ROW_BUTTON} aria-disabled={busy || undefined} onClick={() => void download()}>Sicherung herunterladen</Button>
          </div>
        </dialog>
      </div>
    </ModalPortal>
  );
}
