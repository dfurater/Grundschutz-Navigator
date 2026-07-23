import { Fragment } from 'react';
import type { Control } from '@/domain/models';
import type { ResolvedControlVocabularies } from '@/domain/vocabulary';
import { ControlDetailSection } from './ControlDetailSection';
import {
  findResolutionByValue,
  type RenderVocabularyCard,
  SubSectionHeading,
  toVocabCardId,
  VocabularyAffordanceIcon,
} from './ControlVocabularyPrimitives';

type SecurityContextControl = Pick<
  Control,
  | 'confidentiality'
  | 'integrity'
  | 'availability'
  | 'authenticity'
  | 'threats'
>;

type SecurityContextVocabularies = Pick<
  ResolvedControlVocabularies,
  'securityTargets' | 'threats'
>;

export interface ControlSecurityContextProps {
  control: SecurityContextControl;
  resolvedVocabularies: SecurityContextVocabularies;
  isVocabularyActive: (key: string) => boolean;
  onToggleVocabulary: (key: string) => void;
  renderVocabularyCard: RenderVocabularyCard;
}

const interactiveValueClass = (active: boolean) =>
  `flex w-full items-start gap-1 rounded text-left text-sm leading-relaxed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)] ${
    active
      ? 'font-medium text-primary-main underline decoration-primary-main/40 underline-offset-4'
      : 'text-slate-700'
  }`;

export function ControlSecurityContext({
  control,
  resolvedVocabularies,
  isVocabularyActive,
  onToggleVocabulary,
  renderVocabularyCard,
}: ControlSecurityContextProps) {
  const securityTargets = [
    {
      key: 'confidentiality',
      label: 'Vertraulichkeit',
      relevance: control.confidentiality,
      resolution: resolvedVocabularies.securityTargets.confidentiality,
    },
    {
      key: 'integrity',
      label: 'Integrität',
      relevance: control.integrity,
      resolution: resolvedVocabularies.securityTargets.integrity,
    },
    {
      key: 'availability',
      label: 'Verfügbarkeit',
      relevance: control.availability,
      resolution: resolvedVocabularies.securityTargets.availability,
    },
    {
      key: 'authenticity',
      label: 'Authentizität',
      relevance: control.authenticity,
      resolution: resolvedVocabularies.securityTargets.authenticity,
    },
  ].filter((securityTarget) => securityTarget.relevance !== undefined);
  const hasSecurityTargets = securityTargets.length > 0;
  const hasThreats = control.threats.length > 0;

  if (!hasSecurityTargets && !hasThreats) {
    return null;
  }

  return (
    <ControlDetailSection heading="Schutzziele und Gefährdungen">
      <div className="space-y-4">
        {hasSecurityTargets && (
          <div>
            <SubSectionHeading>Schutzziele</SubSectionHeading>
            <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-3 sm:gap-y-4">
              {securityTargets.map(({ key, label, relevance, resolution }) => {
                const vocabKey = `security-target:${key}`;
                const active = isVocabularyActive(vocabKey);

                return (
                  <Fragment key={vocabKey}>
                    <dt className="catalog-meta-text pt-1">{label}</dt>
                    <dd>
                      {resolution ? (
                        <button
                          type="button"
                          onClick={() => onToggleVocabulary(vocabKey)}
                          aria-label={`Schutzziel: ${label}`}
                          aria-pressed={active}
                          aria-expanded={active}
                          aria-controls={toVocabCardId(vocabKey)}
                          className={interactiveValueClass(active)}
                        >
                          <span>Relevanz: {relevance}</span>
                          <VocabularyAffordanceIcon active={active} />
                        </button>
                      ) : (
                        <p className="text-sm leading-relaxed text-slate-700">
                          Relevanz: {relevance}
                        </p>
                      )}
                    </dd>
                    {resolution && (
                      <dd
                        id={toVocabCardId(vocabKey)}
                        className="col-span-full"
                        hidden={!active || undefined}
                      >
                        {active && renderVocabularyCard(resolution)}
                      </dd>
                    )}
                  </Fragment>
                );
              })}
            </dl>
          </div>
        )}

        {hasThreats && (
          <div>
            <SubSectionHeading>Elementare Gefährdungen</SubSectionHeading>
            <div className="space-y-2">
              {control.threats.map((threat, index) => {
                const resolution = findResolutionByValue(
                  resolvedVocabularies.threats,
                  threat,
                );
                const vocabKey = `threat:${threat}:${index}`;
                const active = isVocabularyActive(vocabKey);

                return resolution ? (
                  <div key={vocabKey}>
                    <button
                      type="button"
                      onClick={() => onToggleVocabulary(vocabKey)}
                      aria-label={`Elementare Gefährdung: ${threat}`}
                      aria-pressed={active}
                      aria-expanded={active}
                      aria-controls={toVocabCardId(vocabKey)}
                      className={interactiveValueClass(active)}
                    >
                      <span>{threat}</span>
                      <VocabularyAffordanceIcon active={active} />
                    </button>
                    <div
                      id={toVocabCardId(vocabKey)}
                      hidden={!active || undefined}
                    >
                      {active && renderVocabularyCard(resolution)}
                    </div>
                  </div>
                ) : (
                  <p
                    key={vocabKey}
                    className="text-sm leading-relaxed text-slate-700"
                  >
                    {threat}
                  </p>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </ControlDetailSection>
  );
}
