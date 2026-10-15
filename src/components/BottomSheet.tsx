import { useRef, type ReactNode } from 'react';
import { BackdropTint } from '@/components/BackdropTint';
import { ModalPortal } from '@/components/ModalPortal';
import { DialogNavigationStatus } from '@/components/NavigationPendingStatus';
import { useBottomSheetDrag } from '@/hooks/useBottomSheetDrag';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { useModalDialog } from '@/hooks/useModalDialog';
import { useScrollLock } from '@/hooks/useScrollLock';

interface BottomSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly labelledBy: string;
  readonly draggable?: boolean;
  readonly children: ReactNode;
}

export function BottomSheet({ open, onClose, labelledBy, draggable = false, children }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDialogElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  useBottomSheetDrag({
    active: open && draggable,
    sheetRef,
    backdropRef,
    handleRef,
    onDismiss: onClose,
  });
  useModalDialog(sheetRef, open, onClose);
  useScrollLock(open);
  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key === 'Escape') onClose();
  }, open);

  if (!open) return null;

  return (
    <ModalPortal>
      <div
        ref={backdropRef}
        className="fixed inset-0 z-40 desktop:hidden"
        style={{ opacity: 0.3 }}
        onClick={onClose}
        aria-hidden="true"
      >
        <BackdropTint className="bg-black" />
      </div>
      <dialog
        open
        ref={sheetRef}
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="mobile-sheet m-0 border-0 w-full max-w-none text-inherit fixed inset-x-0 bottom-0 z-50 bg-[var(--color-surface-raised)] flex flex-col overflow-hidden desktop:hidden animate-slide-up"
      >
        <div
          ref={handleRef}
          className={`flex justify-center items-center min-h-touch shrink-0 select-none${draggable ? ' cursor-grab active:cursor-grabbing touch-none' : ''}`}
          aria-hidden="true"
        >
          <div className="w-10 h-1 bg-[var(--color-border-strong)] rounded-full" />
        </div>
        {children}
        <DialogNavigationStatus />
      </dialog>
    </ModalPortal>
  );
}
