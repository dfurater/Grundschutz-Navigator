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

export function ControlDependencies({
  links,
  controlsById,
  incomingLinks = [],
  onNavigateToControl,
}: ControlDependenciesProps) {
  const incomingByControlId = buildIncomingLinksByControlId(incomingLinks);
  const outgoingIds = new Set(links.map((link) => link.targetId));
  const incomingOnlyLinks = incomingLinks.filter(
    (incoming) => !outgoingIds.has(incoming.control.id),
  );

  if (links.length === 0 && incomingOnlyLinks.length === 0) {
    return null;
  }

  return (
    <ControlDetailSection heading="Abhängigkeiten">
      <div className="space-y-3">
        {links.length > 0 && (
          <div>
            <SubSectionHeading>Verknüpfte Kontrollen</SubSectionHeading>
            <div className="space-y-1">
              {links.map((link) => {
                const targetControl = controlsById?.get(link.targetId);
                const label = getOutgoingLinkLabel(
                  link.relation,
                  incomingByControlId.get(link.targetId),
                );
                const ariaLabel = `${link.targetId}${targetControl?.title ? ` ${targetControl.title}` : ''} (${label})`;

                return (
                  <button
                    key={`${link.targetId}-${link.relation}`}
                    type="button"
                    aria-label={ariaLabel}
                    disabled={!targetControl}
                    className={`${detailLinkRowClass} disabled:cursor-not-allowed disabled:opacity-60`}
                    onClick={() => {
                      if (targetControl) {
                        onNavigateToControl?.(targetControl);
                      }
                    }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xs text-slate-500 shrink-0 group-hover:text-primary-main">
                        {link.targetId}
                      </span>
                      {targetControl?.title && (
                        <span className="text-sm text-slate-700 leading-snug">
                          {targetControl.title}
                        </span>
                      )}
                    </div>
                    <span className="mt-0.5 text-xs text-slate-400">{label}</span>
                  </button>
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
