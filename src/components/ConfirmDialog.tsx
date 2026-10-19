import { useId, useRef, type ReactNode } from 'react';
import { BackdropTint } from '@/components/BackdropTint';
import { Button } from '@/components/Button';
import { ModalPortal } from '@/components/ModalPortal';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { useModalDialog } from '@/hooks/useModalDialog';
import { useScrollLock } from '@/hooks/useScrollLock';

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  /** Benennt den nicht umkehrbaren Teil der Aktion. */
  readonly children: ReactNode;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Ausdrückliche Bestätigung einer zerstörenden Aktion; Abbrechen ist der Standard. */
export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useModalDialog(dialogRef, open, onCancel);
  useScrollLock(open);
  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key === 'Escape') onCancel();
  }, open);

  if (!open) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-40" style={{ opacity: 0.3 }} onClick={onCancel} aria-hidden="true">
        <BackdropTint className="bg-black" />
      </div>
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-4">
        <dialog
          open
          ref={dialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="pointer-events-auto static m-0 w-full max-w-md rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-overlay)] p-4 text-inherit shadow-overlay"
        >
          <h2 id={titleId} className="text-base font-semibold leading-snug text-[var(--color-text-primary)]">{title}</h2>
          <div id={descriptionId} className="mt-2 text-sm leading-relaxed text-[var(--color-text-secondary)]">{children}</div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {/* Abbrechen steht zuerst und erhält den Fokus: Enter löscht nichts. */}
            <Button variant="secondary" className="min-h-touch desktop:min-h-0" onClick={onCancel} autoFocus>Abbrechen</Button>
            <Button variant="danger" className="min-h-touch desktop:min-h-0" onClick={onConfirm}>{confirmLabel}</Button>
          </div>
        </dialog>
      </div>
    </ModalPortal>
  );
}
