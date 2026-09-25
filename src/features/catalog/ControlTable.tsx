import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { IconChevronDown, IconChevronRight } from '@/components/icons';
import { useRowWindow } from '@/hooks/useRowWindow';
import type { Control } from '@/domain/models';
import { getControlHierarchyDepth } from '@/domain/controlRelationships';
import type { SortConfig, SortField } from '@/hooks/useFilteredControls';

interface ControlTableBaseProps {
  controls: Control[];
  controlsById: Map<string, Control>;
  /** ID of the control whose detail panel is currently open */
  selectedControlId?: string;
  sort: SortConfig;
  onSortChange: (sort: SortConfig) => void;
  onSelectControl: (control: Control) => void;
  /** Full set "select all" spans for the header tri-state and toggle. Defaults to `controls`. */
  selectableControls?: Control[];
}

type ControlTableSelectionProps =
  | {
      /** Show row selection checkboxes for export workflows. Defaults to true. */
      showSelection?: true;
      /** IDs currently checked for export */
      checkedIds: Set<string>;
      onCheckedChange: (ids: Set<string>) => void;
    }
  | {
      /** Hide selection controls when the table is used as a read-only reference list. */
      showSelection: false;
      checkedIds?: never;
      onCheckedChange?: never;
    };

export type ControlTableProps = ControlTableBaseProps & ControlTableSelectionProps;

const EMPTY_CHECKED_IDS = new Set<string>();

// Windowing (GSPP-262): Style, Layout und Paint aller 1.000 Zeilen dominierten
// den initialen Katalog-Render. Die Zeilenhöhe ist durch `line-clamp-1` und
// feste Innenabstände einheitlich (gemessen 41 px) und wird am DOM nachgemessen.
const ESTIMATED_ROW_HEIGHT_PX = 41;
const OVERSCAN_ROWS = 10;
const FALLBACK_VISIBLE_ROWS = 40;
// Kopfzeile belegt aria-rowindex 1; Datenzeilen beginnen bei 2.
const FIRST_DATA_ARIA_ROW_INDEX = 2;

const DEFAULT_SORT: SortConfig = [{ field: 'id', direction: 'asc' }];

function getRowBackgroundClass(isOpen: boolean, isChecked: boolean): string {
  if (isOpen) return 'bg-[var(--color-accent-soft)]';
  if (isChecked) return 'bg-[var(--color-surface-subtle)]';
  return 'hover:bg-[var(--color-surface-subtle)]';
}

function getNextRowIndex(key: string, index: number, rowCount: number): number | null {
  switch (key) {
    case 'ArrowDown':
      return Math.min(rowCount - 1, index + 1);
    case 'ArrowUp':
      return Math.max(0, index - 1);
    case 'Home':
      return 0;
    case 'End':
      return rowCount - 1;
    default:
      return null;
  }
}

/** Multi-sort (shift): add the column, toggle its direction, or remove it again. */
function applyMultiSort(sort: SortConfig, field: SortField): SortConfig {
  const idx = sort.findIndex((s) => s.field === field);
  if (idx < 0) {
    return [...sort, { field, direction: 'asc' }];
  }
  const next = [...sort];
  if (next[idx].direction === 'asc') {
    next[idx] = { ...next[idx], direction: 'desc' };
    return next;
  }
  next.splice(idx, 1);
  return next.length > 0 ? next : DEFAULT_SORT;
}

/** Single-sort: make the column the primary sort and toggle its direction. */
function applySingleSort(sort: SortConfig, field: SortField): SortConfig {
  const current = sort.length === 1 && sort[0].field === field ? sort[0] : null;
  return [{
    field,
    direction: current?.direction === 'asc' ? 'desc' : 'asc',
  }];
}

const MV_DOT_CLASSES: Record<string, string> = {
  MUSS: 'bg-red-600',
  SOLLTE: 'bg-yellow-500',
  KANN: 'bg-green-600',
};

function ModalVerbCell({ value }: Readonly<{ value?: string }>) {
  if (!value) return null;
  const dotClass = MV_DOT_CLASSES[value] ?? 'bg-slate-300';

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
      <span className="catalog-meta-text text-slate-600">{value}</span>
    </span>
  );
}

function SecLevelCell({ value }: Readonly<{ value?: string }>) {
  if (!value) return null;
  const isErhoeht = value !== 'normal-SdT';

  return (
    <span className={`catalog-meta-text ${isErhoeht ? 'text-sky-700' : 'text-slate-500'}`}>
      {value}
    </span>
  );
}

