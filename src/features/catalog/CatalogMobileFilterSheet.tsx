import { useCallback, useId, useRef, useState } from 'react';
import { BackdropTint } from '@/components/BackdropTint';
import { Button } from '@/components/Button';
import { IconFilter } from '@/components/icons';
import { ModalPortal } from '@/components/ModalPortal';
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
            className="m-0 p-0 border-0 w-full max-w-none text-[inherit] fixed inset-x-0 bottom-0 z-50 bg-[var(--color-surface-raised)] rounded-t-2xl shadow-xl max-h-[80dvh] flex flex-col overflow-hidden lg:hidden animate-slide-up"
          >
            <div
              ref={handleRef}
              className="flex justify-center items-center min-h-[44px] shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
              aria-hidden="true"
            >
              <div className="w-10 h-1 bg-[var(--color-border-strong)] rounded-full" />
            </div>
            {/* Die Schließaktion steht im Kopf: Das Sheet ist unten verankert und
                schneidet bei wenig Höhe unten ab, der Kopf bleibt sichtbar. Unten
                ragt sie nur so weit über ihre Zeile hinaus, wie der Abstand zur
                Zeile mit „Zurücksetzen“ reicht (`mt-1.5`), damit sie es nicht überdeckt. */}
            <FilterPanel
              {...filterPanelProps}
              headingId={headingId}
              headerAction={(
                <Button variant="ghost" size="sm" className="min-h-[44px] min-w-[44px] -mt-3 -mb-1.5 -mr-2 text-sm" onClick={close} data-dialog-close>
                  Fertig
                </Button>
              )}
            />
          </dialog>
        </ModalPortal>
      )}
    </>
  );
}
