import { useState, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import { IconChevronRight, IconChevronDown } from './icons';

export interface TreeItem {
  id: string;
  label: string;
  /** Short prefix shown as a distinct tag before the label */
  prefix?: string;
  children?: TreeItem[];
  /** Optional count badge shown at the end of the row */
  badge?: string;
}

export interface TreeNavProps {
  items: TreeItem[];
  onSelect: (id: string) => void;
  selectedId?: string;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function hasSelectedDescendant(item: TreeItem, selectedId?: string): boolean {
  if (!selectedId || !item.children) return false;
  return item.children.some(
    (child) =>
      child.id === selectedId || hasSelectedDescendant(child, selectedId),
  );
}

/* ------------------------------------------------------------------ */
/*  TreeNavItem (recursive)                                            */
/* ------------------------------------------------------------------ */

interface TreeNavItemProps {
  item: TreeItem;
  level: number;
  onSelect: (id: string) => void;
  selectedId?: string;
}

const TREE_DEPTH_PADDING_CLASSES = ['pl-2', 'pl-5', 'pl-8', 'pl-11'] as const;

function TreeNavItem({ item, level, onSelect, selectedId }: TreeNavItemProps) {
  const hasChildren = Boolean(item.children && item.children.length > 0);
  const isSelected = selectedId === item.id;
  const shouldAutoExpand =
    hasChildren && hasSelectedDescendant(item, selectedId);
  const autoExpandKey = shouldAutoExpand ? selectedId : undefined;
  const [expandState, setExpandState] = useState(() => ({
    expanded: shouldAutoExpand,
    autoExpandKey,
  }));
  const expanded =
    autoExpandKey && expandState.autoExpandKey !== autoExpandKey
      ? true
      : expandState.expanded;
  const depthClass =
    TREE_DEPTH_PADDING_CLASSES[
      Math.min(level, TREE_DEPTH_PADDING_CLASSES.length - 1)
    ];

  const setExpanded = useCallback(
    (nextExpanded: boolean | ((previous: boolean) => boolean)) => {
      const previousExpanded =
        autoExpandKey && expandState.autoExpandKey !== autoExpandKey
          ? true
          : expandState.expanded;
      const resolvedExpanded =
        typeof nextExpanded === 'function'
          ? nextExpanded(previousExpanded)
          : nextExpanded;

      setExpandState({
        expanded: resolvedExpanded,
        autoExpandKey,
      });
    },
    [autoExpandKey, expandState],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
          if (hasChildren && !expanded) {
            setExpanded(true);
            e.preventDefault();
          }
          break;
        case 'ArrowLeft':
          if (hasChildren && expanded) {
            setExpanded(false);
            e.preventDefault();
          }
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (hasChildren) {
            setExpanded((prev) => !prev);
          }
          onSelect(item.id);
          break;
      }
    },
    [expanded, hasChildren, item.id, onSelect, setExpanded],
  );

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={isSelected}
    >
      <button
        type="button"
        className={`flex w-full items-center py-1.5 pr-2 text-left text-sm transition-colors hover:bg-[var(--color-surface-subtle)] active:bg-[var(--color-border-default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-inset ${depthClass} ${
          isSelected
            ? 'bg-[var(--color-surface-subtle)] font-semibold text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)]'
        }`}
        tabIndex={0}
        onClick={() => {
          if (hasChildren) {
            setExpanded((prev) => !prev);
          }
          onSelect(item.id);
        }}
        onKeyDown={handleKeyDown}
        data-testid={`tree-item-${item.id}`}
      >
        <span className="mr-1 flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-text-muted)]">
          {hasChildren &&
            (expanded ? (
              <IconChevronDown className="w-3.5 h-3.5" />
            ) : (
              <IconChevronRight className="w-3.5 h-3.5" />
            ))}
        </span>
        {item.prefix ? (
          <span className="truncate flex items-center gap-1.5 flex-1 min-w-0">
            <span className="tree-prefix-badge shrink-0 rounded bg-[var(--color-surface-subtle)] px-1 py-px text-center font-mono text-xs font-semibold leading-tight text-[var(--color-text-muted)]">{item.prefix}</span>
            <span className="truncate">{item.label}</span>
          </span>
        ) : (
          <span className="truncate flex-1">{item.label}</span>
        )}
        {item.badge && (
          <span className="catalog-badge-text ml-1 shrink-0 tabular-nums text-[var(--color-text-secondary)]">
            {item.badge}
          </span>
        )}
      </button>
      {hasChildren && expanded && (
        <ul role="group">
          {item.children!.map((child) => (
            <TreeNavItem
              key={child.id}
              item={child}
              level={level + 1}
              onSelect={onSelect}
              selectedId={selectedId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  TreeNav                                                            */
/* ------------------------------------------------------------------ */

export function TreeNav({
  items,
  onSelect,
  selectedId,
  className = '',
}: TreeNavProps) {
  return (
    <nav
      className={className}
      aria-label="Katalog-Explorer"
      data-testid="tree-nav"
    >
      <ul role="tree">
        {items.map((item) => (
          <TreeNavItem
            key={item.id}
            item={item}
            level={0}
            onSelect={onSelect}
            selectedId={selectedId}
          />
        ))}
      </ul>
    </nav>
  );
}
