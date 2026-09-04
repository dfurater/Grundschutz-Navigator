import { Link } from 'react-router';
import type { VocabularyEntry, VocabularyNamespace } from '@/domain/models';
import type { VocabularyResolution } from '@/domain/vocabulary';
import { resolveIdentifierReference } from '@/domain/vocabulary';

export interface VocabularyEntryCardProps {
  readonly resolution: VocabularyResolution;
  readonly hiddenColumns?: string[];
}

/**
 * Verweisspalten tragen die Kennung eines anderen Eintrags. Die Kennung selbst
 * sagt Lesenden nichts, deshalb steht dort der aufgelöste Begriff — und mit ihm
 * eine Beschriftung, die die Beziehung benennt statt der Spaltentechnik. Ohne
 * Eintrag in dieser Zuordnung bleibt der Spaltenname stehen.
 */
const REFERENCE_COLUMN_LABELS: Record<string, string> = {
  childofuuid: 'Übergeordneter Eintrag',
};

function referenceColumnLabel(column: string): string {
  return REFERENCE_COLUMN_LABELS[column.toLowerCase()] ?? column;
}

function buildEntryHref(namespace: VocabularyNamespace, entry: VocabularyEntry) {
  return `/vokabular/${namespace.source.routeId}?wert=${encodeURIComponent(entry.value)}`;
}

export function VocabularyEntryCard({
  resolution,
  hiddenColumns = [],
}: VocabularyEntryCardProps) {
  const { namespace, entry } = resolution;
  const hiddenColumnSet = new Set(hiddenColumns);
  const referenceColumnSet = new Set(namespace.identifierReferenceColumns ?? []);

  const isVisible = (column: string) =>
    column !== namespace.valueColumn &&
    column !== namespace.definitionColumn &&
    !hiddenColumnSet.has(column) &&
    Boolean(entry.columns[column]);

  const extraColumns = namespace.columnOrder.filter(
    (column) => isVisible(column) && !referenceColumnSet.has(column),
  );

  // Ein Verweis ohne auflösbares Ziel wird nicht gezeigt: Die nackte Kennung
  // wäre für Lesende wertlos und stünde als zweite Zeichenkette neben der
  // eigenen Kennung des Eintrags.
  const referenceRows = namespace.columnOrder
    .filter((column) => isVisible(column) && referenceColumnSet.has(column))
    .flatMap((column) => {
      const target = resolveIdentifierReference(namespace, entry.columns[column]);

      return target ? [{ column, target }] : [];
    });

  const hasMetadataRows = extraColumns.length > 0 || referenceRows.length > 0;

  return (
    <div className="animate-vocab-card border-t border-slate-100 pt-2.5 space-y-2 text-sm leading-relaxed text-slate-700">
      {entry.definition && (
        <p className="whitespace-pre-line">
          {entry.definition}
        </p>
      )}

      {hasMetadataRows && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {extraColumns.map((column) => (
            <div key={column} className="contents">
              <dt className="catalog-meta-text pt-0.5">{column}</dt>
              <dd className="whitespace-pre-line">{entry.columns[column]}</dd>
            </div>
          ))}
          {referenceRows.map(({ column, target }) => (
            <div key={column} className="contents">
              <dt className="catalog-meta-text pt-0.5">{referenceColumnLabel(column)}</dt>
              <dd>
                <Link
                  to={buildEntryHref(namespace, target)}
                  className="rounded text-primary-main hover:text-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
                >
                  {target.value}
                </Link>
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>{namespace.source.fileName}</span>
        <Link
          to={buildEntryHref(namespace, entry)}
          className="ml-auto rounded text-primary-main hover:text-primary-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
        >
          Zu den Vokabularen →
        </Link>
      </div>
    </div>
  );
}
