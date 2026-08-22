import { useCallback, useMemo } from 'react';
import {
  IconArrowLeft,
  IconCheck,
  IconLink,
} from '@/components/icons';
import type { IncomingControlLink } from '@/domain/controlRelationships';
import type { Control } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';
import {
  referenceDocumentFromCatalog,
  resolveControlReferences,
} from '@/domain/referenceResolution';
import { resolveControlVocabularies } from '@/domain/vocabulary';
import {
  resolvePracticeVocabulary,
  resolveTopicVocabulary,
} from '@/domain/taxonomyVocabulary';
import { useActiveVocabulary } from '@/hooks/useActiveVocabulary';
import { useCatalog } from '@/hooks/useCatalog';
import { useClipboard } from '@/hooks/useClipboard';
import { useGuidanceOverflow } from '@/hooks/useGuidanceOverflow';
import { VocabularyEntryCard } from '@/features/vocabularies/VocabularyEntryCard';
import { buildControlUrlForControl } from '@/app/routes';
import { ControlClassification } from './ControlClassification';
import { ControlDependencies } from './ControlDependencies';
import { ControlSources } from './ControlSources';
import { ControlGuidance } from './ControlGuidance';
import { ControlHierarchy } from './ControlHierarchy';
import { ControlMetadata } from './ControlMetadata';
import { ControlSecurityContext } from './ControlSecurityContext';
import { ControlStatement } from './ControlStatement';
import { ControlStatementDetails } from './ControlStatementDetails';
import { ControlTaxonomyBreadcrumb } from './ControlTaxonomyBreadcrumb';
import type { RenderVocabularyCard } from './ControlVocabularyPrimitives';

/**
 * Platzhalter für eine Taxonomie-Ebene, deren Quellgruppe keine `id` trägt
 * (OSCAL 1.1.3: `group.id` ist optional). Es wird bewusst kein Ersatzbezeichner
 * erfunden — die Ebene ist nicht adressierbar (GSPP-242).
 */
const UNBENANNTE_TAXONOMIE = 'Ohne Gruppenkennung';

export interface ControlDetailProps {
  readonly control: Control;
  readonly controlsById?: Map<string, Control>;
  readonly incomingLinks?: IncomingControlLink[];
  readonly parentControl?: Control;
  readonly childControls?: Control[];
  readonly onClose: () => void;
  readonly onNavigateToControl?: (control: Control) => void;
}

