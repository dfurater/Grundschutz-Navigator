import { useId } from 'react';
import { IconChevronRight, IconChevronDown } from '@/components/icons';
import { useTreeNavigation } from '@/hooks/useTreeNavigation';
import type { TreeNode } from '@/hooks/useTreeNavigation';

export interface TreeItem {
  /**
   * Fehlt, wenn die Quellgruppe keine `id` trägt (OSCAL 1.1.3: `group.id` ist
   * optional). Ein solcher Eintrag bleibt sichtbar und aufklappbar, ist aber
   * kein Navigationsziel — Anker und Routen setzen keine Gruppen-`id`
   * voraus (GSPP-242).
   */
  id?: string;
  label: string;
  /** Short prefix shown as a distinct tag before the label */
  prefix?: string;
  children?: TreeItem[];
  /** Optional count badge shown at the end of the row */
  badge?: string;
}

export interface TreeNavProps {
  readonly items: TreeItem[];
  readonly onSelect: (id: string) => void;
  readonly selectedId?: string;
  readonly className?: string;
}

type Navigation = ReturnType<typeof useTreeNavigation>;
const TREE_DEPTH_PADDING_CLASSES = ['pl-2', 'pl-5', 'pl-8', 'pl-11'] as const;

interface TreeNavItemProps {
  readonly node: TreeNode;
  readonly navigation: Navigation;
  readonly selectedId?: string;
}

function TreeNavItem({ node, navigation, selectedId }: TreeNavItemProps) {
  const { item } = node;
  const groupId = useId();
  const hasChildren = node.children.length > 0;
  const expanded = navigation.expanded.has(node.key);
  const isSelected = item.id !== undefined && item.id === selectedId;
  const depthClass = TREE_DEPTH_PADDING_CLASSES[
    Math.min(node.ancestors.length, TREE_DEPTH_PADDING_CLASSES.length - 1)
  ];
  return (
    <li role="none">
      <button
        type="button"
        ref={(element) => navigation.register(node.key, element)}
        role="treeitem"
        aria-label={[item.prefix, item.label, item.badge].filter(Boolean).join(' ')}
        aria-owns={hasChildren && expanded ? groupId : undefined}
        aria-expanded={hasChildren ? expanded : undefined}
        aria-selected={isSelected}
        tabIndex={navigation.activeKey === node.key ? 0 : -1}
        onFocus={(event) => navigation.handleFocus(node, event.currentTarget)}
        onClick={() => navigation.activate(node)}
        onKeyDown={(event) => navigation.handleKeyDown(event, node)}
        data-testid={item.id === undefined ? 'tree-item-ohne-id' : `tree-item-${item.id}`}
        className={`flex w-full cursor-pointer items-center py-1.5 pr-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-inset hover:bg-[var(--color-surface-subtle)] active:bg-[var(--color-border-default)] ${depthClass} ${
          isSelected
            ? 'bg-[var(--color-surface-subtle)] font-semibold text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)]'
        }`}
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
            {/* `0.5rem` = `px-1` beidseitig, Preflight setzt border-box */}
            <span
              className="shrink-0 rounded bg-[var(--color-surface-subtle)] px-1 py-px text-center font-mono text-xs font-semibold leading-tight text-[var(--color-text-muted)]"
              style={{ width: `calc(${node.prefixLength}ch + 0.5rem)` }}
            >
              {item.prefix}
            </span>
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
        // aria-owns ordnet die benachbarte Gruppe ihrem Treeitem zu, ohne
        // die Kindtexte zum sichtbaren bzw. zugänglichen Zeilenlabel zu machen.
        <ul role="group" id={groupId}>
          {node.children.map((child) => (
            <TreeNavItem key={child.key} node={child} navigation={navigation} selectedId={selectedId} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TreeNav({ items, onSelect, selectedId, className = '' }: TreeNavProps) {
  const navigation = useTreeNavigation(items, selectedId, onSelect);
  return (
    <nav className={className} aria-label="Katalog-Explorer" data-testid="tree-nav">
      <ul role="tree" aria-label="Katalog-Explorer" ref={(element) => navigation.registerTree(element)} onBlur={(event) => navigation.handleBlur(event.relatedTarget)}>
        {navigation.nodes.map((node) => (
          <TreeNavItem key={node.key} node={node} navigation={navigation} selectedId={selectedId} />
        ))}
      </ul>
    </nav>
  );
}
