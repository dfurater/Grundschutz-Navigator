import { useId, useRef, type ReactNode } from 'react';
import { BackdropTint } from '@/components/BackdropTint';
import { Button, type ButtonVariant } from '@/components/Button';
import { ModalPortal } from '@/components/ModalPortal';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { useModalDialog } from '@/hooks/useModalDialog';
import { useScrollLock } from '@/hooks/useScrollLock';

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  /** Beschreibt die Folgen der Bestätigung. */
  readonly children: ReactNode;
  readonly confirmLabel: string;
  readonly confirmVariant?: ButtonVariant;
  readonly confirmDisabled?: boolean;
  readonly busy?: boolean;
  /** Breiter für Dialoge mit Formular; mobil bleibt die volle Breite. */
  readonly wide?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** Schließen ohne Nutzerentscheidung, etwa durch das Suchkürzel; ohne Angabe wie Abbrechen. */
  readonly onDismiss?: () => void;
}

/** Ausdrückliche Bestätigung mit Abbrechen als anfänglichem Fokus. */
export function ConfirmDialog({ open, title, children, confirmLabel, confirmVariant = 'danger', confirmDisabled = false, busy = false, wide = false, onConfirm, onCancel, onDismiss = onCancel }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const cancel = () => { if (!busy) onCancel(); };
  useModalDialog(dialogRef, open, () => { if (!busy) onDismiss(); });
  useScrollLock(open);
  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key === 'Escape') cancel();
  }, open);

  if (!open) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-40" style={{ opacity: 0.3 }} onClick={cancel} aria-hidden="true">
        <BackdropTint className="bg-black" />
      </div>
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-4">
        <dialog
          open
          ref={dialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-busy={busy || undefined}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className={`pointer-events-auto static m-0 flex max-h-[calc(100dvh-2rem)] w-full ${wide ? 'max-w-2xl' : 'max-w-md'} flex-col rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-overlay)] p-4 text-inherit shadow-overlay`}
        >
          <h2 id={titleId} className="shrink-0 text-base font-semibold leading-snug text-[var(--color-text-primary)]">{title}</h2>
          {/* Ein langer Name scrollt im Text; die Aktionen bleiben im Bild. */}
          <div id={descriptionId} className="mt-2 min-h-0 overflow-y-auto break-words text-sm leading-relaxed text-[var(--color-text-secondary)]">{children}</div>
          <div className="mt-4 flex shrink-0 flex-wrap justify-end gap-2">
            {/* Abbrechen steht zuerst und erhält den Fokus: Enter löscht nichts. */}
            <Button variant="secondary" className="min-h-touch aria-disabled:cursor-not-allowed aria-disabled:opacity-50 desktop:min-h-0" aria-disabled={busy || undefined} onClick={cancel}>Abbrechen</Button>
            <Button variant={confirmVariant} className="min-h-touch aria-disabled:cursor-not-allowed aria-disabled:opacity-50 desktop:min-h-0" aria-disabled={busy || confirmDisabled || undefined} onClick={() => { if (!busy && !confirmDisabled) onConfirm(); }}>{confirmLabel}</Button>
          </div>
        </dialog>
      </div>
    </ModalPortal>
  );
}
