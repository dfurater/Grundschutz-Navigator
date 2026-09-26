import { EffortBadge, ModalverbBadge, SecurityLevelBadge } from '@/components/StatusMeta';
import type { Control } from '@/domain/models';
import type { ResolvedControlVocabularies, VocabularyResolution } from '@/domain/vocabulary';
import { getVocabularyTermLabel } from '@/features/vocabularies/vocabularyTitle';
import type { LegendEntry } from './ControlVocabularyPrimitives';

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
}

/**
 * Legenden-Eintrag für einen vorhandenen Kriterien-Wert (GSPP-303 T6): Das
 * Merkmal kommt aus `getVocabularyTermLabel`, der Term ist der Vokabeleintrag selbst (`entry.value`, bindende Klärung 1), die Route
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
    category: getVocabularyTermLabel(resolution.namespace.source.fileName),
    term: resolution.entry.value,
    definition: resolution.entry.definition ?? '',
    href: `/vokabular/${resolution.namespace.source.routeId}?wert=${encodeURIComponent(resolution.entry.value)}`,
  };
}

/**
 * Legenden-Einträge der Kriterien. Die Legende steht seit der Umstellung in
 * der Leiste „Anforderung“ (wie bei „Schutzziele und Gefährdungen“); leere Liste →
 * keine Legende (bindende Klärung 3: leere Gruppen entfallen).
 */
export function buildClassificationLegendEntries(
  control: ClassificationControl,
  resolvedVocabularies: ClassificationVocabularies,
): LegendEntry[] {
  return [
    toLegendEntry(control.modalverb, resolvedVocabularies.modalverb),
    toLegendEntry(control.securityLevel, resolvedVocabularies.securityLevel),
    toLegendEntry(control.effortLevel, resolvedVocabularies.effortLevel),
  ].filter((entry): entry is LegendEntry => entry !== null);
}

export function hasClassificationCriteria(control: ClassificationControl): boolean {
  return Boolean(control.modalverb || control.securityLevel || control.effortLevel);
}

/**
 * Kriterien-Zeile (Modalverb, Niveau, Aufwand) als statische Badges. Steht als
 * erste Zeile im Block „Anforderung“; die Legende trägt dessen Leiste.
 */
export function ControlClassification({ control }: ControlClassificationProps) {
  if (!hasClassificationCriteria(control)) {
    return null;
  }

  return (
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
  );
}
