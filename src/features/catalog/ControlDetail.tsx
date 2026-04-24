import { useLayoutEffect, useRef, useState } from 'react';
import { Badge } from '@/components/Badge';
import { EffortBadge, ModalverbBadge, SecurityLevelBadge } from '@/components/StatusMeta';
import {
  IconArrowLeft,
  IconCheck,
  IconInfo,
  IconLink,
  IconTag,
  IconTarget,
} from '@/components/icons';
import type { Control, LinkRelation } from '@/domain/models';
import { getLinkRelationLabel, type IncomingControlLink } from '@/domain/controlRelationships';
import type { VocabularyResolution } from '@/domain/vocabulary';
import { resolveControlVocabularies } from '@/domain/vocabulary';
import { useCatalog } from '@/hooks/useCatalog';
import { VocabularyEntryCard } from '@/features/vocabularies/VocabularyEntryCard';
import { ControlDetailSection } from './ControlDetailSection';

export interface ControlDetailProps {
  control: Control;
  controlsById?: Map<string, Control>;
  incomingLinks?: IncomingControlLink[];
  parentControl?: Control;
  childControls?: Control[];
  onClose: () => void;
  onNavigateToControl?: (controlId: string) => void;
}

function buildIncomingLinksByControlId(incomingLinks: IncomingControlLink[]) {
  const incomingByControlId = new Map<string, IncomingControlLink[]>();

  for (const incoming of incomingLinks) {
    const existing = incomingByControlId.get(incoming.control.id);

    if (existing) {
      existing.push(incoming);
      continue;
    }

    incomingByControlId.set(incoming.control.id, [incoming]);
  }

  return incomingByControlId;
}

function getOutgoingLinkLabel(
  relation: LinkRelation,
  reverseLinks: IncomingControlLink[] | undefined,
) {
  const relationLabel = getLinkRelationLabel(relation);

  if (!reverseLinks?.length) {
    return relationLabel;
  }

  const differingReverseLabels = Array.from(
    new Set(
      reverseLinks
        .map((incoming) => incoming.relation)
        .filter((reverseRelation) => reverseRelation !== relation),
    ),
    (reverseRelation) => getLinkRelationLabel(reverseRelation),
  );

  if (differingReverseLabels.length === 0) {
    return relationLabel;
  }

  return `${relationLabel} · ↔ ${differingReverseLabels.join(', ')}`;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
      {children}
    </h3>
  );
}

function SubSectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
      {children}
    </h4>
  );
}

