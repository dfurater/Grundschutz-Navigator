import { Button } from '@/components/Button';
import type { CatalogPin, CatalogPinState } from '@/domain/workspaceCatalogPin';

const TEXT: Readonly<Record<Exclude<CatalogPinState, 'bound'>, { readonly title: string; readonly text: string }>> = {
  pending: {
    title: 'Katalogstand wird geprüft',
    text: 'Der gebundene BSI-Katalog ist in dieser Sitzung noch nicht geladen und geprüft. Bis dahin sind Änderungen gesperrt.',
  },
  unpinned: {
    title: 'Kein Katalogstand gebunden',
    text: 'Dieses Dokument nennt nicht, gegen welchen Stand des BSI-Katalogs es erstellt wurde. Lesen und Export bleiben möglich; Änderungen sind gesperrt, bis Sie es an den ausgelieferten Stand binden.',
  },
  'not-delivered': {
    title: 'Gebundener Katalogstand nicht mehr ausgeliefert',
    text: 'Die Anwendung liefert einen neueren Stand des BSI-Katalogs aus. Das Dokument bleibt an seinen bisherigen Stand gebunden: Lesen und Export bleiben möglich, Änderungen sind gesperrt. Eine Migration auf den neuen Stand ist ein eigener, bestätigter Schritt.',
  },
  unverified: {
    title: 'Katalogstand nicht verifiziert',
    text: 'Der ausgelieferte BSI-Katalog hat die Integritätsprüfung nicht bestanden. Bewertung und Änderungen sind gesperrt; Lesen und Export bleiben möglich.',
  },
  invalid: {
    title: 'Katalogreferenz ungültig',
    text: 'Die Katalogreferenz in den Metadaten dieses Dokuments ist unvollständig oder unbekannt. Lesen und Export bleiben möglich, Änderungen sind gesperrt.',
  },
};

/** Schreibschutz eines an einen BSI-Katalogstand gebundenen Dokuments; ohne Wert, Schlüssel oder Commit im Text. */
export function CatalogPinNotice({ pin, busy, onBind }: Readonly<{ pin: CatalogPin | undefined; busy: boolean; onBind: () => void }>) {
  if (!pin || pin.state === 'bound') return null;
  const { title, text } = TEXT[pin.state];
  return (
    <div
      role={pin.state === 'pending' ? 'status' : 'alert'}
      data-catalog-pin={pin.state}
      className="flex flex-col gap-2 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] p-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-secondary)]">{text}</p>
        {pin.code && <p className="mt-1 font-mono text-xs text-[var(--color-text-secondary)]">{pin.code}</p>}
      </div>
      {pin.state === 'unpinned' && (
        <Button variant="secondary" className="min-h-touch shrink-0 desktop:min-h-0" disabled={busy} onClick={onBind}>
          An ausgelieferten Stand binden
        </Button>
      )}
    </div>
  );
}
