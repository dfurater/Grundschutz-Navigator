import { Link } from 'react-router';
import { IconExternalLink, IconShieldCheck } from '@/components/icons';
import { useCatalog } from '@/hooks/useCatalog';
import { buildVocabularyIndexPath } from '@/features/vocabulary/routes';

export interface FooterProps {
  readonly className?: string;
}

const secondaryFooterLinks = [
  { to: '/about', label: 'About' },
  { to: buildVocabularyIndexPath(), label: 'Vokabulare' },
  { to: '/datenschutz', label: 'Datenschutz' },
  { to: '/lizenzen', label: 'Lizenzen' },
  { to: '/impressum', label: 'Impressum' },
] as const;

export function Footer({ className = '' }: FooterProps) {
  const { verification } = useCatalog();
  const verified = verification?.valid;

  const secondaryLinkClass =
    'whitespace-nowrap rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]';

  return (
    <footer
      className={`shrink-0 border-t border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-4 py-3 text-xs text-[var(--color-text-secondary)] sm:px-6 ${className}`}
      role="contentinfo"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--color-text-secondary)]">
        <div className="flex min-w-0 basis-full flex-wrap items-center gap-x-3 gap-y-1 lg:basis-auto lg:flex-1 lg:flex-nowrap">
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
            <span className="hidden min-w-0 truncate sm:inline">
              Quelle: BSI Stand-der-Technik-Bibliothek
            </span>
            <span className="min-w-0 truncate sm:hidden">Quelle: BSI-Bibliothek</span>
            <IconExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="sr-only"> (öffnet in neuem Tab)</span>
          </a>
          {verified !== undefined && (
            <Link
              to="/about"
              className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)] ${verified ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'}`}
              title="Integritätsdetails auf der Seite Über das Projekt"
            >
              <IconShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {verified ? 'Verifiziert' : 'Nicht verifiziert'}
            </Link>
          )}
        </div>
        <div className="basis-full min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-3 lg:ml-auto lg:basis-auto lg:flex-nowrap lg:justify-end">
          <span aria-hidden="true" className="hidden text-[var(--color-text-muted)] lg:inline">·</span>
          {secondaryFooterLinks.map(({ to, label }) => (
            <Link key={to} to={to} className={secondaryLinkClass}>
              {label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
