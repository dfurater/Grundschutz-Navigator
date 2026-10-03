import { useContext } from 'react';
import type { Control } from '@/domain/models';
import { MobileNavigationContext } from '@/state/MobileNavigationContext';
import { CatalogExportMenu } from '@/features/catalog/CatalogExportMenu';
import { CatalogMobileExportSheet } from '@/features/catalog/CatalogMobileExportSheet';
import { CatalogMobileSelectToggle } from '@/features/catalog/CatalogMobileSelectToggle';
import { CatalogSelectionChip } from '@/features/catalog/CatalogSelectionChip';

const SEARCH_RESULTS_FILENAME = 'grundschutz-suchergebnisse.csv';

interface SearchResultsToolbarProps {
  readonly checkedIds: ReadonlySet<string>;
  readonly onClearSelection: () => void;
  readonly mobileSelectMode: boolean;
  readonly onToggleMobileSelectMode: () => void;
  /** Steuert das Mount-Gate der Exportzugänge: Desktop-Menü ab lg, Mobile-Sheet darunter (GSPP-268). */
  readonly isDesktop: boolean;
  /** All query matches in the current desktop table sort order. */
  readonly desktopViewControls: Control[];
  /** All query matches in search relevance order. */
  readonly mobileViewControls: Control[];
  readonly allControls: Control[];
  readonly onSelectionExported: () => void;
}

export function SearchResultsToolbar({
  checkedIds,
  onClearSelection,
  mobileSelectMode,
  onToggleMobileSelectMode,
  isDesktop,
  desktopViewControls,
  mobileViewControls,
  allControls,
  onSelectionExported,
}: SearchResultsToolbarProps) {
  const mobileNavigationOpen = useContext(MobileNavigationContext);
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
      <CatalogSelectionChip
        count={checkedIds.size}
        isDesktop={isDesktop}
        mobileSelectMode={mobileSelectMode}
        onClear={onClearSelection}
      />

      <CatalogMobileSelectToggle
        active={mobileSelectMode}
        onToggle={onToggleMobileSelectMode}
      />

      {isDesktop && (
        <CatalogExportMenu
          checkedIds={checkedIds}
          filteredControls={desktopViewControls}
          allControls={allControls}
          sectionFilename={SEARCH_RESULTS_FILENAME}
        />
      )}
      {!isDesktop && !mobileNavigationOpen && (
        <CatalogMobileExportSheet
          checkedIds={checkedIds}
          filteredControls={mobileViewControls}
          allControls={allControls}
          sectionFilename={SEARCH_RESULTS_FILENAME}
          onSelectionExported={onSelectionExported}
        />
      )}
    </div>
  );
}
