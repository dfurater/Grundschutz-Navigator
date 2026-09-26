import type { Control } from '@/domain/models';

export interface ControlMetadataProps {
  readonly parentId: Control['parentId'];
  readonly altIdentifier: Control['altIdentifier'];
  readonly hasResolvedParent: boolean;
}

export function ControlMetadata({
  parentId,
  altIdentifier,
  hasResolvedParent,
}: ControlMetadataProps) {
  const showParentFallback = !hasResolvedParent && Boolean(parentId);

  if (!showParentFallback && !altIdentifier) {
    return null;
  }

  return (
    <p className="text-xs text-[var(--color-text-muted)]">
      {altIdentifier && (
        <span className="block">
          UUID: <code className="font-mono">{altIdentifier}</code>
        </span>
      )}
      {showParentFallback && (
        <span className="block">Übergeordnet: {parentId}</span>
      )}
    </p>
  );
}
