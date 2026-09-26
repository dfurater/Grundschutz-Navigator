import type { ReactNode } from 'react';
import type { SegmentStatementResult } from '@/domain/statementSegments';
import type { VocabularyResolution } from '@/domain/vocabulary';
import { detailProseClass, type RenderVocabularyCard, subSectionHeadingClass, TermTrigger, toVocabCardId } from './ControlVocabularyPrimitives';

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
  /** Weitere Gruppen des Anforderungssatzes nach den Restzeilen, z. B. Zielobjekte. */
  readonly children?: ReactNode;
}

type MissingKey = SegmentStatementResult['missing'][number];

/**
 * Restzeilen zur Anforderung: Dokumentation immer, Rest nur bei `missing`;
 * danach weitere Gruppen des Satzes (`children`). Label-über-Inhalt, ohne Icon-Affordanz.
 */
export function ControlStatementDetails({
  details,
  missing,
  isVocabularyActive,
  onToggleVocabulary,
  renderVocabularyCard,
  children,
}: ControlStatementDetailsProps): ReactNode {
  const visible = details.filter(
    (detail) => detail.value !== '' && (detail.key === 'dokumentation' || missing.includes(detail.key as MissingKey)),
  );
  if (visible.length === 0 && !children) {
    return null;
  }
  // GSPP-303 T9: hüllenlos (Restzeilen unterhalb des Anforderungssatzes, ohne
  // eigene Überschrift); Beschriftung wie die Gruppen in „Schutzziele und Gefährdungen“.
  return (
    <div className="mt-3 space-y-3">
      {visible.map((detail) => {
        const active = isVocabularyActive(detail.key);
        return (
          <div key={detail.key}>
            <p className={subSectionHeadingClass}>{detail.label}</p>
            <div className={detailProseClass}>
              {detail.resolution === null ? detail.value : (
                <TermTrigger vocabKey={detail.key} active={active} onToggle={onToggleVocabulary}
                  label={detail.value} ariaLabel={`Vokabularbegriff ${detail.value}`} />
              )}
            </div>
            {active && detail.resolution !== null && (
              <div id={toVocabCardId(detail.key)}>{renderVocabularyCard(detail.resolution)}</div>
            )}
          </div>
        );
      })}
      {children}
    </div>
  );
}
