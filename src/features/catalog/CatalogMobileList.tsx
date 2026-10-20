import { useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { useRowWindow } from '@/hooks/useRowWindow';
import type { Control } from '@/domain/models';
import { useOverlayScrollbars } from '@/hooks/useOverlayScrollbars';
import { CatalogMobileSelectionBar } from './CatalogMobileSelectionBar';
import { ControlMobileReferenceRow } from './ControlMobileReferenceRow';

export interface CatalogMobileListHandle {
  focusControl: (controlId: string) => boolean;
}

interface CatalogMobileListProps {
  readonly ref?: Ref<CatalogMobileListHandle>;
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
  ref,
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
  const pendingFocusRef = useRef<{ id: string; checkbox: boolean } | null>(null);
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
  const requestRowFocus = useCallback((id: string, checkbox = false) => {
    pendingFocusRef.current = null;
    const index = controls.findIndex((control) => control.id === id);
    if (index < 0) return false;
    const target = scrollRef.current?.querySelector<HTMLElement>(
      `[data-row-index="${index}"] ${checkbox ? 'input' : 'button'}`,
    );
    if (target) {
      target.focus();
      return true;
    }
    pendingFocusRef.current = { id, checkbox };
    setFocusedId(id);
    return true;
  }, [controls, scrollRef]);
  useImperativeHandle(ref, () => ({ focusControl: requestRowFocus }), [requestRowFocus]);

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const index = controls.findIndex((control) => control.id === pending.id);
    if (index < 0) {
      pendingFocusRef.current = null;
      return;
    }
    const row = scrollRef.current?.querySelector(`[data-row-index="${index}"]`);
    const target = row?.querySelector<HTMLElement>(pending.checkbox ? 'input' : 'button');
    if (!target) return;
    pendingFocusRef.current = null;
    target.focus();
  });

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
    if (!(event.target instanceof HTMLElement)) return;
    const row = event.target.closest<HTMLElement>('[data-row-index]');
    if (!row) return;
    const checkbox = event.target instanceof HTMLInputElement;
    // Innerhalb einer Zeile bleiben Checkbox und Button in nativer Tab-Reihenfolge.
    if (selectMode && (event.shiftKey ? !checkbox : checkbox)) return;
    const nextIndex = Number(row.dataset.rowIndex) + (event.shiftKey ? -1 : 1);
    const next = controls[nextIndex];
    if (!next || scrollRef.current?.querySelector(`[data-row-index="${nextIndex}"]`)) return;
    event.preventDefault();
    requestRowFocus(next.id, selectMode && !event.shiftKey);
  }, [controls, requestRowFocus, scrollRef, selectMode]);

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
              isLastRow={slot.index === controls.length - 1}
              onFocus={onRowFocus}
              onKeyDown={handleKeyDown}
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
