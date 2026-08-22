import { EffortBadge, ModalverbBadge, SecurityLevelBadge } from '@/components/StatusMeta';
import type { Control } from '@/domain/models';
import type { ResolvedControlVocabularies } from '@/domain/vocabulary';
import { ControlDetailSection } from './ControlDetailSection';
import { ControlTaxonomy } from './ControlTaxonomy';
import {
  toVocabCardId,
  type RenderVocabularyCard,
  VocabularyAffordanceIcon,
  vocabButtonClass,
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
  control: ClassificationControl;
  resolvedVocabularies: ClassificationVocabularies;
  isVocabularyActive: (key: string) => boolean;
  onToggleVocabulary: (key: string) => void;
  renderVocabularyCard: RenderVocabularyCard;
}

interface ClassificationVocabularyBadgeProps {
  vocabKey: 'modalverb' | 'securityLevel' | 'effortLevel';
  active: boolean;
  onToggleVocabulary: (key: string) => void;
  children: React.ReactNode;
}

function ClassificationVocabularyBadge({
  vocabKey,
  active,
  onToggleVocabulary,
  children,
}: ClassificationVocabularyBadgeProps) {
  return (
    <button
      type="button"
      onClick={() => onToggleVocabulary(vocabKey)}
      aria-pressed={active}
      aria-expanded={active}
      aria-controls={toVocabCardId(vocabKey)}
      className={vocabButtonClass(active)}
    >
      {children}
    </button>
  );
}

export function ControlClassification({
  control,
  resolvedVocabularies,
  isVocabularyActive,
  onToggleVocabulary,
  renderVocabularyCard,
}: ControlClassificationProps) {
  const hasControllingCriteria = Boolean(
    control.modalverb || control.securityLevel || control.effortLevel,
  );
  const hasTaxonomy = control.tags.length > 0
    || control.statementProps.zielobjektKategorien.length > 0
    || control.taxonomy.length > 0;

  if (!hasControllingCriteria && !hasTaxonomy) {
    return null;
  }

  const modalverbActive = isVocabularyActive('modalverb');
  const securityLevelActive = isVocabularyActive('securityLevel');
  const effortLevelActive = isVocabularyActive('effortLevel');

  return (
    <ControlDetailSection heading="Klassifikation">
      <div className="space-y-4">
        {hasControllingCriteria && (
          <div role="group" aria-label="Kriterien" className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {control.modalverb && (
                resolvedVocabularies.modalverb ? (
                  <ClassificationVocabularyBadge
                    vocabKey="modalverb"
                    active={modalverbActive}
                    onToggleVocabulary={onToggleVocabulary}
                  >
                    <ModalverbBadge
                      value={control.modalverb}
                      trailingIcon={(
                        <VocabularyAffordanceIcon active={modalverbActive} placement="badge" />
                      )}
                    />
                  </ClassificationVocabularyBadge>
                ) : (
                  <ModalverbBadge value={control.modalverb} />
                )
              )}
              {control.securityLevel && (
                resolvedVocabularies.securityLevel ? (
                  <ClassificationVocabularyBadge
                    vocabKey="securityLevel"
                    active={securityLevelActive}
                    onToggleVocabulary={onToggleVocabulary}
                  >
                    <SecurityLevelBadge
                      value={control.securityLevel}
                      trailingIcon={(
                        <VocabularyAffordanceIcon active={securityLevelActive} placement="badge" />
                      )}
                    />
                  </ClassificationVocabularyBadge>
                ) : (
                  <SecurityLevelBadge value={control.securityLevel} />
                )
              )}
              {control.effortLevel && (
                resolvedVocabularies.effortLevel ? (
                  <ClassificationVocabularyBadge
                    vocabKey="effortLevel"
                    active={effortLevelActive}
                    onToggleVocabulary={onToggleVocabulary}
                  >
                    <EffortBadge
                      value={control.effortLevel}
                      trailingIcon={(
                        <VocabularyAffordanceIcon active={effortLevelActive} placement="badge" />
                      )}
                    />
                  </ClassificationVocabularyBadge>
                ) : (
                  <EffortBadge value={control.effortLevel} />
                )
              )}
            </div>

            {resolvedVocabularies.modalverb && (
              <div id={toVocabCardId('modalverb')} hidden={!modalverbActive || undefined}>
                {modalverbActive && renderVocabularyCard(resolvedVocabularies.modalverb)}
              </div>
            )}
            {resolvedVocabularies.securityLevel && (
              <div id={toVocabCardId('securityLevel')} hidden={!securityLevelActive || undefined}>
                {securityLevelActive && renderVocabularyCard(resolvedVocabularies.securityLevel)}
              </div>
            )}
            {resolvedVocabularies.effortLevel && (
              <div id={toVocabCardId('effortLevel')} hidden={!effortLevelActive || undefined}>
                {effortLevelActive && renderVocabularyCard(resolvedVocabularies.effortLevel)}
              </div>
            )}
          </div>
        )}

        <ControlTaxonomy
          control={control}
          resolvedVocabularies={resolvedVocabularies}
          hasControllingCriteria={hasControllingCriteria}
          isVocabularyActive={isVocabularyActive}
          onToggleVocabulary={onToggleVocabulary}
          renderVocabularyCard={renderVocabularyCard}
        />
      </div>
    </ControlDetailSection>
  );
}
