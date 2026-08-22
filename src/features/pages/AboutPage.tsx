import {
  IconShieldCheck,
  IconExternalLink,
  IconClipboard,
  IconCheck,
  IconDocument,
  IconInfo,
  IconLink,
} from '@/components/icons';
import type {
  CatalogParty,
  CatalogProvenance,
  CatalogRole,
  CatalogResponsibleParty,
} from '@/domain/models';
import type {
  CatalogLineageDocument,
  CatalogLineageImport,
  CatalogLineageProjection,
  CatalogLineageState,
} from '@/domain/catalogLineage';
import {
  isSafeExternalHref,
  referenceDocumentFromCatalog,
  resolveCatalogMetadataReferences,
  resolveCatalogResources,
  type ResolvedOscalReference,
  type ResolvedResource,
} from '@/domain/referenceResolution';
import {
  ENTRY_CATALOG,
  SUPPORTED_CATALOGS,
  catalogDataFileName,
  type CatalogKey,
} from '@/domain/sourceRegistry';
import { useCatalog } from '@/hooks/useCatalog';
import { useClipboard } from '@/hooks/useClipboard';

const DEFAULT_UPSTREAM_REPOSITORY_PATH = 'BSI-Bund/Stand-der-Technik-Bibliothek';

/**
 * Registereintrag des angezeigten Katalogs. Aus dem Quellregister abgeleitet,
 * damit Upstream-Umbenennungen nicht doppelt gepflegt werden; bei unbekanntem
 * Schlüssel bleibt es beim Einstiegskatalog.
 */
function resolveCatalogRegistryEntry(catalogKey: CatalogKey) {
  return SUPPORTED_CATALOGS.find((entry) => entry.catalogKey === catalogKey) ?? ENTRY_CATALOG;
}

const surfacePanelClass =
  'rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)]';
const pageSectionClass = 'border-t border-[var(--color-border-subtle)] pt-6';
const sectionLabelClass = 'type-meta text-[var(--color-text-secondary)]';
const subsectionHeadingClass = 'text-sm font-semibold text-[var(--color-text-primary)]';
const bodyTextClass = 'text-sm leading-relaxed text-[var(--color-text-primary)]';
const metaLabelClass = 'type-meta';
const metaValueClass = 'text-xs font-medium text-[var(--color-text-primary)]';
const externalLinkClass = 'catalog-link-color inline-flex items-center gap-0.5';
const verificationSuccessTone = {
  banner: 'bg-[var(--color-success-surface)]',
  icon: 'text-[var(--color-success)]',
  text: 'text-[var(--color-success-text)]',
} as const;
const verificationFailureTone = {
  banner: 'bg-[var(--color-danger-surface)]',
  icon: 'text-[var(--color-danger-text)]',
  text: 'text-[var(--color-danger-text)]',
} as const;
const copyErrorMessage =
  'Kopieren nicht möglich. Bitte den vollständigen Wert manuell markieren und kopieren.';

function resolveUpstreamRef(provenance: CatalogProvenance | null): string {
  const ref = provenance?.source.commit_sha && provenance.source.commit_sha !== 'unknown'
    ? provenance.source.commit_sha
    : 'main';

  return ref;
}

function resolveUpstreamRepositoryPath(repositoryUrl?: string): string {
  try {
    const path = new URL(repositoryUrl ?? `https://github.com/${DEFAULT_UPSTREAM_REPOSITORY_PATH}`)
      .pathname
      .replace(/^\/+|\/+$/g, '');
    return path || DEFAULT_UPSTREAM_REPOSITORY_PATH;
  } catch {
    return DEFAULT_UPSTREAM_REPOSITORY_PATH;
  }
}

function buildUpstreamCatalogUrl(
  provenance: CatalogProvenance | null,
  catalogKey: CatalogKey,
): string {
  const repositoryPath = resolveUpstreamRepositoryPath(provenance?.source.repository);
  const ref = resolveUpstreamRef(provenance);
  const catalogPath =
    provenance?.source.file || resolveCatalogRegistryEntry(catalogKey).upstreamPath;

  return `https://raw.githubusercontent.com/${repositoryPath}/${ref}/${catalogPath}`;
}

function buildUpstreamSnapshotUrl(
  repositoryUrl: string | undefined,
  snapshotCommitSha: string | undefined,
  upstreamPath: string | null,
): string | null {
  if (!upstreamPath || !snapshotCommitSha || snapshotCommitSha === 'unknown') return null;

  return `https://github.com/${resolveUpstreamRepositoryPath(repositoryUrl)}/blob/${snapshotCommitSha}/${upstreamPath}`;
}

function buildAppCatalogUrl(
  catalogKey: CatalogKey,
  baseUrl = import.meta.env.BASE_URL,
): string {
  const fileName = catalogDataFileName(resolveCatalogRegistryEntry(catalogKey));
  return new URL(`data/${fileName}`, new URL(baseUrl, window.location.origin)).toString();
}

