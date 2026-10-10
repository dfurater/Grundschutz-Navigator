import { Link } from 'react-router';
import { Button } from '@/components/Button';
import { PageTitle } from '@/app/PageTitle';

/*
 * Lade- und Fehlerflächen der Routen in `<main>` (GSPP-506).
 *
 * Beide ersetzen nur den Routeninhalt: Kopfzeile, Seitenleiste und Footer der
 * Shell bleiben bedienbar, auch wenn ein Chunk nicht ankommt oder eine Route
 * beim Rendern wirft. Der Router setzt sie ein (`appRoutes.tsx`): den
 * Ladezustand als `hydrateFallbackElement` einer Lazy-Route beim Direktaufruf,
 * die Fehlerfläche als `ErrorBoundary` um alle Seiten. Beide tragen den Titel
 * selbst, weil die Route, die ihn sonst setzt, noch nicht steht oder ausgefallen ist.
 */

// Wie `PageScroll`: Die Fläche füllt `<main>` bis zum Footer, sodass dieser im
// Lade- und Fehlerzustand nicht aus seiner Lage springt.
const SURFACE = 'flex-1 md:overflow-y-auto pb-safe lg:pb-0';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]';

/** Ladezustand, solange der Chunk einer Seite beim Direktaufruf unterwegs ist. */
export function RouteLoading({ title }: Readonly<{ title?: string }>) {
  return (
    <>
      {title !== undefined && (
        <>
          <PageTitle title={title} />
          {/* Die Seite hat auch im Ladezustand eine Hauptüberschrift. */}
          <h1 className="sr-only">{title}</h1>
        </>
      )}
      {/* S6819: <output> trägt die implizite Rolle "status". */}
      <output
        className={`${SURFACE} flex min-h-64 items-center justify-center gap-3 p-6 text-sm text-slate-600`}
      >
        <span
          className="inline-block w-5 h-5 border-2 border-slate-300 border-t-primary-main rounded-full animate-spin"
          aria-hidden="true"
        />
        <span>Seite wird geladen…</span>
      </output>
    </>
  );
}

/**
 * Fehlerfläche für fehlgeschlagene Chunks und Renderfehler einer Route. Die
 * Fehlerursache erscheint nie in der Oberfläche, und es gibt weder einen
 * automatischen Neuladeversuch noch einen Handler für `vite:preloadError`:
 * „Neu laden“ ist eine bewusste Handlung der Nutzerin oder des Nutzers. Der
 * Router setzt den Fehlerzustand bei der nächsten Navigation zurück.
 */
export function RouteLoadError({ title }: Readonly<{ title?: string }>) {
  return (
    <>
      {/* Ohne Routentitel trägt die Fehlerfläche den Produktnamen: Die Route, die ihn sonst setzt, ist ausgefallen. */}
      <PageTitle title={title} />
      <div role="alert" className={`${SURFACE} p-6`}>
        <h1 className="type-page-title">Seite konnte nicht geladen werden</h1>
        <p className="mt-3 text-sm text-slate-600">
          Die Seite konnte nicht vollständig geladen werden. Bitte laden Sie sie neu.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="button" onClick={() => globalThis.location.reload()}>
            Neu laden
          </Button>
          <Link to="/" className={`rounded catalog-prose-link ${FOCUS_RING}`}>
            Zur Startseite
          </Link>
        </div>
      </div>
    </>
  );
}
