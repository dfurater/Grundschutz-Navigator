import { Link } from 'react-router-dom';
import type { VocabularyResolution } from '@/domain/vocabulary';

export interface VocabularyEntryCardProps {
  resolution: VocabularyResolution;
}

export function VocabularyEntryCard({ resolution }: VocabularyEntryCardProps) {
  const { namespace, entry } = resolution;
  const extraColumns = namespace.columnOrder.filter((column) => {
    if (column === namespace.valueColumn || column === namespace.definitionColumn) {
      return false;
    }

    return Boolean(entry.columns[column]);
  });

  return (
    <div className="animate-vocab-card border-t border-slate-100 pt-2.5 space-y-2 text-sm leading-relaxed text-slate-700">
      {entry.definition && (
        <p className="whitespace-pre-line max-w-prose">
          {entry.definition}
        </p>
      )}

      {extraColumns.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {extraColumns.map((column) => (
            <div key={column} className="contents">
              <dt className="catalog-meta-text pt-0.5">{column}</dt>
              <dd className="whitespace-pre-line">{entry.columns[column]}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>{namespace.source.fileName}</span>
        <Link
          to={`/vokabular/${namespace.source.routeId}?wert=${encodeURIComponent(entry.value)}`}
          className="ml-auto rounded text-primary-main hover:text-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
        >
          Zu den Vokabularen →
        </Link>
      </div>
    </div>
  );
}
