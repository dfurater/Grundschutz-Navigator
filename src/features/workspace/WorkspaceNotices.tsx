import { useState } from 'react';
import { downloadBlob } from '@/adapters/browserDownload';
import { Button } from '@/components/Button';
import { useWorkspace } from '@/hooks/useWorkspace';
import type { WorkspaceNotice } from '@/state/workspaceNotices';
import { QUOTA_WARNING_RATIO } from '@/state/workspaceNotices';

const NOTICE_TEXT: Readonly<Record<WorkspaceNotice, { readonly title: string; readonly text: string; readonly action: 'export' | 'reload' }>> = {
  'write-locked': {
    title: 'Schreibsperre',
    text: 'Der Speicher stammt aus einer neueren Version der Anwendung. Lesen und Sichern bleiben möglich, Änderungen sind gesperrt. Laden Sie die Seite neu, um die aktuelle Version zu verwenden.',
    action: 'export',
  },
  'quota-warning': {
    title: 'Speicher fast voll',
    text: `Der Browser-Speicher dieser Website ist zu mindestens ${QUOTA_WARNING_RATIO * 100} % belegt. Sichern Sie Ihre Daten mit einem Export.`,
    action: 'export',
  },
  'quota-exceeded': {
    title: 'Speicher voll',
    text: 'Die letzte Änderung wurde nicht gespeichert, weil der Browser-Speicher voll ist. Sichern Sie Ihre Daten mit einem Export.',
    action: 'export',
  },
  conflict: {
    title: 'In einem anderen Tab geändert',
    text: 'Ein anderer Tab hat diese Daten inzwischen geändert. Die Änderung hier wurde nicht gespeichert. Laden Sie den aktuellen Stand neu.',
    action: 'reload',
  },
  'storage-failed': {
    title: 'Speicher nicht verfügbar',
    text: 'Der lokale Speicher dieses Browsers konnte nicht gelesen oder geschrieben werden.',
    action: 'reload',
  },
};

function backupFilename(): string {
  return `informationsverbuende-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
}

/** Exportiert den gesamten Speicher als Sicherungsdatei; auch unter Schreibsperre verfügbar. */
export function useBackupExport(): { readonly exporting: boolean; readonly exportBackup: () => void } {
  const { exportBackup } = useWorkspace();
  const [exporting, setExporting] = useState(false);
  return {
    exporting,
    exportBackup: () => {
      setExporting(true);
      void exportBackup().then((result) => {
        setExporting(false);
        if (result.ok) downloadBlob(new Blob([result.value], { type: 'application/json' }), backupFilename());
      });
    },
  };
}

/** Benannte Speichermeldungen; jede trägt ihre Handlung. */
export function WorkspaceNotices() {
  const { notices, reload, status } = useWorkspace();
  const { exporting, exportBackup } = useBackupExport();
  if (notices.length === 0) return null;
  return (
    <ul aria-label="Speichermeldungen" className="space-y-2">
      {notices.map((notice) => {
        const { title, text, action } = NOTICE_TEXT[notice];
        return (
          <li
            key={notice}
            data-notice={notice}
            role={notice === 'quota-warning' ? 'status' : 'alert'}
            className="flex flex-col gap-2 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">{text}</p>
            </div>
            {action === 'export' ? (
              <Button variant="secondary" className="min-h-touch shrink-0 desktop:min-h-0" onClick={exportBackup} disabled={exporting || status !== 'ready'}>
                Sicherung exportieren
              </Button>
            ) : (
              <Button variant="secondary" className="min-h-touch shrink-0 desktop:min-h-0" onClick={reload}>
                Neu laden
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
