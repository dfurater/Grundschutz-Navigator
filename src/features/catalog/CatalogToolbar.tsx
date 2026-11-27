import { useContext, useId } from 'react';
import type { Control } from '@/domain/models';
import { MobileNavigationContext } from '@/state/MobileNavigationContext';
import type { FilterPanelProps } from './FilterPanel';
import { CatalogExportMenu } from './CatalogExportMenu';
import { CatalogMobileSelectToggle } from './CatalogMobileSelectToggle';
import { CatalogSelectionChip } from './CatalogSelectionChip';
import { CatalogMobileExportSheet } from './CatalogMobileExportSheet';
import { CatalogMobileFilterSheet } from './CatalogMobileFilterSheet';

interface CatalogToolbarProps {
  readonly title: string;
  /** Kurztitel des geöffneten Katalogs vor dem Bereich, z. B. „DIVA / Alle Kontrollen“. */
  readonly catalogLabel?: string;
  readonly filteredCount: number;
  readonly totalCount: number;
  readonly hasActiveFilters: boolean;
  readonly onClearFilters: () => void;
  readonly checkedIds: ReadonlySet<string>;
  readonly mobileSelectMode: boolean;
  readonly onToggleMobileSelectMode: () => void;
  readonly onClearSelection: () => void;
  readonly filteredControls: Control[];
  readonly allControls: Control[];
  readonly sectionFilename: string;
  readonly filterPanelProps: FilterPanelProps;
  readonly isDesktop: boolean;
  /**
   * Mobile Filter- und Export-Sheets bleiben abgebaut, etwa solange das Detail
   * als Seite die verborgene Toolbar ersetzt: Ein offenes Sheet hielte sonst
   * unsichtbar Scroll-Sperre und Focus-Trap (GSPP-451).
   */
  readonly mobileSheetsSuspended?: boolean;
  readonly onSelectionExported?: () => void;
}

export function CatalogToolbar({
  title,
  catalogLabel,
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
  isDesktop,
  mobileSheetsSuspended = false,
  onSelectionExported,
}: CatalogToolbarProps) {
  const { securityTargets, ...flatFilters } = filterPanelProps.filters;
  const activeCount = [...Object.values(flatFilters), ...Object.values(securityTargets)]
    .reduce((count, values) => count + values.length, 0);
  const mobileNavigationOpen = useContext(MobileNavigationContext);
  const catalogLabelId = useId();
  const showMobileSheets = !isDesktop && !mobileSheetsSuspended && !mobileNavigationOpen;
  return (
    <div className="px-3 pt-2 pb-0 sm:py-1.5 md:py-0 md:h-panel-head md:flex md:items-center border-b border-[var(--color-border-default)] bg-[var(--color-surface-base)] sticky top-14 z-10 md:static md:z-auto">
      {/* Unter sm zwei Zeilen: die Überschrift über die volle Breite, darunter
          Anzahl und Aktionen. Ab sm eine Zeile wie bisher (GSPP-471). */}
      <div className="w-full flex flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-2 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 min-w-0 sm:flex-nowrap sm:items-center">
          {/* Rückkehrziel nach dem Schließen der mobilen Detailseite (`useDocumentDetailPage`). */}
          {/* Der Katalog beschreibt die Überschrift; nach einem Katalogwechsel liegt der Fokus dort (GSPP-728). */}
          {catalogLabel && (
            <span id={catalogLabelId} className="max-w-full sm:whitespace-nowrap text-base font-medium text-[var(--color-text-secondary)]">
              {catalogLabel}
              <span aria-hidden="true" className="font-normal text-[var(--color-text-muted)]"> /</span>
            </span>
          )}
          <h1 data-catalog-scope-heading tabIndex={-1} aria-describedby={catalogLabel ? catalogLabelId : undefined} className="min-w-0 text-lg/title text-balance hyphens-auto line-clamp-2 sm:line-clamp-none sm:truncate sm:text-base font-bold text-[var(--color-text-primary)] focus:outline-none">
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

        {/* Reicht die Breite nicht für Anzahl, „Filter zurücksetzen“ und die
            Aktionen (etwa bei starkem Zoom), rutschen die Aktionen rechtsbündig
            in eine eigene Zeile, statt den Rücksetzknopf zu überdecken. */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 min-h-touch sm:flex-nowrap sm:min-h-0 sm:shrink-0">
          <div className="sm:hidden flex flex-auto flex-wrap items-center gap-x-3 gap-y-0.5 min-w-0">
            <span
              className="text-xs text-[var(--color-text-secondary)] tabular-nums whitespace-nowrap"
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
                className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] whitespace-nowrap transition-colors"
                aria-label="Filter zurücksetzen"
              >
                Filter zurücksetzen
              </button>
            )}
          </div>

          {/* Eine Auswahl ohne Auswahlmodus (etwa am Desktop markiert, dann
              verkleinert) bleibt auch unter sm sichtbar und aufhebbar; ab sm
              steht der Chip wie bisher vor dem Auswahl-Schalter. */}
          <CatalogSelectionChip
            count={checkedIds.size}
            isDesktop={isDesktop}
            mobileSelectMode={mobileSelectMode}
            onClear={onClearSelection}
          />

          {/* Unter sm sitzen die Icon-Schalter lückenlos und enden am
              Viewport-Rand (-mr-3 gleicht px-3 aus). */}
          <div className="flex items-center ml-auto -mr-3 sm:mr-0 sm:gap-2 shrink-0">
            <CatalogMobileSelectToggle
              active={mobileSelectMode}
              onToggle={onToggleMobileSelectMode}
            />

            {/* Breakpoint-Mount-Strategie (GSPP-268): Alle drei Filter-/Export-
                Zugänge werden über isDesktop bedingt gemountet, nicht per CSS
                versteckt — zu jedem Zeitpunkt ist nur der passende Teilbaum im
                DOM (Invariante aus GRU-217). */}
            {showMobileSheets && (
              <CatalogMobileFilterSheet filterPanelProps={filterPanelProps} activeCount={activeCount} />
            )}
            {isDesktop && (
              <CatalogExportMenu
                checkedIds={checkedIds}
                filteredControls={filteredControls}
                allControls={allControls}
                sectionFilename={sectionFilename}
              />
            )}
            {showMobileSheets && (
              <CatalogMobileExportSheet
                checkedIds={checkedIds}
                filteredControls={filteredControls}
                allControls={allControls}
                sectionFilename={sectionFilename}
                onSelectionExported={onSelectionExported}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
