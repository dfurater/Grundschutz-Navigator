import type { Control, ControlLink, LinkRelation } from '@/domain/models';

export interface IncomingControlLink {
  control: Control;
  relation: LinkRelation;
}

const LINK_RELATION_LABELS: Record<LinkRelation, string> = {
  required: 'erforderlich',
  related: 'verwandt',
};

export function getLinkRelationLabel(relation: LinkRelation): string {
  return LINK_RELATION_LABELS[relation];
}

export function getControlLinkSearchText(links: ControlLink[]): string {
  return links.flatMap((link) => [
    link.targetId,
    link.relation,
    getLinkRelationLabel(link.relation),
  ]).join(' ');
}

export function getControlLinkTargetsByRelation(links: ControlLink[]): Record<LinkRelation, string[]> {
  return {
    required: links
      .filter((link) => link.relation === 'required')
      .map((link) => link.targetId),
    related: links
      .filter((link) => link.relation === 'related')
      .map((link) => link.targetId),
  };
}

export function buildIncomingLinkMap(controls: Control[]): Map<string, IncomingControlLink[]> {
  const incomingByTarget = new Map<string, IncomingControlLink[]>();

  for (const control of controls) {
    for (const link of control.links) {
      const existing = incomingByTarget.get(link.targetId) ?? [];
      existing.push({ control, relation: link.relation });
      incomingByTarget.set(link.targetId, existing);
    }
  }

  for (const incoming of incomingByTarget.values()) {
    incoming.sort((a, b) => a.control.id.localeCompare(b.control.id, 'de', { numeric: true }));
  }

  return incomingByTarget;
}

export function buildChildControlMap(controls: Control[]): Map<string, Control[]> {
  const childrenByParent = new Map<string, Control[]>();

  for (const control of controls) {
    if (!control.parentId) continue;
    const existing = childrenByParent.get(control.parentId) ?? [];
    existing.push(control);
    childrenByParent.set(control.parentId, existing);
  }

  for (const children of childrenByParent.values()) {
    children.sort((a, b) => a.id.localeCompare(b.id, 'de', { numeric: true }));
  }

  return childrenByParent;
}

export function getControlHierarchyDepth(
  control: Control,
  controlsById: Map<string, Control>,
): number {
  let depth = 0;
  let currentParentId = control.parentId;

  while (currentParentId) {
    depth += 1;
    currentParentId = controlsById.get(currentParentId)?.parentId;
  }

  return depth;
}
