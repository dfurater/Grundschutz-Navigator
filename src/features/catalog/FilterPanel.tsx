import { Fragment, useCallback, type ReactNode } from 'react';
import { useAdaptiveFilterHeader } from '@/features/catalog/useAdaptiveFilterHeader';
import { FilterSection } from '@/components/FilterSection';
import { CheckboxLabel } from '@/components/CheckboxLabel';
import { IconFilter, IconChevronRight } from '@/components/icons';
import type { ControlFilters, FacetCounts } from '@/hooks/useFilteredControls';
import { SecurityTargetFilterSection } from './SecurityTargetFilterSection';
import { useCatalog } from '@/hooks/useCatalog';
import { useOverlayScrollbars } from '@/hooks/useOverlayScrollbars';
import {
  SECURITY_TARGETS_AFTER,
  buildFilterDimensions,
  toggleArrayItem,
} from './filterDimensions';

export interface FilterPanelProps {
  readonly filters: ControlFilters;
  readonly facetCounts: FacetCounts;
  readonly filteredFacetCounts: FacetCounts;
  readonly hasActiveFilters: boolean;
  readonly filteredCount: number;
  readonly totalCount: number;
  readonly onFiltersChange: (filters: ControlFilters) => void;
  readonly onClearFilters: () => void;
  readonly onCollapse?: () => void;
  /** ID der Überschrift „Filter“, über die das mobile Sheet seinen Dialognamen bezieht. */
  readonly headingId?: string;
  /** Aktion rechts neben der Überschrift, etwa „Schließen“ im mobilen Sheet. */
  readonly headerAction?: ReactNode;
  /** Bei Platzmangel scrollt die Trefferzeile im mobilen Sheet mit. */
  readonly adaptiveHeader?: boolean;
}

export function FilterPanel({
  filters,
  facetCounts,
  filteredFacetCounts,
  hasActiveFilters,
  filteredCount,
  totalCount,
  onFiltersChange,
  onClearFilters,
  onCollapse,
  headingId,
  headerAction,
  adaptiveHeader = false,
}: FilterPanelProps) {
  const { vocabularyRegistry } = useCatalog();
  const { formRef, headingRef, summaryRef, sectionsRef, bodyRef, scrollSummary, onScroll } = useAdaptiveFilterHeader(adaptiveHeader);
  const filterScrollRef = useOverlayScrollbars<HTMLDivElement>(!scrollSummary);
  const bodyScrollRef = useOverlayScrollbars<HTMLDivElement>(scrollSummary);
  const setSectionsRef = useCallback((element: HTMLDivElement | null) => {
    sectionsRef.current = element;
    return filterScrollRef(element);
  }, [sectionsRef, filterScrollRef]);
  const setBodyRef = useCallback((element: HTMLDivElement | null) => {
    bodyRef.current = element;
    return bodyScrollRef(element);
  }, [bodyRef, bodyScrollRef]);

  const dimensions = buildFilterDimensions({ filters, facetCounts, filteredFacetCounts, vocabularyRegistry });

  return (
    <form
      ref={formRef}
      role="search"
      aria-label="Kontrollen filtern"
      onSubmit={(e) => e.preventDefault()}
      className="flex-1 min-h-0 w-full flex flex-col bg-[var(--color-surface-subtle)]"
    >
      {/* Header */}
      <div ref={headingRef} data-scroll-summary={scrollSummary} className={`px-4 pt-3 pb-1.5 shrink-0 ${scrollSummary ? 'border-b border-[var(--color-border-default)]' : ''}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconFilter className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
            <h2 id={headingId} className="type-meta">Filter</h2>
          </div>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="rounded p-1 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
              aria-label="Filter ausblenden"
              title="Filter ausblenden"
            >
              <IconChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          {headerAction}
        </div>
      </div>
      <div ref={setBodyRef} onScroll={onScroll} data-filter-scroll={scrollSummary ? '' : undefined} className={`flex-1 min-h-0 ${scrollSummary ? 'overflow-y-auto overscroll-contain touch-pan-y' : 'flex flex-col'}`}>
        <div ref={summaryRef} className="px-4 pb-3 border-b border-[var(--color-border-default)] shrink-0">
          <div className="flex items-center justify-between">
            <span className="type-meta tabular-nums" aria-live="polite" aria-atomic="true">
              {filteredCount === totalCount
                ? `${totalCount} Kontrollen`
                : `${filteredCount} von ${totalCount} Kontrollen`}
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={onClearFilters}
                className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              >
                Zurücksetzen
              </button>
            )}
          </div>
        </div>

        {/* Filter Sections */}
        <div ref={setSectionsRef} onScroll={onScroll} data-filter-scroll={scrollSummary ? undefined : ''} className={`${scrollSummary ? '' : 'flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y'} px-4 py-1`}>
        {dimensions.map((dimension) => (
          <Fragment key={dimension.field}>
            {dimension.visible && (
              <FilterSection title={dimension.title} activeCount={dimension.activeCount} defaultExpanded={dimension.defaultExpanded}>
                {dimension.options.map((option) => (
                  <CheckboxLabel
                    key={option.value}
                    label={option.label}
                    title={option.tooltip}
                    count={option.count}
                    checked={option.checked}
                    onChange={() =>
                      onFiltersChange({
                        ...filters,
                        [dimension.field]: toggleArrayItem(filters[dimension.field], option.value),
                      })
                    }
                  />
                ))}
              </FilterSection>
            )}
            {dimension.field === SECURITY_TARGETS_AFTER && (
              <SecurityTargetFilterSection
                filters={filters}
                facetCounts={facetCounts}
                filteredFacetCounts={filteredFacetCounts}
                onFiltersChange={onFiltersChange}
              />
            )}
          </Fragment>
        ))}
      </div>
      </div>
    </form>
  );
}
