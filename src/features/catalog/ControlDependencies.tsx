import { Fragment } from 'react';
import type { Control, ControlLink } from '@/domain/models';
import {
  type IncomingControlLink,
} from '@/domain/controlRelationships';
import {
  ControlListLink,
  detailListClass,
  type LegendEntry,
} from './ControlVocabularyPrimitives';

/** Relationsart unter einem Link: leise, direkt unter der Link-Zeile. */
const relationNoteClass = 'text-xs text-slate-400';

export interface ControlDependenciesProps {
  readonly links: readonly ControlLink[];
  readonly controlsById?: ReadonlyMap<string, Control>;
  readonly incomingLinks?: readonly IncomingControlLink[];
  readonly onNavigateToControl?: (control: Control) => void;
}

/**
 * Alltagslabel einer Verknüpfung (GSPP-303 T8): bekannte `rel`-Werte →
 * „Verwandt"/„Erfordert"/„Referenz", sonst `Benutzerdefinierte Relation
 * „<rel>"`. Die Herkunft steht ausschließlich in der Legende.
 */
const EVERYDAY_RELATION_LABELS: Readonly<Record<string, string>> = {
  related: 'Verwandt',
  required: 'Erfordert',
  reference: 'Referenz',
};

export function everydayRelationLabel(link: ControlLink): string {
  if (link.relStatus === 'missing') return 'Ohne Relationsangabe';
  const rel = link.rel ?? '';
  return Object.hasOwn(EVERYDAY_RELATION_LABELS, rel)
    ? EVERYDAY_RELATION_LABELS[rel]
    : `Benutzerdefinierte Relation „${rel}"`;
}

/** Gegenrichtungs-Zeile: „<ID> verweist hierauf als „<label>""". */
export function buildIncomingEverydayLabel(incoming: IncomingControlLink): string {
  return `${incoming.control.id} verweist hierauf als „${everydayRelationLabel(incoming.link)}"`;
}

function relationLegendEntry(term: string, definition: string): LegendEntry {
  return { category: 'Link-Relation', term, definition };
}

/**
 * Statische Legende (T8): Relationsbedeutung je Alltags-Label plus
 * Herkunftshinweis aus GSPP-243.
 * Relationen haben keine Vokabular-Route; die Legende verlinkt sich nicht selbst.
 */
export function buildLinkLegendEntries(): LegendEntry[] {
  return [
    relationLegendEntry('Verwandt', 'Verwandte Kontrolle — Alltagslabel für OSCAL-rel „related".'),
    relationLegendEntry('Erfordert', 'Erforderliche Kontrolle — Alltagslabel für OSCAL-rel „required".'),
    relationLegendEntry('Referenz', 'Referenz — Alltagslabel für OSCAL-rel „reference".'),
    {
      term: 'Herkunft der Relationsangabe',
      definition: 'Ob die Relationsangabe im OSCAL-Katalog dokumentiert ist '
      + '(… · OSCAL-dokumentiert), nur benutzerdefiniert vorliegt '
      + '(… · benutzerdefinierte OSCAL-Relation) oder fehlt (ohne Relationsangabe).',
    },
  ];
}

function buildIncomingLinksByControlId(incomingLinks: readonly IncomingControlLink[]) {
  const incomingByControlId = new Map<string, IncomingControlLink[]>();
  for (const incoming of incomingLinks) {
    const existing = incomingByControlId.get(incoming.control.id);
    if (existing) existing.push(incoming);
    else incomingByControlId.set(incoming.control.id, [incoming]);
  }
  return incomingByControlId;
}

/** Rücklinks je distinktem Alltags-Label genau einmal (keine Doppelzeilen). */
function distinctReverseLinks(reverseLinks: readonly IncomingControlLink[] | undefined) {
  const seen = new Set<string>();
  return (reverseLinks ?? []).filter((incoming) => {
    const label = everydayRelationLabel(incoming.link);
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}

function capitalize(label: string) {
  return label.length === 0 ? label : `${label[0]?.toUpperCase()}${label.slice(1)}`;
}

function groupLinksByLabel(links: readonly ControlLink[]) {
  const groups: { label: string; links: ControlLink[] }[] = [];
  const groupsByLabel = new Map<string, { label: string; links: ControlLink[] }>();
  for (const link of links) {
    const label = everydayRelationLabel(link);
    const existing = groupsByLabel.get(label);
    if (existing) {
      existing.links.push(link);
      continue;
    }
    const group = { label, links: [link] };
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
  const linkGroups = groupLinksByLabel(resolvedLinks);

  if (resolvedLinks.length === 0 && incomingOnlyLinks.length === 0) {
    return null;
  }

  // GSPP-303 T9: hüllenlos (Teil des Blocks „Zusammenhänge“; die Gruppen-
  // Beschriftung „Verknüpft" setzt ControlDetail darüber). Listen mit Punkten
  // wie Erweiterungen und Gefährdungen; die Relationsart steht leise unter
  // dem Link.
  return (
    <div className="space-y-3">
      {resolvedLinks.length > 0 && (
        <div className="space-y-3">
          {linkGroups.map((group, groupIndex) => {
            const groupLabelId = `control-dependencies-group-label-${groupIndex}`;
            return (
              <fieldset key={group.label} aria-labelledby={groupLabelId} className="min-w-0">
                {/* Relationsart als Gruppenname für Screenreader; sichtbar steht
                    sie leise unter jedem Link (Mock), nicht als zweite Beschriftung. */}
                <legend id={groupLabelId} className="sr-only">
                  {capitalize(group.label)}
                </legend>
                <ul className={detailListClass}>
                  {group.links.map((link) => {
                    const targetControl = controlsById?.get(link.targetId);
                    if (!targetControl) return null;
                    return (
                      <li key={`${link.targetId}-${link.href}-${link.rel ?? 'missing'}-${link.resourceFragment ?? ''}`}>
                        <ControlListLink
                          control={targetControl}
                          ariaLabel={`${link.targetId} ${targetControl.title} (${everydayRelationLabel(link)})`}
                          onNavigateToControl={onNavigateToControl}
                        />
                        <p className={relationNoteClass}>
                          <span aria-hidden="true">{group.label}</span>
                          {distinctReverseLinks(incomingByControlId.get(link.targetId)).map((incoming) => (
                            <Fragment key={`${incoming.control.id}-${incoming.link.rel ?? 'missing'}-${incoming.link.relStatus}`}>
                              <span aria-hidden="true"> · </span>
                              <span>{buildIncomingEverydayLabel(incoming)}</span>
                            </Fragment>
                          ))}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}
        </div>
      )}

      {incomingOnlyLinks.length > 0 && (
        <ul className={detailListClass}>
          {incomingOnlyLinks.map((incoming) => (
            <li key={`${incoming.control.id}-${incoming.link.href}-${incoming.link.rel ?? 'missing'}`}>
              <ControlListLink
                control={incoming.control}
                ariaLabel={`${incoming.control.id} ${incoming.control.title} (${everydayRelationLabel(incoming.link)})`}
                onNavigateToControl={onNavigateToControl}
              />
              <p className={relationNoteClass}>{buildIncomingEverydayLabel(incoming)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