export function getControlDetailUrl(
  catalogKey: CatalogKey,
  control: Pick<Control, 'id' | 'altIdentifier'>,
  options: {
    origin?: string;
    baseUrl?: string;
  } = {},
) {
  const origin = options.origin ?? window.location.origin;
  const baseUrl = options.baseUrl ?? import.meta.env.BASE_URL;
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const relativeControlUrl = buildControlUrlForControl(catalogKey, control).slice(1);

  return new URL(relativeControlUrl, new URL(normalizedBaseUrl, origin)).toString();
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
  const { vocabularyRegistry, catalog, catalogDocument } = useCatalog();
  if (!catalog) {
    throw new Error('ControlDetail requires a loaded catalog context');
  }

  const catalogKey = catalog.catalogKey;
  const controlStateKey = `${catalogKey}:${control.id}`;
  const {
    copy: copyLink,
    copied: linkCopied,
    error: linkCopyError,
  } = useClipboard();
  const {
    isActive: isVocabularyActive,
    toggle: toggleVocabulary,
  } = useActiveVocabulary({ scopeId: controlStateKey });
  const {
    ref: guidanceRef,
    expanded: guidanceExpanded,
    hasOverflow: guidanceHasOverflow,
    toggleExpanded: toggleGuidanceExpanded,
  } = useGuidanceOverflow({
    scopeId: controlStateKey,
    enabled: Boolean(control.guidance),
  });
  const resolvedVocabularies = useMemo(
    () => resolveControlVocabularies(vocabularyRegistry, control),
    [control, vocabularyRegistry],
  );
  const resolvedControlReferences = useMemo(() => {
    if (!catalogDocument) return [];

    return resolveControlReferences({
      document: referenceDocumentFromCatalog(catalogDocument),
      controlId: control.id,
      catalogsByKey: new Map([[
        catalog.catalogKey,
        controlsById ? { ...catalog, controlsById } : catalog,
      ]]),
    });
  }, [catalog, catalogDocument, control.id, controlsById]);
  const renderVocabularyCard = useCallback<RenderVocabularyCard>(
    (resolution, options) => (
      <VocabularyEntryCard
        resolution={resolution}
        hiddenColumns={options?.hiddenColumns}
      />
    ),
    [],
  );
  // Ohne Gruppen-`id` gibt es keinen adressierbaren Taxonomie-Eintrag. Der
  // Vergleich muss die Abwesenheit ausdrücklich ausschließen, sonst würde
  // `undefined === undefined` das Control der ersten id-losen Gruppe
  // zuschreiben — eine falsche Zuordnung statt einer fehlenden (GSPP-242).
  const practice =
    control.practiceId === undefined
      ? undefined
      : catalog.practices.find((candidate) => candidate.id === control.practiceId);
  const topic =
    control.groupId === undefined
      ? undefined
      : practice?.topics.find((candidate) => candidate.id === control.groupId);
  const practiceName = practice?.title ?? control.practiceId ?? UNBENANNTE_TAXONOMIE;
  const topicName = topic?.title ?? control.groupId ?? UNBENANNTE_TAXONOMIE;
  const practiceVocabulary = useMemo(
    () => resolvePracticeVocabulary(vocabularyRegistry, practice),
    [practice, vocabularyRegistry],
  );
  const topicVocabulary = useMemo(
    () => resolveTopicVocabulary(vocabularyRegistry, topic),
    [topic, vocabularyRegistry],
  );

  const handleCopyLink = () => {
    const url = getControlDetailUrl(catalogKey, control);
    void copyLink(url);
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
        {linkCopyError && (
          <div className="mb-2 space-y-1.5 rounded-md bg-[var(--color-danger-surface)] px-3 py-2">
            <p role="alert" className="text-xs text-[var(--color-danger-text)]">
              Kopieren nicht möglich. Bitte den vollständigen Wert manuell markieren und kopieren.
            </p>
            <button
              type="button"
              onClick={() => {
                void copyLink(getControlDetailUrl(catalogKey, control));
              }}
              aria-label="Direktlink zum manuellen Kopieren"
              className="block w-full cursor-text select-all break-all text-left font-mono text-xs text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
            >
              {getControlDetailUrl(catalogKey, control)}
            </button>
          </div>
        )}
        <ControlTaxonomyBreadcrumb
          practiceName={practiceName}
          topicName={topicName}
          hasTopic={Boolean(topic)}
          practiceVocabulary={practiceVocabulary}
          topicVocabulary={topicVocabulary}
          isVocabularyActive={isVocabularyActive}
          onToggleVocabulary={toggleVocabulary}
        />
        <h2 className="type-page-title">
          {control.title}
        </h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-safe lg:pb-4">
        <ControlClassification
          control={control}
          resolvedVocabularies={resolvedVocabularies}
          isVocabularyActive={isVocabularyActive}
          onToggleVocabulary={toggleVocabulary}
          renderVocabularyCard={renderVocabularyCard}
        />
        <ControlSecurityContext
          control={control}
          resolvedVocabularies={resolvedVocabularies}
          isVocabularyActive={isVocabularyActive}
          onToggleVocabulary={toggleVocabulary}
          renderVocabularyCard={renderVocabularyCard}
        />
        <ControlStatement statement={control.statement} />
        <ControlStatementDetails
          statementProps={control.statementProps}
          resolutions={resolvedVocabularies.statement}
          isVocabularyActive={isVocabularyActive}
          onToggleVocabulary={toggleVocabulary}
          renderVocabularyCard={renderVocabularyCard}
        />
        <ControlGuidance
          guidance={control.guidance}
          guidanceRef={guidanceRef}
          expanded={guidanceExpanded}
          hasOverflow={guidanceHasOverflow}
          onToggleExpanded={toggleGuidanceExpanded}
        />
        <ControlDependencies
          links={control.links}
          controlsById={controlsById}
          incomingLinks={incomingLinks}
          onNavigateToControl={onNavigateToControl}
        />
        <ControlSources references={resolvedControlReferences} />
        <ControlHierarchy
          parentControl={parentControl}
          childControls={childControls}
          onNavigateToControl={onNavigateToControl}
        />
        <ControlMetadata
          parentId={control.parentId}
          altIdentifier={control.altIdentifier}
          hasResolvedParent={Boolean(parentControl)}
        />
      </div>
    </div>
  );
}
