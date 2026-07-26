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
  | 'confidentialityProp'
  | 'integrity'
  | 'integrityProp'
  | 'availability'
  | 'availabilityProp'
  | 'authenticity'
  | 'authenticityProp'
  | 'threats'
>;

type SecurityContextVocabularies = Pick<
  ResolvedControlVocabularies,
  'securityTargets' | 'securityTargetLevels' | 'threats'
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
      relevance: control.confidentialityProp?.value ?? control.confidentiality,
      targetResolution: resolvedVocabularies.securityTargets.confidentiality,
      levelResolution: resolvedVocabularies.securityTargetLevels.confidentiality,
    },
    {
      key: 'integrity',
      label: 'Integrität',
      relevance: control.integrityProp?.value ?? control.integrity,
      targetResolution: resolvedVocabularies.securityTargets.integrity,
      levelResolution: resolvedVocabularies.securityTargetLevels.integrity,
    },
    {
      key: 'availability',
      label: 'Verfügbarkeit',
      relevance: control.availabilityProp?.value ?? control.availability,
      targetResolution: resolvedVocabularies.securityTargets.availability,
      levelResolution: resolvedVocabularies.securityTargetLevels.availability,
    },
    {
      key: 'authenticity',
      label: 'Authentizität',
      relevance: control.authenticityProp?.value ?? control.authenticity,
      targetResolution: resolvedVocabularies.securityTargets.authenticity,
      levelResolution: resolvedVocabularies.securityTargetLevels.authenticity,
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

                return (
                  <Fragment key={targetVocabKey}>
                    <dt className="catalog-meta-text pt-1">
                      {targetResolution ? (
                        <button
                          type="button"
                          onClick={() => onToggleVocabulary(targetVocabKey)}
                          aria-label={`Schutzziel: ${label}`}
                          aria-pressed={targetActive}
                          aria-expanded={targetActive}
                          aria-controls={toVocabCardId(targetVocabKey)}
                          className={interactiveValueClass(targetActive)}
                        >
                          <span>{label}</span>
                          <VocabularyAffordanceIcon active={targetActive} />
                        </button>
                      ) : label}
                    </dt>
                    <dd>
                      {levelResolution ? (
                        <button
                          type="button"
                          onClick={() => onToggleVocabulary(levelVocabKey)}
                          aria-label={`Relevanz ${label}: ${relevance}`}
                          aria-pressed={levelActive}
                          aria-expanded={levelActive}
                          aria-controls={toVocabCardId(levelVocabKey)}
                          className={interactiveValueClass(levelActive)}
                        >
                          <span>Relevanz: {relevance}</span>
                          <VocabularyAffordanceIcon active={levelActive} />
                        </button>
                      ) : (
                        <div>
                          <p className="text-sm leading-relaxed text-slate-700">
                            Relevanz: {relevance}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-amber-700">
                            Keine offizielle Definition für diese Relevanzstufe verfügbar.
                          </p>
                        </div>
                      )}
                    </dd>
                    {targetResolution && (
                      <dd
                        id={toVocabCardId(targetVocabKey)}
                        className="col-span-full"
                        hidden={!targetActive || undefined}
                      >
                        {targetActive && renderVocabularyCard(targetResolution)}
                      </dd>
                    )}
                    {levelResolution && (
                      <dd
                        id={toVocabCardId(levelVocabKey)}
                        className="col-span-full"
                        hidden={!levelActive || undefined}
                      >
                        {levelActive && renderVocabularyCard(levelResolution)}
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
