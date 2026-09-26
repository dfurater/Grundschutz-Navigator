import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Tooltip } from '@/components/Tooltip';
import type {
  SegmentStatementInput,
  SegmentStatementResult,
  SentenceClauseRole,
  SentenceSegment,
} from '@/domain/statementSegments';
import { segmentStatement } from '@/domain/statementSegments';
import type { Control } from '@/domain/models';
import type { VocabularyResolution } from '@/domain/vocabulary';
import { ControlDetailSection } from './ControlDetailSection';
import {
  detailProseClass,
  type LegendEntry,
  type RenderVocabularyCard,
  TermTrigger,
  toVocabCardId,
} from './ControlVocabularyPrimitives';

/**
 * FIXED-Toggletip für Platzhalter ohne Wert (T2: `hasValue:false` rendert weiter `value`).
 * OSCAL 1.1.3 setzt Parameter per `set-parameter` im Profil, in der
 * Komponentendefinition oder im SSP; das BSI nennt für Anwender Profil und SSP
 * (`documentation/OSCAL.md` der Stand-der-Technik-Bibliothek).
 */
export const PLACEHOLDER_TOGGLETIP = 'Der Wert wird im eigenen Profil oder im Implementierungsplan (SSP) festgelegt.';

export interface ControlStatementProps {
  readonly statement: Control['statement'];
  readonly segments?: ControlStatementSegmentsProps | null;
  /** Kriterien-Zeile (Modalverb, Niveau, Aufwand) als erste Zeile unter der Leiste. */
  readonly criteria?: ReactNode;
  /** Legende der Kriterien: Textlink rechts in der Leiste „Anforderung“. */
  readonly legend?: { readonly id: string; readonly entries: LegendEntry[] };
  readonly children?: ReactNode;
}

export interface ControlStatementSegmentsProps {
  readonly input: SegmentStatementInput;
  /** Memoiziertes Ergebnis aus `ControlDetail` (Single-Run, GSPP-303 T10). */
  readonly precomputed?: SegmentStatementResult;
  readonly practiceResolution: VocabularyResolution | null;
  readonly modalverbResolution: VocabularyResolution | null;
  readonly handlungswortResolution: VocabularyResolution | null;
  readonly ergebnisResolution?: VocabularyResolution | null;
  readonly praezisierungResolution?: VocabularyResolution | null;
  readonly isVocabularyActive: (key: string) => boolean;
  readonly onToggleVocabulary: (key: string) => void;
  readonly renderVocabularyCard: RenderVocabularyCard;
}

interface SatzSlot {
  readonly role: SentenceSegment['role'];
  readonly key: string;
  readonly resolution: VocabularyResolution | null;
}

const CLAUSE_LABEL: Record<SentenceClauseRole, string> = {
  ergebnis: 'Ergebnis',
  praezisierung: 'Präzisierung',
};

function renderPlaceholder(segment: SentenceSegment, index: number): ReactNode {
  const content = segment.partOf === undefined ? PLACEHOLDER_TOGGLETIP : (
    <>
      <span className="block font-medium">{CLAUSE_LABEL[segment.partOf]}</span>
      {PLACEHOLDER_TOGGLETIP}
    </>
  );
  return (
    <Tooltip key={index} id={`satz-param-${index}`} mode="hover-toggle" content={content}
      describeTarget={() => (
        <span className="rounded bg-[var(--color-accent-soft)] px-[3px] [box-decoration-break:clone]">{segment.text}</span>
      )} />
  );
}

function renderClause(role: SentenceClauseRole, children: ReactNode, index: number): ReactNode {
  return (
    <Tooltip key={index} id={`satzteil-${role}-${index}`} content={CLAUSE_LABEL[role]}
      describeTarget={(describedById) => (
        // Fokussierbar, damit die Beschriftung auch per Tastatur erreichbar ist.
        <span tabIndex={0} aria-describedby={describedById}
          className="rounded hover:bg-[var(--color-surface-subtle)] focus-visible:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]">
          {children}
        </span>
      )} />
  );
}

function isPlaceholder(segment: SentenceSegment, input: SegmentStatementInput): boolean {
  return segment.role === 'param'
    && (segment.paramId === undefined || input.params[segment.paramId]?.hasValue !== true);
}

function renderPlain(segment: SentenceSegment, index: number, input: SegmentStatementInput): ReactNode {
  return isPlaceholder(segment, input)
    ? renderPlaceholder(segment, index)
    : <Fragment key={index}>{segment.text}</Fragment>;
}

type RenderItem =
  | { readonly kind: 'segment'; readonly segment: SentenceSegment; readonly index: number }
  | { readonly kind: 'clause'; readonly role: SentenceClauseRole; readonly members: ReadonlyArray<{ segment: SentenceSegment; index: number }> };

interface SatzContext {
  readonly input: SegmentStatementInput;
  readonly slotByRole: ReadonlyMap<SentenceSegment['role'], SatzSlot>;
  /** Satzteile mit mindestens einem eigenen Textstück. */
  readonly rolesWithText: ReadonlySet<SentenceSegment['role']>;
}

/**
 * Rolle, deren Begriffs-Trigger ein Segment trägt. Ein Parameterwert trägt den
 * Trigger seines Satzteils nur, wenn der Satzteil sonst kein Textstück hat —
 * sonst wäre die aufgelöste Erklärung weder im Satz noch in einer Restzeile
 * erreichbar, denn der Satzteil gilt als gefunden. Platzhalter ohne Wert
 * behalten ihre eigene Erklärung.
 */
