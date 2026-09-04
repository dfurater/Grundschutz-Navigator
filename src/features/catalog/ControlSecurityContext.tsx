import type { Control } from '@/domain/models';
import type { ResolvedControlVocabularies } from '@/domain/vocabulary';
import { ControlDetailSection } from './ControlDetailSection';
import {
  ControlSecurityTargets,
  type SecurityTargetRow,
} from './ControlSecurityTargets';
import {
  findResolutionByValue,
  leadingAffordanceIndentClass,
  leadingTriggerClass,
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
  readonly control: SecurityContextControl;
  readonly resolvedVocabularies: SecurityContextVocabularies;
  readonly isVocabularyActive: (key: string) => boolean;
  readonly onToggleVocabulary: (key: string) => void;
  readonly renderVocabularyCard: RenderVocabularyCard;
}

interface ThreatItem {
  threat: string;
  displayName: string;
  vocabKey: string;
  resolution: ReturnType<typeof findResolutionByValue>;
  showsTerm: boolean;
}

function buildSecurityTargetRows(
  control: SecurityContextControl,
  resolvedVocabularies: SecurityContextVocabularies,
): SecurityTargetRow[] {
  return [
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
  ].filter(
    (securityTarget): securityTarget is SecurityTargetRow =>
      securityTarget.relevance !== undefined,
  );
}

/**
 * Anzeigename `Begriff (ID)` laut GSPP-302; ohne auflösbaren Begriff bleibt es bei
 * der reinen ID. Der Vokabular-Key behält den Index aus der Prop-Reihenfolge,
 * damit die alphabetische Sortierung den aufgeklappten Zustand nicht verschiebt
 * und doppelte Werte unterscheidbar bleiben.
 */
function buildThreatItems(
  threats: readonly string[],
  resolutions: SecurityContextVocabularies['threats'],
): ThreatItem[] {
  return threats
    .map((threat, index) => {
      const resolution = findResolutionByValue(resolutions, threat);
      const term = resolution?.entry.columns['Begriff']?.trim();
      const showsTerm = Boolean(term && term !== threat);

      return {
        threat,
        displayName: showsTerm ? `${term} (${threat})` : threat,
        vocabKey: `threat:${threat}:${index}`,
        resolution,
        showsTerm,
      };
    })
    .sort(
      (first, second) =>
        first.displayName.localeCompare(second.displayName, 'de') ||
        first.threat.localeCompare(second.threat, 'de') ||
        first.vocabKey.localeCompare(second.vocabKey, 'de'),
    );
}

export function ControlSecurityContext({
  control,
  resolvedVocabularies,
  isVocabularyActive,
  onToggleVocabulary,
  renderVocabularyCard,
}: ControlSecurityContextProps) {
  const securityTargets = buildSecurityTargetRows(control, resolvedVocabularies);
  const threatItems = buildThreatItems(control.threats, resolvedVocabularies.threats);

  if (securityTargets.length === 0 && threatItems.length === 0) {
    return null;
  }

  return (
    <ControlDetailSection heading="Schutzziele und Gefährdungen">
      <div className="space-y-4">
        {securityTargets.length > 0 && (
          <ControlSecurityTargets
            securityTargets={securityTargets}
            isVocabularyActive={isVocabularyActive}
            onToggleVocabulary={onToggleVocabulary}
            renderVocabularyCard={renderVocabularyCard}
          />
        )}

        {threatItems.length > 0 && (
          <div>
            <SubSectionHeading>Elementare Gefährdungen</SubSectionHeading>
            <div className="space-y-2">
              {threatItems.map(({
                threat,
                displayName,
                vocabKey,
                resolution,
                showsTerm,
              }) => {
                const active = isVocabularyActive(vocabKey);

                return resolution ? (
                  <div key={vocabKey}>
                    <button
                      type="button"
                      onClick={() => onToggleVocabulary(vocabKey)}
                      aria-label={`Elementare Gefährdung: ${displayName}`}
                      aria-pressed={active}
                      aria-expanded={active}
                      aria-controls={toVocabCardId(vocabKey)}
                      className={leadingTriggerClass(active)}
                    >
                      <VocabularyAffordanceIcon active={active} placement="leading" />
                      <span className="min-w-0 flex-1">{displayName}</span>
                    </button>
                    <div
                      id={toVocabCardId(vocabKey)}
                      hidden={!active || undefined}
                    >
                      {active && renderVocabularyCard(resolution, {
                        hiddenColumns: showsTerm ? ['Begriff'] : [],
                      })}
                    </div>
                  </div>
                ) : (
                  <p
                    key={vocabKey}
                    className={`text-sm leading-relaxed text-slate-700 ${leadingAffordanceIndentClass}`}
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
