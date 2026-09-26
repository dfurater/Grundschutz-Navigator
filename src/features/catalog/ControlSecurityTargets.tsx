import { RELEVANCE_SCALE_MAX, RelevanceScale } from '@/components/StatusMeta';
import type { VocabularyResolution } from '@/domain/vocabulary';
import {
  SectionLegend,
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

/** Alle drei Stufen stammen aus dem BSI-Namensraum einer aufgelösten Stufe. */
function buildLegendEntries(securityTargets: SecurityTargetRow[]): LegendEntry[] {
  const namespace = securityTargets.find(({ levelResolution }) => levelResolution)?.levelResolution?.namespace;
  if (!namespace) return [];
  return namespace.entries
    .filter((entry) => entry.value === '0' || entry.value === '1' || entry.value === '2')
    .sort((first, second) => Number(first.value) - Number(second.value))
    .map((entry) => ({
      term: entry.value,
      definition: entry.definition ?? '',
      href: vocabularyEntryHref(namespace, entry.value),
    }));
}

export function ControlSecurityTargets({
  securityTargets,
  isVocabularyActive,
  onToggleVocabulary,
  renderVocabularyCard,
}: ControlSecurityTargetsProps) {
  const legendEntries = buildLegendEntries(securityTargets);

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <SubSectionHeading>Schutzziele</SubSectionHeading>
        {legendEntries.length > 0 && (
          <SectionLegend legendId="legende-merkmale" entries={legendEntries} />
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {securityTargets.map(({ key, label, relevance, targetResolution, levelResolution }) => {
          const targetVocabKey = `security-target:${key}`;
          const levelVocabKey = `security-target-level:${key}`;
          const targetActive = isVocabularyActive(targetVocabKey);
          const levelActive = isVocabularyActive(levelVocabKey);
          const relevanceScaleValue = toRelevanceScaleValue(relevance);

          return (
            <fieldset key={targetVocabKey} aria-label={`${label}: Relevanz ${relevance}`} className="min-w-0">
              {targetResolution ? (
                <TermTrigger
                  vocabKey={targetVocabKey}
                  active={targetActive}
                  onToggle={onToggleVocabulary}
                  label={label}
                  ariaLabel={`Schutzziel: ${label}`}
                />
              ) : (
                <span className="text-sm leading-relaxed text-slate-700">{label}</span>
              )}
              {levelResolution ? (
                <span className="mt-0.5 flex items-center gap-2">
                  <TermTrigger
                    vocabKey={levelVocabKey}
                    active={levelActive}
                    onToggle={onToggleVocabulary}
                    label={relevance}
                    ariaLabel={`Relevanz ${label}: ${relevance}`}
                  />
                  {relevanceScaleValue !== null && (
                    <span aria-hidden="true">
                      <RelevanceScale value={relevanceScaleValue} />
                    </span>
                  )}
                </span>
              ) : (
                <div>
                  <p className="text-sm leading-relaxed text-slate-700">{relevance}</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-700">
                    Keine offizielle Definition für diese Relevanzstufe verfügbar.
                  </p>
                </div>
              )}
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
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
