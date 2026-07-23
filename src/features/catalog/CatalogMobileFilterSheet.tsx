import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { IconFilter } from '@/components/icons';
import { useBottomSheetDrag } from '@/hooks/useBottomSheetDrag';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useScrollLock } from '@/hooks/useScrollLock';
import { FilterPanel, type FilterPanelProps } from './FilterPanel';

interface CatalogMobileFilterSheetProps {
  filterPanelProps: FilterPanelProps;
}

export function CatalogMobileFilterSheet({
  filterPanelProps,
}: CatalogMobileFilterSheetProps) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useBottomSheetDrag({
    active: open,
    sheetRef,
    backdropRef,
    handleRef,
    onDismiss: close,
  });
  useFocusTrap(sheetRef, open);
  useScrollLock(open);

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
        <>
          <div
            ref={backdropRef}
            className="fixed inset-0 bg-black z-40 lg:hidden"
            style={{ opacity: 0.3 }}
            onClick={close}
            aria-hidden="true"
          />
          <aside
            ref={sheetRef}
            className="fixed inset-x-0 bottom-0 z-50 bg-[var(--color-surface-raised)] rounded-t-2xl shadow-xl max-h-[80dvh] flex flex-col overflow-hidden lg:hidden animate-slide-up"
            onKeyDown={(event) => {
              if (event.key === 'Escape') close();
            }}
          >
            <div
              ref={handleRef}
              className="flex justify-center items-center min-h-[44px] shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
              aria-hidden="true"
            >
              <div className="w-10 h-1 bg-[var(--color-border-strong)] rounded-full" />
            </div>
            <FilterPanel {...filterPanelProps} />
          </aside>
        </>
      )}
    </>
  );
}
