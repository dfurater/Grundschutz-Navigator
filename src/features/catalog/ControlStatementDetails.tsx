import type { ReactNode } from 'react';
import type { SegmentStatementResult } from '@/domain/statementSegments';
import type { VocabularyResolution } from '@/domain/vocabulary';
import { type RenderVocabularyCard, TermTrigger, toVocabCardId } from './ControlVocabularyPrimitives';

export interface RestDetail {
  readonly key: 'ergebnis' | 'praezisierung' | 'handlungsworte' | 'dokumentation';
  readonly label: string;
  readonly value: string;
  readonly resolution: VocabularyResolution | null;
}

export interface ControlStatementDetailsProps {
  readonly details: RestDetail[];
  readonly missing: SegmentStatementResult['missing'];
  readonly isVocabularyActive: (key: string) => boolean;
  readonly onToggleVocabulary: (key: string) => void;
  readonly renderVocabularyCard: RenderVocabularyCard;
}

type MissingKey = SegmentStatementResult['missing'][number];

/** Restzeilen zur Anforderung: Dokumentation immer, Rest nur bei `missing`; Label-über-Inhalt, ohne Icon-Affordanz. */
export function ControlStatementDetails({
  details,
  missing,
  isVocabularyActive,
  onToggleVocabulary,
  renderVocabularyCard,
}: ControlStatementDetailsProps): ReactNode {
  const visible = details.filter(
    (detail) => detail.value !== '' && (detail.key === 'dokumentation' || missing.includes(detail.key as MissingKey)),
  );
  if (visible.length === 0) {
    return null;
  }
  // GSPP-303 T9: hüllenlos (Restzeilen unterhalb des Anforderungssatzes, ohne eigene Überschrift).
  return (
    <div className="space-y-3">
      {visible.map((detail) => {
        const active = isVocabularyActive(detail.key);
        return (
          <div key={detail.key}>
            <p className="catalog-meta-text">{detail.label}</p>
            {detail.resolution === null ? (
              <p className="w-full break-words text-sm leading-relaxed whitespace-pre-line text-slate-700 [hyphens:auto]">
                {detail.value}
              </p>
            ) : (
              <TermTrigger vocabKey={detail.key} active={active} onToggle={onToggleVocabulary}
                label={detail.value} ariaLabel={`Vokabularbegriff ${detail.value}`} />
            )}
            {active && detail.resolution !== null && (
              <div id={toVocabCardId(detail.key)}>{renderVocabularyCard(detail.resolution)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
