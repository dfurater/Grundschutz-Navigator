import { useCallback, useId, useState } from 'react';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { IconFilter } from '@/components/icons';
import { FilterPanel, type FilterPanelProps } from './FilterPanel';

interface CatalogMobileFilterSheetProps {
  readonly filterPanelProps: FilterPanelProps;
  readonly activeCount: number;
}

export function CatalogMobileFilterSheet({
  filterPanelProps,
  activeCount,
}: CatalogMobileFilterSheetProps) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="desktop:hidden min-h-touch min-w-touch"
        onClick={() => setOpen(true)}
        aria-label={activeCount > 0 ? `Filter anzeigen, ${activeCount} aktiv` : 'Filter anzeigen'}
      >
        <IconFilter className="w-4 h-4" />
        {activeCount > 0 && (
          <span className="filter-count-badge bg-[var(--color-text-primary)]" aria-hidden="true">
            {activeCount}
          </span>
        )}
      </Button>

      <BottomSheet open={open} onClose={close} labelledBy={headingId} draggable>
        <FilterPanel
          {...filterPanelProps}
          adaptiveHeader
          headingId={headingId}
          headerAction={(
            <Button variant="ghost" size="sm" className="min-h-touch min-w-touch -mt-3 -mb-1.5 -mr-2 text-sm tabular-nums" onClick={close} data-dialog-close>
              Schließen ({filterPanelProps.filteredCount})
            </Button>
          )}
        />
      </BottomSheet>
    </>
  );
}
