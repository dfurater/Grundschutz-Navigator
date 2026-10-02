import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { PageTitle } from '@/app/PageTitle';
import { PAGE_TITLES } from '@/app/pageTitles';
import type { Catalog, Control } from '@/domain/models';
import { useCatalog } from '@/hooks/useCatalog';
import { useControlNavigation } from '@/hooks/useControlNavigation';
import { useControlSelection } from '@/hooks/useControlSelection';
import { useDocumentDetailPage } from '@/hooks/useDocumentDetailPage';
import { useDragToResize } from '@/hooks/useDragToResize';
import { useFilterParams } from '@/hooks/useFilterParams';
import {
  emptyFilters,
  useFilteredControls,
} from '@/hooks/useFilteredControls';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { OWN_SCROLL_AREA_QUERY } from '@/hooks/useOverlayScrollbars';
import { describeCatalogScope } from './catalogScopeTitle';
import { CatalogDesktopSidebar } from './CatalogDesktopSidebar';
import { CatalogTargetNotFound } from './CatalogTargetNotFound';
import { CatalogDetailPage, CatalogMobileDetailOverlay } from './CatalogDetailPanel';
import { CatalogMobileList } from './CatalogMobileList';
import { CatalogToolbar } from './CatalogToolbar';
import { ControlTable } from './ControlTable';
import type { FilterPanelProps } from './FilterPanel';

const DETAIL_DEFAULT_WIDTH = 420;
const DETAIL_MIN_WIDTH = 320;
const DETAIL_MAX_WIDTH = 720;
const EMPTY_CONTROLS_BY_ID = new Map<string, Control>();

