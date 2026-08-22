import type { Control, ControlLink } from '@/domain/models';
import {
  getLinkRelationDescription,
  type IncomingControlLink,
} from '@/domain/controlRelationships';
import { ControlDetailSection } from './ControlDetailSection';
import {
  detailLinkRowClass,
  SubSectionHeading,
} from './ControlVocabularyPrimitives';

export interface ControlDependenciesProps {
  readonly links: readonly ControlLink[];
  readonly controlsById?: ReadonlyMap<string, Control>;
  readonly incomingLinks?: readonly IncomingControlLink[];
  readonly onNavigateToControl?: (control: Control) => void;
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
  link: ControlLink,
  reverseLinks: readonly IncomingControlLink[] | undefined,
) {
  const relationLabel = getLinkRelationDescription(link.rel, link.relStatus);

  if (!reverseLinks?.length) {
    return relationLabel;
  }

  const differingReverseLabels = Array.from(
    new Set(
      reverseLinks
        .map((incoming) => incoming.link)
        .filter((reverseLink) => (
          reverseLink.rel !== link.rel || reverseLink.relStatus !== link.relStatus
        ))
        .map((reverseLink) => getLinkRelationDescription(
          reverseLink.rel,
          reverseLink.relStatus,
        )),
    ),
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
      link,
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
                  <fieldset key={group.label} aria-labelledby={groupLabelId} className="min-w-0">
                    <legend id={groupLabelId} className="text-xs font-medium text-slate-500 mb-1">
                      {capitalize(group.label)}
                    </legend>
                    <div className="space-y-1">
                      {group.links.map((link) => {
                        const targetControl = controlsById?.get(link.targetId);
                        if (!targetControl) return null;
                        const ariaLabel = `${link.targetId} ${targetControl.title} (${group.label})`;

                        return (
                          <button
                            key={`${link.targetId}-${link.href}-${link.rel ?? 'missing'}-${link.resourceFragment ?? ''}`}
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
                  </fieldset>
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
                  key={`${incoming.control.id}-${incoming.link.href}-${incoming.link.rel ?? 'missing'}`}
                  type="button"
                  aria-label={`${incoming.control.id} ${incoming.control.title} (${getLinkRelationDescription(incoming.link.rel, incoming.link.relStatus)})`}
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
                    {getLinkRelationDescription(incoming.link.rel, incoming.link.relStatus)}
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
