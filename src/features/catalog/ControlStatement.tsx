import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Tooltip } from '@/components/Tooltip';
import type { SegmentStatementInput, SegmentStatementResult, SentenceSegment } from '@/domain/statementSegments';
import { segmentStatement } from '@/domain/statementSegments';
import type { Control } from '@/domain/models';
import type { VocabularyResolution } from '@/domain/vocabulary';
import { ControlDetailSection } from './ControlDetailSection';
import { type RenderVocabularyCard, TermTrigger, toVocabCardId } from './ControlVocabularyPrimitives';

/** FIXED-Toggletip für Platzhalter ohne Wert (T2: `hasValue:false` rendert weiter `value`). */
export const PLACEHOLDER_TOGGLETIP = 'Platzhalter – Der Wert wird bei der Anwendung festgelegt.';

export interface ControlStatementProps {
  readonly statement: Control['statement'];
  readonly segments?: ControlStatementSegmentsProps | null;
  readonly children?: ReactNode;
}

export interface ControlStatementSegmentsProps {
  readonly input: SegmentStatementInput;
  /** Memoiziertes Ergebnis aus `ControlDetail` (Single-Run, GSPP-303 T10). */
  readonly precomputed?: SegmentStatementResult;
  readonly practiceResolution: VocabularyResolution | null;
  readonly modalverbResolution: VocabularyResolution | null;
  readonly handlungswortResolution: VocabularyResolution | null;
  readonly isVocabularyActive: (key: string) => boolean;
  readonly onToggleVocabulary: (key: string) => void;
  readonly renderVocabularyCard: RenderVocabularyCard;
}

interface SatzSlot {
  readonly role: SentenceSegment['role'];
  readonly key: string;
  readonly resolution: VocabularyResolution | null;
}

function renderSegment(
  segment: SentenceSegment,
  index: number,
  input: SegmentStatementInput,
  slotByRole: ReadonlyMap<SentenceSegment['role'], SatzSlot>,
  isVocabularyActive: (key: string) => boolean,
  onToggleVocabulary: (key: string) => void,
): ReactNode {
  if (segment.role === 'text') {
    return <Fragment key={index}>{segment.text}</Fragment>;
  }
  if (segment.role === 'param') {
    const hasValue = segment.paramId !== undefined && input.params[segment.paramId]?.hasValue === true;
    if (hasValue) {
      return <Fragment key={index}>{segment.text}</Fragment>;
    }
    return (
      <Tooltip key={index} id={`satz-param-${index}`} mode="hover-toggle" content={PLACEHOLDER_TOGGLETIP}
        describeTarget={(describedById) => <span aria-describedby={describedById} className="rounded bg-amber-100 px-0.5">{segment.text}</span>} />
    );
  }
  if (segment.role === 'ergebnis' || segment.role === 'praezisierung') {
    return (
      <Tooltip key={index} id={`satzteil-${segment.role}-${index}`} content={segment.role === 'ergebnis' ? 'Ergebnis' : 'Präzisierung'}
        describeTarget={(describedById) => <span aria-describedby={describedById} className="rounded hover:bg-[var(--color-surface-subtle)]">{segment.text}</span>} />
    );
  }
  const slot = slotByRole.get(segment.role);
  if (slot === undefined || slot.resolution === null) {
    return <Fragment key={index}>{segment.text}</Fragment>;
  }
  return (
    <TermTrigger key={index} vocabKey={slot.key} active={isVocabularyActive(slot.key)} onToggle={onToggleVocabulary}
      label={segment.text} ariaLabel={`Vokabularbegriff ${segment.text}`} inline />
  );
}

export function ControlStatementSegments({
  input,
  precomputed,
  practiceResolution,
  modalverbResolution,
  handlungswortResolution,
  isVocabularyActive,
  onToggleVocabulary,
  renderVocabularyCard,
}: ControlStatementSegmentsProps): ReactNode {
  const { segments } = precomputed ?? segmentStatement(input);
  const slots: readonly SatzSlot[] = [
    { role: 'practice', key: 'satz:practice', resolution: practiceResolution },
    { role: 'modalverb', key: 'satz:modalverb', resolution: modalverbResolution },
    { role: 'handlungswort', key: 'satz:handlungswort', resolution: handlungswortResolution },
  ];
  const slotByRole = new Map(slots.map((slot) => [slot.role, slot]));
  const activeSlot = slots.find((slot) => slot.resolution !== null && isVocabularyActive(slot.key));

  return (
    <>
      <p style={{ fontSize: 16 }} className="w-full break-words leading-relaxed whitespace-pre-line text-slate-700 [hyphens:auto]">
        {segments.map((segment, index) =>
          renderSegment(segment, index, input, slotByRole, isVocabularyActive, onToggleVocabulary),
        )}
      </p>
      {activeSlot !== undefined && activeSlot.resolution !== null && (
        <div id={toVocabCardId(activeSlot.key)}>{renderVocabularyCard(activeSlot.resolution)}</div>
      )}
    </>
  );
}

export function ControlStatement({ statement, segments, children }: ControlStatementProps): ReactNode {
  if (segments?.input.statementRaw) {
    return (
      <ControlDetailSection heading="Anforderung">
        <ControlStatementSegments {...segments} />
        {children}
      </ControlDetailSection>
    );
  }
  if (!statement) {
    return null;
  }
  return (
    <ControlDetailSection heading="Anforderung">
      <p className="w-full break-words text-base text-slate-700 leading-relaxed whitespace-pre-line [hyphens:auto]">
        {statement}
      </p>
      {children}
    </ControlDetailSection>
  );
}
