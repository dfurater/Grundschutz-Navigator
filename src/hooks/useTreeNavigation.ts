import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { TreeItem } from '@/components/TreeNav';

export interface TreeNode {
  readonly key: string;
  readonly ancestors: readonly string[];
  readonly item: TreeItem;
  readonly children: readonly TreeNode[];
  readonly prefixLength: number;
}

function buildNodes(
  items: readonly TreeItem[],
  path: readonly (string | number)[] = [],
  ancestors: readonly string[] = [],
): TreeNode[] {
  const prefixLength = items.reduce((length, item) => Math.max(length, item.prefix?.length ?? 0), 0);
  return items.map((item, index) => {
    // Kennungen und Positionsschlüssel bleiben auch bei fehlenden Gruppen-IDs getrennt.
    const nextPath = [...path, item.id ?? index];
    const key = JSON.stringify(nextPath);
    return {
      key,
      ancestors,
      item,
      prefixLength,
      children: buildNodes(item.children ?? [], nextPath, [...ancestors, key]),
    };
  });
}

function flatten(nodes: readonly TreeNode[], expanded?: ReadonlySet<string>): TreeNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(expanded === undefined || expanded.has(node.key) ? flatten(node.children, expanded) : []),
  ]);
}

/** Sichtbare Reihenfolge, Expansion und roving tabindex gehören derselben Bauminstanz. */
export function useTreeNavigation(
  items: readonly TreeItem[],
  selectedId: string | undefined,
  onSelect: (id: string) => void,
  catalogKey?: string,
) {
  const nodes = useMemo(() => buildNodes(items), [items]);
  const allNodes = useMemo(() => flatten(nodes), [nodes]);
  const selected = selectedId === undefined ? undefined : allNodes.find((node) => node.item.id === selectedId);
  const [expansion, setExpansion] = useState(() => ({
    selectionKey: selected?.key,
    keys: new Set(selected?.ancestors),
  }));
  // Eine neue Routenauswahl öffnet ihre Vorfahren. Ein manuelles Kollabieren bei
  // unveränderter Auswahl bleibt dagegen bestehen, wie im bisherigen Baum.
  let expanded = expansion.keys;
  if (expansion.selectionKey !== selected?.key) {
    expanded = new Set([...expanded, ...(selected?.ancestors ?? [])]);
    setExpansion({ selectionKey: selected?.key, keys: expanded });
  }
  const visible = flatten(nodes, expanded);
  const [focused, setFocused] = useState<TreeNode>();
  const [scope, setScope] = useState(catalogKey);
  if (scope !== catalogKey) {
    setScope(catalogKey);
    setFocused(undefined);
    setExpansion({ selectionKey: selected?.key, keys: new Set(selected?.ancestors) });
  }
  const active = visible.find((node) => node.key === focused?.key)
    ?? [...(focused?.ancestors ?? [])].reverse()
      .map((key) => visible.find((node) => node.key === key)).find(Boolean)
    ?? visible.find((node) => node.key === selected?.key)
    ?? visible[0];
  const elements = useRef(new Map<string, HTMLButtonElement>());
  const focusedElement = useRef<HTMLButtonElement | null>(null);
  const treeRef = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const previous = focusedElement.current;
    // Nur verlorenen Baumfokus reparieren. Routenseiten/Drawer dürfen ihren
    // Fokus setzen; ein inerter Baum nimmt ihn beim Schließen niemals zurück.
    if (previous && !previous.isConnected
      && document.activeElement === document.body
      && !treeRef.current?.closest('[inert]')) {
      focusedElement.current = null;
      if (active) elements.current.get(active.key)?.focus();
    }
  }, [active, catalogKey]);

  function focus(node: TreeNode | undefined) {
    if (node) elements.current.get(node.key)?.focus();
  }
  function toggle(node: TreeNode) {
    if (node.children.length === 0) return;
    const keys = new Set(expanded);
    if (keys.has(node.key)) keys.delete(node.key);
    else keys.add(node.key);
    setExpansion({ selectionKey: selected?.key, keys });
  }
  function activate(node: TreeNode) {
    focus(node);
    toggle(node);
    if (node.item.id !== undefined) onSelect(node.item.id);
  }
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, node: TreeNode) {
    // Nur Tastaturevents des fokussierbaren Treeitems behandeln.
    if (event.target !== event.currentTarget) return;
    const index = visible.findIndex((entry) => entry.key === node.key);
    switch (event.key) {
      case 'ArrowDown': focus(visible[Math.min(index + 1, visible.length - 1)]); break;
      case 'ArrowUp': focus(visible[Math.max(index - 1, 0)]); break;
      case 'Home': focus(visible[0]); break;
      case 'End': focus(visible.at(-1)); break;
      case 'ArrowRight':
        if (node.children.length > 0) {
          if (expanded.has(node.key)) focus(node.children[0]);
          else toggle(node);
        }
        break;
      case 'ArrowLeft':
        if (node.children.length > 0 && expanded.has(node.key)) toggle(node);
        else focus(visible.find((entry) => entry.key === node.ancestors.at(-1)));
        break;
      case 'Enter':
      case ' ': activate(node); break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  }
  function register(key: string, element: HTMLButtonElement | null) {
    if (element) elements.current.set(key, element);
    else elements.current.delete(key);
  }
  function handleFocus(node: TreeNode, element: HTMLButtonElement) {
    focusedElement.current = element;
    setFocused(node);
  }
  function handleBlur(relatedTarget: EventTarget | null) {
    if (relatedTarget instanceof Node && !treeRef.current?.contains(relatedTarget)) focusedElement.current = null;
  }

  function registerTree(element: HTMLUListElement | null) {
    treeRef.current = element;
  }

  return { nodes, expanded, activeKey: active?.key, registerTree, register, handleFocus, handleBlur, handleKeyDown, activate };
}
