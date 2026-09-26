import { IconExternalLink } from '@/components/icons';
import type {
  ResolvedOscalReference,
  ResolvedResource,
  ResolvedResourceLink,
} from '@/domain/referenceResolution';
import { isSafeExternalHref } from '@/domain/referenceResolution';
import { detailListMarkerClass } from './ControlVocabularyPrimitives';

export interface ControlSourcesProps {
  readonly references: readonly ResolvedOscalReference[];
}

function ExternalLink({
  href,
  label,
}: {
  readonly href: string;
  readonly label: string;
}) {
  if (!isSafeExternalHref(href)) {
    return <span className="break-all">{label}</span>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="catalog-link-color inline-flex items-center gap-1 break-all rounded text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
    >
      {label}
      <span className="sr-only"> (externer Link, öffnet in neuem Tab)</span>
      <IconExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

function ResourceLink({ link }: { readonly link: ResolvedResourceLink }) {
  return (
    <li className="space-y-1">
      {link.target.kind === 'external' && link.target.href ? (
        <ExternalLink href={link.target.href} label={link.href} />
      ) : (
        <p className="break-all">{link.href}</p>
      )}
      {link.mediaType && <p className="type-meta">Medientyp: {link.mediaType}</p>}
      {link.integrity === 'missing' ? (
        <p className="type-meta">Ohne Integritätsnachweis</p>
      ) : (
        <ul className="space-y-1">
          {link.hashes.map((hash) => (
            <li key={`${hash.algorithm}-${hash.value}`} className="type-meta break-all">
              {hash.algorithm}: <code className="font-mono">{hash.value}</code>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function ResourceDetails({
  resource,
}: {
  readonly resource: ResolvedResource;
}) {
  return (
    <>
      {resource.description && <p>{resource.description}</p>}
      {resource.citation && <p>{resource.citation}</p>}
      {resource.content === 'empty' && (
        <p className="type-secondary text-sm">Ressource enthält keine darstellbaren Inhalte.</p>
      )}
      {resource.embeddedContent && (
        <p className="type-meta">
          Eingebetteter Inhalt: {resource.embeddedContent.filename ?? 'ohne Dateiname'}
          {resource.embeddedContent.mediaType ? ` (${resource.embeddedContent.mediaType})` : ''}
        </p>
      )}
      {resource.rlinks.length > 0 && (
        <ul className="space-y-1">
          {resource.rlinks.map((link) => (
            <ResourceLink key={`${resource.uuid}-${link.href}`} link={link} />
          ))}
        </ul>
      )}
    </>
  );
}

function resourceLabel(reference: Extract<ResolvedOscalReference, { kind: 'resource' }>) {
  return reference.text?.trim() || reference.resource.title || reference.resource.uuid;
}

export function ControlSources({ references }: ControlSourcesProps) {
  const sourceReferences = references.filter(
    (reference) => reference.kind !== 'control' && reference.kind !== 'provenance',
  );
  if (sourceReferences.length === 0) return null;

  // GSPP-303 T9: hüllenlos (Teil des Blocks „Zusammenhänge“; die Gruppen-
  // Beschriftung „Quellen" setzt ControlDetail darüber). Liste mit Punkten wie
  // Erweiterungen und Verknüpft; alle Zeilen einer Quelle bündig mit 4 px,
  // zwischen zwei Quellen 12 px (Owner 26.09.2026).
  return (
    <ul className={`${detailListMarkerClass} space-y-3`}>
        {sourceReferences.map((reference) => {
          if (reference.kind === 'resource') {
            return (
              <li key={reference.path} className="space-y-1">
                <p className="font-medium text-slate-800">{resourceLabel(reference)}</p>
                <p className="type-meta">UUID: <code className="font-mono">{reference.resource.uuid}</code></p>
                {reference.resourceFragment && (
                  <p className="type-meta">Fragment: {reference.resourceFragment}</p>
                )}
                <ResourceDetails resource={reference.resource} />
              </li>
            );
          }

          if (reference.kind === 'external') {
            return (
              <li key={reference.path}>
                <ExternalLink href={reference.href} label={reference.text?.trim() || reference.href} />
              </li>
            );
          }

          if (reference.kind === 'cross-document') {
            return (
              <li key={reference.path} className="break-all">
                {reference.text?.trim() || reference.href}
              </li>
            );
          }

          return (
            <li key={reference.path} className="break-all">
              {reference.text?.trim() || reference.href}
            </li>
          );
        })}
    </ul>
  );
}
