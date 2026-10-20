import { documentValidity } from '@/domain/workspaceStations';
import type { DocumentState } from '@/domain/workspaceModel';

/** Festes Herkunftslabel lokaler Daten (ADR-11 §1); es ersetzt jede Integritätsanzeige. */
export const LOCAL_ORIGIN_LABEL = 'Eigene Daten · kein Integritätsnachweis';

export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]';

const MARK = 'inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium leading-4';

export function OriginLabel() {
  return (
    <span className={`${MARK} border-[var(--color-border-strong)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]`}>
      {LOCAL_ORIGIN_LABEL}
    </span>
  );
}

/** Statuswort aus der Schemastruktur; Text trägt die Aussage, die Farbe nur die Gruppe. */
export function ValidityBadge({ state }: Readonly<{ state: DocumentState }>) {
  const validity = documentValidity(state);
  const tone = validity === 'Entwurf'
    ? 'border-document-draft-border bg-document-draft-bg text-document-draft-text'
    : 'border-document-valid-border bg-document-valid-bg text-document-valid-text';
  return <span data-validity={validity} className={`${MARK} ${tone}`}>{validity}</span>;
}
