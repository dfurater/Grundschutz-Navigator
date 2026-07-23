import type { ReactNode } from 'react';
import type { Control } from '@/domain/models';
import type {
  ResolvedControlVocabularies,
  VocabularyResolution,
} from '@/domain/vocabulary';
import { ControlDetailSection } from './ControlDetailSection';
import {
  type RenderVocabularyCard,
  toVocabCardId,
  VocabularyAffordanceIcon,
} from './ControlVocabularyPrimitives';

type StatementDetails = Pick<
  Control['statementProps'],
  'ergebnis' | 'praezisierung' | 'handlungsworte' | 'dokumentation'
>;

type StatementDetailResolutions = Pick<
  ResolvedControlVocabularies['statement'],
  'ergebnis' | 'praezisierung' | 'handlungsworte' | 'dokumentation'
>;

export interface ControlStatementDetailsProps {
  statementProps: StatementDetails;
  resolutions: StatementDetailResolutions;
  isVocabularyActive: (key: string) => boolean;
  onToggleVocabulary: (key: string) => void;
  renderVocabularyCard: RenderVocabularyCard;
}

interface DetailFieldProps {
  label: string;
  value: string;
  resolution?: VocabularyResolution | null;
  active?: boolean;
  onClick?: () => void;
  vocabKey?: string;
  children?: ReactNode;
}

function DetailField({
  label,
  value,
  resolution,
  active,
  onClick,
  vocabKey,
  children,
}: DetailFieldProps) {
  const cardId = vocabKey ? toVocabCardId(vocabKey) : undefined;

  return (
    <>
      <dt className="catalog-meta-text pt-1">{label}</dt>
      <dd>
        {resolution ? (
          <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            aria-expanded={active}
            aria-controls={cardId}
            className={`flex w-full items-start gap-1 rounded text-left text-sm leading-relaxed whitespace-pre-line transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)] ${
              active
                ? 'font-medium text-primary-main underline decoration-primary-main/40 underline-offset-4'
                : 'text-slate-700'
            }`}
          >
            <span className="min-w-0 flex-1 break-words [hyphens:auto]">
              {value}
            </span>
            <VocabularyAffordanceIcon active={active} />
          </button>
        ) : (
          <p className="w-full break-words text-sm leading-relaxed whitespace-pre-line text-slate-700 [hyphens:auto]">
            {value}
          </p>
        )}
      </dd>
      {(children || cardId) && (
        <dd id={cardId} className="col-span-full" hidden={!children || undefined}>
          {children}
        </dd>
      )}
    </>
  );
}

export function ControlStatementDetails({
  statementProps,
  resolutions,
  isVocabularyActive,
  onToggleVocabulary,
  renderVocabularyCard,
}: ControlStatementDetailsProps) {
  const fields = [
    {
      key: 'ergebnis',
      label: 'Ergebnis',
      value: statementProps.ergebnis,
      resolution: resolutions.ergebnis,
    },
    {
      key: 'praezisierung',
      label: 'Präzisierung',
      value: statementProps.praezisierung,
      resolution: resolutions.praezisierung,
    },
    {
      key: 'handlungsworte',
      label: 'Handlungswort',
      value: statementProps.handlungsworte,
      resolution: resolutions.handlungsworte,
    },
    {
      key: 'dokumentation',
      label: 'Dokumentation',
      value: statementProps.dokumentation,
      resolution: resolutions.dokumentation,
    },
  ] as const;
  const visibleFields = fields.filter(
    (field): field is typeof field & { value: string } => Boolean(field.value),
  );

  if (visibleFields.length === 0) {
    return null;
  }

  return (
    <ControlDetailSection heading="Anforderungsdetails">
      <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-3 sm:gap-y-4">
        {visibleFields.map(({ key, label, value, resolution }) => {
          const active = isVocabularyActive(key);

          return (
            <DetailField
              key={key}
              label={label}
              value={value}
              resolution={resolution}
              active={active}
              onClick={() => onToggleVocabulary(key)}
              vocabKey={key}
            >
              {active && resolution && renderVocabularyCard(resolution)}
            </DetailField>
          );
        })}
      </dl>
    </ControlDetailSection>
  );
}
