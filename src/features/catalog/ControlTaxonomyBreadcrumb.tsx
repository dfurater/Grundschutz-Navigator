import type { VocabularyResolution } from '@/domain/vocabulary';
import { VocabularyEntryCard } from '@/features/vocabularies/VocabularyEntryCard';
import { beforeTightContentClass } from '@/components/legendStyles';
import { TermTrigger, toVocabCardId } from './ControlVocabularyPrimitives';

export interface ControlTaxonomyBreadcrumbProps {
  readonly practiceName: string;
  readonly topicName: string;
  readonly hasTopic: boolean;
  readonly practiceVocabulary: VocabularyResolution | null;
  readonly topicVocabulary: VocabularyResolution | null;
  readonly isVocabularyActive: (key: string) => boolean;
  readonly onToggleVocabulary: (key: string) => void;
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
      ? ['Nummerierung', 'Begriff']
      : ['Nummerierung'];

  return (
    // Direkt darunter folgt der Titel (4 px): Eine offene Karte hält 12 px.
    <div className={`mb-1 ${beforeTightContentClass}`}>
      <p className="flex flex-wrap items-center gap-1 text-xs text-[var(--color-text-muted)]">
        {practiceVocabulary ? (
          <TermTrigger
            vocabKey={practiceKey}
            active={practiceActive}
            onToggle={onToggleVocabulary}
            label={practiceName}
            ariaLabel={`Praktik: ${practiceName}`}
          />
        ) : (
          <span>{practiceName}</span>
        )}
        <span aria-hidden="true">·</span>
        {topicVocabulary ? (
          <TermTrigger
            vocabKey={topicKey}
            active={topicActive}
            onToggle={onToggleVocabulary}
            label={topicName}
            ariaLabel={`Thema: ${topicName}`}
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
            <VocabularyEntryCard resolution={topicVocabulary} />
          )}
        </div>
      )}
    </div>
  );
}
