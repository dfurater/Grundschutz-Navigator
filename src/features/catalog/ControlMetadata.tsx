import type { Control } from '@/domain/models';

export interface ControlMetadataProps {
  readonly parentId: Control['parentId'];
  readonly altIdentifier: Control['altIdentifier'];
  readonly controlClass?: Control['controlClass'];
  readonly hasResolvedParent: boolean;
}

export function ControlMetadata({
  parentId,
  altIdentifier,
  controlClass,
  hasResolvedParent,
}: ControlMetadataProps) {
  const showParentFallback = !hasResolvedParent && Boolean(parentId);

  if (!showParentFallback && !altIdentifier && !controlClass) {
    return null;
  }

  // Beschriftung (Sans, halbfett, sekundär) und Wert (Mono, gedämpft) in zwei
  // Spalten, damit Begriff und Wert klar getrennt lesbar sind (Owner 26.09.2026).
  // Ohne eigene Linie: Sie folgt im Blockabstand auf den letzten Block.
  const labelClass = 'font-medium text-[var(--color-text-secondary)]';
  const valueClass = 'break-all font-mono';

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
      {altIdentifier && (
        <>
          <dt className={labelClass}>UUID</dt>
          <dd className={valueClass}>{altIdentifier}</dd>
        </>
      )}
      {/* OSCAL `control.class`: technische Charakterisierung, deshalb neben der UUID. */}
      {controlClass && (
        <>
          <dt className={labelClass}>Klasse</dt>
          <dd className={valueClass}>{controlClass}</dd>
        </>
      )}
      {showParentFallback && (
        <>
          <dt className={labelClass}>Übergeordnet</dt>
          <dd className={valueClass}>{parentId}</dd>
        </>
      )}
    </dl>
  );
}
