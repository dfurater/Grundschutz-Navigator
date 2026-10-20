import { useCallback, useMemo, useState } from 'react';
import { useRowWindow } from '@/hooks/useRowWindow';
import type { Control } from '@/domain/models';
import { useOverlayScrollbars } from '@/hooks/useOverlayScrollbars';
import { CatalogMobileSelectionBar } from './CatalogMobileSelectionBar';
import { ControlMobileReferenceRow } from './ControlMobileReferenceRow';

interface CatalogMobileListProps {
  readonly controls: Control[];
  readonly controlsById: Map<string, Control>;
  readonly allControls: Control[];
  /** Ab `md` scrollt die Liste selbst, darunter das Dokument. */
  readonly hasOwnScrollArea: boolean;
  readonly selectMode: boolean;
  readonly checkedIds: ReadonlySet<string>;
  readonly onSelect: (control: Control) => void;
  readonly onCheckedChange: (control: Control, checked: boolean) => void;
  readonly onSelectionDone: () => void;
}

/** Trefferliste des Katalogs außerhalb des Desktops mit optionalem Auswahlmodus. */
export function CatalogMobileList({
  controls,
  controlsById,
  allControls,
  hasOwnScrollArea,
  selectMode,
  checkedIds,
  onSelect,
  onCheckedChange,
  onSelectionDone,
}: CatalogMobileListProps) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const pinnedIndex = useMemo(
    () => controls.findIndex((control) => control.id === focusedId),
    [controls, focusedId],
  );
  const onRowFocus = useCallback((control: Control) => setFocusedId(control.id), []);
  const { scrollRef, onScroll, rowHeight, slots } = useRowWindow({
    rowCount: controls.length,
    pinnedIndex,
    scrollsDocument: !hasOwnScrollArea,
    estimatedRowHeight: 88,
    overscan: 10,
    fallbackVisibleRowCount: 12,
    rowIndexAttribute: 'data-row-index',
  });
  const overlayScrollbarsRef = useOverlayScrollbars<HTMLDivElement>(hasOwnScrollArea);
  const setScrollElement = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    const cleanup = overlayScrollbarsRef(element);
    return () => {
      scrollRef.current = null;
      if (typeof cleanup === 'function') cleanup();
    };
  }, [overlayScrollbarsRef, scrollRef]);
  return (
    <div className="desktop:hidden flex-1 min-w-0 flex flex-col md:overflow-hidden">
      <div ref={setScrollElement} onScroll={onScroll} className={`flex-1 md:overflow-y-auto ${selectMode ? 'pb-safe-selection' : 'pb-safe'}`}>
        {slots.map((slot) => {
          if (slot.kind === 'spacer') {
            return <div key={slot.key} aria-hidden="true" style={{ height: slot.rowCount * rowHeight }} />;
          }
          const control = controls[slot.index];
          return (
            <ControlMobileReferenceRow
              key={control.id}
              control={control}
              rowIndex={slot.index}
              onFocus={onRowFocus}
              controlsById={controlsById}
              selectMode={selectMode}
              checked={checkedIds.has(control.id)}
              onSelect={onSelect}
              onCheckedChange={onCheckedChange}
            />
          );
        })}
        {controls.length === 0 && (
          <p className="text-sm text-[var(--color-text-secondary)] text-center py-8">
            Keine Kontrollen gefunden
          </p>
        )}
      </div>
      {selectMode && (
        <CatalogMobileSelectionBar
          checkedIds={checkedIds}
          allControls={allControls}
          onDone={onSelectionDone}
        />
      )}
    </div>
  );
}