function buildVerifyCommand(appUrl: string, upstreamUrl: string): string {
  return `bash -lc '[ "$(curl -fsSL "$1" | sha256sum | cut -d" " -f1)" = "$(curl -fsSL "$2" | sha256sum | cut -d" " -f1)" ] && printf "true\\n" || printf "false\\n"' bash '${appUrl}' '${upstreamUrl}'`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('de-DE', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function getRoleTitle(roleId: string, roles: CatalogRole[]): string {
  return roles.find((role) => role.id === roleId)?.title ?? roleId;
}

function getPartyByUuid(uuid: string, parties: CatalogParty[]): CatalogParty | undefined {
  return parties.find((party) => party.uuid === uuid);
}

function formatPartyLabel(party: CatalogParty): string {
  return party.email ? `${party.name} (${party.email})` : party.name;
}

function CopyableValue({
  label,
  value,
  displayValue,
}: {
  label: string;
  value: string;
  displayValue?: string;
}) {
  const { copy, copied, error } = useClipboard();

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <span className="type-meta shrink-0 pt-0.5">{label}</span>
        <button
          type="button"
          onClick={() => void copy(value)}
          className="group flex min-w-0 items-center gap-1.5 text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
          title={`${label} kopieren`}
          aria-label={`${label} kopieren`}
        >
          {copied ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-success)]">
              <IconCheck className="h-3 w-3" />
              Kopiert
            </span>
          ) : (
            <>
              <span className="break-all text-right font-mono text-xs text-[var(--color-text-secondary)]">
                {displayValue ?? value}
              </span>
              <IconClipboard className="h-3 w-3 shrink-0 text-[var(--color-text-muted)] transition-colors group-hover:text-[var(--color-text-secondary)]" />
            </>
          )}
        </button>
      </div>
      {error && (
        <div className="mt-2 space-y-1.5 text-right">
          <p role="alert" className="text-xs text-[var(--color-danger-text)]">
            {copyErrorMessage}
          </p>
          <code
            tabIndex={0}
            aria-label={`${label}: vollständiger Wert zum manuellen Kopieren`}
            className="block select-all break-all font-mono text-xs text-[var(--color-text-primary)]"
          >
            {value}
          </code>
        </div>
      )}
    </div>
  );
}

function CopyButton({ command }: { command: string }) {
  const { copy, copied, error } = useClipboard();

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void copy(command)}
        className="touch-target-size flex items-center justify-center gap-1 rounded p-2 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
        aria-label="Code kopieren"
      >
        {copied ? (
          <>
            <IconCheck className="h-3.5 w-3.5 text-[var(--color-success-text)]" />
            <span className="text-[var(--color-success-text)]">Kopiert</span>
          </>
        ) : (
          <>
            <IconClipboard className="h-3.5 w-3.5" />
            <span>Kopieren</span>
          </>
        )}
      </button>
      {error && (
        <p
          role="alert"
          className="max-w-64 text-right text-xs leading-relaxed text-[var(--color-danger-text)]"
        >
          {copyErrorMessage}
        </p>
      )}
    </div>
  );
}

function LinkRow({ label, href }: { label: string; href: string }) {
  return (
    <div className="px-4 py-2.5">
      <span className={`block ${metaLabelClass}`}>{label}</span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="catalog-link-color mt-1 inline-flex min-w-0 items-start gap-1 text-xs font-medium"
      >
        <span className="break-all">{href}</span>
        <span className="sr-only"> (öffnet in neuem Tab)</span>
        <IconExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      </a>
    </div>
  );
}

