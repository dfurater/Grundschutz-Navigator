import { useState } from 'react';
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
  CatalogMetadataLink,
  CatalogParty,
  CatalogProvenance,
  CatalogResource,
  CatalogRole,
  CatalogResponsibleParty,
} from '@/domain/models';
import { useCatalog } from '@/hooks/useCatalog';

const DEFAULT_UPSTREAM_REPOSITORY_PATH = 'BSI-Bund/Stand-der-Technik-Bibliothek';
const DEFAULT_CATALOG_PATH = 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json';

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

function buildUpstreamCatalogUrl(provenance: CatalogProvenance | null): string {
  const repositoryPath = resolveUpstreamRepositoryPath(provenance?.source.repository);
  const ref = resolveUpstreamRef(provenance);
  const catalogPath = provenance?.source.file || DEFAULT_CATALOG_PATH;

  return `https://raw.githubusercontent.com/${repositoryPath}/${ref}/${catalogPath}`;
}

function buildAppCatalogUrl(baseUrl = import.meta.env.BASE_URL): string {
  return new URL('data/catalog.json', new URL(baseUrl, window.location.origin)).toString();
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

function isNavigableHref(href: string): boolean {
  return /^(https?:|mailto:)/.test(href);
}

function resolveMetadataLinkHref(
  link: CatalogMetadataLink,
  backMatter: CatalogResource[],
): string | undefined {
  if (!link.href.startsWith('#')) {
    return link.href;
  }

  const resource = backMatter.find((entry) => `#${entry.uuid}` === link.href);
  return resource?.rlinks[0]?.href;
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

function CopyableValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2.5">
      <span className="type-meta shrink-0 pt-0.5">{label}</span>
      <button
        type="button"
        onClick={handleCopy}
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
              {value}
            </span>
            <IconClipboard className="h-3 w-3 shrink-0 text-[var(--color-text-muted)] transition-colors group-hover:text-[var(--color-text-secondary)]" />
          </>
        )}
      </button>
    </div>
  );
}

function CopyButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
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

export function AboutPage() {
  const { provenance, verification, catalog } = useCatalog();
  const metadata = catalog?.metadata;
  const backMatter = catalog?.backMatter ?? [];
  const appCatalogUrl = buildAppCatalogUrl();
  const upstreamCatalogUrl = buildUpstreamCatalogUrl(provenance);
  const verifyCommand = buildVerifyCommand(appCatalogUrl, upstreamCatalogUrl);
  const verificationTone = verification?.valid
    ? verificationSuccessTone
    : verification
      ? verificationFailureTone
      : null;

  return (
    <div className="mx-auto max-w-3xl px-6 pt-8 pb-12">
      <header className="flex items-start gap-3.5 pb-8">
        <IconInfo className="mt-0.5 h-8 w-8 shrink-0 text-[var(--color-accent-default)]" />
        <div className="min-w-0">
          <h1 className="type-page-title">Über das Projekt</h1>
          <p className="type-secondary mt-0.5">
            Der Grundschutz++ Navigator erschließt den offiziellen BSI-Katalog im Browser.
            Die Anwendung ist ein inoffizielles Werkzeug und kein Angebot des BSI.
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
                <code className="break-all font-mono text-xs leading-relaxed text-[var(--color-text-primary)]">
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
                      value={provenance.source.commit_sha.slice(0, 12)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
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

            {metadata.links.length > 0 && (
              <div className="mt-6 border-t border-[var(--color-border-subtle)] pt-4">
                <h3 className={`${subsectionHeadingClass} flex items-center gap-2`}>
                  <IconLink className="h-4 w-4 text-[var(--color-text-secondary)]" />
                  Referenzen
                </h3>
                <ul className="mt-3 space-y-3">
                  {metadata.links.map((link) => {
                    const resolvedHref = resolveMetadataLinkHref(link, backMatter);
                    const targetHref = resolvedHref && isNavigableHref(resolvedHref)
                      ? resolvedHref
                      : isNavigableHref(link.href)
                        ? link.href
                        : undefined;
                    const linkLabel = link.text?.trim() || resolvedHref || link.href;

                    return (
                      <li key={`${link.href}-${link.rel ?? 'none'}`} className="space-y-1">
                        {targetHref ? (
                          <a
                            href={targetHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="catalog-link-color inline-flex items-center gap-1 text-sm"
                          >
                            {linkLabel}
                            <span className="sr-only"> (öffnet in neuem Tab)</span>
                            <IconExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        ) : (
                          <p className="break-all text-sm text-[var(--color-text-primary)]">
                            {linkLabel}
                          </p>
                        )}
                        <p className="type-meta break-all">
                          Relation: {link.rel ?? 'nicht gesetzt'} · Quelle: {link.href}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {backMatter.length > 0 && (
              <div className="mt-6 border-t border-[var(--color-border-subtle)] pt-4">
                <h3 className={`${subsectionHeadingClass} flex items-center gap-2`}>
                  <IconDocument className="h-4 w-4 text-[var(--color-text-secondary)]" />
                  Referenzierte Ressourcen
                </h3>
                <ul className="mt-3 space-y-4">
                  {backMatter.map((resource) => (
                    <li key={resource.uuid} className="space-y-2">
                      <div>
                        <p className="text-sm font-medium text-[var(--color-text-primary)]">
                          {resource.title ?? resource.uuid}
                        </p>
                        <p className="type-meta">
                          UUID: <code className="font-mono">{resource.uuid}</code>
                        </p>
                      </div>

                      {resource.rlinks.length > 0 ? (
                        <ul className="space-y-2">
                          {resource.rlinks.map((rlink) => (
                            <li key={`${resource.uuid}-${rlink.href}`} className="space-y-1">
                              {isNavigableHref(rlink.href) ? (
                                <a
                                  href={rlink.href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="catalog-link-color inline-flex items-center gap-1 break-all text-sm"
                                >
                                  {rlink.href}
                                  <span className="sr-only"> (öffnet in neuem Tab)</span>
                                  <IconExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                                </a>
                              ) : (
                                <p className="break-all text-sm text-[var(--color-text-primary)]">
                                  {rlink.href}
                                </p>
                              )}

                              {rlink.hashes.length > 0 && (
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
                      ) : (
                        <p className="type-secondary text-sm">Keine verknüpften Links vorhanden.</p>
                      )}
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
