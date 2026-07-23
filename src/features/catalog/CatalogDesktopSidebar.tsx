import type { MouseEventHandler } from 'react';
import type { Catalog, Control } from '@/domain/models';
import { IconChevronLeft, IconFilter } from '@/components/icons';
import { FilterPanel, type FilterPanelProps } from './FilterPanel';
import { CatalogDetailPanel } from './CatalogDetailPanel';

const FILTER_PANEL_WIDTH = 288;
const FILTER_COLLAPSED_WIDTH = 44;

interface CatalogDesktopSidebarProps {
  catalog: Catalog;
  selectedControl: Control | null;
  detailWidth: number;
  detailMinWidth: number;
  detailMaxWidth: number;
  isResizing: boolean;
  onResizeStart: MouseEventHandler;
  onDetailWidthChange: (update: (width: number) => number) => void;
  onCloseDetail: () => void;
  onNavigateToControl: (control: Control) => void;
  filterCollapsed: boolean;
  onFilterCollapsedChange: (collapsed: boolean) => void;
  hasActiveFilters: boolean;
  filterPanelProps: FilterPanelProps;
}

export function CatalogDesktopSidebar({
  catalog,
  selectedControl,
  detailWidth,
  detailMinWidth,
  detailMaxWidth,
  isResizing,
  onResizeStart,
  onDetailWidthChange,
  onCloseDetail,
  onNavigateToControl,
  filterCollapsed,
  onFilterCollapsedChange,
  hasActiveFilters,
  filterPanelProps,
}: CatalogDesktopSidebarProps) {
  return (
    <aside
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
        transition: isResizing
          ? 'none'
          : 'width var(--duration-normal) var(--easing-default)',
      }}
    >
      {selectedControl && (
        <div
          className="resize-handle absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-20"
          onMouseDown={onResizeStart}
          role="separator"
          aria-orientation="vertical"
          aria-label="Panelbreite anpassen"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              onDetailWidthChange((width) =>
                Math.min(detailMaxWidth, width + 20),
              );
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault();
              onDetailWidthChange((width) =>
                Math.max(detailMinWidth, width - 20),
              );
            }
          }}
        />
      )}

      {selectedControl ? (
        <div
          key={`${catalog.catalogKey}:${selectedControl.id}`}
          className="animate-panel-in flex-1 min-w-0"
        >
          <CatalogDetailPanel
            catalog={catalog}
            control={selectedControl}
            onClose={onCloseDetail}
            onNavigateToControl={onNavigateToControl}
          />
        </div>
      ) : filterCollapsed ? (
        <div className="flex flex-col items-center py-4 w-full">
          <button
            type="button"
            onClick={() => onFilterCollapsedChange(false)}
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
          {...filterPanelProps}
          onCollapse={() => onFilterCollapsedChange(true)}
        />
      )}
    </aside>
  );
}
