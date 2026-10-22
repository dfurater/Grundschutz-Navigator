import { useState } from 'react';
import type { LocalId, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { ReviewTab } from '@/features/workspace/review/ReviewTab';

/**
 * Aufklappbare Prüfspur einer Dokumentseite; der Worker startet erst beim
 * Aufklappen. Eine Bearbeitungsansicht reicht Arbeitsstand und
 * Speicherzeitpunkt durch, damit der Prüfstand einem geänderten oder neu
 * gespeicherten Dokument folgt.
 */
export function ReviewSection({ localId, documentSavedAt, editorDirty, onDocumentAdopted }: Readonly<{
  localId: LocalId;
  documentSavedAt?: string;
  editorDirty?: boolean;
  onDocumentAdopted?: (document: WorkspaceEnvelope) => Promise<'adopted' | 'blocked' | 'failed'>;
}>) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
      <summary className={`min-h-touch cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)] ${FOCUS_RING} focus-visible:ring-inset desktop:min-h-0`}>
        Prüfung und Freigabe
      </summary>
      {open && (
        <div className="border-t border-[var(--color-border-default)] p-4">
          <ReviewTab key={localId} localId={localId} documentSavedAt={documentSavedAt} editorDirty={editorDirty} onDocumentAdopted={onDocumentAdopted} />
        </div>
      )}
    </details>
  );
}
