import { Fragment } from 'react';
import { RELEVANCE_SCALE_MAX, RelevanceScale } from '@/components/StatusMeta';
import type { VocabularyResolution } from '@/domain/vocabulary';
import {
  leadingAffordanceIndentClass,
  leadingTriggerClass,
  type RenderVocabularyCard,
  SubSectionHeading,
  toVocabCardId,
  VocabularyAffordanceIcon,
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

const cellClass = 'py-0.5 align-top';

/** Liefert die Punktzahl der Skala oder `null` für Werte außerhalb der Skala. */
function toRelevanceScaleValue(relevance: string) {
  const parsed = Number.parseInt(relevance, 10);
  const isScaleValue =
    String(parsed) === relevance.trim() && parsed >= 0 && parsed <= RELEVANCE_SCALE_MAX;

  return isScaleValue ? parsed : null;
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
      <table className="w-full border-collapse">
        <caption className="sr-only">Schutzziele und ihre Relevanz</caption>
        <thead>
          <tr>
            {/* Die Subsection-Überschrift benennt diese Spalte bereits sichtbar. */}
            <th scope="col" className="w-full pb-1 text-left font-normal">
              <span className="sr-only">Schutzziel</span>
            </th>
            <th
              scope="col"
              className="catalog-meta-text whitespace-nowrap pb-1 text-left"
            >
              Relevanz
            </th>
          </tr>
        </thead>
        <tbody>
          {securityTargets.map(({
            key,
            label,
            relevance,
            targetResolution,
            levelResolution,
          }) => {
            const targetVocabKey = `security-target:${key}`;
            const levelVocabKey = `security-target-level:${key}`;
            const targetActive = isVocabularyActive(targetVocabKey);
            const levelActive = isVocabularyActive(levelVocabKey);
            const relevanceScaleValue = toRelevanceScaleValue(relevance);

            return (
              <Fragment key={targetVocabKey}>
                <tr>
                  <th
                    scope="row"
                    className={`${cellClass} pr-4 text-left text-sm font-normal leading-relaxed text-slate-700`}
                  >
                    {targetResolution ? (
                      <button
                        type="button"
                        onClick={() => onToggleVocabulary(targetVocabKey)}
                        aria-label={`Schutzziel: ${label}`}
                        aria-pressed={targetActive}
                        aria-expanded={targetActive}
                        aria-controls={toVocabCardId(targetVocabKey)}
                        className={leadingTriggerClass(targetActive)}
                      >
                        <VocabularyAffordanceIcon
                          active={targetActive}
                          placement="leading"
                        />
                        <span className="min-w-0 flex-1">{label}</span>
                      </button>
                    ) : (
                      <span className={`block ${leadingAffordanceIndentClass}`}>
                        {label}
                      </span>
                    )}
                  </th>
                  <td className={cellClass}>
                    {levelResolution ? (
                      <button
                        type="button"
                        onClick={() => onToggleVocabulary(levelVocabKey)}
                        aria-label={`Relevanz ${label}: ${relevance}`}
                        title={`Relevanz ${label}: ${relevance}`}
                        aria-pressed={levelActive}
                        aria-expanded={levelActive}
                        aria-controls={toVocabCardId(levelVocabKey)}
                        className={leadingTriggerClass(levelActive)}
                      >
                        <VocabularyAffordanceIcon
                          active={levelActive}
                          placement="leading"
                        />
                        {relevanceScaleValue === null ? (
                          <span className="min-w-0 flex-1">{relevance}</span>
                        ) : (
                          <RelevanceScale value={relevanceScaleValue} />
                        )}
                      </button>
                    ) : (
                      <div className={leadingAffordanceIndentClass}>
                        <p className="text-sm leading-relaxed text-slate-700">
                          {relevance}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-amber-700">
                          Keine offizielle Definition für diese Relevanzstufe verfügbar.
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
                {targetResolution && (
                  <tr
                    id={toVocabCardId(targetVocabKey)}
                    hidden={!targetActive || undefined}
                  >
                    <td colSpan={2}>
                      {targetActive && renderVocabularyCard(targetResolution)}
                    </td>
                  </tr>
                )}
                {levelResolution && (
                  <tr
                    id={toVocabCardId(levelVocabKey)}
                    hidden={!levelActive || undefined}
                  >
                    <td colSpan={2}>
                      {levelActive && renderVocabularyCard(levelResolution)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
