import { Link } from 'react-router-dom';
import { useCatalog } from '@/hooks/useCatalog';
import { buildVocabularySourceUrl } from '@/domain/vocabulary';

const vocabularyTitles: Record<string, string> = {
  'action_words.csv': 'Handlungsworte',
  'documentation_guidelines.csv': 'Dokumentationsvorgaben',
  'effort_level.csv': 'Aufwandsstufen',
  'modal_verbs.csv': 'Modalverben',
  'result.csv': 'Ergebnisse',
  'security_level.csv': 'Sicherheitsniveaus',
  'tags.csv': 'Tags',
  'target_object_categories.csv': 'Zielobjekt-Kategorien',
};

function humanizeVocabularyFileName(fileName: string) {
  return fileName
    .replace(/\.csv$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function VocabularyOverviewPage() {
  const { vocabularyRegistry, loading, error } = useCatalog();

  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-3 py-4">
          <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border-default)] border-t-[var(--color-accent-default)]" />
          <span className="text-sm text-[var(--color-text-secondary)]">Vokabulare werden geladen…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <h1 className="type-page-title">Vokabulare</h1>
        <p className="mt-3 text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!vocabularyRegistry || vocabularyRegistry.namespaces.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <h1 className="type-page-title">Vokabulare</h1>
        <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
          Für den aktuell geladenen Katalog sind keine offiziellen
          Vokabular-Dateien verfügbar.
        </p>
      </div>
    );
  }

  const namespaces = [...vocabularyRegistry.namespaces].sort((left, right) =>
    left.source.fileName.localeCompare(right.source.fileName, 'de'),
  );

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div className="space-y-1">
        <h1 className="type-page-title">Vokabulare</h1>
        <p className="type-secondary">
          {namespaces.length} offizielle Vokabulare stehen für den aktuellen Katalog bereit.
        </p>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)] overflow-hidden">
        <div className="border-b border-[var(--color-border-default)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Verwendete Vokabulare</h2>
        </div>
        <div className="divide-y divide-[var(--color-border-subtle)]">
          {namespaces.map((namespace) => {
            const sourceHref = buildVocabularySourceUrl(
              namespace.source,
              vocabularyRegistry.sourceCommitSha,
            );

            return (
              <div
                key={namespace.source.namespace}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-surface-subtle)]"
              >
                <div className="flex min-w-0 flex-col justify-center">
                  <Link
                    to={`/vokabular/${namespace.source.routeId}`}
                    className="type-object-title block min-w-0 rounded hover:text-[var(--color-accent-default)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
                  >
                    {vocabularyTitles[namespace.source.fileName] ?? humanizeVocabularyFileName(namespace.source.fileName)}
                  </Link>
                  <a
                    href={sourceHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="catalog-link-color catalog-meta-type mt-0.5 block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
                    title="Upstream-Datei öffnen"
                  >
                    {namespace.source.fileName}
                  </a>
                </div>
                <div className="shrink-0 text-right leading-none">
                  <div className="text-sm font-semibold tabular-nums text-[var(--color-text-primary)]">
                    {namespace.entries.length}
                  </div>
                  <div className="catalog-meta-text mt-0.5">
                    {namespace.entries.length === 1 ? 'Eintrag' : 'Einträge'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