function DetailField({
  label,
  value,
  resolution,
  active,
  onClick,
  vocabKey,
  children,
}: {
  label: string;
  value: string;
  resolution?: VocabularyResolution | null;
  active?: boolean;
  onClick?: () => void;
  vocabKey?: string;
  children?: React.ReactNode;
}) {
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
            <span className="min-w-0 flex-1 break-words [hyphens:auto]">{value}</span>
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

const outlineBadgeClass =
  'max-w-full whitespace-normal break-words py-1 text-left leading-snug [overflow-wrap:anywhere]';

function VocabularyAffordanceIcon({
  active = false,
  placement = 'inline',
}: {
  active?: boolean;
  placement?: 'badge' | 'inline';
}) {
  const placementClass = placement === 'badge' ? 'self-center' : 'mt-0.5';

  return (
    <IconInfo
      aria-hidden="true"
      className={`catalog-vocabulary-affordance h-3 w-3 shrink-0 transition-colors ${placementClass} ${
        active ? 'text-primary-main' : 'text-slate-400'
      }`}
    />
  );
}

function toVocabCardId(key: string) {
  return `vocab-card-${key.replace(/[^a-zA-Z0-9-]/g, '-')}`;
}

function vocabButtonClass(active: boolean) {
  return `inline-flex cursor-pointer rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)] ${
    active
      ? 'ring-2 ring-offset-1 ring-primary-main/40'
      : ''
  }`;
}

const detailLinkRowClass =
  'group block w-full rounded px-2 py-2 -mx-2 text-left transition-colors hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]';
const guidanceOverflowTolerance = 1;

export function getControlDetailUrl(
  controlId: string,
  options: {
    origin?: string;
    baseUrl?: string;
  } = {},
) {
  const origin = options.origin ?? window.location.origin;
  const baseUrl = options.baseUrl ?? import.meta.env.BASE_URL;
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  return new URL(`katalog/${controlId}`, new URL(normalizedBaseUrl, origin)).toString();
}

export function ControlDetail({
  control,
  controlsById,
  incomingLinks = [],
  parentControl,
  childControls = [],
  onClose,
  onNavigateToControl,
}: ControlDetailProps) {
  const { vocabularyRegistry, catalog } = useCatalog();
  const practice = catalog?.practices?.find(p => p.id === control.practiceId);
  const topic = practice?.topics?.find(t => t.id === control.groupId);
  const practiceName = practice?.title ?? control.practiceId;
  const topicName = topic?.title ?? control.groupId;
  const [linkCopied, setLinkCopied] = useState(false);
  const [activeVocabularyKey, setActiveVocabularyKey] = useState<string | null>(null);
  const [guidanceExpandedState, setGuidanceExpandedState] = useState({
    controlId: control.id,
    expanded: false,
  });
  const [guidanceOverflowState, setGuidanceOverflowState] = useState({
    controlId: control.id,
    hasOverflow: false,
  });
  const guidanceRef = useRef<HTMLParagraphElement | null>(null);
  const guidanceExpanded =
    guidanceExpandedState.controlId === control.id
      ? guidanceExpandedState.expanded
      : false;
  const guidanceHasOverflow =
    guidanceOverflowState.controlId === control.id
      ? guidanceOverflowState.hasOverflow
      : false;
  const resolvedVocabularies = resolveControlVocabularies(vocabularyRegistry, control);
  const hasClassification = Boolean(
    control.modalverb ||
    control.securityLevel ||
    control.effortLevel ||
    control.tags.length > 0 ||
    control.statementProps.zielobjektKategorien.length > 0,
  );
  const hasStatementDetails = Boolean(
    control.statementProps.ergebnis ||
    control.statementProps.praezisierung ||
    control.statementProps.handlungsworte ||
    control.statementProps.dokumentation,
  );
  const hasErgebnis = Boolean(control.statementProps.ergebnis);
  const hasPraezisierung = Boolean(control.statementProps.praezisierung);
  const hasHandlungswort = Boolean(control.statementProps.handlungsworte);
  const hasDokumentation = Boolean(control.statementProps.dokumentation);
  const hasZielobjektKategorien = control.statementProps.zielobjektKategorien.length > 0;
  const hasControllingCriteria = Boolean(
    control.modalverb ||
    control.securityLevel ||
    control.effortLevel,
  );
  const hasTaxonomy = control.tags.length > 0 || hasZielobjektKategorien;
  const incomingByControlId = buildIncomingLinksByControlId(incomingLinks);
  const outgoingIds = new Set(control.links.map((l) => l.targetId));
  const incomingOnlyLinks = incomingLinks.filter((inc) => !outgoingIds.has(inc.control.id));
  const hasDependencies = control.links.length > 0 || incomingOnlyLinks.length > 0;
  const hasHierarchy = Boolean(parentControl || childControls.length > 0);

  const toggleVocabulary = (key: string) => {
    setActiveVocabularyKey((currentKey) => currentKey === key ? null : key);
  };

  useLayoutEffect(() => {
    if (!control.guidance || guidanceExpanded) {
      return;
    }

    const guidanceElement = guidanceRef.current;
    if (!guidanceElement) {
      return;
    }

    const measureGuidanceOverflow = () => {
      setGuidanceOverflowState({
        controlId: control.id,
        hasOverflow:
          guidanceElement.scrollHeight - guidanceElement.clientHeight >
          guidanceOverflowTolerance,
      });
    };

    measureGuidanceOverflow();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureGuidanceOverflow);
      return () => window.removeEventListener('resize', measureGuidanceOverflow);
    }

    const resizeObserver = new ResizeObserver(measureGuidanceOverflow);
    resizeObserver.observe(guidanceElement);

    const container = guidanceElement.parentElement;
    if (container) {
      resizeObserver.observe(container);
    }

    return () => resizeObserver.disconnect();
  }, [control.guidance, control.id, guidanceExpanded]);

  const isVocabularyActive = (key: string) => activeVocabularyKey === key;
  const findResolutionByValue = (
    resolutions: VocabularyResolution[],
    value: string,
  ) => resolutions.find((resolution) => resolution.entry.value === value) ?? null;

  const handleCopyLink = () => {
    const url = getControlDetailUrl(control.id);
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    });
  };

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface-raised)]">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border-default)]">
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Zurück zur Übersicht"
            className="flex h-11 w-11 lg:h-10 lg:w-10 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
          >
            <IconArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <span className="catalog-reference-text flex-1">
            {control.id}
          </span>
          <button
            type="button"
            onClick={handleCopyLink}
            aria-label={linkCopied ? 'Kopiert' : 'Link kopieren'}
            title="Direktlink kopieren"
            className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-accent-default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
          >
            {linkCopied ? (
              <>
                <IconCheck className="h-4 w-4 text-success" aria-hidden="true" />
                <span className="text-success">Kopiert</span>
              </>
            ) : (
              <>
                <IconLink className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Link kopieren</span>
              </>
            )}
          </button>
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mb-1">
          {practiceName} · {topicName}
        </p>
        <h2 className="type-page-title">
          {control.title}
        </h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-safe lg:pb-4">
        {/* Klassifikation */}
        {hasClassification && (
          <ControlDetailSection heading="Klassifikation">
            <div className="space-y-4">
              {hasControllingCriteria && (
                <div role="group" aria-label="Kriterien" className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {control.modalverb && (
                      resolvedVocabularies.modalverb ? (
                        <button
                          type="button"
                          onClick={() => toggleVocabulary('modalverb')}
                          aria-pressed={isVocabularyActive('modalverb')}
                          aria-expanded={isVocabularyActive('modalverb')}
                          aria-controls={toVocabCardId('modalverb')}
                          className={vocabButtonClass(isVocabularyActive('modalverb'))}
                        >
                          <ModalverbBadge
                            value={control.modalverb}
                            trailingIcon={
                              <VocabularyAffordanceIcon
                                active={isVocabularyActive('modalverb')}
                                placement="badge"
                              />
                            }
                          />
                        </button>
                      ) : (
                        <ModalverbBadge value={control.modalverb} />
                      )
                    )}
                    {control.securityLevel && (
                      resolvedVocabularies.securityLevel ? (
                        <button
                          type="button"
                          onClick={() => toggleVocabulary('securityLevel')}
                          aria-pressed={isVocabularyActive('securityLevel')}
                          aria-expanded={isVocabularyActive('securityLevel')}
                          aria-controls={toVocabCardId('securityLevel')}
                          className={vocabButtonClass(isVocabularyActive('securityLevel'))}
                        >
                          <SecurityLevelBadge
                            value={control.securityLevel}
                            trailingIcon={
                              <VocabularyAffordanceIcon
                                active={isVocabularyActive('securityLevel')}
                                placement="badge"
                              />
                            }
                          />
                        </button>
                      ) : (
                        <SecurityLevelBadge value={control.securityLevel} />
                      )
                    )}
                    {control.effortLevel && (
                      resolvedVocabularies.effortLevel ? (
                        <button
                          type="button"
                          onClick={() => toggleVocabulary('effortLevel')}
                          aria-pressed={isVocabularyActive('effortLevel')}
                          aria-expanded={isVocabularyActive('effortLevel')}
                          aria-controls={toVocabCardId('effortLevel')}
                          className={vocabButtonClass(isVocabularyActive('effortLevel'))}
                        >
                          <EffortBadge
                            value={control.effortLevel}
                            trailingIcon={
                              <VocabularyAffordanceIcon
                                active={isVocabularyActive('effortLevel')}
                                placement="badge"
                              />
                            }
                          />
                        </button>
                      ) : (
                        <EffortBadge value={control.effortLevel} />
                      )
                    )}
                  </div>

                  {resolvedVocabularies.modalverb && (
                    <div id={toVocabCardId('modalverb')} hidden={!isVocabularyActive('modalverb') || undefined}>
                      {isVocabularyActive('modalverb') && (
                        <VocabularyEntryCard resolution={resolvedVocabularies.modalverb} />
                      )}
                    </div>
                  )}
                  {resolvedVocabularies.securityLevel && (
                    <div id={toVocabCardId('securityLevel')} hidden={!isVocabularyActive('securityLevel') || undefined}>
                      {isVocabularyActive('securityLevel') && (
                        <VocabularyEntryCard resolution={resolvedVocabularies.securityLevel} />
                      )}
                    </div>
                  )}
                  {resolvedVocabularies.effortLevel && (
                    <div id={toVocabCardId('effortLevel')} hidden={!isVocabularyActive('effortLevel') || undefined}>
                      {isVocabularyActive('effortLevel') && (
                        <VocabularyEntryCard resolution={resolvedVocabularies.effortLevel} />
                      )}
                    </div>
                  )}
                </div>
              )}

              {hasTaxonomy && (
                <div
                  role="group"
                  aria-label="Taxonomie"
                  className={`space-y-2 ${hasControllingCriteria ? 'border-t border-[var(--color-border-subtle)] pt-3' : ''}`}
                >
                  {/* GRU-140: Zielobjekt-Kategorien bleiben als filterbare Taxonomie in Klassifikation, nicht in Anforderungsdetails. */}
                  <div>
                    <h4 className="text-sm font-semibold text-slate-800 mb-2">
                      Tags und Zielobjektkategorien
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {control.tags.map((tag) => {
                        const resolution = findResolutionByValue(resolvedVocabularies.tags, tag);
                        return resolution ? (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleVocabulary(`tag:${tag}`)}
                            aria-pressed={isVocabularyActive(`tag:${tag}`)}
                            aria-expanded={isVocabularyActive(`tag:${tag}`)}
                            aria-controls={toVocabCardId(`tag:${tag}`)}
                            aria-label={`Tag: ${tag}`}
                            className={vocabButtonClass(isVocabularyActive(`tag:${tag}`))}
                          >
                            <Badge
                              variant="outline"
                              className={outlineBadgeClass}
                              trailingIcon={
                                <VocabularyAffordanceIcon
                                  active={isVocabularyActive(`tag:${tag}`)}
                                  placement="badge"
                                />
                              }
                            >
                              <IconTag className="w-3 h-3 mr-1 shrink-0" />
                              {tag}
                            </Badge>
                          </button>
                        ) : (
                          <Badge key={tag} variant="outline" className={outlineBadgeClass}>
                            <IconTag className="w-3 h-3 mr-1 shrink-0" />
                            {tag}
                          </Badge>
                        );
                      })}
                      {control.statementProps.zielobjektKategorien.map((kat) => {
                        const resolution = findResolutionByValue(
                          resolvedVocabularies.statement.zielobjektKategorien,
                          kat,
                        );
                        return resolution ? (
                          <button
                            key={kat}
                            type="button"
                            onClick={() => toggleVocabulary(`zielobjekt:${kat}`)}
                            aria-pressed={isVocabularyActive(`zielobjekt:${kat}`)}
                            aria-expanded={isVocabularyActive(`zielobjekt:${kat}`)}
                            aria-controls={toVocabCardId(`zielobjekt:${kat}`)}
                            aria-label={`Zielobjekt: ${kat}`}
                            className={vocabButtonClass(isVocabularyActive(`zielobjekt:${kat}`))}
                          >
                            <Badge
                              variant="outline"
                              className={outlineBadgeClass}
                              trailingIcon={
                                <VocabularyAffordanceIcon
                                  active={isVocabularyActive(`zielobjekt:${kat}`)}
                                  placement="badge"
                                />
                              }
                            >
                              <IconTarget className="w-3 h-3 mr-1 shrink-0" />
                              {kat}
                            </Badge>
                          </button>
                        ) : (
                          <Badge key={kat} variant="outline" className={outlineBadgeClass}>
                            <IconTarget className="w-3 h-3 mr-1 shrink-0" />
                            {kat}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                  {control.tags.map((tag) => {
                    const resolution = findResolutionByValue(resolvedVocabularies.tags, tag);
                    if (!resolution) return null;
                    const active = isVocabularyActive(`tag:${tag}`);
                    return (
                      <div key={`tag-card:${tag}`} id={toVocabCardId(`tag:${tag}`)} hidden={!active || undefined}>
                        {active && <VocabularyEntryCard resolution={resolution} />}
                      </div>
                    );
                  })}
                  {control.statementProps.zielobjektKategorien.map((kat) => {
                    const resolution = findResolutionByValue(
                      resolvedVocabularies.statement.zielobjektKategorien,
                      kat,
                    );
                    if (!resolution) return null;
                    const active = isVocabularyActive(`zielobjekt:${kat}`);
                    return (
                      <div key={`zielobjekt-card:${kat}`} id={toVocabCardId(`zielobjekt:${kat}`)} hidden={!active || undefined}>
                        {active && <VocabularyEntryCard resolution={resolution} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </ControlDetailSection>
        )}

        {/* statement */}
        {control.statement && (
          <ControlDetailSection heading="Anforderung">
            <p className="w-full break-words text-sm text-slate-700 leading-relaxed whitespace-pre-line [hyphens:auto]">
              {control.statement}
            </p>
          </ControlDetailSection>
        )}

        {/* Anforderungsdetails */}
        {hasStatementDetails && (
          <ControlDetailSection heading="Anforderungsdetails">
            <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-3 sm:gap-y-4">
              {hasErgebnis && (
                <DetailField
                  label="Ergebnis"
                  value={control.statementProps.ergebnis!}
                  resolution={resolvedVocabularies.statement.ergebnis}
                  active={isVocabularyActive('ergebnis')}
                  onClick={() => toggleVocabulary('ergebnis')}
                  vocabKey="ergebnis"
                >
                  {isVocabularyActive('ergebnis') && resolvedVocabularies.statement.ergebnis && (
                    <VocabularyEntryCard resolution={resolvedVocabularies.statement.ergebnis} />
                  )}
                </DetailField>
              )}

              {hasPraezisierung && (
                <DetailField
                  label="Präzisierung"
                  value={control.statementProps.praezisierung!}
                  resolution={resolvedVocabularies.statement.praezisierung}
                  active={isVocabularyActive('praezisierung')}
                  onClick={() => toggleVocabulary('praezisierung')}
                  vocabKey="praezisierung"
                >
                  {isVocabularyActive('praezisierung') && resolvedVocabularies.statement.praezisierung && (
                    <VocabularyEntryCard resolution={resolvedVocabularies.statement.praezisierung} />
                  )}
                </DetailField>
              )}

              {hasHandlungswort && (
                <DetailField
                  label="Handlungswort"
                  value={control.statementProps.handlungsworte!}
                  resolution={resolvedVocabularies.statement.handlungsworte}
                  active={isVocabularyActive('handlungsworte')}
                  onClick={() => toggleVocabulary('handlungsworte')}
                  vocabKey="handlungsworte"
                >
                  {isVocabularyActive('handlungsworte') && resolvedVocabularies.statement.handlungsworte && (
                    <VocabularyEntryCard resolution={resolvedVocabularies.statement.handlungsworte} />
                  )}
                </DetailField>
              )}

              {hasDokumentation && (
                <DetailField
                  label="Dokumentation"
                  value={control.statementProps.dokumentation!}
                  resolution={resolvedVocabularies.statement.dokumentation}
                  active={isVocabularyActive('dokumentation')}
                  onClick={() => toggleVocabulary('dokumentation')}
                  vocabKey="dokumentation"
                >
                  {isVocabularyActive('dokumentation') && resolvedVocabularies.statement.dokumentation && (
                    <VocabularyEntryCard resolution={resolvedVocabularies.statement.dokumentation} />
                  )}
                </DetailField>
              )}
            </dl>
          </ControlDetailSection>
        )}

        {/* guidance */}
        {control.guidance && (
          <ControlDetailSection heading="Umsetzungshinweise">
            <p
              id="guidance-text"
              ref={guidanceRef}
              className={`w-full break-words text-sm text-slate-700 leading-relaxed whitespace-pre-line [hyphens:auto] ${!guidanceExpanded ? 'line-clamp-5' : ''}`}
            >
              {control.guidance}
            </p>
            {guidanceHasOverflow && (
              <button
                type="button"
                aria-expanded={guidanceExpanded}
                aria-controls="guidance-text"
                onClick={() =>
                  setGuidanceExpandedState((current) => ({
                    controlId: control.id,
                    expanded:
                      current.controlId === control.id ? !current.expanded : true,
                  }))
                }
                className="mt-2 rounded text-xs font-medium text-primary-main hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
              >
                {guidanceExpanded ? 'Weniger anzeigen' : 'Mehr anzeigen'}
              </button>
            )}
          </ControlDetailSection>
        )}

        {/* Abhängigkeiten */}
        {hasDependencies && (
          <ControlDetailSection heading="Abhängigkeiten">
            <div className="space-y-3">
            {control.links.length > 0 && (
              <div>
                <SubSectionHeading>Verknüpfte Kontrollen</SubSectionHeading>
                <div className="space-y-1">
                  {control.links.map((link) => {
                    const label = getOutgoingLinkLabel(
                      link.relation,
                      incomingByControlId.get(link.targetId),
                    );
                    const ariaLabel = `${link.targetId}${controlsById?.get(link.targetId)?.title ? ` ${controlsById.get(link.targetId)!.title}` : ''} (${label})`;
                    return (
                      <button
                        key={`${link.targetId}-${link.relation}`}
                        type="button"
                        aria-label={ariaLabel}
                        className={detailLinkRowClass}
                        onClick={() => onNavigateToControl?.(link.targetId)}
                      >
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-xs text-slate-500 shrink-0 group-hover:text-primary-main">{link.targetId}</span>
                          {controlsById?.get(link.targetId)?.title && (
                            <span className="text-sm text-slate-700 leading-snug">{controlsById.get(link.targetId)!.title}</span>
                          )}
                        </div>
                        <span className="mt-0.5 text-xs text-slate-400">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {incomingOnlyLinks.length > 0 && (
              <div>
                <SubSectionHeading>Wird referenziert von</SubSectionHeading>
                <div className="space-y-1">
                  {incomingOnlyLinks.map((incoming) => (
                    <button
                      key={`${incoming.control.id}-${incoming.relation}`}
                      type="button"
                      aria-label={`${incoming.control.id} ${incoming.control.title} (${getLinkRelationLabel(incoming.relation)})`}
                      className={detailLinkRowClass}
                      onClick={() => onNavigateToControl?.(incoming.control.id)}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-slate-500 shrink-0 group-hover:text-primary-main">{incoming.control.id}</span>
                        <span className="text-sm text-slate-700 leading-snug">{incoming.control.title}</span>
                      </div>
                      <span className="mt-0.5 text-xs text-slate-400">
                        {getLinkRelationLabel(incoming.relation)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            </div>
          </ControlDetailSection>
        )}

        {/* Hierarchie */}
        {hasHierarchy && (
          <ControlDetailSection heading="Hierarchie">
            <div className="space-y-3">
            {parentControl && (
              <div>
                <SubSectionHeading>Übergeordnete Kontrolle</SubSectionHeading>
                <button
                  type="button"
                  aria-label={`${parentControl.id} ${parentControl.title}`}
                  className={detailLinkRowClass}
                  onClick={() => onNavigateToControl?.(parentControl.id)}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-slate-500 shrink-0 group-hover:text-primary-main">{parentControl.id}</span>
                    <span className="text-sm text-slate-700 leading-snug">{parentControl.title}</span>
                  </div>
                </button>
              </div>
            )}
            {childControls.length > 0 && (
              <div>
                <SubSectionHeading>Erweiterungen</SubSectionHeading>
                <div className="space-y-1">
                  {childControls.map((childControl) => (
                    <button
                      key={childControl.id}
                      type="button"
                      aria-label={`${childControl.id} ${childControl.title}`}
                      className={detailLinkRowClass}
                      onClick={() => onNavigateToControl?.(childControl.id)}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-slate-500 shrink-0 group-hover:text-primary-main">{childControl.id}</span>
                        <span className="text-sm text-slate-700 leading-snug">{childControl.title}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            </div>
          </ControlDetailSection>
        )}

        {/* Metadata */}
        {((!parentControl && control.parentId) || control.altIdentifier) && (
          <div className="space-y-1.5">
            <SectionHeading>Technische Metadaten</SectionHeading>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
              {!parentControl && control.parentId && (
                <>
                  <dt className="font-medium">Übergeordnet</dt>
                  <dd>{control.parentId}</dd>
                </>
              )}
              {control.altIdentifier && (
                <>
                  <dt className="font-medium">UUID</dt>
                  <dd className="font-mono">{control.altIdentifier}</dd>
                </>
              )}
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