type CatalogDisplayState =
  | { kind: 'loading' }
  | { kind: 'error'; error: string }
  | { kind: 'notFound' }
  | { kind: 'content'; catalog: Catalog };

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
  const hasOwnScrollArea = useMediaQuery(OWN_SCROLL_AREA_QUERY);
  const [filterCollapsed, setFilterCollapsed] = useState(false);
  const [mobileSelectMode, setMobileSelectMode] = useState(false);
  const {
    size: detailWidth,
    isResizing,
    setSize: setDetailWidth,
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
  // Renderentscheidung und Listenbereitschaft teilen dieselbe Ansichtspriorität.
  let displayState: CatalogDisplayState;
  if (loading) {
    displayState = { kind: 'loading' };
  } else if (error) {
    displayState = { kind: 'error', error };
  } else if (routeNotFound || !catalog) {
    displayState = { kind: 'notFound' };
  } else {
    displayState = { kind: 'content', catalog };
  }
  const selectionScopeId =
    catalog?.catalogKey ?? catalogKey ?? '__unknown_catalog__';
  // Unterhalb `md` scrollt das Dokument: Das Detail ersetzt dort die Liste als
  // Seite, statt als Overlay mit eigenem Scrollbereich darüber zu liegen (GSPP-447).
  const showDetailAsPage = !hasOwnScrollArea && selectedControl !== null;
  // Aktiv auch beim Laden; Bereich aus der Route, die dem Katalogwechsel vorausgeht.
  useDocumentDetailPage({
    enabled: !hasOwnScrollArea,
    controlId: selectedControl?.id ?? null,
    scopeKey: `${catalogKey ?? selectionScopeId}:${scopeId ?? ''}`,
    listReady: displayState.kind === 'content',
    onClose: closeDetail,
  });
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
    // S7754: Existenzprüfung — das gefundene Practice-Objekt wird nicht verwendet.
    const hasPractice = catalog.practices.some((item) => item.id === scopeId);
    return hasPractice
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
  const clearFilters = useCallback(() => setFilters(emptyFilters), [setFilters]);
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

  const scopeTitle = useMemo(() => describeCatalogScope(catalog, scopeId), [catalog, scopeId]);

  if (displayState.kind === 'loading') {
    return (
      <>
        <PageTitle title={PAGE_TITLES.catalog} />
        <div className="flex-1 flex items-center justify-center min-h-[50vh]">
          <div className="text-center">
            <div className="inline-block w-6 h-6 border-2 border-[var(--color-border-strong)] border-t-[var(--color-primary-main)] rounded-full animate-spin" />
            <p className="text-sm text-[var(--color-text-secondary)] mt-3">
              Katalog wird geladen…
            </p>
          </div>
        </div>
      </>
    );
  }

  if (displayState.kind === 'error') {
    return (
      <>
        <PageTitle title={PAGE_TITLES.catalog} />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <p className="text-red-600 font-medium">Fehler beim Laden</p>
            <p className="text-sm text-red-500 mt-1">{displayState.error}</p>
          </div>
        </div>
      </>
    );
  }

  if (displayState.kind === 'notFound') {
    return (
      <>
        <PageTitle title={PAGE_TITLES.catalogTargetNotFound} />
        <CatalogTargetNotFound catalog={catalog} />
      </>
    );
  }

  const contentCatalog = displayState.catalog;
  // Titelpriorität: Kontrolle vor Gruppe vor Katalogwurzel. Alle Bestandteile
  // stammen aus aufgelösten Domain-Daten, nie aus rohen URL-Segmenten.
  let pageTitle: string;
  if (selectedControl) {
    pageTitle = `${selectedControl.id} — ${selectedControl.title} — ${contentCatalog.metadata.title}`;
  } else if (scopeId) {
    pageTitle = `${scopeTitle.documentTitle} — ${contentCatalog.metadata.title}`;
  } else {
    pageTitle = contentCatalog.metadata.title;
  }

  const controlsById = contentCatalog.controlsById ?? EMPTY_CONTROLS_BY_ID;
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
    <>
      <PageTitle title={pageTitle} />
      <div className="flex-1 min-w-0 flex flex-col md:overflow-hidden">
        {/*
          Als Seite geöffnetes Detail: Liste und Toolbar bleiben gemountet (Auswahl,
          Filter, Zeilenzustand), sind aber per `hidden` verborgen; nur die mobilen
          Sheets baut die Toolbar ab, damit keines unsichtbar die Seite sperrt.
        */}
        <div hidden={showDetailAsPage} className="flex-1 min-w-0 flex flex-col md:overflow-hidden">
          <CatalogToolbar
            title={scopeTitle.heading}
            filteredCount={filtered.length}
            totalCount={totalCount}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
            checkedIds={checkedIds}
            mobileSelectMode={mobileSelectMode}
            onToggleMobileSelectMode={toggleMobileSelection}
            onClearSelection={clearSelection}
            filteredControls={filtered}
            allControls={contentCatalog.controls}
            sectionFilename={`grundschutz-${scopeId ?? 'katalog'}.csv`}
            filterPanelProps={filterPanelProps}
            isDesktop={isDesktop}
            mobileSheetsSuspended={showDetailAsPage}
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
              <CatalogMobileList
                controls={filtered}
                controlsById={controlsById}
                allControls={contentCatalog.controls}
                hasOwnScrollArea={hasOwnScrollArea}
                selectMode={mobileSelectMode}
                checkedIds={checkedIds}
                onSelect={selectControl}
                onCheckedChange={handleMobileCheckedChange}
                onSelectionDone={finishMobileSelection}
              />
            )}

            <CatalogDesktopSidebar
              catalog={contentCatalog}
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
        </div>

        {showDetailAsPage && selectedControl && (
          <CatalogDetailPage
            key={`${contentCatalog.catalogKey}:${selectedControl.id}`}
            catalog={contentCatalog}
            control={selectedControl}
            onClose={closeDetail}
            onNavigateToControl={navigateToControl}
          />
        )}

        {/* GSPP-268, bewusste Ausnahme: rendert inaktiv bereits null und besitzt
          seinen Modal-Lifecycle selbst (GSPP-188) — ein parent-Gate brächte keinen Mount-Gewinn. */}
        <CatalogMobileDetailOverlay
          catalog={contentCatalog}
          control={selectedControl}
          active={!!selectedControl && !isDesktop && hasOwnScrollArea}
          onClose={closeDetail}
          onNavigateToControl={navigateToControl}
        />
      </div>
    </>
  );
}
