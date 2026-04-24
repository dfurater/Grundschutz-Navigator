import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { VocabularyEntry, VocabularyNamespace } from '@/domain/models';
import { useCatalog } from '@/hooks/useCatalog';

function InlineVocabularyEntryDetails({
  namespace,
  entry,
}: {
  namespace: VocabularyNamespace;
  entry: VocabularyEntry;
}) {
  const extraColumns = namespace.columnOrder.filter((column) => {
    if (column === namespace.valueColumn || column === namespace.definitionColumn) {
      return false;
    }

    return Boolean(entry.columns[column]);
  });

  return (
    <div className="border-t border-[var(--color-border-default)] bg-[var(--color-surface-subtle)] px-4 py-4 sm:px-5">
      <div className="max-w-3xl space-y-3">
        {entry.definition && (
          <div className="space-y-1">
            <div className="catalog-meta-text">
              {namespace.definitionColumn ?? 'Definition'}
            </div>
            <p className="text-sm leading-relaxed text-[var(--color-text-primary)] whitespace-pre-line">
              {entry.definition}
            </p>
          </div>
        )}

        {extraColumns.length > 0 && (
          <dl className="grid gap-3 sm:grid-cols-2">
            {extraColumns.map((column) => (
              <div key={column}>
                <dt className="catalog-meta-text">
                  {column}
                </dt>
                <dd className="mt-1 text-sm text-[var(--color-text-primary)] whitespace-pre-line">
                  {entry.columns[column]}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="pt-1">
          <span className="catalog-meta-text">
            Quelle: {namespace.source.path}
          </span>
        </div>
      </div>
    </div>
  );
}

export function VocabularyNamespacePage() {
  const { namespaceId } = useParams<{ namespaceId: string }>();
  const [searchParams] = useSearchParams();
  const { vocabularyRegistry, loading, error } = useCatalog();

  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-3 py-4">
          <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border-default)] border-t-[var(--color-accent-default)]" />
          <span className="text-sm text-[var(--color-text-secondary)]">Vokabular wird geladen…</span>
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

  const namespace = namespaceId
    ? vocabularyRegistry?.namespacesByRouteId.get(namespaceId)
    : undefined;

  if (!namespace) {
    return (
      <div className="p-4 sm:p-6 space-y-3">
        <h1 className="type-page-title">Vokabulare</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Dieses Vokabular ist im aktuellen Katalog nicht verfügbar.
        </p>
        <Link
          to="/vokabular"
          className="catalog-link-color rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
        >
          Zur Übersicht der Vokabulare
        </Link>
      </div>
    );
  }

  const selectedValue = searchParams.get('wert');
  const selectedEntry = selectedValue
    ? namespace.entriesByValue.get(selectedValue)
    : null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div className="space-y-1">
        <Link
          to="/vokabular"
          className="catalog-meta-text inline-block rounded hover:text-[var(--color-text-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
        >
          Zur Übersicht der Vokabulare
        </Link>
        <h1 className="type-page-title">{namespace.source.fileName}</h1>
        <p className="type-secondary">{namespace.source.path}</p>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
        <div className="border-b border-[var(--color-border-default)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
            Offizielle Werte
          </h2>
          {!selectedEntry && (
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              Wählen Sie einen offiziellen Wert aus der Liste aus, um die Definition direkt unter
              dem Eintrag anzuzeigen.
            </p>
          )}
        </div>
        <div className="divide-y divide-[var(--color-border-subtle)]">
          {namespace.entries.map((entry) => {
            const isActive = entry.value === selectedValue;

            return (
              <div key={entry.value}>
                <Link
                  to={`/vokabular/${namespace.source.routeId}?wert=${encodeURIComponent(entry.value)}`}
                  className={`block border-l-2 px-4 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)] ${
                    isActive
                      ? 'border-[var(--color-accent-default)] bg-[var(--color-accent-soft)] font-medium text-[var(--color-text-primary)]'
                      : 'border-transparent text-[var(--color-text-secondary)] hover:border-[var(--color-border-default)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  {entry.value}
                </Link>
                {isActive && (
                  <InlineVocabularyEntryDetails namespace={namespace} entry={entry} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
