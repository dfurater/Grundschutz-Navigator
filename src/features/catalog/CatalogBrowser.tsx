import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { buildCatalogUrl } from '@/app/routes';
import type { Catalog, Control } from '@/domain/models';
import { useCatalog } from '@/hooks/useCatalog';
import { useControlNavigation } from '@/hooks/useControlNavigation';
import { useControlSelection } from '@/hooks/useControlSelection';
import { useDragToResize } from '@/hooks/useDragToResize';
import { useFilterParams } from '@/hooks/useFilterParams';
import {
  emptyFilters,
  useFilteredControls,
} from '@/hooks/useFilteredControls';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { CatalogDesktopSidebar } from './CatalogDesktopSidebar';
import {
  CatalogMobileDetailOverlay,
} from './CatalogDetailPanel';
import { ControlMobileReferenceRow } from './ControlMobileReferenceRow';
import { CatalogMobileSelectionBar } from './CatalogMobileSelectionBar';
import { CatalogToolbar } from './CatalogToolbar';
import { ControlTable } from './ControlTable';
import type { FilterPanelProps } from './FilterPanel';

const DETAIL_DEFAULT_WIDTH = 420;
const DETAIL_MIN_WIDTH = 320;
const DETAIL_MAX_WIDTH = 720;
const EMPTY_CONTROLS_BY_ID = new Map<string, Control>();

