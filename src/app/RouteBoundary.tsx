import { Component, Suspense } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/Button';
import { PageTitle } from '@/app/PageTitle';

/*
 * Lade- und Fehlergrenze für nachgeladene Seiten-Chunks (GSPP-506).
 *
 * Beide Flächen ersetzen nur den Routeninhalt innerhalb von `<main>`: Kopfzeile,
 * Seitenleiste und Footer der Shell bleiben bedienbar, auch wenn ein Chunk
 * nicht ankommt oder eine Route beim Rendern wirft. Da die Grenze alle Routen
 * umschließt, liefert sie im Fallback den Titel selbst (`fallbackTitle`): Die
 * Routen-Titel stehen innerhalb der Grenze und fehlen, solange sie suspendiert.
 */

// Wie `PageScroll` in `AppShell.tsx`: Die Fläche füllt `<main>` bis zum Footer,
// sodass dieser im Lade- und Fehlerzustand nicht aus seiner Lage springt.
const SURFACE = 'flex-1 md:overflow-y-auto pb-safe lg:pb-0';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]';

/** Ladezustand, solange der Chunk einer Seite unterwegs ist. */
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

function RouteLoadError({ title }: Readonly<{ title?: string }>) {
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

interface RouteErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallbackTitle?: string;
  /** Ändert sich der Wert (z. B. der Pfad), weicht ein Fehlerzustand beim nächsten Render. */
  readonly resetKey?: string;
}

/**
 * Fängt Fehler der Seite samt ihres Chunk-Ladens. Die Fehlerursache erscheint
 * nie in der Oberfläche, und es gibt weder einen automatischen Neuladeversuch
 * noch einen Handler für `vite:preloadError`: „Neu laden“ ist eine bewusste
 * Handlung der Nutzerin oder des Nutzers.
 */
export class RouteErrorBoundary extends Component<
  Readonly<RouteErrorBoundaryProps>,
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  // Erst ein bereits festgeschriebener Fehlerzustand weicht einem neuen
  // `resetKey`. Ein Fehler, der im selben Render wie der Wechsel auftritt, hat
  // noch keinen festgeschriebenen Zustand (`prevState.failed` ist falsch) und
  // bleibt stehen. Ein Zurücksetzen über `getDerivedStateFromProps` würde ihn
  // dagegen sofort wieder verwerfen und die Seite erneut werfen lassen.
  override componentDidUpdate(prevProps: Readonly<RouteErrorBoundaryProps>, prevState: Readonly<{ failed: boolean }>) {
    if (this.state.failed && prevState.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override render() {
    return this.state.failed
      ? <RouteLoadError title={this.props.fallbackTitle} />
      : this.props.children;
  }
}

/**
 * Grenze für nachgeladene Seiten: Fehlergrenze › Suspense › Inhalt.
 *
 * Sie sitzt einmal um alle Routen in `<main>` und wird nicht je Pfad neu
 * gemountet. Eine neu gemountete Suspense-Grenze zeigt ihren Fallback, und
 * React hält einen gezeigten Fallback mindestens 300 ms, auch wenn der Chunk
 * längst da ist. Bleibt die Grenze stehen, behält eine Router-Transition die
 * vorige Seite, bis der Chunk eingetroffen ist; der Fallback erscheint dann
 * nur noch, wenn noch gar keine Seite steht (Direktaufruf).
 *
 * `resetKey` (der Pfad) setzt nur den Fehlerzustand zurück: Die Fehlerfläche
 * weicht bei der nächsten Navigation, ohne dass die Suspense-Grenze neu
 * montiert werden muss.
 */
export function LazyRoute({
  children,
  fallbackTitle,
  resetKey,
}: Readonly<{ children: ReactNode; fallbackTitle?: string; resetKey?: string }>) {
  return (
    <RouteErrorBoundary fallbackTitle={fallbackTitle} resetKey={resetKey}>
      <Suspense fallback={<RouteLoading title={fallbackTitle} />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
}
