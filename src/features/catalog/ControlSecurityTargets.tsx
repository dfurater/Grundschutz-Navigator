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
 * Legende „Schutzziele und Gefährdungen“: alle drei Stufen aus dem BSI-Namensraum einer
 * aufgelösten Stufe, jeweils als dieselbe Punkte-Skala wie im Raster. Der Textlink steht in der Leiste „Schutzziele und Gefährdungen“
 * (`ControlDetailSection`), nicht im Schutzziel-Raster.
 */
export function buildRelevanceLegendEntries(
  levelResolutions: ReadonlyArray<VocabularyResolution | null>,
): LegendEntry[] {
  const namespace = levelResolutions.find((resolution) => resolution)?.namespace;
  if (!namespace) return [];
  return namespace.entries
    .filter((entry) => entry.value === '0' || entry.value === '1' || entry.value === '2')
    .sort((first, second) => Number(first.value) - Number(second.value))
    .map((entry) => ({
      category: getVocabularyTermLabel(namespace.source.fileName),
      term: entry.value,
      definition: entry.definition ?? '',
      href: vocabularyEntryHref(namespace, entry.value),
      visual: <RelevanceScale value={Number(entry.value)} />,
    }));
}

export function ControlSecurityTargets({
  securityTargets,
  isVocabularyActive,
  onToggleVocabulary,
  renderVocabularyCard,
}: ControlSecurityTargetsProps) {
  return (
    <div>
      <SubSectionHeading>Schutzziele</SubSectionHeading>
      {/*
        2×2-Raster mit Spalten in Inhaltsbreite: Die Punkte stehen direkt hinter
        ihrem Schutzziel und untereinander bündig, unabhängig von der
        Panelbreite (Owner 26.09.2026). Zeilenhöhe fest, Touch-Fläche über
        Pseudo-Elemente statt `min-h-11`, damit am Breakpoint nichts springt.
      */}
      <div className="grid w-fit grid-cols-[max-content_max-content_1.5rem_max-content_max-content] gap-x-3 gap-y-1.5 text-sm leading-relaxed text-slate-700">
        {securityTargets.map(({ key, label, relevance, targetResolution, levelResolution }, index) => {
          const targetVocabKey = `security-target:${key}`;
          const levelVocabKey = `security-target-level:${key}`;
          const targetActive = isVocabularyActive(targetVocabKey);
          const levelActive = isVocabularyActive(levelVocabKey);
          const relevanceScaleValue = toRelevanceScaleValue(relevance);

          return (
            // `div role="group"` statt `fieldset`: Chromium wendet `subgrid` auf
            // das Fieldset nicht an, die Punkte rutschten unter den Namen.
            <div
              role="group"
              key={targetVocabKey}
              aria-label={`${label}: Relevanz ${relevance}`}
              className={`col-span-2 grid grid-cols-subgrid items-center ${index % 2 === 0 ? 'col-start-1' : 'col-start-4'}`}
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
              {levelResolution && relevanceScaleValue !== null ? (
                // Die Skala ist der Relevanz-Trigger; der Wert steht für
                // Screenreader im Text, sichtbar erklärt ihn die Legende.
                <button
                  type="button"
                  aria-pressed={levelActive}
                  aria-expanded={levelActive}
                  aria-controls={toVocabCardId(levelVocabKey)}
                  aria-label={`Relevanz ${label}: ${relevance}`}
                  title={`Relevanz ${relevance}`}
                  onClick={() => {
                    onToggleVocabulary(levelVocabKey);
                  }}
                  className="relative inline-flex min-h-6 min-w-6 cursor-pointer items-center rounded after:absolute after:-inset-2.5 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)] lg:after:-inset-1"
                >
                  <span aria-hidden="true">
                    <RelevanceScale value={relevanceScaleValue} />
                  </span>
                  <span className="sr-only">{relevance}</span>
                </button>
              ) : (
                <span className="tabular-nums">{relevance}</span>
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
      {securityTargets.map(({ key, targetResolution, levelResolution }) => {
        const targetVocabKey = `security-target:${key}`;
        const levelVocabKey = `security-target-level:${key}`;
        const targetActive = isVocabularyActive(targetVocabKey);
        const levelActive = isVocabularyActive(levelVocabKey);
        return (
          <div key={`${key}-cards`}>
            {targetResolution && (
              <div id={toVocabCardId(targetVocabKey)} hidden={!targetActive || undefined}>
                {targetActive && renderVocabularyCard(targetResolution)}
              </div>
            )}
            {levelResolution && (
              <div id={toVocabCardId(levelVocabKey)} hidden={!levelActive || undefined}>
                {levelActive && renderVocabularyCard(levelResolution)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
