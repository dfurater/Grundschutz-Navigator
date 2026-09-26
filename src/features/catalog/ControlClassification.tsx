import { EffortBadge, ModalverbBadge, SecurityLevelBadge } from '@/components/StatusMeta';
import type { Control } from '@/domain/models';
import type { ResolvedControlVocabularies, VocabularyResolution } from '@/domain/vocabulary';
import {
  SectionLegend,
  type LegendEntry,
} from './ControlVocabularyPrimitives';

type ClassificationControl = Pick<
  Control,
  'modalverb' | 'securityLevel' | 'effortLevel' | 'tags' | 'taxonomy'
> & {
  statementProps: Pick<Control['statementProps'], 'zielobjektKategorien'>;
};

type ClassificationVocabularies = Pick<
  ResolvedControlVocabularies,
  'modalverb' | 'securityLevel' | 'effortLevel' | 'tags'
> & {
  statement: Pick<ResolvedControlVocabularies['statement'], 'zielobjektKategorien'>;
};

export interface ControlClassificationProps {
  readonly control: ClassificationControl;
  readonly resolvedVocabularies: ClassificationVocabularies;
}

/**
 * Legenden-Eintrag für einen vorhandenen Kriterien-Wert (GSPP-303 T6): Der Term
 * ist der Vokabeleintrag selbst (`entry.value`, bindende Klärung 1), die Route
 * seine `routeId`, der Wert URL-kodiert (bindende Klärung 2, Präzedenz
 * `buildEntryHref`). Ohne Resolution gibt es keinen Eintrag.
 */
function toLegendEntry(
  displayedValue: string | undefined,
  resolution: VocabularyResolution | null,
): LegendEntry | null {
  if (!displayedValue || !resolution) {
    return null;
  }

  return {
    term: resolution.entry.value,
    definition: resolution.entry.definition ?? '',
    href: `/vokabular/${resolution.namespace.source.routeId}?wert=${encodeURIComponent(resolution.entry.value)}`,
  };
}

export function ControlClassification({
  control,
  resolvedVocabularies,
}: ControlClassificationProps) {
  const hasControllingCriteria = Boolean(
    control.modalverb || control.securityLevel || control.effortLevel,
  );

  if (!hasControllingCriteria) {
    return null;
  }

  // Nur vorhandene Resolutions aufnehmen; bei leerer Liste entfällt die
  // Legende ganz (bindende Klärung 3: leere Gruppen entfallen).
  const legendEntries = [
    toLegendEntry(control.modalverb, resolvedVocabularies.modalverb),
    toLegendEntry(control.securityLevel, resolvedVocabularies.securityLevel),
    toLegendEntry(control.effortLevel, resolvedVocabularies.effortLevel),
  ].filter((entry): entry is LegendEntry => entry !== null);

  // GSPP-303 T9: hüllenlos (Kurzprofil-Block ohne Überschrift); Tags und
  // WLAN-Taxonomie rendert die Merkmale-Zone (`ControlSubjectGroups`,
  // `ControlWlanTaxonomy`).
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <fieldset aria-label="Kriterien" className="min-w-0">
          <div className="flex flex-wrap gap-2">
            {control.modalverb && (
              <ModalverbBadge value={control.modalverb} />
            )}
            {control.securityLevel && (
              <SecurityLevelBadge value={control.securityLevel} />
            )}
            {control.effortLevel && (
              <EffortBadge value={control.effortLevel} />
            )}
          </div>
        </fieldset>
        {legendEntries.length > 0 && (
          <SectionLegend legendId="legende-kurzprofil" entries={legendEntries} />
        )}
      </div>
    </div>
  );
}
