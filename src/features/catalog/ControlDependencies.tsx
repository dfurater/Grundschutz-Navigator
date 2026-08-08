import type { Control, ControlLink, LinkRelation } from '@/domain/models';
import {
  getLinkRelationLabel,
  type IncomingControlLink,
} from '@/domain/controlRelationships';
import { ControlDetailSection } from './ControlDetailSection';
import {
  detailLinkRowClass,
  SubSectionHeading,
} from './ControlVocabularyPrimitives';

export interface ControlDependenciesProps {
  links: readonly ControlLink[];
  controlsById?: ReadonlyMap<string, Control>;
  incomingLinks?: readonly IncomingControlLink[];
  onNavigateToControl?: (control: Control) => void;
}

function buildIncomingLinksByControlId(
  incomingLinks: readonly IncomingControlLink[],
) {
  const incomingByControlId = new Map<string, IncomingControlLink[]>();

  for (const incoming of incomingLinks) {
    const existing = incomingByControlId.get(incoming.control.id);

    if (existing) {
      existing.push(incoming);
      continue;
    }

    incomingByControlId.set(incoming.control.id, [incoming]);
  }

  return incomingByControlId;
}

function getOutgoingLinkLabel(
  relation: LinkRelation,
  reverseLinks: readonly IncomingControlLink[] | undefined,
) {
  const relationLabel = getLinkRelationLabel(relation);

  if (!reverseLinks?.length) {
    return relationLabel;
  }

  const differingReverseLabels = Array.from(
    new Set(
      reverseLinks
        .map((incoming) => incoming.relation)
        .filter((reverseRelation) => reverseRelation !== relation),
    ),
    (reverseRelation) => getLinkRelationLabel(reverseRelation),
  );

  if (differingReverseLabels.length === 0) {
    return relationLabel;
  }

  return `${relationLabel} · ↔ ${differingReverseLabels.join(', ')}`;
}

function capitalize(label: string) {
  return label.length === 0 ? label : `${label[0]?.toUpperCase()}${label.slice(1)}`;
}

interface LinkGroup {
  label: string;
  links: ControlLink[];
}

function groupLinksByLabel(
  links: readonly ControlLink[],
  incomingByControlId: ReadonlyMap<string, IncomingControlLink[]>,
): LinkGroup[] {
  const groups: LinkGroup[] = [];
  const groupsByLabel = new Map<string, LinkGroup>();

  for (const link of links) {
    const label = getOutgoingLinkLabel(
      link.relation,
      incomingByControlId.get(link.targetId),
    );
    const existing = groupsByLabel.get(label);

    if (existing) {
      existing.links.push(link);
      continue;
    }

    const group: LinkGroup = { label, links: [link] };
    groupsByLabel.set(label, group);
    groups.push(group);
  }

  return groups;
}

export function ControlDependencies({
  links,
  controlsById,
  incomingLinks = [],
  onNavigateToControl,
}: ControlDependenciesProps) {
  const resolvedLinks = links.filter((link) => controlsById?.has(link.targetId));
  const incomingByControlId = buildIncomingLinksByControlId(incomingLinks);
  const outgoingIds = new Set(resolvedLinks.map((link) => link.targetId));
  const incomingOnlyLinks = incomingLinks.filter(
    (incoming) => !outgoingIds.has(incoming.control.id),
  );
  const linkGroups = groupLinksByLabel(resolvedLinks, incomingByControlId);

  if (resolvedLinks.length === 0 && incomingOnlyLinks.length === 0) {
    return null;
  }

  return (
    <ControlDetailSection heading="Abhängigkeiten">
      <div className="space-y-3">
        {resolvedLinks.length > 0 && (
          <div>
            <SubSectionHeading>Verknüpfte Kontrollen</SubSectionHeading>
            <div className="space-y-3">
              {linkGroups.map((group, groupIndex) => {
                const groupLabelId = `control-dependencies-group-label-${groupIndex}`;

                return (
                  <div key={group.label} role="group" aria-labelledby={groupLabelId}>
                    <p id={groupLabelId} className="text-xs font-medium text-slate-500 mb-1">
                      {capitalize(group.label)}
                    </p>
                    <div className="space-y-1">
                      {group.links.map((link) => {
                        const targetControl = controlsById?.get(link.targetId);
                        if (!targetControl) return null;
                        const ariaLabel = `${link.targetId} ${targetControl.title} (${group.label})`;

                        return (
                          <button
                            key={`${link.targetId}-${link.relation}`}
                            type="button"
                            aria-label={ariaLabel}
                            className={detailLinkRowClass}
                            onClick={() => onNavigateToControl?.(targetControl)}
                          >
                            <div className="flex items-baseline gap-2">
                              <span className="font-mono text-xs text-slate-500 shrink-0 group-hover:text-primary-main">
                                {link.targetId}
                              </span>
                              <span className="text-sm text-slate-700 leading-snug">
                                {targetControl.title}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {incomingOnlyLinks.length > 0 && (
          <div>
            <SubSectionHeading>Wird referenziert von</SubSectionHeading>
            <div className="space-y-1">
              {incomingOnlyLinks.map((incoming) => (
                <button
                  key={`${incoming.control.id}-${incoming.relation}`}
                  type="button"
                  aria-label={`${incoming.control.id} ${incoming.control.title} (${getLinkRelationLabel(incoming.relation)})`}
                  className={detailLinkRowClass}
                  onClick={() => onNavigateToControl?.(incoming.control)}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-slate-500 shrink-0 group-hover:text-primary-main">
                      {incoming.control.id}
                    </span>
                    <span className="text-sm text-slate-700 leading-snug">
                      {incoming.control.title}
                    </span>
                  </div>
                  <span className="mt-0.5 text-xs text-slate-400">
                    {getLinkRelationLabel(incoming.relation)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </ControlDetailSection>
  );
}