function SortIcon({ field, sort }: Readonly<{ field: SortField; sort: SortConfig }>) {
  const idx = sort.findIndex((s) => s.field === field);
  if (idx < 0) return <span aria-hidden="true" className="text-[var(--color-text-muted)] ml-1">&#8597;</span>;
  const arrow = sort[idx].direction === 'asc' ? '↑' : '↓';
  return (
    <span aria-hidden="true" className="text-[var(--color-accent-default)] ml-1">
      {arrow}
      {sort.length > 1 && <sup className="sort-order-text ml-px opacity-60">{idx + 1}</sup>}
    </span>
  );
}

function getAriaSort(field: SortField, sort: SortConfig) {
  const primarySort = sort[0];

  if (primarySort?.field !== field) {
    return 'none' as const;
  }

  return primarySort.direction === 'asc' ? 'ascending' as const : 'descending' as const;
}

// Feste Spaltenbreiten (`table-layout: fixed`): Im automatischen Tabellenlayout
// hinge die ID-Breite von den gerade gerenderten Zeilen ab und spränge beim
// Scrollen. Die Breiten decken die gemessenen Maximalwerte ab (längste ID im
// Grundschutz++-Katalog 94 px Inhalt, Kopf „Sicherheitsniveau" 114 px).
const COLUMNS: { field: SortField; label: string; colClassName: string }[] = [
  { field: 'id',            label: 'ID',                colClassName: 'w-32' },
  { field: 'title',         label: 'Titel',             colClassName: '' },
  { field: 'modalverb',     label: 'Modalverb',         colClassName: 'w-28' },
  { field: 'securityLevel', label: 'Sicherheitsniveau', colClassName: 'w-36' },
  { field: 'effortLevel',   label: 'Aufwand',           colClassName: 'hidden w-24 sm:table-column' },
];

interface ControlTableRowProps {
  control: Control;
  depth: number;
  index: number;
  isChecked: boolean;
  isOpen: boolean;
  isTabStop: boolean;
  showSelection: boolean;
  onFocus: (index: number, control: Control) => void;
  onKeyDown: (event: React.KeyboardEvent, index: number, control: Control) => void;
  onSelectControl: (control: Control) => void;
  onToggleSelection: (id: string) => void;
}

const ControlTableRow = memo(function ControlTableRow({
  control,
  depth,
  index,
  isChecked,
  isOpen,
  isTabStop,
  showSelection,
  onFocus,
  onKeyDown,
  onSelectControl,
  onToggleSelection,
}: ControlTableRowProps) {
  return (
    <tr
      className={`
        border-b border-[var(--color-border-subtle)] cursor-pointer transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]
        ${getRowBackgroundClass(isOpen, isChecked)}
      `}
      onClick={() => onSelectControl(control)}
      role="row"
      aria-rowindex={index + FIRST_DATA_ARIA_ROW_INDEX}
      data-row-index={index}
      aria-selected={isOpen}
      tabIndex={isTabStop ? 0 : -1}
      onKeyDown={(event) => onKeyDown(event, index, control)}
      onFocus={() => onFocus(index, control)}
    >
      {showSelection && (
        <td className="px-3 py-2.5 align-middle" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(event) => {
              event.stopPropagation();
              onToggleSelection(control.id);
            }}
            onClick={(event) => event.stopPropagation()}
            className="block w-4 h-4 rounded border-[var(--color-border-strong)] cursor-pointer accent-slate-800"
            aria-label={`${control.id} auswählen`}
          />
        </td>
      )}

      <td className="catalog-reference-text overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2.5">
        {control.id}
      </td>
      <td className="type-object-title px-3 py-2.5">
        <div
          className="min-w-0"
          style={depth > 0 ? { paddingInlineStart: `${Math.min(depth, 3) * 16}px` } : undefined}
        >
          <div className="flex min-w-0 items-baseline gap-2">
            {depth > 0 && (
              <span className="catalog-hierarchy-marker" aria-hidden="true">
                ↳
              </span>
            )}
            <span className="line-clamp-1 leading-5">{control.title}</span>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <ModalVerbCell value={control.modalverb} />
      </td>
      <td className="px-3 py-2.5">
        <SecLevelCell value={control.securityLevel} />
      </td>
      <td className="hidden px-3 py-2.5 text-center sm:table-cell">
        {control.effortLevel != null && (
          <span className="catalog-meta-text tabular-nums text-[var(--color-text-secondary)]">
            {control.effortLevel}
          </span>
        )}
      </td>
      <td className="px-2 py-2.5 text-[var(--color-text-muted)]">
        {isOpen
          ? <IconChevronDown className="w-4 h-4" />
          : <IconChevronRight className="w-4 h-4" />}
      </td>
    </tr>
  );
});

