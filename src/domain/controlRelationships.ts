import type {
  Control,
  ControlLink,
  LinkRelation,
  LinkRelationStatus,
} from '@/domain/models';

export interface IncomingControlLink {
  control: Control;
  link: ControlLink;
}

const LINK_RELATION_LABELS: Record<LinkRelation, string> = {
  required: 'erforderlich',
  related: 'verwandt',
};

export function getLinkRelationLabel(relation: LinkRelation): string {
  return LINK_RELATION_LABELS[relation];
}

export function toFilterableLinkRelation(
  rel: string | undefined,
): LinkRelation | undefined {
  return rel === 'required' || rel === 'related' ? rel : undefined;
}

export function getLinkRelationDescription(
  rel: string | undefined,
  status: LinkRelationStatus,
): string {
  if (status === 'missing') return 'ohne Relationsangabe';

  const knownLabel = rel === 'reference'
    ? 'Referenz'
    : rel === 'required'
      ? 'erforderlich'
      : rel === 'related'
        ? 'verwandt'
        : undefined;

  if (status === 'documented') {
    return knownLabel
      ? `${knownLabel} · OSCAL-dokumentiert`
      : `OSCAL-dokumentierte Relation „${rel ?? ''}“`;
  }

  return knownLabel
    ? `${knownLabel} · benutzerdefinierte OSCAL-Relation`
    : `benutzerdefinierte OSCAL-Relation „${rel ?? ''}“`;
}

export function getControlLinkSearchText(links: ControlLink[]): string {
  return links.flatMap((link) => {
    const filterableRelation = toFilterableLinkRelation(link.rel);
    return [
      link.targetId,
      link.href,
      link.rel ?? '',
      getLinkRelationDescription(link.rel, link.relStatus),
      filterableRelation ? getLinkRelationLabel(filterableRelation) : '',
      link.resourceFragment ?? '',
    ];
  }).join(' ');
}

export function getControlLinkTargetsByRelation(links: ControlLink[]): Record<LinkRelation, string[]> {
  return {
    required: links
      .filter((link) => toFilterableLinkRelation(link.rel) === 'required')
      .map((link) => link.targetId),
    related: links
      .filter((link) => toFilterableLinkRelation(link.rel) === 'related')
      .map((link) => link.targetId),
  };
}

export function buildIncomingLinkMap(controls: Control[]): Map<string, IncomingControlLink[]> {
  const incomingByTarget = new Map<string, IncomingControlLink[]>();

  for (const control of controls) {
    for (const link of control.links) {
      const existing = incomingByTarget.get(link.targetId) ?? [];
      existing.push({ control, link });
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