function ExternalReferenceLink({ href, label }: { href: string; label: string }) {
  if (!isSafeExternalHref(href)) {
    return <span className="break-all text-sm text-[var(--color-text-primary)]">{label}</span>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="catalog-link-color inline-flex items-center gap-1 break-all text-sm"
    >
      {label}
      <span className="sr-only"> (externer Link, öffnet in neuem Tab)</span>
      <IconExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

function ResourceLinkList({ resource }: { resource: ResolvedResource }) {
  if (resource.rlinks.length === 0) {
    return <p className="type-secondary text-sm">Keine verknüpften Links vorhanden.</p>;
  }

  return (
    <ul className="space-y-2">
      {resource.rlinks.map((rlink) => (
        <li key={`${resource.uuid}-${rlink.href}`} className="space-y-1">
          {rlink.target.kind === 'external' && rlink.target.href ? (
            <ExternalReferenceLink href={rlink.target.href} label={rlink.href} />
          ) : (
            <p className="break-all text-sm text-[var(--color-text-primary)]">{rlink.href}</p>
          )}
          {rlink.mediaType && <p className="type-meta">Medientyp: {rlink.mediaType}</p>}
          {rlink.integrity === 'missing' ? (
            <p className="type-meta">Ohne Integritätsnachweis</p>
          ) : (
            <ul className="space-y-1">
              {rlink.hashes.map((hash) => (
                <li
                  key={`${rlink.href}-${hash.algorithm}-${hash.value}`}
                  className="type-meta break-all"
                >
                  {hash.algorithm}: <code className="font-mono">{hash.value}</code>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function MetadataReference({ reference }: { reference: ResolvedOscalReference }) {
  if (reference.kind === 'provenance') return null;

  const label = reference.text?.trim() || reference.href;
  const resourceLink = reference.kind === 'resource'
    ? reference.resource.rlinks.find((rlink) => rlink.target.kind === 'external')
    : undefined;
  const targetHref = reference.kind === 'external'
    ? reference.href
    : resourceLink?.target.kind === 'external'
      ? resourceLink.target.href
      : undefined;

  return (
    <li className="space-y-1">
      {targetHref ? (
        <ExternalReferenceLink href={targetHref} label={label} />
      ) : (
        <p className="break-all text-sm text-[var(--color-text-primary)]">{label}</p>
      )}
      <p className="type-meta break-all">
        Relation: {reference.rel ?? 'nicht gesetzt'} · Quelle: {reference.href}
      </p>
      {reference.kind === 'resource' && reference.resourceFragment && (
        <p className="type-meta">Fragment: {reference.resourceFragment}</p>
      )}
    </li>
  );
}

const lineageStateLabels: Record<Exclude<CatalogLineageState, 'complete'>, string> = {
  'import-href-missing': 'Import ohne href',
  'import-href-not-fragment': 'Import-href ist kein lokales Fragment',
  'resource-missing': 'Back-matter-Ressource fehlt',
  'resource-ambiguous': 'Back-matter-Ressource ist mehrdeutig',
  'rlink-missing': 'Ressourcen-Link fehlt',
  'rlink-ambiguous': 'Ressourcen-Link ist mehrdeutig',
  'artifact-unregistered': 'Quelle ist nicht explizit im Quellregister zugeordnet',
  'import-duplicate': 'Profilimport ist mehrfach vorhanden',
  'configured-import-missing': 'Konfigurierter Quellimport fehlt im Profil',
};

const lineageStates = new Set<CatalogLineageState>([
  'complete',
  'import-href-missing',
  'import-href-not-fragment',
  'resource-missing',
  'resource-ambiguous',
  'rlink-missing',
  'rlink-ambiguous',
  'artifact-unregistered',
  'import-duplicate',
  'configured-import-missing',
]);

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCatalogLineageDocument(value: unknown): value is CatalogLineageDocument {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.artifactKey === 'string' &&
    isNullableString(document.title) &&
    isNullableString(document.documentUuid) &&
    isNullableString(document.oscalVersion) &&
    isNullableString(document.version) &&
    isNullableString(document.upstreamPath) &&
    isNullableString(document.gitBlobSha) &&
    isNullableString(document.contentSha256)
  );
}

function isCatalogLineageImport(value: unknown): value is CatalogLineageImport {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const importedCatalog = value as Record<string, unknown>;
  const state = importedCatalog.state;
  if (typeof state !== 'string' || !lineageStates.has(state as CatalogLineageState)) return false;

  const hasValidIndex =
    state === 'configured-import-missing'
      ? importedCatalog.index === null
      : Number.isSafeInteger(importedCatalog.index) && (importedCatalog.index as number) >= 0;
  if (
    !hasValidIndex ||
    !isNullableString(importedCatalog.importHref) ||
    !isNullableString(importedCatalog.resourceUuid) ||
    !isNullableString(importedCatalog.rlinkHref)
  ) {
    return false;
  }

  return importedCatalog.state === 'complete'
    ? isCatalogLineageDocument(importedCatalog.source)
    : importedCatalog.source === null;
}

function isCatalogLineageProjection(value: unknown): value is CatalogLineageProjection {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const lineage = value as Record<string, unknown>;
  return (
    typeof lineage.catalogKey === 'string' &&
    lineage.catalogKey.length > 0 &&
    isCatalogLineageDocument(lineage.profile) &&
    Array.isArray(lineage.imports) &&
    lineage.imports.every(isCatalogLineageImport)
  );
}

function resolveActiveCatalogLineage(lineages: unknown, activeCatalogKey: CatalogKey) {
  if (lineages === undefined) return { lineage: null, invalid: false };
  if (!Array.isArray(lineages)) return { lineage: null, invalid: true };

  const candidates = lineages.filter(
    (candidate) =>
      candidate !== null &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      (candidate as { catalogKey?: unknown }).catalogKey === activeCatalogKey,
  );
  if (candidates.length === 0) return { lineage: null, invalid: false };
  if (candidates.length !== 1 || !isCatalogLineageProjection(candidates[0])) {
    return { lineage: null, invalid: true };
  }
  return { lineage: candidates[0], invalid: false };
}

function LineageDocumentDetails({
  document,
  snapshotUrl,
  label,
}: Readonly<{
  document: CatalogLineageDocument;
  snapshotUrl: string | null;
  label: string;
}>) {
  const title = document.title ?? document.artifactKey;

  return (
    <div className="space-y-1.5">
      <p className="type-meta">{label}</p>
      {snapshotUrl ? (
        <ExternalReferenceLink href={snapshotUrl} label={title} />
      ) : (
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{title}</p>
      )}
      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className={metaLabelClass}>Dokument-UUID</dt>
        <dd className="break-all font-mono text-[var(--color-text-primary)]">
          {document.documentUuid ?? 'nicht angegeben'}
        </dd>
        <dt className={metaLabelClass}>OSCAL-Version</dt>
        <dd className="text-[var(--color-text-primary)]">
          {document.oscalVersion ?? 'nicht angegeben'}
        </dd>
        <dt className={metaLabelClass}>Version / Stand</dt>
        <dd className="break-all text-[var(--color-text-primary)]">
          {document.version ?? 'nicht angegeben'}
        </dd>
      </dl>
    </div>
  );
}

function LineageImportEntry({
  importedCatalog,
  repositoryUrl,
  snapshotCommitSha,
}: Readonly<{
  importedCatalog: CatalogLineageImport;
  repositoryUrl: string | undefined;
  snapshotCommitSha: string | undefined;
}>) {
  if (importedCatalog.state === 'complete' && importedCatalog.source) {
    return (
      <li className="border-t border-[var(--color-border-subtle)] pt-4 first:border-t-0 first:pt-0">
        <LineageDocumentDetails
          label="Quellkatalog"
          document={importedCatalog.source}
          snapshotUrl={buildUpstreamSnapshotUrl(
            repositoryUrl,
            snapshotCommitSha,
            importedCatalog.source.upstreamPath,
          )}
        />
        <p className="type-meta mt-2 break-all">
          Profilreferenz: {importedCatalog.importHref} · Ressourcen-Link: {importedCatalog.rlinkHref}
        </p>
      </li>
    );
  }

  const unresolvedState = importedCatalog.state === 'complete'
    ? 'artifact-unregistered'
    : importedCatalog.state;
  const referenceDetails = [
    importedCatalog.importHref ? `Import: ${importedCatalog.importHref}` : null,
    importedCatalog.resourceUuid ? `Ressource: ${importedCatalog.resourceUuid}` : null,
    importedCatalog.rlinkHref ? `Link: ${importedCatalog.rlinkHref}` : null,
  ].filter((detail): detail is string => detail !== null);

  return (
    <li className="border-t border-[var(--color-border-subtle)] pt-4 first:border-t-0 first:pt-0">
      <p className="text-sm font-medium text-[var(--color-text-primary)]">
        {lineageStateLabels[unresolvedState]}
      </p>
      {referenceDetails.length > 0 && (
        <p className="type-meta mt-1 break-all">
          {referenceDetails.join(' · ')}
        </p>
      )}
    </li>
  );
}

export function AboutPage() {
  const {
    provenance,
    verification,
    catalog,
    catalogDocument,
    activeCatalogKey,
    vocabularyProvenance,
    vocabularyVerification,
  } = useCatalog();
  const metadata = catalog?.metadata;
  const referenceDocument = catalogDocument
    ? referenceDocumentFromCatalog(catalogDocument)
    : null;
  const metadataReferences = referenceDocument
    ? resolveCatalogMetadataReferences({ document: referenceDocument })
    : [];
  const resolvedResources = referenceDocument
    ? resolveCatalogResources({ document: referenceDocument })
    : [];
  const appCatalogUrl = buildAppCatalogUrl(activeCatalogKey);
  const upstreamCatalogUrl = buildUpstreamCatalogUrl(provenance, activeCatalogKey);
  const verifyCommand = buildVerifyCommand(appCatalogUrl, upstreamCatalogUrl);
  const verificationTone = verification?.valid
    ? verificationSuccessTone
    : verification
      ? verificationFailureTone
      : null;
  const vocabularyVerificationTone = vocabularyVerification?.valid
    ? verificationSuccessTone
    : vocabularyVerification
      ? verificationFailureTone
      : null;
  const { lineage: activeCatalogLineage, invalid: invalidCatalogLineage } =
    resolveActiveCatalogLineage(vocabularyProvenance?.catalogLineages, activeCatalogKey);
  const hasResolutionTool = metadata?.props.some((prop) => prop.name === 'resolution-tool') ?? false;
  const hasSourceProfile = metadata?.links.some((link) => link.rel === 'source-profile') ?? false;

  return (
    <div className="mx-auto max-w-3xl px-6 pt-8 pb-12">
      <header className="flex items-start gap-3.5 pb-8">
        <IconInfo className="mt-0.5 h-8 w-8 shrink-0 text-[var(--color-accent-default)]" />
        <div className="min-w-0">
          <h1 className="type-page-title">Über das Projekt</h1>
          <p className="type-secondary mt-0.5">
            Der Grundschutz++ Navigator erschließt den offiziellen BSI-Katalog im Browser.
            Die Anwendung ist kein Angebot des BSI.
          </p>
          <p className="type-meta mt-3">
            Clientseitige Verarbeitung &middot; Laufzeit-Verifikation per SHA-256 &middot; Build-Provenance via GitHub Actions
          </p>
        </div>
      </header>

      <div className="space-y-8">
        <section className={pageSectionClass}>
          <h2 className={sectionLabelClass}>Einordnung</h2>
          <div className="mt-4 space-y-6">
            <div className="space-y-2">
              <h3 className={subsectionHeadingClass}>Was ist Grundschutz++?</h3>
              <p className={bodyTextClass}>
                Grundschutz++ ist ein vom BSI veröffentlichter Anwenderkatalog zur
                Fortentwicklung des IT-Grundschutzes. Der Katalog wird maschinenlesbar
                im OSCAL-Format bereitgestellt und verbindet methodische Anforderungen
                für ein ISMS mit konkreten technisch-organisatorischen Anforderungen.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className={subsectionHeadingClass}>Was zeigt diese App?</h3>
              <p className={bodyTextClass}>
                Der Grundschutz++ Navigator erschließt den offiziellen Katalog für
                die fachliche Arbeit im Browser: suchen, filtern, einordnen und als
                CSV exportieren.
              </p>
            </div>
          </div>
        </section>

        <section className={pageSectionClass}>
          <h2 className={`${sectionLabelClass} flex items-center gap-2`}>
            <IconShieldCheck className="h-4.5 w-4.5 text-[var(--color-accent-default)]" />
            Datenherkunft und Verifikation
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-text-primary)]">
            Der angezeigte Katalog stammt aus dem offiziellen BSI-Repository. Die App
            vergleicht die geladene Datei zur Laufzeit per SHA-256 mit den beim Build
            erfassten Metadaten und dokumentiert die Herkunft des Deployments.
          </p>

          <dl className="mt-4 grid grid-cols-[6.5rem_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className={metaLabelClass}>Quelle</dt>
            <dd className="text-[var(--color-text-primary)]">
              <a
                href="https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek"
                target="_blank"
                rel="noopener noreferrer"
                className={externalLinkClass}
              >
                github.com/BSI-Bund/Stand-der-Technik-Bibliothek
                <span className="sr-only"> (öffnet in neuem Tab)</span>
                <IconExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </dd>

            <dt className={metaLabelClass}>Integrität</dt>
            <dd className="text-[var(--color-text-primary)]">
              SHA-256-Abgleich zwischen geladener Datei und Build-Metadaten
            </dd>

            <dt className={metaLabelClass}>Build</dt>
            <dd className="text-[var(--color-text-primary)]">
              SLSA-Provenance des Deployments via GitHub Actions
            </dd>

            <dt className={metaLabelClass}>Aktualisierung</dt>
            <dd className="text-[var(--color-text-primary)]">
              Täglicher Abgleich des referenzierten BSI-Snapshots
            </dd>
          </dl>

          <div className={`${surfacePanelClass} mt-5 overflow-hidden`}>
            <div className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="type-meta">Prüfbefehl</p>
                  <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
                    SHA-256 von App- und Upstream-Katalog vergleichen
                  </p>
                </div>
                <CopyButton command={verifyCommand} />
              </div>

              <div className="mt-3 rounded-[calc(var(--radius-md)-2px)] bg-[var(--color-surface-subtle)] px-4 py-3">
                <code
                  tabIndex={0}
                  aria-label="Prüfbefehl zum manuellen Kopieren"
                  className="select-all break-all font-mono text-xs leading-relaxed text-[var(--color-text-primary)]"
                >
                  {verifyCommand}
                </code>
              </div>

              <p className="type-meta mt-3">
                Der Befehl lädt beide Dateien, vergleicht ihre SHA-256-Prüfsummen
                und gibt `true` bei Gleichheit bzw. `false` bei Abweichung aus.
              </p>
            </div>

            {provenance && (
              <div className="border-t border-[var(--color-border-default)]">
                <div
                  className={`px-4 py-3 ${
                    verificationTone?.banner ?? 'bg-[var(--color-surface-subtle)]'
                  }`}
                >
                  {verification ? (
                    <div className="flex items-center gap-2.5">
                      <IconShieldCheck className={`h-4.5 w-4.5 ${verificationTone!.icon}`} />
                      <div>
                        <span className={`text-sm font-semibold ${verificationTone!.text}`}>
                          {verification.valid
                            ? 'Katalog verifiziert'
                            : 'Verifikation fehlgeschlagen'}
                        </span>
                        <p className={`mt-0.5 text-xs ${verificationTone!.text}`}>
                          {verification.valid
                            ? 'Datei-Hash stimmt mit den Build-Metadaten überein'
                            : 'Datei-Hash weicht von den Build-Metadaten ab'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <span className="type-meta">Verifikation ausstehend…</span>
                  )}
                </div>

                <div className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-surface-base)]">
                  {provenance.source.commit_date && provenance.source.commit_date !== 'unknown' && (
                    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                      <span className={metaLabelClass}>Commit-Datum</span>
                      <span className={metaValueClass}>
                        {formatDate(provenance.source.commit_date)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                    <span className={metaLabelClass}>Abgerufen am</span>
                    <span className={metaValueClass}>
                      {formatDate(provenance.integrity.fetched_at)}
                    </span>
                  </div>
                  <LinkRow label="App-Katalog" href={appCatalogUrl} />
                  <LinkRow label="Upstream-Katalog" href={upstreamCatalogUrl} />
                  {provenance.source.commit_sha && provenance.source.commit_sha !== 'unknown' && (
                    <CopyableValue
                      label="Commit"
                      value={provenance.source.commit_sha}
                      displayValue={provenance.source.commit_sha.slice(0, 12)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {catalog && metadata && (
            <div className={`${surfacePanelClass} mt-5 divide-y divide-[var(--color-border-subtle)]`}>
              <div className="px-4 py-3">
                <p className="type-meta">OSCAL-Ableitungsprovenienz</p>
                <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
                  Markierungen im ausgelieferten OSCAL-Dokument
                </p>
                <p className="type-meta mt-2">
                  Diese optionalen Angaben beschreiben die Ableitung des Dokuments selbst.
                </p>
              </div>
              <div className="divide-y divide-[var(--color-border-subtle)]">
                <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <span className={metaLabelClass}>resolution-tool</span>
                  <span className={metaValueClass}>{hasResolutionTool ? 'vorhanden' : 'nicht vorhanden'}</span>
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <span className={metaLabelClass}>source-profile</span>
                  <span className={metaValueClass}>{hasSourceProfile ? 'vorhanden' : 'nicht vorhanden'}</span>
                </div>
              </div>
              <p className="px-4 py-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                Fehlende optionale Marker sind ein Projektbefund, kein Schemafehler.
              </p>
              <div className="border-t border-[var(--color-border-subtle)] px-4 py-3">
                <p className="type-meta">Ressourcen-Hashes</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                  Hashes unter <code className="font-mono">back-matter.resource.rlinks</code> beschreiben
                  referenzierte Ressourcen, nie einen Hash des Katalogdokuments über sich selbst.
                </p>
              </div>
            </div>
          )}

          {invalidCatalogLineage && vocabularyProvenance && (
            <div className={`${surfacePanelClass} mt-5 px-4 py-3`}>
              <p className="type-meta">Quellkatalog-Lineage nicht verfügbar</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                Die im Build-Sidecar enthaltene Lineage ist unvollständig oder widersprüchlich und wird
                nicht angezeigt.
              </p>
            </div>
          )}

          {activeCatalogLineage && vocabularyProvenance && (
            <div className={`${surfacePanelClass} mt-5 overflow-hidden`}>
              <div className="px-4 py-3">
                <p className="type-meta">Quellkatalog-Lineage</p>
                <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
                  Aufgelöster Katalog ← Profil ← registrierte Quellkataloge
                </p>
                <p className="type-meta mt-2">Profile Resolution: Draft · keine Control-genaue Herkunftsaussage</p>
              </div>
              <div className="border-t border-[var(--color-border-default)] px-4 py-4">
                <LineageDocumentDetails
                  label="Profil"
                  document={activeCatalogLineage.profile}
                  snapshotUrl={buildUpstreamSnapshotUrl(
                    vocabularyProvenance.source?.repository,
                    vocabularyProvenance.source?.snapshotCommitSha,
                    activeCatalogLineage.profile.upstreamPath,
                  )}
                />
                <ul className="mt-4 space-y-4">
                  {activeCatalogLineage.imports.map((importedCatalog, importPosition) => (
                    <LineageImportEntry
                      key={`lineage-import:${importedCatalog.index ?? 'configured'}:${importPosition}`}
                      importedCatalog={importedCatalog}
                      repositoryUrl={vocabularyProvenance.source?.repository}
                      snapshotCommitSha={vocabularyProvenance.source?.snapshotCommitSha}
                    />
                  ))}
                </ul>
              </div>
            </div>
          )}

          {vocabularyProvenance && (
            <div className={`${surfacePanelClass} mt-5 overflow-hidden`}>
              <div className="px-4 py-3">
                <p className="type-meta">Projekt-Build-Provenienz</p>
                <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">
                  Manifest v2 und Vokabulare aus demselben Upstream-Snapshot
                </p>
                <p className="type-meta mt-2">
                  Git-Blob-SHA und SHA-256 stammen aus den Build-Metadaten, nicht aus einem
                  Selbsthash des OSCAL-Dokuments.
                </p>
              </div>

              <div className="border-t border-[var(--color-border-default)]">
                <div
                  className={`px-4 py-3 ${
                    vocabularyVerificationTone?.banner ?? 'bg-[var(--color-surface-subtle)]'
                  }`}
                >
                  {vocabularyVerification ? (
                    <div className="flex items-center gap-2.5">
                      <IconShieldCheck
                        className={`h-4.5 w-4.5 ${vocabularyVerificationTone!.icon}`}
                      />
                      <div>
                        <span
                          className={`text-sm font-semibold ${vocabularyVerificationTone!.text}`}
                        >
                          {vocabularyVerification.valid
                            ? 'Vokabulare verifiziert'
                            : 'Vokabular-Verifikation fehlgeschlagen'}
                        </span>
                        <p className={`mt-0.5 text-xs ${vocabularyVerificationTone!.text}`}>
                          {vocabularyVerification.valid
                            ? 'Vokabular-Hash stimmt mit den Build-Metadaten überein'
                            : 'Vokabular-Hash weicht von den Build-Metadaten ab'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <span className="type-meta">Verifikation ausstehend…</span>
                  )}
                </div>

                <div className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-surface-base)]">
                  {/* Laufzeit-JSON kann von älteren Deployments stammen — Felder nie unbedingt dereferenzieren */}
                  {typeof vocabularyProvenance.integrity?.fetched_at === 'string' && (
                    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                      <span className={metaLabelClass}>Abgerufen am</span>
                      <span className={metaValueClass}>
                        {formatDate(vocabularyProvenance.integrity.fetched_at)}
                      </span>
                    </div>
                  )}
                  {Array.isArray(vocabularyProvenance.files) && (
                    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                      <span className={metaLabelClass}>Namespace-Dateien</span>
                      <span className={metaValueClass}>
                        {vocabularyProvenance.files.length}
                      </span>
                    </div>
                  )}
                  {vocabularyProvenance.source?.snapshotCommitSha &&
                    vocabularyProvenance.source.snapshotCommitSha !== 'unknown' && (
                      <CopyableValue
                        label="Snapshot-Commit"
                        value={vocabularyProvenance.source.snapshotCommitSha}
                        displayValue={vocabularyProvenance.source.snapshotCommitSha.slice(0, 12)}
                      />
                    )}
                </div>
              </div>
            </div>
          )}
        </section>

        {catalog && metadata && (
          <section className={pageSectionClass}>
            <h2 className={sectionLabelClass}>Katalog-Metadaten</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-text-primary)]">
              Diese Angaben stammen aus dem offiziellen OSCAL-Katalog und ergänzen
              die Build- und Integritätsdaten um Geltungsbereich, Rollen,
              Verantwortlichkeiten und Referenzen.
            </p>

            <div className={`${surfacePanelClass} mt-4 divide-y divide-[var(--color-border-subtle)]`}>
              <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                <span className={metaLabelClass}>Katalogtitel</span>
                <span className={`${metaValueClass} text-right`}>{metadata.title}</span>
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                <span className={metaLabelClass}>Version</span>
                <span className={metaValueClass}>{metadata.version}</span>
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                <span className={metaLabelClass}>OSCAL-Version</span>
                <span className={metaValueClass}>{metadata.oscalVersion}</span>
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                <span className={metaLabelClass}>Zuletzt geändert</span>
                <span className={metaValueClass}>{formatDate(metadata.lastModified)}</span>
              </div>
              {metadata.publisherName && (
                <div className="flex items-center justify-between gap-4 px-4 py-2.5">
                  <span className={metaLabelClass}>Herausgeber</span>
                  <span className={`${metaValueClass} text-right`}>
                    {metadata.publisherEmail
                      ? `${metadata.publisherName} (${metadata.publisherEmail})`
                      : metadata.publisherName}
                  </span>
                </div>
              )}
            </div>

            {metadata.remarks && (
              <div className="mt-6 space-y-2">
                <h3 className={subsectionHeadingClass}>Bemerkungen</h3>
                <p className="whitespace-pre-line break-words text-sm text-[var(--color-text-primary)]">
                  {metadata.remarks}
                </p>
              </div>
            )}

            {metadata.roles.length > 0 && (
              <div className="mt-6 border-t border-[var(--color-border-subtle)] pt-4">
                <h3 className={subsectionHeadingClass}>Rollen</h3>
                <ul className="mt-3 space-y-2">
                  {metadata.roles.map((role) => (
                    <li
                      key={role.id}
                      className="flex items-center justify-between gap-4 text-sm text-[var(--color-text-primary)]"
                    >
                      <span>{role.title}</span>
                      <code className="font-mono text-xs text-[var(--color-text-secondary)]">
                        {role.id}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {metadata.responsibleParties.length > 0 && (
              <div className="mt-6 border-t border-[var(--color-border-subtle)] pt-4">
                <h3 className={subsectionHeadingClass}>Verantwortliche Parteien</h3>
                <ul className="mt-3 space-y-3">
                  {metadata.responsibleParties.map((entry: CatalogResponsibleParty) => {
                    const linkedParties = entry.partyUuids
                      .map((uuid) => getPartyByUuid(uuid, metadata.parties))
                      .filter((party): party is CatalogParty => Boolean(party));

                    return (
                      <li key={`${entry.roleId}-${entry.partyUuids.join(',')}`} className="space-y-1">
                        <p className="text-sm font-medium text-[var(--color-text-primary)]">
                          {getRoleTitle(entry.roleId, metadata.roles)}
                        </p>
                        <p className="text-sm text-[var(--color-text-primary)]">
                          {linkedParties.length > 0
                            ? linkedParties.map(formatPartyLabel).join(', ')
                            : entry.partyUuids.join(', ')}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {metadata.parties.length > 0 && (
              <div className="mt-6 border-t border-[var(--color-border-subtle)] pt-4">
                <h3 className={subsectionHeadingClass}>Parteien</h3>
                <ul className="mt-3 space-y-2">
                  {metadata.parties.map((party) => (
                    <li
                      key={party.uuid}
                      className="flex flex-col gap-0.5 text-sm text-[var(--color-text-primary)]"
                    >
                      <span>{formatPartyLabel(party)}</span>
                      <span className="type-meta">
                        Typ: {party.type} · UUID: <code className="font-mono">{party.uuid}</code>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {metadata.props.length > 0 && (
              <div className="mt-6 border-t border-[var(--color-border-subtle)] pt-4">
                <h3 className={subsectionHeadingClass}>Zusätzliche Metadaten</h3>
                <dl className="mt-3 space-y-3">
                  {metadata.props.map((prop) => (
                    <div key={`${prop.name}-${prop.value}`} className="space-y-1">
                      <dt className="text-sm font-medium text-[var(--color-text-primary)]">
                        {prop.name}
                      </dt>
                      <dd className="break-words text-sm text-[var(--color-text-primary)]">
                        {prop.value}
                      </dd>
                      {prop.ns && <dd className="type-meta break-all">Namespace: {prop.ns}</dd>}
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {metadataReferences.some((reference) => reference.kind !== 'provenance') && (
              <div className="mt-6 border-t border-[var(--color-border-subtle)] pt-4">
                <h3 className={`${subsectionHeadingClass} flex items-center gap-2`}>
                  <IconLink className="h-4 w-4 text-[var(--color-text-secondary)]" />
                  Referenzen
                </h3>
                <ul className="mt-3 space-y-3">
                  {metadataReferences.map((reference) => (
                    <MetadataReference key={reference.path} reference={reference} />
                  ))}
                </ul>
              </div>
            )}

            {resolvedResources.length > 0 && (
              <div className="mt-6 border-t border-[var(--color-border-subtle)] pt-4">
                <h3 className={`${subsectionHeadingClass} flex items-center gap-2`}>
                  <IconDocument className="h-4 w-4 text-[var(--color-text-secondary)]" />
                  Referenzierte Ressourcen
                </h3>
                <ul className="mt-3 space-y-4">
                  {resolvedResources.map((resource) => (
                    <li key={resource.uuid} className="space-y-2">
                      <div>
                        <p className="text-sm font-medium text-[var(--color-text-primary)]">
                          {resource.title ?? resource.uuid}
                        </p>
                        <p className="type-meta">
                          UUID: <code className="font-mono">{resource.uuid}</code>
                        </p>
                      </div>
                      {resource.description && (
                        <p className="text-sm text-[var(--color-text-primary)]">{resource.description}</p>
                      )}
                      {resource.citation && (
                        <p className="text-sm text-[var(--color-text-primary)]">{resource.citation}</p>
                      )}
                      {resource.content === 'empty' && (
                        <p className="type-secondary text-sm">Ressource enthält keine darstellbaren Inhalte.</p>
                      )}
                      {resource.embeddedContent && (
                        <p className="type-meta">
                          Eingebetteter Inhalt: {resource.embeddedContent.filename ?? 'ohne Dateiname'}
                          {resource.embeddedContent.mediaType
                            ? ` (${resource.embeddedContent.mediaType})`
                            : ''}
                        </p>
                      )}
                      <ResourceLinkList resource={resource} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <section className={pageSectionClass}>
          <h2 className={sectionLabelClass}>Technologie</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-primary)]">
            React 19, TypeScript, Vite, Tailwind CSS und FlexSearch. Deployment
            auf GitHub Pages.
          </p>
        </section>
      </div>
    </div>
  );
}