export function ControlTable(props: ControlTableProps) {
  const {
    controls,
    controlsById,
    selectedControlId,
    sort,
    onSortChange,
    onSelectControl,
    selectableControls = controls,
  } = props;
  const showSelection = props.showSelection !== false;
  const checkedIds = showSelection && 'checkedIds' in props ? props.checkedIds : EMPTY_CHECKED_IDS;
  const onCheckedChange = showSelection && 'onCheckedChange' in props ? props.onCheckedChange : undefined;
  // Roving tabindex: only one row is tabbable at a time. Der Tab-Stopp folgt
  // der Control-ID, damit er bei Umsortierung mit seiner Zeile wandert; der
  // Index dient nur als Rückfall, wenn die Control aus der Liste fällt.
  const [tabStop, setTabStop] = useState<{ id: string | null; index: number }>({ id: null, index: 0 });
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const pendingFocusIdRef = useRef<string | null>(null);
  const checkedIdsRef = useRef(checkedIds);
  const onCheckedChangeRef = useRef(onCheckedChange);
  const onSelectControlRef = useRef(onSelectControl);

  useLayoutEffect(() => {
    checkedIdsRef.current = checkedIds;
    onCheckedChangeRef.current = onCheckedChange;
    onSelectControlRef.current = onSelectControl;
  }, [checkedIds, onCheckedChange, onSelectControl]);

  const depthById = useMemo(() => new Map(
    controls.map((control) => [
      control.id,
      getControlHierarchyDepth(control, controlsById),
    ]),
  ), [controls, controlsById]);

  const selectControl = useCallback((control: Control) => {
    onSelectControlRef.current(control);
  }, []);

  const toggleRowSelection = useCallback((id: string) => {
    const changeSelection = onCheckedChangeRef.current;
    if (!changeSelection) return;
    const next = new Set(checkedIdsRef.current);
    if (next.has(id)) next.delete(id); else next.add(id);
    checkedIdsRef.current = next;
    changeSelection(next);
  }, []);

  const handleRowKeyDown = useCallback((e: React.KeyboardEvent, index: number, control: Control) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      selectControl(control);
      return;
    }
    if (e.key === ' ' && showSelection) {
      e.preventDefault();
      toggleRowSelection(control.id);
      return;
    }
    const nextIndex = getNextRowIndex(e.key, index, controls.length);
    if (nextIndex === null) return;
    e.preventDefault();
    const renderedRow = tbodyRef.current?.querySelector<HTMLElement>(`tr[data-row-index="${nextIndex}"]`);
    if (renderedRow) {
      // Gerenderte Zeile sofort fokussieren; onFocus setzt den Tab-Stopp.
      renderedRow.focus();
      return;
    }
    // Nicht gerendert heißt: nicht der aktuelle Tab-Stopp. Das Setzen ändert den
    // State daher sicher, das Windowing rendert die Zeile und der Layout-Effekt
    // fokussiert sie nach dem Commit — kein Auftrag bleibt liegen.
    const target = controls[nextIndex];
    pendingFocusIdRef.current = target.id;
    setTabStop({ id: target.id, index: nextIndex });
  }, [controls, selectControl, showSelection, toggleRowSelection]);

  const handleRowFocus = useCallback((index: number, control: Control) => {
    setTabStop((current) =>
      current.id === control.id && current.index === index ? current : { id: control.id, index },
    );
  }, []);

  const indexById = useMemo(
    () => new Map(controls.map((control, index) => [control.id, index])),
    [controls],
  );
  const tabStopIndex = (tabStop.id === null ? undefined : indexById.get(tabStop.id))
    ?? Math.min(tabStop.index, Math.max(controls.length - 1, 0));

  const { scrollRef, onScroll, rowHeight, slots } = useRowWindow({
    rowCount: controls.length,
    pinnedIndex: tabStopIndex,
    estimatedRowHeight: ESTIMATED_ROW_HEIGHT_PX,
    overscan: OVERSCAN_ROWS,
    fallbackVisibleRowCount: FALLBACK_VISIBLE_ROWS,
    rowIndexAttribute: 'data-row-index',
  });

  useLayoutEffect(() => {
    const pendingId = pendingFocusIdRef.current;
    if (pendingId === null) return;
    pendingFocusIdRef.current = null;
    const pendingIndex = indexById.get(pendingId);
    if (pendingIndex === undefined) return;
    // focus() scrollt die Zeile ins Bild; `scroll-pt-9` hält sie unter der
    // Sticky-Kopfzeile sichtbar.
    tbodyRef.current
      ?.querySelector<HTMLElement>(`tr[data-row-index="${pendingIndex}"]`)
      ?.focus();
  });

  const allChecked = showSelection && selectableControls.length > 0 && selectableControls.every((c) => checkedIds.has(c.id));
  const someChecked = showSelection && !allChecked && selectableControls.some((c) => checkedIds.has(c.id));

  const handleToggleAll = () => {
    if (!onCheckedChange) return;
    if (allChecked) {
      // Deselect the full selection universe
      const next = new Set(checkedIds);
      selectableControls.forEach((c) => next.delete(c.id));
      onCheckedChange(next);
    } else {
      // Select the full selection universe
      const next = new Set(checkedIds);
      selectableControls.forEach((c) => next.add(c.id));
      onCheckedChange(next);
    }
  };

  const handleSingleSort = (field: SortField) => {
    onSortChange(applySingleSort(sort, field));
  };

  const handleMultiSort = (field: SortField) => {
    onSortChange(applyMultiSort(sort, field));
  };

  if (controls.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 bg-[var(--color-surface-base)]">
        <div className="text-center">
          <p className="text-[var(--color-text-secondary)] text-sm">Keine Kontrollen gefunden.</p>
          <p className="catalog-meta-text mt-1">
            Passen Sie die Filter an oder wählen Sie eine andere Praktik.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="flex-1 overflow-auto scroll-pt-9 bg-[var(--color-surface-base)]"
    >
      <table
        className="control-table-min-width w-full table-fixed text-sm"
        role="grid"
        aria-rowcount={controls.length + 1}
      >
        <colgroup>
          {showSelection && <col className="w-10" />}
          {COLUMNS.map((col) => (
            <col key={col.field} className={col.colClassName || undefined} />
          ))}
          <col className="w-8" />
        </colgroup>
        <thead className="sticky top-0 bg-[var(--color-surface-subtle)] z-10">
          <tr className="border-b border-[var(--color-border-default)]" aria-rowindex={1}>
            {showSelection && (
              <th className="px-3 py-2 align-middle">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={handleToggleAll}
                  className="block w-4 h-4 rounded border-[var(--color-border-strong)] text-primary-main cursor-pointer accent-slate-800"
                  aria-label="Alle auswählen"
                />
              </th>
            )}

            {COLUMNS.map((col) => (
              <th
                key={col.field}
                className={`catalog-meta-text whitespace-nowrap px-3 py-1.5 text-left${col.field === 'effortLevel' ? ' hidden sm:table-cell' : ''}`}
                role="columnheader"
                aria-sort={getAriaSort(col.field, sort)}
              >
                <button
                  type="button"
                  className="inline-flex w-full items-center rounded px-0 py-1 text-left transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-subtle)]"
                  onClick={(e) => (e.shiftKey ? handleMultiSort(col.field) : handleSingleSort(col.field))}
                >
                  <span>{col.label}</span>
                  <SortIcon field={col.field} sort={sort} />
                </button>
              </th>
            ))}
            <th className="px-2" />
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {slots.map((slot) => {
            if (slot.kind === 'spacer') {
              return (
                <tr key={slot.key} aria-hidden="true">
                  <td
                    colSpan={COLUMNS.length + (showSelection ? 2 : 1)}
                    className="p-0"
                    style={{ height: `${slot.rowCount * rowHeight}px` }}
                  />
                </tr>
              );
            }
            const control = controls[slot.index];
            return (
              <ControlTableRow
                key={control.id}
                control={control}
                depth={depthById.get(control.id) ?? 0}
                index={slot.index}
                isChecked={showSelection && checkedIds.has(control.id)}
                isOpen={selectedControlId === control.id}
                isTabStop={slot.index === tabStopIndex}
                showSelection={showSelection}
                onFocus={handleRowFocus}
                onKeyDown={handleRowKeyDown}
                onSelectControl={selectControl}
                onToggleSelection={toggleRowSelection}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