function CatalogTargetNotFound({ catalog }: { catalog: Catalog | null }) {
  return (
    <div className="flex-1 p-6">
      <h1 className="text-xl font-bold text-slate-900">
        404 — Katalogziel nicht gefunden
      </h1>
      <p className="mt-3 text-sm text-slate-600">
        Der angeforderte Katalogeintrag existiert nicht.
        {catalog && (
          <>
            {' '}
            <Link
              to={buildCatalogUrl(catalog.catalogKey)}
              className="rounded text-sky-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
            >
              Zum Katalog
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

export function CatalogBrowser() {
  const { catalogKey, groupId, altIdentifier } = useParams<{
    catalogKey?: string;
    groupId?: string;
    altIdentifier?: string;
  }>();
  const navigate = useNavigate();
  const { catalog, loading, error } = useCatalog();
  const { filters, setFilters, sort, setSort, searchString } = useFilterParams();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [filterCollapsed, setFilterCollapsed] = useState(false);
  const [mobileSelectMode, setMobileSelectMode] = useState(false);
  const {
    width: detailWidth,
    isResizing,
    setWidth: setDetailWidth,
    startResize: handleResizeStart,
  } = useDragToResize({
    axis: 'x',
    edge: 'start',
    min: DETAIL_MIN_WIDTH,
    max: DETAIL_MAX_WIDTH,
    initial: DETAIL_DEFAULT_WIDTH,
  });
  const {
    selectedControl,
    scopeId,
    routeNotFound,
    selectControl,
    closeDetail,
    navigateToControl,
  } = useControlNavigation({
    catalog,
    routeCatalogKey: catalogKey,
    groupId,
    altIdentifier,
    searchString,
    navigate,
  });
  const selectionScopeId =
    `${catalog?.catalogKey ?? catalogKey ?? '__unknown_catalog__'}:` +
    `${scopeId ?? '__all__'}`;
  const {
    checkedIds,
    setCheckedIds,
    setChecked,
    clear: clearSelection,
  } = useControlSelection({ scopeId: selectionScopeId });

  const prevScopeRef = useRef(scopeId);
  useEffect(() => {
    if (scopeId !== prevScopeRef.current) {
      if (!searchString) {
        setFilters(emptyFilters);
        setSort([{ field: 'id', direction: 'asc' }]);
      }
      prevScopeRef.current = scopeId;
    }
  }, [scopeId, searchString, setFilters, setSort]);

  const scopedControls = useMemo(() => {
    if (!catalog) return [];
    if (!scopeId) return catalog.controls;
    const practice = catalog.practices.find((item) => item.id === scopeId);
    return practice
      ? catalog.controls.filter((control) => control.practiceId === scopeId)
      : catalog.controls.filter((control) => control.groupId === scopeId);
  }, [catalog, scopeId]);
  const {
    filtered,
    totalCount,
    facetCounts,
    filteredFacetCounts,
    hasActiveFilters,
  } = useFilteredControls(scopedControls, filters, sort);
  const clearFilters = useCallback(
    () => setFilters(emptyFilters),
    [setFilters],
  );
  const finishMobileSelection = useCallback(() => {
    setMobileSelectMode(false);
    clearSelection();
  }, [clearSelection]);
  const toggleMobileSelection = useCallback(() => {
    if (mobileSelectMode) {
      finishMobileSelection();
    } else {
      setMobileSelectMode(true);
    }
  }, [finishMobileSelection, mobileSelectMode]);
  const handleMobileCheckedChange = useCallback(
    (control: Control, checked: boolean) => {
      setChecked(control.id, checked);
    },
    [setChecked],
  );

  const currentTitle = useMemo(() => {
    if (!catalog || !scopeId) return 'Alle Kontrollen';
    const practice = catalog.practices.find((item) => item.id === scopeId);
    if (practice) return `${practice.label} — ${practice.title}`;
    for (const item of catalog.practices) {
      const topic = item.topics.find((candidate) => candidate.id === scopeId);
      if (topic) return `${scopeId} — ${topic.title}`;
    }
    return scopeId;
  }, [catalog, scopeId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <div className="inline-block w-6 h-6 border-2 border-[var(--color-border-strong)] border-t-[var(--color-primary-main)] rounded-full animate-spin" />
          <p className="text-sm text-[var(--color-text-secondary)] mt-3">
            Katalog wird geladen…
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <p className="text-red-600 font-medium">Fehler beim Laden</p>
          <p className="text-sm text-red-500 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (routeNotFound || !catalog) {
    return <CatalogTargetNotFound catalog={catalog} />;
  }

  const controlsById = catalog.controlsById ?? EMPTY_CONTROLS_BY_ID;
  const filterPanelProps: FilterPanelProps = {
    filters,
    facetCounts,
    filteredFacetCounts,
    hasActiveFilters,
    filteredCount: filtered.length,
    totalCount,
    onFiltersChange: setFilters,
    onClearFilters: clearFilters,
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col md:overflow-hidden">
      <CatalogToolbar
        title={currentTitle}
        filteredCount={filtered.length}
        totalCount={totalCount}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
        checkedIds={checkedIds}
        mobileSelectMode={mobileSelectMode}
        onToggleMobileSelectMode={toggleMobileSelection}
        onClearSelection={clearSelection}
        filteredControls={filtered}
        allControls={catalog.controls}
        sectionFilename={`grundschutz-${scopeId ?? 'katalog'}.csv`}
        filterPanelProps={filterPanelProps}
        isDesktop={isDesktop}
        onSelectionExported={finishMobileSelection}
      />

      <div className="flex-1 min-w-0 flex md:overflow-hidden">
        {isDesktop ? (
          <div className="hidden lg:flex flex-1 flex-col overflow-hidden">
            <ControlTable
              controls={filtered}
              controlsById={controlsById}
              selectedControlId={selectedControl?.id}
              checkedIds={checkedIds}
              sort={sort}
              onSortChange={setSort}
              onSelectControl={selectControl}
              onCheckedChange={setCheckedIds}
            />
          </div>
        ) : (
          <div className="lg:hidden flex-1 min-w-0 flex flex-col md:overflow-hidden">
            <div className={`flex-1 md:overflow-y-auto divide-y divide-[var(--color-border-subtle)] ${mobileSelectMode ? 'pb-[calc(7rem+env(safe-area-inset-bottom,0px))]' : 'pb-safe'}`}>
              {filtered.map((control) => (
                <ControlMobileReferenceRow
                  key={control.id}
                  control={control}
                  controlsById={controlsById}
                  selectMode={mobileSelectMode}
                  checked={checkedIds.has(control.id)}
                  onSelect={selectControl}
                  onCheckedChange={handleMobileCheckedChange}
                />
              ))}
              {filtered.length === 0 && (
                <p className="text-sm text-[var(--color-text-secondary)] text-center py-8">
                  Keine Kontrollen gefunden
                </p>
              )}
            </div>
            {mobileSelectMode && (
              <CatalogMobileSelectionBar
                checkedIds={checkedIds}
                filteredControls={filtered}
                onDone={finishMobileSelection}
              />
            )}
          </div>
        )}

        <CatalogDesktopSidebar
          catalog={catalog}
          selectedControl={isDesktop ? selectedControl : null}
          detailWidth={detailWidth}
          detailMinWidth={DETAIL_MIN_WIDTH}
          detailMaxWidth={DETAIL_MAX_WIDTH}
          isResizing={isResizing}
          onResizeStart={handleResizeStart}
          onDetailWidthChange={setDetailWidth}
          onCloseDetail={closeDetail}
          onNavigateToControl={navigateToControl}
          filterCollapsed={filterCollapsed}
          onFilterCollapsedChange={setFilterCollapsed}
          hasActiveFilters={hasActiveFilters}
          filterPanelProps={filterPanelProps}
        />
      </div>

      <CatalogMobileDetailOverlay
        catalog={catalog}
        control={selectedControl}
        active={!!selectedControl && !isDesktop}
        onClose={closeDetail}
        onNavigateToControl={navigateToControl}
      />
    </div>
  );
}
