import { createContext, useContext, useEffect, useLayoutEffect, useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import { Router } from 'react-router';
import type { UNSAFE_createBrowserHistory } from 'react-router';

/*
 * Wartezustand der Client-Navigation (GSPP-506).
 *
 * Der deklarative Router führt jede Navigation als React-Transition aus: Lädt
 * der Chunk der Zielseite noch, bleibt die vorige Seite stehen, und die
 * Suspense-Grenze zeigt keinen Fallback. `BrowserRouter` gibt den Wartezustand
 * dieser Transition nicht heraus. `TransitionRouter` übernimmt deshalb dessen
 * Verdrahtung (Verlauf abonnieren, Ort in einer Transition setzen) mit
 * `useTransition` und stellt `isPending` bereit. Das erfasst jede Navigation,
 * gleich ob per Link, Tastenkürzel, Programm oder Zurück-Taste.
 */

/** Der Verlauf, den der Router liest und beschreibt (Browser- oder Speicherverlauf). */
export type RouterHistory = Pick<
  ReturnType<typeof UNSAFE_createBrowserHistory>,
  'action' | 'location' | 'listen' | 'createHref' | 'createURL' | 'encodeLocation' | 'push' | 'replace' | 'go'
>;

/** `undefined` außerhalb von `TransitionRouter`: Dann gibt es keinen Hinweis. */
const NavigationPendingContext = createContext<boolean | undefined>(undefined);

/** Router wie `BrowserRouter`, der zusätzlich den Wartezustand der Navigation bereitstellt. */
export function TransitionRouter({
  history,
  basename,
  children,
}: Readonly<{ history: RouterHistory; basename?: string; children: ReactNode }>) {
  const [state, setState] = useState(() => ({ action: history.action, location: history.location }));
  const [pending, startTransition] = useTransition();

  useLayoutEffect(
    () => history.listen(({ action, location }) => startTransition(() => setState({ action, location }))),
    [history],
  );

  return (
    <NavigationPendingContext.Provider value={pending}>
      <Router basename={basename} location={state.location} navigationType={state.action} navigator={history}>
        {children}
      </Router>
    </NavigationPendingContext.Provider>
  );
}

/**
 * Ab dieser Wartezeit erscheint der Hinweis. Eine vorgeladene oder kleine Seite
 * wechselt schneller (gemessen ≈ 20–230 ms unter Fast-3G) und blinkt so nicht auf.
 */
export const NAVIGATION_PENDING_DELAY_MS = 300;

/**
 * Hinweis „Seite wird geladen…“, solange eine Navigation länger als
 * `NAVIGATION_PENDING_DELAY_MS` wartet. Er schwebt unter der Kopfzeile und
 * fängt keine Zeiger ab: Die vorige Seite bleibt bedienbar. Der Statusbereich
 * steht dauerhaft im DOM, damit Screenreader das Erscheinen des Textes ansagen,
 * und gehört in keinen Bereich, der `inert` werden kann.
 * Er verschwindet, sobald die Transition endet: mit der neuen Seite, mit der
 * Fehlerfläche oder weil eine weitere Navigation die wartende abgelöst hat.
 */
export function NavigationPendingIndicator() {
  const pending = useContext(NavigationPendingContext);
  const [delayElapsed, setDelayElapsed] = useState(false);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setDelayElapsed(true), NAVIGATION_PENDING_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setDelayElapsed(false);
    };
  }, [pending]);

  if (pending === undefined) return null;
  return (
    <output className="pointer-events-none fixed left-1/2 top-[4.25rem] z-50 -translate-x-1/2">
      {pending && delayElapsed && (
        <span className="flex items-center gap-2 rounded-full border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] shadow-[var(--shadow-overlay)]">
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-border-default)] border-t-[var(--color-primary-main)] motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span>Seite wird geladen…</span>
        </span>
      )}
    </output>
  );
}
