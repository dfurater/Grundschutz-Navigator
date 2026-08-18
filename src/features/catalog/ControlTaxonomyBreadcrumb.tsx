import type { VocabularyResolution } from '@/domain/vocabulary';
import { VocabularyEntryCard } from '@/features/vocabularies/VocabularyEntryCard';
import {
  toVocabCardId,
  VocabularyAffordanceIcon,
} from './ControlVocabularyPrimitives';

interface TaxonomyTriggerProps {
  ariaLabel: string;
  label: string;
  vocabKey: string;
  active: boolean;
  onToggle: (key: string) => void;
}

function TaxonomyTrigger({
  ariaLabel,
  label,
  vocabKey,
  active,
  onToggle,
}: TaxonomyTriggerProps) {
  return (
    <button
      type="button"
      onClick={() => onToggle(vocabKey)}
      aria-label={ariaLabel}
      aria-pressed={active}
      aria-expanded={active}
      aria-controls={toVocabCardId(vocabKey)}
      className="inline-flex items-center gap-1 rounded text-left hover:text-primary-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
    >
      <span>{label}</span>
      <VocabularyAffordanceIcon active={active} />
    </button>
  );
}

export interface ControlTaxonomyBreadcrumbProps {
  practiceName: string;
  topicName: string;
  hasTopic: boolean;
  practiceVocabulary: VocabularyResolution | null;
  topicVocabulary: VocabularyResolution | null;
  isVocabularyActive: (key: string) => boolean;
  onToggleVocabulary: (key: string) => void;
}

export function ControlTaxonomyBreadcrumb({
  practiceName,
  topicName,
  hasTopic,
  practiceVocabulary,
  topicVocabulary,
  isVocabularyActive,
  onToggleVocabulary,
}: ControlTaxonomyBreadcrumbProps) {
  const practiceKey = 'practice';
  const topicKey = 'topic';
  const practiceActive = isVocabularyActive(practiceKey);
  const topicActive = isVocabularyActive(topicKey);
  // Der offizielle Begriff steht als Praktik-Name bereits im Breadcrumb; nur bei
  // exakter Übereinstimmung ist die Metadatenzeile redundant (GSPP-301).
  const practiceHiddenColumns =
    practiceVocabulary?.entry.columns['Begriff'] === practiceName
      ? ['UUID', 'Nummerierung', 'Begriff']
      : ['UUID', 'Nummerierung'];

  return (
    <div className="mb-1">
      <p className="flex flex-wrap items-center gap-1 text-xs text-[var(--color-text-muted)]">
        {practiceVocabulary ? (
          <TaxonomyTrigger
            ariaLabel={`Praktik: ${practiceName}`}
            label={practiceName}
            vocabKey={practiceKey}
            active={practiceActive}
            onToggle={onToggleVocabulary}
          />
        ) : (
          <span>{practiceName}</span>
        )}
        <span aria-hidden="true">·</span>
        {topicVocabulary ? (
          <TaxonomyTrigger
            ariaLabel={`Thema: ${topicName}`}
            label={topicName}
            vocabKey={topicKey}
            active={topicActive}
            onToggle={onToggleVocabulary}
          />
        ) : (
          <>
            <span>{topicName}</span>
            {hasTopic && (
              <span className="text-[10px] text-amber-700">
                keine offizielle Definition
              </span>
            )}
          </>
        )}
      </p>
      {practiceVocabulary && (
        <div
          id={toVocabCardId(practiceKey)}
          hidden={!practiceActive || undefined}
        >
          {practiceActive && (
            <VocabularyEntryCard
              resolution={practiceVocabulary}
              hiddenColumns={practiceHiddenColumns}
            />
          )}
        </div>
      )}
      {topicVocabulary && (
        <div
          id={toVocabCardId(topicKey)}
          hidden={!topicActive || undefined}
        >
          {topicActive && (
            <VocabularyEntryCard
              resolution={topicVocabulary}
              hiddenColumns={['UUID']}
            />
          )}
        </div>
      )}
    </div>
  );
}
