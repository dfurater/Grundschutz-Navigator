import { useCallback, useMemo, useState } from 'react';
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
import { segmentStatement } from '@/domain/statementSegments';
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
import { ControlDetailSection } from './ControlDetailSection';
import { ControlSources } from './ControlSources';
import { ControlGuidance } from './ControlGuidance';
import { ControlHierarchy } from './ControlHierarchy';
import { ControlMetadata } from './ControlMetadata';
import { ControlSecurityContext } from './ControlSecurityContext';
import { ControlStatement } from './ControlStatement';
import { ControlStatementDetails, type RestDetail } from './ControlStatementDetails';
import { ControlSubjectGroups, ControlWlanTaxonomy } from './ControlTaxonomy';
import { ControlTaxonomyBreadcrumb } from './ControlTaxonomyBreadcrumb';
import {
  SubSectionHeading,
  type RenderVocabularyCard,
} from './ControlVocabularyPrimitives';

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
  const origin = options.origin ?? globalThis.location.origin;
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
  // Fehlerpfad: Der Direktlink-Fallback muss stabil gerendert bleiben — ein
  // erneuter Kopierversuch darf ihn nicht unmounten, sonst verliert eine
  // markierte URL ihre Auswahl (Greptile-Finding PR #155). Der Zähler hält
  // die Anzeige über ALLE gleichzeitig laufenden Versuche offen; nur der
  // Abschluss des letzten Versuchs kann sie entfernen (Race-sicher).
  const [pendingCopyRetries, setPendingCopyRetries] = useState(0);
  const showCopyError = Boolean(linkCopyError) || pendingCopyRetries > 0;
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

  // GSPP-303 T9: EIN Segmentierungslauf für Satz (`ControlStatement`) und
  // Restzeilen (`ControlStatementDetails`, `missing`); T10 reicht das
  // Ergebnis als `precomputed` durch (Single-Run, keine Re-Segmentierung).
  const statementSegmentation = useMemo(() => {
    const input = {
      statementRaw: control.statementRaw,
      params: control.params,
      practiceTitle: practiceName,
      modalverb: control.modalverb,
      handlungsworte: control.statementProps.handlungsworte,
      ergebnis: control.statementProps.ergebnis,
      praezisierung: control.statementProps.praezisierung,
    };
    return { input, result: segmentStatement(input) };
  }, [control, practiceName]);
  const statementDetails: RestDetail[] = [
    {
      key: 'ergebnis',
      label: 'Ergebnis',
      value: control.statementProps.ergebnis ?? '',
      resolution: resolvedVocabularies.statement.ergebnis,
    },
    {
      key: 'praezisierung',
      label: 'Präzisierung',
      value: control.statementProps.praezisierung ?? '',
      resolution: resolvedVocabularies.statement.praezisierung,
    },
    {
      key: 'handlungsworte',
      label: 'Handlungswort',
      value: control.statementProps.handlungsworte ?? '',
      resolution: resolvedVocabularies.statement.handlungsworte,
    },
    {
      key: 'dokumentation',
      label: 'Dokumentation',
      value: control.statementProps.dokumentation ?? '',
      resolution: resolvedVocabularies.statement.dokumentation,
    },
  ];
  const hasAnforderung = Boolean(statementSegmentation.input.statementRaw)
    || Boolean(control.statement)
    || statementDetails.some((detail) => detail.value !== '');

  const hasSecurityTargetRelevance = (control.confidentialityProp?.value ?? control.confidentiality) !== undefined
    || (control.integrityProp?.value ?? control.integrity) !== undefined
    || (control.availabilityProp?.value ?? control.availability) !== undefined
    || (control.authenticityProp?.value ?? control.authenticity) !== undefined;
  const hasMerkmale = hasSecurityTargetRelevance
    || control.threats.length > 0
    || control.tags.length > 0
    || control.statementProps.zielobjektKategorien.length > 0
    || control.taxonomy.length > 0;

  // Spiegelt die Null-Guards von `ControlDependencies` (aufgelöste Out-Links
  // bzw. reine In-Links) und `ControlSources` (keine Kontroll-/Provenienz-
  // Referenzen), damit Gruppen-Beschriftungen nur bei Inhalt stehen.
  const resolvedOutgoingLinks = control.links.filter((link) => controlsById?.has(link.targetId));
  const outgoingLinkTargetIds = new Set(resolvedOutgoingLinks.map((link) => link.targetId));
  const hasOutgoingLinks = resolvedOutgoingLinks.length > 0;
  const hasIncomingOnlyLinks = incomingLinks.some(
    (incoming) => !outgoingLinkTargetIds.has(incoming.control.id),
  );
  const hasRelatedLinks = hasOutgoingLinks || hasIncomingOnlyLinks;
  const hasSources = resolvedControlReferences.some(
    (reference) => reference.kind !== 'control' && reference.kind !== 'provenance',
  );
  const hasZusammenhaenge = childControls.length > 0 || hasRelatedLinks || hasSources;

  // Spiegelt den Null-Guard von `ControlMetadata`.
  const hasFooter = (!parentControl && Boolean(control.parentId))
    || Boolean(control.altIdentifier);
  const hasZoneContent = hasMerkmale || hasZusammenhaenge || hasFooter;

  const handleCopyLink = () => {
    const url = getControlDetailUrl(catalogKey, control);
    if (showCopyError) {
      setPendingCopyRetries((pending) => pending + 1);
      void copyLink(url).finally(() => {
        // Nur der letzte laufende Versuch darf die Anzeige schließen —
        // sonst entfernt ein früher fertig werdender älterer Versuch den
        // Fallback unter einem noch laufenden neueren Versuch (Race).
        setPendingCopyRetries((pending) => Math.max(0, pending - 1));
      });
      return;
    }
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
        {showCopyError && (
          <div className="mb-2 space-y-1.5 rounded-md bg-[var(--color-danger-surface)] px-3 py-2">
            <p role="alert" className="text-xs text-[var(--color-danger-text)]">
              Kopieren nicht möglich. Bitte den vollständigen Wert manuell markieren und kopieren.
            </p>
            <code
              aria-label="Direktlink zum manuellen Kopieren"
              className="block select-all break-all font-mono text-xs text-[var(--color-text-primary)]"
            >
              {getControlDetailUrl(catalogKey, control)}
            </code>
            <button
              type="button"
              onClick={handleCopyLink}
              className="rounded-md px-2 py-1 text-xs font-medium text-[var(--color-accent-default)] transition-colors hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
            >
              Erneut kopieren
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
        {parentControl && (
          <button
            type="button"
            onClick={() => onNavigateToControl?.(parentControl)}
            aria-label={`Teil von ${parentControl.id} ${parentControl.title}`}
            className="mt-1 rounded text-left text-sm text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-accent-default)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
          >
            ↳ Teil von {parentControl.id} {parentControl.title}
          </button>
        )}
      </div>

      {/* Content: Kopf/Kurzprofil/Anforderung/Hinweise auf raised, Merkmale/Zusammenhänge/Fußzeile in der Zone (GSPP-303 T4/T9). */}
      <div data-control-detail-scroll className="flex-1 overflow-y-auto p-4 space-y-6 pb-safe lg:pb-4">
        <ControlClassification
          control={control}
          resolvedVocabularies={resolvedVocabularies}
        />
        {hasAnforderung && (
          <ControlStatement
            statement={control.statement}
            segments={{
              input: statementSegmentation.input,
              precomputed: statementSegmentation.result,
              practiceResolution: practiceVocabulary,
              modalverbResolution: resolvedVocabularies.modalverb,
              handlungswortResolution: resolvedVocabularies.statement.handlungsworte,
              ergebnisResolution: resolvedVocabularies.statement.ergebnis,
              praezisierungResolution: resolvedVocabularies.statement.praezisierung,
              isVocabularyActive,
              onToggleVocabulary: toggleVocabulary,
              renderVocabularyCard,
            }}
          >
            <ControlStatementDetails
              details={statementDetails}
              missing={statementSegmentation.result.missing}
              isVocabularyActive={isVocabularyActive}
              onToggleVocabulary={toggleVocabulary}
              renderVocabularyCard={renderVocabularyCard}
            />
          </ControlStatement>
        )}
        <ControlGuidance
          guidance={control.guidance}
          guidanceRef={guidanceRef}
          expanded={guidanceExpanded}
          hasOverflow={guidanceHasOverflow}
          onToggleExpanded={toggleGuidanceExpanded}
        />
        {hasZoneContent && (
          <div className="bg-[var(--color-surface-subtle)] border-t border-[var(--color-border-default)] -mx-4 -mb-4 px-4 py-4 space-y-6">
            {hasMerkmale && (
              <ControlDetailSection heading="Merkmale" tone="onZone">
                <div className="space-y-4">
                  <ControlSecurityContext
                    control={control}
                    resolvedVocabularies={resolvedVocabularies}
                    isVocabularyActive={isVocabularyActive}
                    onToggleVocabulary={toggleVocabulary}
                    renderVocabularyCard={renderVocabularyCard}
                  />
                  <ControlSubjectGroups
                    control={control}
                    resolvedVocabularies={resolvedVocabularies}
                    isVocabularyActive={isVocabularyActive}
                    onToggleVocabulary={toggleVocabulary}
                    renderVocabularyCard={renderVocabularyCard}
                  />
                  {control.taxonomy.length > 0 && (
                    <ControlWlanTaxonomy control={control} />
                  )}
                </div>
              </ControlDetailSection>
            )}
            {hasZusammenhaenge && (
              <ControlDetailSection heading="Zusammenhänge" tone="onZone">
                <div className="space-y-4">
                  {childControls.length > 0 && (
                    <div>
                      <SubSectionHeading>Erweiterungen</SubSectionHeading>
                      <ControlHierarchy
                        childControls={childControls}
                        onNavigateToControl={onNavigateToControl}
                      />
                    </div>
                  )}
                  {hasRelatedLinks && (
                    <div>
                      <SubSectionHeading>Verknüpft</SubSectionHeading>
                      <ControlDependencies
                        links={control.links}
                        controlsById={controlsById}
                        incomingLinks={incomingLinks}
                        onNavigateToControl={onNavigateToControl}
                      />
                    </div>
                  )}
                  {hasSources && (
                    <div>
                      <SubSectionHeading>Quellen</SubSectionHeading>
                      <ControlSources references={resolvedControlReferences} />
                    </div>
                  )}
                </div>
              </ControlDetailSection>
            )}
            <ControlMetadata
              parentId={control.parentId}
              altIdentifier={control.altIdentifier}
              hasResolvedParent={Boolean(parentControl)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
