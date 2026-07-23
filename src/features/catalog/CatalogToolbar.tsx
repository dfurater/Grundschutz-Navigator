import type { Control } from '@/domain/models';
import { Button } from '@/components/Button';
import { IconCheck, IconX } from '@/components/icons';
import type { FilterPanelProps } from './FilterPanel';
import { CatalogExportMenu } from './CatalogExportMenu';
import { CatalogMobileExportSheet } from './CatalogMobileExportSheet';
import { CatalogMobileFilterSheet } from './CatalogMobileFilterSheet';

interface CatalogToolbarProps {
  title: string;
  filteredCount: number;
  totalCount: number;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  checkedIds: ReadonlySet<string>;
  mobileSelectMode: boolean;
  onToggleMobileSelectMode: () => void;
  onClearSelection: () => void;
  filteredControls: Control[];
  allControls: Control[];
  sectionFilename: string;
  filterPanelProps: FilterPanelProps;
  onSelectionExported?: () => void;
}

export function CatalogToolbar({
  title,
  filteredCount,
  totalCount,
  hasActiveFilters,
  onClearFilters,
  checkedIds,
  mobileSelectMode,
  onToggleMobileSelectMode,
  onClearSelection,
  filteredControls,
  allControls,
  sectionFilename,
  filterPanelProps,
  onSelectionExported,
}: CatalogToolbarProps) {
  return (
    <div className="px-3 py-1.5 md:py-0 md:h-[51px] md:flex md:items-center border-b border-[var(--color-border-default)] bg-[var(--color-surface-base)] sticky top-14 z-10 md:static md:z-auto">
      <div className="w-full flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-base font-bold text-[var(--color-text-primary)] truncate">
            {title}
          </h1>
          <span
            className="hidden sm:inline text-xs text-[var(--color-text-secondary)] whitespace-nowrap tabular-nums"
            aria-live="polite"
            aria-atomic="true"
          >
            {filteredCount}
            {filteredCount < totalCount ? ` / ${totalCount}` : ''} Kontrollen
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {checkedIds.size > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent-default)] bg-[var(--color-accent-soft)] px-2 py-1 rounded">
              {checkedIds.size} ausgewählt
              <button
                type="button"
                onClick={onClearSelection}
                className="hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)] px-2 py-1 rounded transition-colors"
                aria-label="Auswahl aufheben"
              >
                <IconX className="w-3 h-3" />
              </button>
            </span>
          )}

          <Button
            variant={mobileSelectMode ? 'primary' : 'ghost'}
            size="sm"
            className="lg:hidden min-h-[44px] min-w-[44px]"
            onClick={onToggleMobileSelectMode}
            aria-label={
              mobileSelectMode ? 'Auswahl beenden' : 'Kontrollen auswählen'
            }
            aria-pressed={mobileSelectMode}
          >
            <IconCheck className="w-4 h-4" />
          </Button>

          <CatalogMobileFilterSheet filterPanelProps={filterPanelProps} />
          <CatalogExportMenu
            checkedIds={checkedIds}
            filteredControls={filteredControls}
            allControls={allControls}
            sectionFilename={sectionFilename}
          />
          <CatalogMobileExportSheet
            checkedIds={checkedIds}
            filteredControls={filteredControls}
            allControls={allControls}
            sectionFilename={sectionFilename}
            onSelectionExported={onSelectionExported}
          />
        </div>
      </div>

      <div className="sm:hidden flex items-center justify-between mt-1.5">
        <span
          className="text-xs text-[var(--color-text-secondary)] tabular-nums"
          aria-live="polite"
          aria-atomic="true"
        >
          {filteredCount === totalCount
            ? `${totalCount} Kontrollen`
            : `${filteredCount} von ${totalCount}`}
        </span>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            aria-label="Filter zurücksetzen"
          >
            Filter zurücksetzen
          </button>
        )}
      </div>
    </div>
  );
}
