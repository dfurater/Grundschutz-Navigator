import { Link } from 'react-router-dom';
import { IconShield } from '@/components/icons';
import { useCatalog } from '@/hooks/useCatalog';

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

export function HomePage() {
  const { catalog, loading, provenance, verification } = useCatalog();
  const commitDate = provenance?.source.commit_date;
  const catalogVersion =
    commitDate && commitDate !== 'unknown' ? commitDate : undefined;
  const verified = verification?.valid;
  const catalogStats = catalog
    ? {
        practices: catalog.practices.length,
        topics: catalog.practices.reduce(
          (total, practice) => total + practice.topics.length,
          0,
        ),
        controls: catalog.practices.reduce(
          (total, practice) => total + practice.controlCount,
          0,
        ),
      }
    : null;

  return (
    <div className="max-w-3xl mx-auto px-6 pt-8 pb-12">
      {/* Header */}
      <header className="flex items-start gap-3.5 pb-8">
        <IconShield className="w-9 h-9 shrink-0 text-[var(--color-accent-default)]" />
        <div className="min-w-0">
          <h1 className="type-page-title text-[var(--color-text-primary)]">
            Grundschutz++ Navigator
          </h1>
          <p className="type-secondary mt-0.5 text-[var(--color-text-secondary)]">
            Werkzeug zum Durchsuchen, Filtern und Exportieren des offiziellen
            Grundschutz++-Anwenderkatalogs des BSI. Kein Angebot des BSI.
          </p>
          {catalogStats && (
            <p className="type-meta mt-3 text-[var(--color-text-secondary)] tabular-nums">
              {catalogStats.practices} Praktiken &middot;{' '}
              {catalogStats.topics} Themen &middot; {catalogStats.controls}{' '}
              Kontrollen
            </p>
          )}
          <p className="type-meta mt-2 text-[var(--color-text-secondary)]">
            {catalogVersion && (
              <>
                Katalog-Stand: {formatDate(catalogVersion)}
                <span aria-hidden="true"> &middot; </span>
              </>
            )}
            {verified !== undefined && (
              <>
                <span
                  className={
                    verified
                      ? 'text-[var(--color-success)]'
                      : 'text-[var(--color-warning)]'
                  }
                >
                  {verified ? 'verifiziert' : 'nicht verifiziert'}
                </span>
                <span aria-hidden="true"> &middot; </span>
              </>
            )}
            Quelle: BSI Stand-der-Technik-Bibliothek
          </p>
        </div>
      </header>

      {catalog && (
        <section
          aria-labelledby="grundschutz-summary-heading"
          className="mt-6 border-t border-[var(--color-border-subtle)] pt-4"
        >
          <h2
            id="grundschutz-summary-heading"
            className="type-meta text-[var(--color-text-secondary)]"
          >
            Was ist Grundschutz++?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-primary)]">
            Grundschutz++ ist ein fortentwickelter Anwenderkatalog des BSI im
            Kontext des IT-Grundschutzes. Er liegt maschinenlesbar im
            OSCAL-Format vor und verbindet methodische mit konkreten
            technisch-organisatorischen Anforderungen. Mehr dazu unter{' '}
            <Link to="/about" className="catalog-link-color">
              Über das Projekt
            </Link>
            .
          </p>
        </section>
      )}

      {/* Practice register */}
      {loading && (
        <div className="py-8 text-center">
          <div
            className="inline-block w-5 h-5 animate-spin rounded-full border-2 border-[var(--color-border-default)] border-t-[var(--color-accent-default)]"
            role="status"
            aria-label="Katalog wird geladen"
          />
        </div>
      )}

      {catalog && (
        <section aria-label="Praktiken-Register">
          {/* Column header — same grid as data rows */}
          <div className="grid grid-cols-[3.5rem_1fr] sm:grid-cols-[3.5rem_1fr_4.5rem_4rem] items-baseline gap-x-3 px-4 pb-2">
            <span className="type-secondary text-[var(--color-text-muted)]">
              Abk.
            </span>
            <span className="type-secondary text-[var(--color-text-muted)]">
              Praktik
            </span>
            <span className="type-secondary text-right text-[var(--color-text-muted)] hidden sm:block">
              Themen
            </span>
            <span className="type-secondary text-right text-[var(--color-text-muted)] hidden sm:block">
              Kontrollen
            </span>
          </div>

          <div className="border border-[var(--color-border-default)] rounded-[var(--radius-md)] bg-[var(--color-surface-base)] divide-y divide-[var(--color-border-subtle)]">
            {catalog.practices.map((practice) => (
              <Link
                key={practice.id}
                to={`/katalog/${practice.id}`}
                className="grid grid-cols-[3.5rem_1fr] sm:grid-cols-[3.5rem_1fr_4.5rem_4rem] items-baseline gap-x-3 px-4 py-2.5 hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)] transition-colors"
              >
                <span className="catalog-reference-text text-xs text-[var(--color-accent-default)]">
                  {practice.label}
                </span>
                <span className="type-object-title min-w-0 truncate">
                  {practice.title}
                </span>
                <span className="type-meta text-right text-[var(--color-text-muted)] tabular-nums hidden sm:block">
                  {practice.topics.length}
                </span>
                <span className="type-meta text-right text-[var(--color-text-muted)] tabular-nums hidden sm:block">
                  {practice.controlCount}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

    </div>
  );
}
