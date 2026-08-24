import type { ReactNode } from 'react';
import type { Control } from '@/domain/models';

export interface ControlMetadataProps {
  readonly parentId: Control['parentId'];
  readonly altIdentifier: Control['altIdentifier'];
  readonly hasResolvedParent: boolean;
}

function SectionHeading({ children }: { readonly children: ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">
      {children}
    </h3>
  );
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
    <div className="space-y-1.5">
      <SectionHeading>Technische Metadaten</SectionHeading>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
        {showParentFallback && (
          <>
            <dt className="font-medium">Übergeordnet</dt>
            <dd>{parentId}</dd>
          </>
        )}
        {altIdentifier && (
          <>
            <dt className="font-medium">UUID</dt>
            <dd className="font-mono">{altIdentifier}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
