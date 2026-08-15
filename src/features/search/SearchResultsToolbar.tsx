import type { Control } from '@/domain/models';
import { Button } from '@/components/Button';
import { IconCheck, IconX } from '@/components/icons';
import { CatalogExportMenu } from '@/features/catalog/CatalogExportMenu';
import { CatalogMobileExportSheet } from '@/features/catalog/CatalogMobileExportSheet';

const SEARCH_RESULTS_FILENAME = 'grundschutz-suchergebnisse.csv';

interface SearchResultsToolbarProps {
  checkedIds: ReadonlySet<string>;
  onClearSelection: () => void;
  mobileSelectMode: boolean;
  onToggleMobileSelectMode: () => void;
  /** All query matches in the current desktop table sort order. */
  desktopViewControls: Control[];
  /** All query matches in search relevance order. */
  mobileViewControls: Control[];
  allControls: Control[];
  onSelectionExported: () => void;
}

export function SearchResultsToolbar({
  checkedIds,
  onClearSelection,
  mobileSelectMode,
  onToggleMobileSelectMode,
  desktopViewControls,
  mobileViewControls,
  allControls,
  onSelectionExported,
}: SearchResultsToolbarProps) {
  return (
    <div className="shrink-0 flex items-center justify-end gap-2 border-b border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-4 py-2 sm:px-6">
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
        aria-label={mobileSelectMode ? 'Auswahl beenden' : 'Kontrollen auswählen'}
        aria-pressed={mobileSelectMode}
      >
        <IconCheck className="w-4 h-4" />
      </Button>

      <CatalogExportMenu
        checkedIds={checkedIds}
        filteredControls={desktopViewControls}
        allControls={allControls}
        sectionFilename={SEARCH_RESULTS_FILENAME}
      />
      <CatalogMobileExportSheet
        checkedIds={checkedIds}
        filteredControls={mobileViewControls}
        allControls={allControls}
        sectionFilename={SEARCH_RESULTS_FILENAME}
        onSelectionExported={onSelectionExported}
      />
    </div>
  );
}
