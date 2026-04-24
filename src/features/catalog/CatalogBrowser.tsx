import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCatalog } from '@/hooks/useCatalog';
import {
  useFilteredControls,
  emptyFilters,
} from '@/hooks/useFilteredControls';
import { useFilterParams } from '@/hooks/useFilterParams';
import { FilterPanel } from './FilterPanel';
import { ControlTable } from './ControlTable';
import { ControlDetail } from './ControlDetail';
import { Button } from '@/components/Button';
import { IconDownload, IconFilter, IconX, IconChevronDown, IconChevronLeft, IconCheck } from '@/components/icons';
import { ControlMobileReferenceRow } from './ControlMobileReferenceRow';
import { downloadCSV } from '@/features/export/csvExport';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import type { Control } from '@/domain/models';
import { buildChildControlMap, buildIncomingLinkMap } from '@/domain/controlRelationships';

const FILTER_PANEL_WIDTH = 288;        // w-72
const FILTER_COLLAPSED_WIDTH = 44;
const DETAIL_DEFAULT_WIDTH = 420;
const DETAIL_MIN_WIDTH = 320;
const DETAIL_MAX_WIDTH = 720;
const EMPTY_CHECKED_IDS = new Set<string>();


export function CatalogBrowser() {
  const { groupId } = useParams<{ groupId?: string }>();
  const navigate = useNavigate();
  const { catalog, loading, error } = useCatalog();

  const { filters, setFilters, sort, setSort, searchString } = useFilterParams();
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [filterCollapsed, setFilterCollapsed] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [mobileExportOpen, setMobileExportOpen] = useState(false);
  const [mobileSelectMode, setMobileSelectMode] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Focus trap refs for mobile overlays
  const mobileFilterRef = useRef<HTMLElement>(null);
  const mobileExportRef = useRef<HTMLDivElement>(null);
  const mobileDetailRef = useRef<HTMLDivElement>(null);

  // Ref for first export menu item (auto-focus on open)
  const firstMenuItemRef = useRef<HTMLButtonElement>(null);

  // Drag-to-dismiss refs for mobile filter sheet
  const filterBackdropRef = useRef<HTMLDivElement>(null);
  const filterHandleRef = useRef<HTMLDivElement>(null);

  // Native touch listeners directly on the drag handle.
  // Attaching to the handle (which has touch-action: none) avoids conflicts with
  // the filter scroll area's touch-action: pan-y. Using { passive: false } on
  // touchmove allows e.preventDefault(), which is critical on iOS Safari where
  // React synthetic events are passive and can't prevent the browser from
  // hijacking the gesture.
  useEffect(() => {
    const handle = filterHandleRef.current;
    const sheet = mobileFilterRef.current;
    if (!handle || !sheet || !showMobileFilters) return;

    let startY = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let delta = 0;

    const onTouchStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      lastY = startY;
      lastTime = Date.now();
      velocity = 0;
      delta = 0;
      sheet.style.transition = 'none';
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault(); // stop iOS from capturing the gesture

      const currentY = e.touches[0].clientY;
      const now = Date.now();
      delta = currentY - startY;

      const dt = now - lastTime;
      if (dt > 0) velocity = (currentY - lastY) / dt * 1000;
      lastY = currentY;
      lastTime = now;

      // Rubber-band resistance when dragging upward, free when dragging down
      const visual = delta > 0 ? delta : delta * 0.12;
      sheet.style.transform = `translateY(${visual}px)`;

      // Fade backdrop proportionally
      const bd = filterBackdropRef.current;
      if (bd) {
        const h = sheet.offsetHeight;
        const fade = delta > 0 ? Math.min(delta / h, 1) : 0;
        bd.style.opacity = String(Math.max(0, 0.3 * (1 - fade)));
      }
    };

    const onTouchEnd = () => {
      const h = sheet.offsetHeight;
      const dismiss = (velocity > 400 && delta > 20) || delta > h * 0.3;

      if (dismiss) {
        sheet.style.transition = 'transform var(--duration-normal) var(--easing-default)';
        sheet.style.transform = `translateY(${h}px)`;
        const bd = filterBackdropRef.current;
        if (bd) { bd.style.transition = 'opacity var(--duration-normal) var(--easing-default)'; bd.style.opacity = '0'; }
        setTimeout(() => setShowMobileFilters(false), 200);
      } else {
        sheet.style.transition = 'transform var(--duration-normal) var(--easing-default)';
        sheet.style.transform = '';
        const bd = filterBackdropRef.current;
        if (bd) { bd.style.transition = 'opacity var(--duration-normal) var(--easing-default)'; bd.style.opacity = '0.3'; }
      }
    };

    handle.addEventListener('touchstart', onTouchStart, { passive: true });
    handle.addEventListener('touchmove', onTouchMove, { passive: false });
    handle.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      handle.removeEventListener('touchstart', onTouchStart);
      handle.removeEventListener('touchmove', onTouchMove);
      handle.removeEventListener('touchend', onTouchEnd);
    };
  }, [showMobileFilters]);

  // Resizable detail panel
  const [detailWidth, setDetailWidth] = useState(DETAIL_DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const asideRef = useRef<HTMLElement>(null);

  // URL-driven control selection:
  // groupId can be a practice ("BES"), topic ("BES.1"), or control ("BES.1.1.1")
  const selectedControl = useMemo<Control | null>(() => {
    if (!catalog || !groupId) return null;
    return catalog.controlsById.get(groupId) ?? null;
  }, [catalog, groupId]);

  // Resolve the table scope: if URL points to a control, scope to its topic
  const scopeId = useMemo(() => {
    if (!groupId) return undefined;
    if (selectedControl) return selectedControl.groupId;
    return groupId;
  }, [groupId, selectedControl]);
  const selectionScopeKey = scopeId ?? '__all__';
  const [selectionState, setSelectionState] = useState(() => ({
    scopeKey: selectionScopeKey,
    checkedIds: EMPTY_CHECKED_IDS,
  }));
  const checkedIds =
    selectionState.scopeKey === selectionScopeKey
      ? selectionState.checkedIds
      : EMPTY_CHECKED_IDS;
  const setCheckedIds = useCallback(
    (next: Set<string>) => {
      setSelectionState(() => {
        return {
          scopeKey: selectionScopeKey,
          checkedIds: next.size > 0 ? next : EMPTY_CHECKED_IDS,
        };
      });
    },
    [selectionScopeKey],
  );

  // Remember the browse scope (practice/topic chosen via tree nav)
  // so "close" returns to the right level, not the control's topic
  const browseScopeRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (catalog && groupId && !catalog.controlsById.has(groupId)) {
      browseScopeRef.current = groupId;
    }
  }, [catalog, groupId]);

  // Close export dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    }
    if (exportMenuOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [exportMenuOpen]);

  // Auto-focus first export menu item when dropdown opens
  useEffect(() => {
    if (exportMenuOpen) firstMenuItemRef.current?.focus();
  }, [exportMenuOpen]);

  // Focus traps for mobile overlays
  useFocusTrap(mobileFilterRef, showMobileFilters);
  useFocusTrap(mobileExportRef as React.RefObject<HTMLElement | null>, mobileExportOpen);
  useFocusTrap(mobileDetailRef as React.RefObject<HTMLElement | null>, !!selectedControl);

  // Scroll lock: prevent background scroll when mobile overlays are open
  useEffect(() => {
    const anyOverlayOpen = showMobileFilters || mobileExportOpen || !!selectedControl;
    if (anyOverlayOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => { document.body.style.overflow = ''; };
  }, [showMobileFilters, mobileExportOpen, selectedControl]);

  // Drag-to-resize handler
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    document.body.classList.add('is-resizing');

    const startX = e.clientX;
    const startWidth = detailWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.min(DETAIL_MAX_WIDTH, Math.max(DETAIL_MIN_WIDTH, startWidth + delta));
      setDetailWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.classList.remove('is-resizing');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [detailWidth]);

  // Reset filters/sort when the table scope changes and the URL is clean.
  // Filter-driven navigation with explicit query params still keeps its state.
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

  // Scope controls to resolved scope (practice or topic)
  const scopedControls = useMemo(() => {
    if (!catalog) return [];
    if (!scopeId) return catalog.controls;
    const practice = catalog.practices.find((p) => p.id === scopeId);
    if (practice) return catalog.controls.filter((c) => c.practiceId === scopeId);
    return catalog.controls.filter((c) => c.groupId === scopeId);
  }, [catalog, scopeId]);

  const incomingLinksByTarget = useMemo(
    () => buildIncomingLinkMap(catalog?.controls ?? []),
    [catalog],
  );
  const childControlsByParentId = useMemo(
    () => buildChildControlMap(catalog?.controls ?? []),
    [catalog],
  );

  const { filtered, totalCount, facetCounts, filteredFacetCounts, hasActiveFilters } =
    useFilteredControls(scopedControls, filters, sort);

  const clearFilters = useCallback(() => setFilters(emptyFilters), [setFilters]);

  // Select control → push so browser back returns to list
  const handleSelectControl = useCallback((control: Control) => {
    if (selectedControl?.id === control.id) {
      const target = browseScopeRef.current ?? scopeId;
      navigate({ pathname: `/katalog/${target}`, search: searchString });
    } else {
      navigate({ pathname: `/katalog/${control.id}`, search: searchString });
    }
  }, [selectedControl, scopeId, navigate, searchString]);

  // Close detail → replace (undo the open, so back goes to original list)
  const handleCloseDetail = useCallback(() => {
    const target = browseScopeRef.current ?? scopeId;
    navigate({ pathname: `/katalog/${target}`, search: searchString }, { replace: true });
  }, [scopeId, navigate, searchString]);

  // Navigate to related control → replace (swap control, same history depth)
  const handleNavigateToControl = useCallback((controlId: string) => {
    navigate({ pathname: `/katalog/${controlId}`, search: searchString }, { replace: true });
  }, [navigate, searchString]);

  // Export selected rows (only checked)
  const handleExportSelected = useCallback(() => {
    const toExport = filtered.filter((c) => checkedIds.has(c.id));
    downloadCSV(toExport, `grundschutz-auswahl.csv`);
    setExportMenuOpen(false);
  }, [checkedIds, filtered]);

  // Export current section (scoped + filtered)
  const handleExportSection = useCallback(() => {
    downloadCSV(filtered, `grundschutz-${scopeId ?? 'katalog'}.csv`);
    setExportMenuOpen(false);
  }, [filtered, scopeId]);

  // Export entire catalog
  const handleExportAll = useCallback(() => {
    if (catalog) downloadCSV(catalog.controls, 'grundschutz-gesamtkatalog.csv');
    setExportMenuOpen(false);
  }, [catalog]);

  const clearChecked = useCallback(() => setCheckedIds(new Set()), [setCheckedIds]);

  // Title from resolved scope
  const currentTitle = useMemo(() => {
    if (!catalog || !scopeId) return 'Alle Kontrollen';
    const practice = catalog.practices.find((p) => p.id === scopeId);
    if (practice) return `${practice.label} — ${practice.title}`;
    for (const p of catalog.practices) {
      const topic = p.topics.find((t) => t.id === scopeId);
      if (topic) return `${scopeId} — ${topic.title}`;
    }
    return scopeId;
  }, [catalog, scopeId]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <div className="inline-block w-6 h-6 border-2 border-[var(--color-border-strong)] border-t-[var(--color-primary-main)] rounded-full animate-spin" />
          <p className="text-sm text-[var(--color-text-secondary)] mt-3">Katalog wird geladen…</p>
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

  return (
    <div className="flex-1 min-w-0 flex flex-col md:overflow-hidden">
      {/* Toolbar */}
      <div className="px-3 py-1.5 md:py-0 md:h-[51px] md:flex md:items-center border-b border-[var(--color-border-default)] bg-[var(--color-surface-base)] sticky top-14 z-10 md:static md:z-auto">
        <div className="w-full flex items-center justify-between gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-base font-bold text-[var(--color-text-primary)] truncate">
              {currentTitle}
            </h1>
            <span className="hidden sm:inline text-xs text-[var(--color-text-secondary)] whitespace-nowrap tabular-nums" aria-live="polite" aria-atomic="true">
              {filtered.length}{filtered.length < totalCount ? ` / ${totalCount}` : ''} Kontrollen
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Selection indicator + clear */}
            {checkedIds.size > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent-default)] bg-[var(--color-accent-soft)] px-2 py-1 rounded">
                {checkedIds.size} ausgewählt
                <button
                  type="button"
                  onClick={clearChecked}
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
              onClick={() => {
                setMobileSelectMode((v) => !v);
                if (mobileSelectMode) setCheckedIds(new Set());
              }}
              aria-label={mobileSelectMode ? 'Auswahl beenden' : 'Kontrollen auswählen'}
              aria-pressed={mobileSelectMode}
            >
              <IconCheck className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden min-h-[44px] min-w-[44px]"
              onClick={() => setShowMobileFilters(true)}
              aria-label="Filter anzeigen"
            >
              <IconFilter className="w-4 h-4" />
            </Button>

          {/* Split export button */}
          <div className="hidden lg:flex relative" ref={exportMenuRef}>
            {/* Main action: export selected or section */}
            <Button
              variant="secondary"
              size="sm"
              onClick={checkedIds.size > 0 ? handleExportSelected : handleExportSection}
              disabled={filtered.length === 0}
              className="rounded-r-none border-r border-[var(--color-border-strong)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <IconDownload className="w-4 h-4 mr-1.5" />
              {checkedIds.size > 0 ? `Export (${checkedIds.size})` : 'CSV Export'}
            </Button>
            {/* Dropdown trigger */}
            <button
              type="button"
              onClick={() => setExportMenuOpen((v) => !v)}
              className="px-2 py-1.5 text-sm font-medium border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)] rounded-r-md transition-colors border-l-0"
              aria-label="Weitere Exportoptionen"
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
            >
              <IconChevronDown className="w-3.5 h-3.5" />
            </button>

            {/* Dropdown menu */}
            {exportMenuOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-56 bg-[var(--color-surface-raised)] border border-[var(--color-border-default)] rounded-lg shadow-[var(--shadow-overlay)] z-50 py-1"
                role="menu"
                aria-label="Exportoptionen"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setExportMenuOpen(false); }
                }}
              >
                {checkedIds.size > 0 && (
                  <button
                    ref={firstMenuItemRef}
                    type="button"
                    role="menuitem"
                    onClick={handleExportSelected}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-surface-subtle)] flex items-center gap-2"
                  >
                    <IconDownload className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                    <span>Auswahl exportieren <span className="text-[var(--color-text-secondary)]">({checkedIds.size})</span></span>
                  </button>
                )}
                {filtered.length < (catalog?.totalControls ?? 0) && (
                  <>
                    <button
                      ref={checkedIds.size === 0 ? firstMenuItemRef : undefined}
                      type="button"
                      role="menuitem"
                      onClick={handleExportSection}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-surface-subtle)] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:text-[var(--color-text-muted)]"
                      disabled={filtered.length === 0}
                    >
                      <IconDownload className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                      <span>Aktuelle Ansicht <span className="text-[var(--color-text-secondary)]">({filtered.length})</span></span>
                    </button>
                    <div className="border-t border-[var(--color-border-subtle)] my-1" />
                  </>
                )}
                <button
                  ref={checkedIds.size === 0 && filtered.length >= (catalog?.totalControls ?? 0) ? firstMenuItemRef : undefined}
                  type="button"
                  role="menuitem"
                  onClick={handleExportAll}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-surface-subtle)] flex items-center gap-2"
                >
                  <IconDownload className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                  <span>Gesamtkatalog <span className="text-[var(--color-text-secondary)]">({catalog?.totalControls ?? 0})</span></span>
                </button>
              </div>
            )}
          </div>

          {/* Mobile export button */}
          <Button
            variant="secondary"
            size="sm"
            className="lg:hidden min-h-[44px]"
            onClick={() => setMobileExportOpen(true)}
            disabled={filtered.length === 0}
          >
            <IconDownload className="w-4 h-4 mr-1.5" />
            CSV
          </Button>
          </div>
        </div>

        {/* Mobile count + filter status row */}
        <div className="sm:hidden flex items-center justify-between mt-1.5">
          <span className="text-xs text-[var(--color-text-secondary)] tabular-nums" aria-live="polite" aria-atomic="true">
            {filtered.length === totalCount
              ? `${totalCount} Kontrollen`
              : `${filtered.length} von ${totalCount}`}
          </span>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="Filter zurücksetzen"
            >
              Filter zurücksetzen
            </button>
          )}
        </div>
      </div>

      {/* Content: Table + Right Panel */}
      <div className="flex-1 min-w-0 flex md:overflow-hidden">
        {/* Desktop table */}
        <div className="hidden lg:flex flex-1 flex-col overflow-hidden">
          <ControlTable
            controls={filtered}
            controlsById={catalog?.controlsById ?? new Map()}
            selectedControlId={selectedControl?.id}
            checkedIds={checkedIds}
            sort={sort}
            onSortChange={setSort}
            onSelectControl={handleSelectControl}
            onCheckedChange={setCheckedIds}
          />
        </div>

        {/* Mobile card list */}
        <div className="lg:hidden flex-1 min-w-0 flex flex-col md:overflow-hidden">
          <div className={`flex-1 md:overflow-y-auto divide-y divide-[var(--color-border-subtle)] ${mobileSelectMode ? 'pb-[calc(7rem+env(safe-area-inset-bottom,0px))]' : 'pb-safe'}`}>
            {filtered.map((control) => (
              <ControlMobileReferenceRow
                key={control.id}
                control={control}
                controlsById={catalog?.controlsById ?? new Map()}
                selectMode={mobileSelectMode}
                checked={checkedIds.has(control.id)}
                onSelect={handleSelectControl}
                onCheckedChange={(ctrl, isChecked) => {
                  const next = new Set(checkedIds);
                  if (isChecked) next.add(ctrl.id); else next.delete(ctrl.id);
                  setCheckedIds(next);
                }}
              />
            ))}
            {filtered.length === 0 && (
              <p className="text-sm text-[var(--color-text-secondary)] text-center py-8">Keine Kontrollen gefunden</p>
            )}
          </div>

          {/* Mobile select-mode action bar — fixed above bottom nav */}
          {mobileSelectMode && (
            <div className="fixed bottom-0 pb-safe inset-x-0 z-30 border-t border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-3 py-2.5 flex items-center gap-2 lg:hidden shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
              <span className="text-sm text-[var(--color-text-secondary)] flex-1 tabular-nums">
                {checkedIds.size > 0 ? `${checkedIds.size} ausgewählt` : 'Tippen zum Auswählen'}
              </span>
              <Button
                variant="secondary"
                size="sm"
                className="min-h-[44px]"
                disabled={checkedIds.size === 0}
                onClick={() => { handleExportSelected(); setMobileSelectMode(false); setCheckedIds(new Set()); }}
              >
                <IconDownload className="w-4 h-4 mr-1.5" />
                Export ({checkedIds.size})
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-[44px]"
                onClick={() => { setMobileSelectMode(false); setCheckedIds(new Set()); }}
              >
                Fertig
              </Button>
            </div>
          )}
        </div>

        {/* Right Panel: Filter OR Detail (desktop) */}
        <aside
          ref={asideRef}
          className={`hidden lg:flex border-l border-[var(--color-border-default)] shrink-0 relative overflow-hidden ${
            selectedControl
              ? 'bg-[var(--color-surface-raised)] shadow-[var(--shadow-sm)]'
              : 'bg-[var(--color-surface-subtle)]'
          }`}
          style={{
            width: selectedControl
              ? detailWidth
              : filterCollapsed
                ? FILTER_COLLAPSED_WIDTH
                : FILTER_PANEL_WIDTH,
            transition: isResizing ? 'none' : 'width var(--duration-normal) var(--easing-default)',
          }}
        >
          {/* Resize handle — only when detail panel is open */}
          {selectedControl && (
            <div
              className="resize-handle absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-20"
              onMouseDown={handleResizeStart}
              role="separator"
              aria-orientation="vertical"
              aria-label="Panelbreite anpassen"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') { e.preventDefault(); setDetailWidth((w) => Math.min(DETAIL_MAX_WIDTH, w + 20)); }
                if (e.key === 'ArrowRight') { e.preventDefault(); setDetailWidth((w) => Math.max(DETAIL_MIN_WIDTH, w - 20)); }
              }}
            />
          )}

          {selectedControl ? (
            <div
              key={selectedControl.id}
              className="animate-panel-in flex-1 min-w-0"
            >
                <ControlDetail
                  control={selectedControl}
                  controlsById={catalog?.controlsById}
                  incomingLinks={incomingLinksByTarget.get(selectedControl.id) ?? []}
                  parentControl={selectedControl.parentId ? catalog?.controlsById.get(selectedControl.parentId) : undefined}
                  childControls={childControlsByParentId.get(selectedControl.id) ?? []}
                  onClose={handleCloseDetail}
                  onNavigateToControl={handleNavigateToControl}
              />
            </div>
          ) : filterCollapsed ? (
            <div className="flex flex-col items-center py-4 w-full">
              <button
                type="button"
                onClick={() => setFilterCollapsed(false)}
                className="relative p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-base)] rounded transition-colors"
                aria-label="Filter einblenden"
                title="Filter einblenden"
              >
                <IconChevronLeft className="w-4 h-4" />
              </button>
              <div
                className="relative p-2 text-[var(--color-text-muted)] mt-1"
                aria-hidden="true"
              >
                <IconFilter className="w-4 h-4" />
                {hasActiveFilters && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[var(--color-accent-default)] rounded-full" />
                )}
              </div>
            </div>
          ) : (
            <FilterPanel
              filters={filters}
              facetCounts={facetCounts}
              filteredFacetCounts={filteredFacetCounts}
              hasActiveFilters={hasActiveFilters}
              filteredCount={filtered.length}
              totalCount={totalCount}
              onFiltersChange={setFilters}
              onClearFilters={clearFilters}
              onCollapse={() => setFilterCollapsed(true)}
            />
          )}
        </aside>

        {/* Mobile filter overlay */}
        {showMobileFilters && (
          <>
            <div
              ref={filterBackdropRef}
              className="fixed inset-0 bg-black z-40 lg:hidden"
              style={{ opacity: 0.3 }}
              onClick={() => setShowMobileFilters(false)}
              aria-hidden="true"
            />
            <aside
              ref={mobileFilterRef}
              className="fixed inset-x-0 bottom-0 z-50 bg-[var(--color-surface-raised)] rounded-t-2xl shadow-xl max-h-[80dvh] flex flex-col overflow-hidden lg:hidden animate-slide-up"
              onKeyDown={(e) => { if (e.key === 'Escape') setShowMobileFilters(false); }}
            >
              {/* Drag handle — 44px touch target, native listeners via useEffect */}
              <div
                ref={filterHandleRef}
                className="flex justify-center items-center min-h-[44px] shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
                aria-hidden="true"
              >
                <div className="w-10 h-1 bg-[var(--color-border-strong)] rounded-full" />
              </div>
              <FilterPanel
                filters={filters}
                facetCounts={facetCounts}
                filteredFacetCounts={filteredFacetCounts}
                hasActiveFilters={hasActiveFilters}
                filteredCount={filtered.length}
                totalCount={totalCount}
                onFiltersChange={setFilters}
                onClearFilters={clearFilters}
              />
            </aside>
          </>
        )}

        {/* Mobile export bottom sheet */}
        {mobileExportOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/30 z-40 lg:hidden"
              onClick={() => setMobileExportOpen(false)}
              aria-hidden="true"
            />
            <div
              ref={mobileExportRef}
              className="fixed inset-x-0 bottom-0 z-50 bg-[var(--color-surface-raised)] rounded-t-2xl shadow-xl flex flex-col overflow-hidden lg:hidden animate-slide-up"
              onKeyDown={(e) => { if (e.key === 'Escape') setMobileExportOpen(false); }}
            >
              {/* Drag handle — 44px touch target, gleiche Grammatik wie Filter-Sheet */}
              <div
                className="flex justify-center items-center min-h-[44px] shrink-0 select-none"
                aria-hidden="true"
              >
                <div className="w-10 h-1 bg-[var(--color-border-strong)] rounded-full" />
              </div>
              {/* Header — gleiche Grammatik wie FilterPanel */}
              <div className="px-4 py-3 border-b border-[var(--color-border-default)] shrink-0">
                <h3 className="type-meta">Exportieren als CSV</h3>
              </div>
              <div className="p-4 flex flex-col gap-2">
                {checkedIds.size > 0 && (
                  <Button variant="secondary" className="w-full min-h-[44px] justify-start"
                          onClick={() => {
                            handleExportSelected();
                            setMobileExportOpen(false);
                            setMobileSelectMode(false);
                            setCheckedIds(new Set());
                          }}>
                    <IconDownload className="w-4 h-4 mr-2" />
                    Auswahl exportieren ({checkedIds.size})
                  </Button>
                )}
                <Button variant="secondary" className="w-full min-h-[44px] justify-start"
                        disabled={filtered.length === 0}
                        onClick={() => { handleExportSection(); setMobileExportOpen(false); }}>
                  <IconDownload className="w-4 h-4 mr-2" />
                  Aktuelle Ansicht ({filtered.length})
                </Button>
                <Button variant="ghost" className="w-full min-h-[44px] justify-start"
                        onClick={() => { handleExportAll(); setMobileExportOpen(false); }}>
                  <IconDownload className="w-4 h-4 mr-2" />
                  Gesamtkatalog ({catalog?.totalControls ?? 0})
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Mobile detail panel */}
      {selectedControl && (
        <div
          ref={mobileDetailRef}
          className="fixed inset-0 z-50 lg:hidden flex flex-col bg-[var(--color-surface-raised)]"
          onKeyDown={(e) => { if (e.key === 'Escape') handleCloseDetail(); }}
        >
                  <ControlDetail
                    control={selectedControl}
                    controlsById={catalog?.controlsById}
                    incomingLinks={incomingLinksByTarget.get(selectedControl.id) ?? []}
                    parentControl={selectedControl.parentId ? catalog?.controlsById.get(selectedControl.parentId) : undefined}
                    childControls={childControlsByParentId.get(selectedControl.id) ?? []}
                    onClose={handleCloseDetail}
                    onNavigateToControl={handleNavigateToControl}
          />
        </div>
      )}
    </div>
  );
}