function termRoleOf(segment: SentenceSegment, context: SatzContext): SentenceSegment['role'] {
  if (segment.role !== 'param' || segment.partOf === undefined) {
    return segment.role;
  }
  const hasTermSlot = context.slotByRole.get(segment.partOf)?.resolution != null
    && !context.rolesWithText.has(segment.partOf)
    && !isPlaceholder(segment, context.input);
  return hasTermSlot ? segment.partOf : segment.role;
}

function clauseOf(segment: SentenceSegment, context: SatzContext): SentenceClauseRole | undefined {
  const role = termRoleOf(segment, context);
  if (role === 'param') {
    return segment.partOf;
  }
  if (role !== 'ergebnis' && role !== 'praezisierung') {
    return undefined;
  }
  // Mit Vokabeleintrag bleibt der Satzteil ein eigener Begriffs-Trigger.
  return context.slotByRole.get(role)?.resolution == null ? role : undefined;
}

/** Fasst aufeinanderfolgende Stücke eines Satzteils zu einem Fokusziel zusammen. */
function groupClauses(
  segments: readonly SentenceSegment[],
  context: SatzContext,
): RenderItem[] {
  const items: RenderItem[] = [];
  segments.forEach((segment, index) => {
    const role = clauseOf(segment, context);
    const last = items.at(-1);
    if (role === undefined) {
      items.push({ kind: 'segment', segment, index });
    } else if (last?.kind === 'clause' && last.role === role) {
      items[items.length - 1] = { ...last, members: [...last.members, { segment, index }] };
    } else {
      items.push({ kind: 'clause', role, members: [{ segment, index }] });
    }
  });
  return items;
}

function renderClauseItem(item: Extract<RenderItem, { kind: 'clause' }>, input: SegmentStatementInput): ReactNode {
  const first = item.members[0].index;
  // Besteht der Satzteil nur aus Platzhaltern, nennen diese ihn selbst (`partOf`).
  if (item.members.every(({ segment }) => isPlaceholder(segment, input))) {
    return <Fragment key={first}>{item.members.map(({ segment, index }) => renderPlaceholder(segment, index))}</Fragment>;
  }
  return renderClause(item.role, item.members.map(({ segment, index }) => renderPlain(segment, index, input)), first);
}

function renderSegment(
  segment: SentenceSegment,
  index: number,
  context: SatzContext,
  isVocabularyActive: (key: string) => boolean,
  onToggleVocabulary: (key: string) => void,
): ReactNode {
  const role = termRoleOf(segment, context);
  const slot = context.slotByRole.get(role);
  if (slot?.resolution == null) {
    return renderPlain(segment, index, context.input);
  }
  const isClause = role === 'ergebnis' || role === 'praezisierung';
  return (
    <TermTrigger key={index} vocabKey={slot.key} active={isVocabularyActive(slot.key)} onToggle={onToggleVocabulary}
      label={segment.text} ariaLabel={`Vokabularbegriff ${segment.text}`} inline
      tooltip={isClause ? CLAUSE_LABEL[role] : undefined} />
  );
}

export function ControlStatementSegments({
  input,
  precomputed,
  practiceResolution,
  modalverbResolution,
  handlungswortResolution,
  ergebnisResolution = null,
  praezisierungResolution = null,
  isVocabularyActive,
  onToggleVocabulary,
  renderVocabularyCard,
}: ControlStatementSegmentsProps): ReactNode {
  const { segments } = precomputed ?? segmentStatement(input);
  const slots: readonly SatzSlot[] = [
    { role: 'practice', key: 'satz:practice', resolution: practiceResolution },
    { role: 'modalverb', key: 'satz:modalverb', resolution: modalverbResolution },
    { role: 'handlungswort', key: 'satz:handlungswort', resolution: handlungswortResolution },
    { role: 'ergebnis', key: 'satz:ergebnis', resolution: ergebnisResolution },
    { role: 'praezisierung', key: 'satz:praezisierung', resolution: praezisierungResolution },
  ];
  const context: SatzContext = {
    input,
    slotByRole: new Map(slots.map((slot) => [slot.role, slot])),
    rolesWithText: new Set(segments.map((segment) => segment.role)),
  };

  return (
    <>
      <p className={detailProseClass}>
        {groupClauses(segments, context).map((item) =>
          item.kind === 'clause'
            ? renderClauseItem(item, input)
            : renderSegment(item.segment, item.index, context, isVocabularyActive, onToggleVocabulary),
        )}
      </p>
      {/* Container bleiben geschlossen im DOM, damit `aria-controls` der Trigger auflöst. */}
      {slots.map(({ key, resolution }) => {
        if (resolution === null) return null;
        const active = isVocabularyActive(key);
        return (
          <div key={key} id={toVocabCardId(key)} hidden={!active || undefined}>
            {active && renderVocabularyCard(resolution)}
          </div>
        );
      })}
    </>
  );
}

export function ControlStatement({
  statement,
  segments,
  criteria,
  legend,
  children,
}: ControlStatementProps): ReactNode {
  let body: ReactNode = null;
  if (segments?.input.statementRaw) {
    body = <ControlStatementSegments {...segments} />;
  } else if (statement) {
    body = (
      <p className={detailProseClass}>
        {statement}
      </p>
    );
  }
  // Anforderungsdetails oder Kriterien ohne Satzprosa bleiben sichtbar;
  // `ControlDetail` rendert diesen Block nur, wenn es solchen Inhalt gibt.
  if (!body && !criteria && !children) {
    return null;
  }
  return (
    <ControlDetailSection heading="Anforderung" legend={legend}>
      {criteria && <div className="mb-3">{criteria}</div>}
      {body}
      {children}
    </ControlDetailSection>
  );
}
