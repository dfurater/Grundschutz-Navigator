import { useId } from 'react';
import type { Control, ControlLink } from '@/domain/models';
import {
  type IncomingControlLink,
} from '@/domain/controlRelationships';
import { ControlListLink, ControlListNote } from './ControlListLink';
import { detailListClass, type LegendEntry } from './ControlVocabularyPrimitives';

export interface ControlDependenciesProps {
  readonly links: readonly ControlLink[];
  readonly controlsById?: ReadonlyMap<string, Control>;
  readonly incomingLinks?: readonly IncomingControlLink[];
  readonly onNavigateToControl?: (control: Control) => void;
}

/**
 * Alltagslabel einer Verknüpfung (GSPP-303 T8): bekannte `rel`-Werte →
 * „Verwandt"/„Erfordert"/„Referenz", sonst `Benutzerdefinierte Relation
 * „<rel>"`. Die Herkunft je Label erklärt die Legende; die Zeile nennt sie nicht.
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

/** Einleitung des Hinweises zur Gegenrichtung; die Kennung steht bereits in der Link-Zeile. */
export const INCOMING_NOTE_PREFIX = 'Verweist auf diese Kontrolle';

/**
 * Hinweis zur Gegenrichtung: „Verweist auf diese Kontrolle · <Relationsart>“.
 * Mehrere verschiedene Relationsarten stehen kommagetrennt in ihrer
 * Reihenfolge; jede nur einmal.
 */
export function buildIncomingEverydayLabel(incomingLinks: readonly IncomingControlLink[]): string {
  const labels = [...new Set(incomingLinks.map((incoming) => everydayRelationLabel(incoming.link)))];
  return `${INCOMING_NOTE_PREFIX} · ${labels.join(', ')}`;
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
      definition: 'Nur „Referenz“ (OSCAL-rel „reference“) ist im OSCAL-Katalogmodell dokumentiert. '
      + '„Verwandt“, „Erfordert“ und jede „Benutzerdefinierte Relation“ sind benutzerdefinierte '
      + 'OSCAL-Relationen; „Ohne Relationsangabe“ steht bei Links ohne rel.',
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

/** Sichtbare Beschriftung einer Relationsgruppe über ihrer Liste. */
const relationGroupLabelClass = 'mb-1 text-xs font-medium leading-snug text-slate-500';

export function ControlDependencies({
  links,
  controlsById,
  incomingLinks = [],
  onNavigateToControl,
}: ControlDependenciesProps) {
  const idBase = useId();
  const resolvedLinks = links.filter((link) => controlsById?.has(link.targetId));
  const incomingByControlId = buildIncomingLinksByControlId(incomingLinks);
  const outgoingIds = new Set(resolvedLinks.map((link) => link.targetId));
  // Reine eingehende Verweise einmal je Kontrolle, ihre Relationsarten gesammelt.
  const incomingOnlyByControlId = buildIncomingLinksByControlId(
    incomingLinks.filter((incoming) => !outgoingIds.has(incoming.control.id)),
  );
  const linkGroups = groupLinksByLabel(resolvedLinks);

  if (resolvedLinks.length === 0 && incomingOnlyByControlId.size === 0) {
    return null;
  }

  // GSPP-303 T9: hüllenlos (Teil des Blocks „Zusammenhänge“; die Gruppen-
  // Beschriftung „Verknüpft" setzt ControlDetail darüber). GSPP-447: Die
  // Relationsart steht einmal sichtbar über ihrer Gruppe; unter einem Link
  // steht nur noch ein eigener Hinweis zur Gegenrichtung.
  return (
    <div className="space-y-3">
      {linkGroups.map((group, groupIndex) => {
        const groupLabelId = `${idBase}-group-${groupIndex}`;
        return (
          <fieldset key={group.label} aria-labelledby={groupLabelId} className="min-w-0">
            <legend id={groupLabelId} className={relationGroupLabelClass}>
              {capitalize(group.label)}
            </legend>
            <ul className={detailListClass}>
              {group.links.map((link, linkIndex) => {
                const targetControl = controlsById?.get(link.targetId);
                if (!targetControl) return null;
                const reverseLinks = incomingByControlId.get(link.targetId);
                const noteId = reverseLinks ? `${idBase}-note-${groupIndex}-${linkIndex}` : undefined;
                return (
                  <li key={`${link.targetId}-${link.href}-${link.rel ?? 'missing'}-${link.resourceFragment ?? ''}`}>
                    <ControlListLink
                      control={targetControl}
                      ariaLabel={`${link.targetId} ${targetControl.title} (${everydayRelationLabel(link)})`}
                      describedById={noteId}
                      onNavigateToControl={onNavigateToControl}
                    />
                    {reverseLinks && noteId && (
                      <ControlListNote id={noteId}>{buildIncomingEverydayLabel(reverseLinks)}</ControlListNote>
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}

      {incomingOnlyByControlId.size > 0 && (
        <ul className={detailListClass}>
          {[...incomingOnlyByControlId.values()].map((incomings, index) => {
            const { control } = incomings[0];
            const noteId = `${idBase}-incoming-${index}`;
            return (
              <li key={control.id}>
                <ControlListLink
                  control={control}
                  ariaLabel={`${control.id} ${control.title}`}
                  describedById={noteId}
                  onNavigateToControl={onNavigateToControl}
                />
                <ControlListNote id={noteId}>{buildIncomingEverydayLabel(incomings)}</ControlListNote>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
