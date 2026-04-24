import { useRef, useState, useCallback } from 'react';
import { IconChevronDown, IconChevronRight } from '@/components/icons';
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

const MV_DOT_CLASSES: Record<string, string> = {
  MUSS: 'bg-red-600',
  SOLLTE: 'bg-yellow-500',
  KANN: 'bg-green-600',
};

function ModalVerbCell({ value }: { value?: string }) {
  if (!value) return null;
  const dotClass = MV_DOT_CLASSES[value] ?? 'bg-slate-300';

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
      <span className="catalog-meta-text text-slate-600">{value}</span>
    </span>
  );
}

function SecLevelCell({ value }: { value?: string }) {
  if (!value) return null;
  const isErhoeht = value !== 'normal-SdT';

  return (
    <span className={`catalog-meta-text ${isErhoeht ? 'text-sky-700' : 'text-slate-500'}`}>
      {value}
    </span>
  );
}

function SortIcon({ field, sort }: { field: SortField; sort: SortConfig }) {
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

const COLUMNS: { field: SortField; label: string; className: string }[] = [
  { field: 'id',            label: 'ID',           className: 'w-24' },
  { field: 'title',         label: 'Titel',        className: 'min-w-52' },
  { field: 'modalverb',     label: 'Modalverb',        className: 'w-28' },
  { field: 'securityLevel', label: 'Sicherheitsniveau', className: 'w-24' },
  { field: 'effortLevel',   label: 'Aufwand',         className: 'w-24' },
];

export function ControlTable(props: ControlTableProps) {
  const {
    controls,
    controlsById,
    selectedControlId,
    sort,
    onSortChange,
    onSelectControl,
  } = props;
  const showSelection = props.showSelection !== false;
  const checkedIds = showSelection && 'checkedIds' in props ? props.checkedIds : EMPTY_CHECKED_IDS;
  const onCheckedChange = showSelection && 'onCheckedChange' in props ? props.onCheckedChange : undefined;
  // Roving tabindex: only one row is tabbable at a time
  const [focusedIndex, setFocusedIndex] = useState(0);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const toggleRowSelection = useCallback((id: string) => {
    if (!onCheckedChange) return;
    const next = new Set(checkedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onCheckedChange(next);
  }, [checkedIds, onCheckedChange]);

  const handleRowKeyDown = useCallback((e: React.KeyboardEvent, index: number, control: Control) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSelectControl(control);
      return;
    }
    if (e.key === ' ' && showSelection) {
      e.preventDefault();
      toggleRowSelection(control.id);
      return;
    }
    const nextIndex =
      e.key === 'ArrowDown'
        ? Math.min(controls.length - 1, index + 1)
        : e.key === 'ArrowUp'
          ? Math.max(0, index - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? controls.length - 1
              : null;
    if (nextIndex === null) return;
    e.preventDefault();
    setFocusedIndex(nextIndex);
    const rows = tbodyRef.current?.querySelectorAll<HTMLElement>('tr[role="row"]');
    rows?.[nextIndex]?.focus();
  }, [controls, onSelectControl, showSelection, toggleRowSelection]);

  const allChecked = showSelection && controls.length > 0 && controls.every((c) => checkedIds.has(c.id));
  const someChecked = showSelection && !allChecked && controls.some((c) => checkedIds.has(c.id));

  const handleToggleAll = () => {
    if (!onCheckedChange) return;
    if (allChecked) {
      // Deselect all visible
      const next = new Set(checkedIds);
      controls.forEach((c) => next.delete(c.id));
      onCheckedChange(next);
    } else {
      // Select all visible
      const next = new Set(checkedIds);
      controls.forEach((c) => next.add(c.id));
      onCheckedChange(next);
    }
  };

  const handleSort = (field: SortField, shiftKey: boolean) => {
    if (shiftKey) {
      // Multi-sort: add, toggle direction, or remove
      const idx = sort.findIndex((s) => s.field === field);
      if (idx >= 0) {
        const next = [...sort];
        if (next[idx].direction === 'asc') {
          next[idx] = { ...next[idx], direction: 'desc' };
        } else {
          next.splice(idx, 1);
        }
        onSortChange(next.length > 0 ? next : [{ field: 'id', direction: 'asc' }]);
      } else {
        onSortChange([...sort, { field, direction: 'asc' }]);
      }
    } else {
      // Single-sort: set or toggle direction
      const current = sort.length === 1 && sort[0].field === field ? sort[0] : null;
      onSortChange([{
        field,
        direction: current?.direction === 'asc' ? 'desc' : 'asc',
      }]);
    }
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
    <div className="flex-1 overflow-auto bg-[var(--color-surface-base)]">
      <table className="control-table-min-width w-full text-sm" role="grid">
        <thead className="sticky top-0 bg-[var(--color-surface-subtle)] z-10">
          <tr className="border-b border-[var(--color-border-default)]">
            {showSelection && (
              <th className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                  onChange={handleToggleAll}
                  className="w-4 h-4 rounded border-[var(--color-border-strong)] text-primary-main cursor-pointer accent-slate-800"
                  aria-label="Alle auswählen"
                />
              </th>
            )}

            {COLUMNS.map((col) => (
              <th
                key={col.field}
                className={`catalog-meta-text whitespace-nowrap px-3 py-1.5 text-left ${col.className}${col.field === 'effortLevel' ? ' hidden sm:table-cell' : ''}`}
                role="columnheader"
                aria-sort={getAriaSort(col.field, sort)}
              >
                <button
                  type="button"
                  className="inline-flex w-full items-center rounded px-0 py-1 text-left transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-subtle)]"
                  onClick={(e) => handleSort(col.field, e.shiftKey)}
                >
                  <span>{col.label}</span>
                  <SortIcon field={col.field} sort={sort} />
                </button>
              </th>
            ))}
            <th className="w-8 px-2" />
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {controls.map((control, index) => {
            const isOpen    = selectedControlId === control.id;
            const isChecked = showSelection && checkedIds.has(control.id);
            const depth = getControlHierarchyDepth(control, controlsById);
            return (
              <tr
                key={control.id}
                className={`
                  border-b border-[var(--color-border-subtle)] cursor-pointer transition-colors
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]
                  ${isOpen ? 'bg-[var(--color-accent-soft)]' : isChecked ? 'bg-[var(--color-surface-subtle)]' : 'hover:bg-[var(--color-surface-subtle)]'}
                `}
                onClick={() => onSelectControl(control)}
                role="row"
                aria-selected={isOpen}
                tabIndex={index === focusedIndex ? 0 : -1}
                onKeyDown={(e) => handleRowKeyDown(e, index, control)}
                onFocus={() => setFocusedIndex(index)}
              >
                {showSelection && (
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleRowSelection(control.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded border-[var(--color-border-strong)] cursor-pointer accent-slate-800"
                      aria-label={`${control.id} auswählen`}
                    />
                  </td>
                )}

                <td className="catalog-reference-text whitespace-nowrap px-3 py-2.5">
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
          })}
        </tbody>
      </table>
    </div>
  );
}
