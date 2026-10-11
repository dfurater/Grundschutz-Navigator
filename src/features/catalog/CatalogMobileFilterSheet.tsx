import { useCallback, useId, useRef, useState } from 'react';
import { BackdropTint } from '@/components/BackdropTint';
import { Button } from '@/components/Button';
import { IconFilter } from '@/components/icons';
import { ModalPortal } from '@/components/ModalPortal';
import { DialogNavigationStatus } from '@/components/NavigationPendingStatus';
import { useBottomSheetDrag } from '@/hooks/useBottomSheetDrag';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { useModalDialog } from '@/hooks/useModalDialog';
import { useScrollLock } from '@/hooks/useScrollLock';
import { FilterPanel, type FilterPanelProps } from './FilterPanel';

interface CatalogMobileFilterSheetProps {
  readonly filterPanelProps: FilterPanelProps;
}

export function CatalogMobileFilterSheet({
  filterPanelProps,
}: CatalogMobileFilterSheetProps) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const close = useCallback(() => setOpen(false), []);

  useBottomSheetDrag({
    active: open,
    sheetRef,
    backdropRef,
    handleRef,
    onDismiss: close,
  });
  useModalDialog(sheetRef, open);
  useScrollLock(open);
  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key === 'Escape') close();
  }, open);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="lg:hidden min-h-[44px] min-w-[44px]"
        onClick={() => setOpen(true)}
        aria-label="Filter anzeigen"
      >
        <IconFilter className="w-4 h-4" />
      </Button>

      {open && (
        <ModalPortal>
          <div
            ref={backdropRef}
            className="fixed inset-0 z-40 lg:hidden"
            style={{ opacity: 0.3 }}
            onClick={close}
            aria-hidden="true"
          >
            <BackdropTint className="bg-black" />
          </div>
          <dialog
            open
            ref={sheetRef}
            aria-modal="true"
            aria-labelledby={headingId}
            className="mobile-sheet m-0 border-0 w-full max-w-none text-[inherit] fixed inset-x-0 bottom-0 z-50 bg-[var(--color-surface-raised)] flex flex-col overflow-hidden lg:hidden animate-slide-up"
          >
            <div
              ref={handleRef}
              className="flex justify-center items-center min-h-[44px] shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
              aria-hidden="true"
            >
              <div className="w-10 h-1 bg-[var(--color-border-strong)] rounded-full" />
            </div>
            <FilterPanel
              {...filterPanelProps}
              adaptiveHeader
              headingId={headingId}
              headerAction={(
                <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px] -mt-3 -mb-1.5 -mr-2 text-sm" onClick={close} data-dialog-close>
                  Fertig
                </Button>
              )}
            />
            <DialogNavigationStatus />
          </dialog>
        </ModalPortal>
      )}
    </>
  );
}
