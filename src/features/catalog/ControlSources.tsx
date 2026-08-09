import { IconDocument, IconExternalLink } from '@/components/icons';
import type {
  ResolvedOscalReference,
  ResolvedResource,
  ResolvedResourceLink,
} from '@/domain/referenceResolution';
import { ControlDetailSection } from './ControlDetailSection';

export interface ControlSourcesProps {
  references: readonly ResolvedOscalReference[];
}

function ExternalLink({ href, label }: { href: string; label: string }) {
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

function ResourceLink({ link }: { link: ResolvedResourceLink }) {
  return (
    <li className="space-y-1">
      {link.target.kind === 'external' && link.target.href ? (
        <ExternalLink href={link.target.href} label={link.href} />
      ) : (
        <p className="break-all text-sm text-slate-700">{link.href}</p>
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

function ResourceDetails({ resource }: { resource: ResolvedResource }) {
  return (
    <div className="space-y-2">
      {resource.description && <p className="text-sm text-slate-700">{resource.description}</p>}
      {resource.citation && <p className="text-sm text-slate-700">{resource.citation}</p>}
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
        <ul className="space-y-2">
          {resource.rlinks.map((link) => (
            <ResourceLink key={`${resource.uuid}-${link.href}`} link={link} />
          ))}
        </ul>
      )}
    </div>
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

  return (
    <ControlDetailSection heading="Quellen und Verweise">
      <ul className="space-y-4">
        {sourceReferences.map((reference) => {
          if (reference.kind === 'resource') {
            return (
              <li key={reference.path} className="space-y-2">
                <div className="flex items-start gap-2">
                  <IconDocument className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium text-slate-800">{resourceLabel(reference)}</p>
                    <p className="type-meta">UUID: <code className="font-mono">{reference.resource.uuid}</code></p>
                    {reference.resourceFragment && (
                      <p className="type-meta">Fragment: {reference.resourceFragment}</p>
                    )}
                  </div>
                </div>
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
              <li key={reference.path} className="break-all text-sm text-slate-700">
                {reference.text?.trim() || reference.href}
              </li>
            );
          }

          return (
            <li key={reference.path} className="break-all text-sm text-slate-700">
              {reference.text?.trim() || reference.href}
            </li>
          );
        })}
      </ul>
    </ControlDetailSection>
  );
}
