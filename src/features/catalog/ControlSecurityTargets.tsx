import { RELEVANCE_SCALE_MAX, RelevanceScale } from '@/components/StatusMeta';
import type { VocabularyResolution } from '@/domain/vocabulary';
import { getVocabularyTermLabel } from '@/features/vocabularies/vocabularyTitle';
import {
  SubSectionHeading,
  TermTrigger,
  toVocabCardId,
  vocabularyEntryHref,
  type LegendEntry,
  type RenderVocabularyCard,
} from './ControlVocabularyPrimitives';

export interface SecurityTargetRow {
  key: string;
  label: string;
  relevance: string;
  targetResolution: VocabularyResolution | null;
  levelResolution: VocabularyResolution | null;
}

export interface ControlSecurityTargetsProps {
  readonly securityTargets: SecurityTargetRow[];
  readonly isVocabularyActive: (key: string) => boolean;
  readonly onToggleVocabulary: (key: string) => void;
  readonly renderVocabularyCard: RenderVocabularyCard;
}

/** Liefert die Punktzahl der Skala oder `null` für Werte außerhalb der Skala. */
function toRelevanceScaleValue(relevance: string) {
  const parsed = Number.parseInt(relevance, 10);
  const isScaleValue = String(parsed) === relevance.trim()
    && parsed >= 0
    && parsed <= RELEVANCE_SCALE_MAX;

  return isScaleValue ? parsed : null;
}

/**
 * Legende „Schutzziele und Gefährdungen“: alle Stufen aus dem BSI-Namensraum einer
 * aufgelösten Stufe. Stufen der Skala stehen als dieselbe Punkte-Skala wie im
 * Raster, danach jede weitere Stufe mit ihrem Wert, damit auch ein künftiger
 * Wert außerhalb der Skala erklärt bleibt. Der Textlink steht in der Leiste
 * „Schutzziele und Gefährdungen“ (`ControlDetailSection`), nicht im Schutzziel-Raster.
 */
export function buildRelevanceLegendEntries(
  levelResolutions: ReadonlyArray<VocabularyResolution | null>,
): LegendEntry[] {
  const namespace = levelResolutions.find(Boolean)?.namespace;
  if (!namespace) return [];
  const rank = (value: string) => toRelevanceScaleValue(value) ?? Number.POSITIVE_INFINITY;
  // Kopie statt `toSorted`: Vite ergänzt keine Polyfills für ES2023.
  const entries = [...namespace.entries];
  entries.sort((first, second) => rank(first.value) - rank(second.value)
    || first.value.localeCompare(second.value));
  return entries.map((entry) => {
    const scaleValue = toRelevanceScaleValue(entry.value);
    return {
      category: getVocabularyTermLabel(namespace.source.fileName),
      term: entry.value,
      definition: entry.definition ?? '',
      href: vocabularyEntryHref(namespace, entry.value),
      ...(scaleValue === null ? {} : { visual: <RelevanceScale value={scaleValue} /> }),
    };
  });
}

export function ControlSecurityTargets({
  securityTargets,
  isVocabularyActive,
  onToggleVocabulary,
  renderVocabularyCard,
}: ControlSecurityTargetsProps) {
  return (
    <div className="@container">
      <SubSectionHeading>Schutzziele</SubSectionHeading>
      {/*
        Zwei Spaltenpaare ab 18.5rem Inhaltsbreite, darunter ein Paar pro Zeile.
        Das 2×2-Raster braucht mit geladenen App-Schriften 18,16rem (290,5 px
        bei 16 px Grundschrift, Chromium, GSPP-447); der Rest ist Reserve für
        abweichende Schriftmetrik. In `rem` wandert der Umschaltpunkt mit einer
        vergrößerten Grundschrift mit. Die Punkte stehen direkt hinter ihrem
        Schutzziel und untereinander bündig. Zeilenhöhe fest, Touch-Fläche der
        Namen über Pseudo-Elemente statt `min-h-11`, damit am Umschaltpunkt
        nichts springt.
      */}
      <div className="grid w-fit grid-cols-[max-content_max-content] gap-x-3 gap-y-1.5 text-sm leading-relaxed text-slate-700 @min-[18.5rem]:grid-cols-[max-content_max-content_1.5rem_max-content_max-content]">
        {securityTargets.map(({ key, label, relevance, targetResolution, levelResolution }, index) => {
          const targetVocabKey = `security-target:${key}`;
          const targetActive = isVocabularyActive(targetVocabKey);
          const relevanceScaleValue = toRelevanceScaleValue(relevance);

          return (
            // `div role="group"` statt `fieldset`: Chromium wendet `subgrid` auf
            // das Fieldset nicht an, die Punkte rutschten unter den Namen.
            <div
              role="group"
              key={targetVocabKey}
              aria-label={`${label}: Relevanz ${relevance}`}
              className={`col-span-2 grid grid-cols-subgrid items-center ${index % 2 === 0 ? 'col-start-1' : '@min-[18.5rem]:col-start-4'}`}
            >
              {targetResolution ? (
                <TermTrigger
                  vocabKey={targetVocabKey}
                  active={targetActive}
                  onToggle={onToggleVocabulary}
                  label={label}
                  ariaLabel={`Schutzziel: ${label}`}
                  className="relative inline-flex min-h-6 items-center text-left after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-[''] lg:after:-inset-y-1"
                />
              ) : (
                <span>{label}</span>
              )}
              {/*
                Die Relevanz ist reine Anzeige (GSPP-447): Ihre feste Skala
                erklärt die Legende „Schutzziele und Gefährdungen“. Werte
                außerhalb der Skala stehen als Rohwert.
              */}
              {relevanceScaleValue === null ? (
                <span className="tabular-nums">{relevance}</span>
              ) : (
                <span className="inline-flex min-h-6 items-center" title={`Relevanz ${relevance}`}>
                  <span aria-hidden="true">
                    <RelevanceScale value={relevanceScaleValue} />
                  </span>
                  <span className="sr-only">Relevanz {relevance}</span>
                </span>
              )}
              {!levelResolution && (
                // `contain` hält den Hinweis aus der Spaltenbreite heraus.
                <p className="col-span-2 text-xs leading-snug text-amber-700 [contain:inline-size]">
                  Keine offizielle Definition für diese Relevanzstufe verfügbar.
                </p>
              )}
            </div>
          );
        })}
      </div>
      {/* Karten in voller Breite unter dem Raster, damit sie keine Spalte verbreitern. */}
      {securityTargets.map(({ key, targetResolution }) => {
        if (!targetResolution) return null;
        const targetVocabKey = `security-target:${key}`;
        const targetActive = isVocabularyActive(targetVocabKey);
        return (
          <div key={`${key}-card`} id={toVocabCardId(targetVocabKey)} hidden={!targetActive || undefined}>
            {targetActive && renderVocabularyCard(targetResolution)}
          </div>
        );
      })}
    </div>
  );
}
