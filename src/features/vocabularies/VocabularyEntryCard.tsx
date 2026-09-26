import { Link } from 'react-router';
import type { VocabularyEntry, VocabularyNamespace } from '@/domain/models';
import type { VocabularyResolution } from '@/domain/vocabulary';
import { resolveIdentifierReference } from '@/domain/vocabulary';
import { legendCardClass, legendLinkClass, legendTermClass } from '@/components/legendStyles';
import { getVocabularyTermLabel } from './vocabularyTitle';

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

  // Legendenschema (Owner 26.09.2026): „Merkmal: Wert“ über der Erklärung,
  // Zusatzangaben als „Merkmal: Wert“-Zeilen. Der Wert verlinkt den Eintrag
  // im Vokabular.
  return (
    <dl data-vocab-card className={`animate-vocab-card ${legendCardClass} mt-1.5`}>
      <div>
        <dt className={legendTermClass}>
          {`${getVocabularyTermLabel(namespace.source.fileName)}: `}
          <Link to={buildEntryHref(namespace, entry)} className={legendLinkClass}>
            {entry.value}
          </Link>
        </dt>
        {entry.definition && (
          <dd className="whitespace-pre-line">{entry.definition}</dd>
        )}
      </div>
      {extraColumns.map((column) => (
        <div key={column}>
          <dt className={`inline ${legendTermClass}`}>{`${column}: `}</dt>
          <dd className="inline whitespace-pre-line [overflow-wrap:anywhere]">{entry.columns[column]}</dd>
        </div>
      ))}
      {referenceRows.map(({ column, target }) => (
        <div key={column}>
          <dt className={`inline ${legendTermClass}`}>{`${referenceColumnLabel(column)}: `}</dt>
          <dd className="inline">
            <Link to={buildEntryHref(namespace, target)} className={legendLinkClass}>
              {target.value}
            </Link>
          </dd>
        </div>
      ))}
    </dl>
  );
}
