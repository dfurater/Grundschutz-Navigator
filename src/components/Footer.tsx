import { Link } from 'react-router-dom';
import { IconExternalLink, IconShieldCheck } from '@/components/icons';
import { useCatalog } from '@/hooks/useCatalog';
import { buildVocabularyIndexPath } from '@/features/vocabulary/routes';

export interface FooterProps {
  className?: string;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('de-DE', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function Footer({ className = '' }: FooterProps) {
  const { provenance, verification } = useCatalog();
  const commitDate = provenance?.source.commit_date;
  const catalogVersion =
    commitDate && commitDate !== 'unknown' ? commitDate : undefined;
  const verified = verification?.valid;

  const secondaryLinkClass =
    'hidden lg:inline whitespace-nowrap rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]';

  return (
    <footer
      className={`shrink-0 border-t border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-6 py-3 text-xs text-[var(--color-text-secondary)] ${className}`}
      role="contentinfo"
    >
      <div className="flex flex-row items-center justify-between gap-3 lg:gap-6">
        <div className="flex min-w-0 items-center gap-3 overflow-hidden">
          <span className="hidden shrink-0 whitespace-nowrap font-medium tracking-[0.02em] text-[var(--color-text-primary)] xl:inline">
            Grundschutz++ Navigator
          </span>
          <span aria-hidden="true" className="hidden text-[var(--color-text-muted)] xl:inline">/</span>
          <a
            href="https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek"
            target="_blank"
            rel="noopener noreferrer"
            className="catalog-link-color inline-flex min-w-0 items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
          >
            <span className="hidden sm:inline truncate">Quelle: BSI Stand-der-Technik-Bibliothek</span>
            <span className="sm:hidden">Quelle: BSI-Bibliothek</span>
            <IconExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="sr-only"> (öffnet in neuem Tab)</span>
          </a>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-x-3 text-[var(--color-text-secondary)]">
          {catalogVersion && (
            <span className="whitespace-nowrap">{formatDate(catalogVersion)}</span>
          )}
          {verified !== undefined && (
            <Link
              to="/about"
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)] ${verified ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}
              title="Integritätsdetails auf der Seite Über das Projekt"
            >
              <IconShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {verified ? 'Verifiziert' : 'Nicht verifiziert'}
            </Link>
          )}
          <span aria-hidden="true" className="hidden text-[var(--color-text-muted)] lg:inline">·</span>
          <Link to="/about" className={secondaryLinkClass}>
            Über das Projekt
          </Link>
          <Link to="/datenschutz" className={secondaryLinkClass}>
            Datenschutz
          </Link>
          <Link to="/impressum" className={secondaryLinkClass}>
            Impressum
          </Link>
          <Link to="/lizenzen" className={secondaryLinkClass}>
            Lizenzen
          </Link>
          <Link to={buildVocabularyIndexPath()} className={secondaryLinkClass}>
            Vokabulare
          </Link>
        </div>
      </div>
    </footer>
  );
}
