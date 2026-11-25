import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { BackdropTint } from '@/components/BackdropTint';
import { Button, type ButtonVariant } from '@/components/Button';
import { ModalPortal } from '@/components/ModalPortal';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { useModalDialog } from '@/hooks/useModalDialog';
import { useScrollLock } from '@/hooks/useScrollLock';

// Mobil füllt der Formulardialog den Bildschirm; die Aktionsleiste bleibt unten stehen, nur der Inhalt scrollt.
const FORM_FRAME = 'h-dvh desktop:h-auto desktop:max-h-[calc(100dvh-2rem)] desktop:max-w-2xl desktop:rounded-lg desktop:border desktop:shadow-overlay';
const FORM_ACTIONS = 'compact:-mx-4 compact:-mb-4 compact:grid compact:grid-cols-2 compact:border-t compact:border-[var(--color-border-default)] compact:p-3';

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly title: string;
  /** Beschreibt die Folgen der Bestätigung. */
  readonly children: ReactNode;
  readonly confirmLabel: string;
  readonly confirmVariant?: ButtonVariant;
  readonly confirmDisabled?: boolean;
  readonly busy?: boolean;
  /** Dialog mit Formular: auf dem Desktop breiter, mobil eine Seite über die gesamte Breite mit fester Aktionsleiste; der Fokus startet auf der Überschrift. */
  readonly form?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** Schließen ohne Nutzerentscheidung, etwa durch das Suchkürzel; ohne Angabe wie Abbrechen. */
  readonly onDismiss?: () => void;
}

/** Ausdrückliche Bestätigung mit Abbrechen als anfänglichem Fokus. */
export function ConfirmDialog({ open, title, children, confirmLabel, confirmVariant = 'danger', confirmDisabled = false, busy = false, form = false, onConfirm, onCancel, onDismiss = onCancel }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const cancel = () => { if (!busy) onCancel(); };
  useModalDialog(dialogRef, open, () => { if (!busy) onDismiss(); });
  // Nach `useModalDialog`: Dessen Rückkehrziel bleibt der auslösende Knopf, erst danach wandert der Fokus auf die Überschrift.
  useLayoutEffect(() => { if (open && form) titleRef.current?.focus(); }, [open, form]);
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
      <div className={`pointer-events-none fixed inset-0 z-50 flex items-center justify-center ${form ? 'desktop:px-4' : 'px-4'}`}>
        <dialog
          open
          ref={dialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-busy={busy || undefined}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className={`pointer-events-auto static m-0 flex w-full flex-col border-[var(--color-border-default)] bg-[var(--color-surface-overlay)] p-4 text-inherit ${form ? FORM_FRAME : 'max-h-[calc(100dvh-2rem)] max-w-md rounded-lg border shadow-overlay'}`}
        >
          <h2 id={titleId} ref={titleRef} tabIndex={form ? -1 : undefined} className="shrink-0 text-base font-semibold leading-snug text-[var(--color-text-primary)]">{title}</h2>
          {/* Ein langer Name scrollt im Text; die Aktionen bleiben im Bild. */}
          <div id={descriptionId} className={`mt-2 min-h-0 overflow-y-auto break-words text-sm leading-relaxed text-[var(--color-text-secondary)] ${form ? 'compact:flex-1' : ''}`}>{children}</div>
          <div className={`mt-4 flex shrink-0 flex-wrap justify-end gap-2 ${form ? FORM_ACTIONS : ''}`}>
            {/* Abbrechen steht zuerst und erhält den Fokus: Enter löscht nichts. */}
            <Button variant="secondary" className="min-h-touch aria-disabled:cursor-not-allowed aria-disabled:opacity-50 desktop:min-h-0" aria-disabled={busy || undefined} onClick={cancel}>Abbrechen</Button>
            <Button variant={confirmVariant} className="min-h-touch aria-disabled:cursor-not-allowed aria-disabled:opacity-50 desktop:min-h-0" aria-disabled={busy || confirmDisabled || undefined} onClick={() => { if (!busy && !confirmDisabled) onConfirm(); }}>{confirmLabel}</Button>
          </div>
        </dialog>
      </div>
    </ModalPortal>
  );
}
