import { useEffect, useState, type ReactNode } from 'react';
import { useNavigation } from 'react-router';
import { NavigationPendingStatus } from '@/components/NavigationPendingStatus';
import { NavigationPendingContext } from '@/state/NavigationPendingContext';

/*
 * Wartezustand der Client-Navigation (GSPP-506).
 *
 * Nebenrouten laden über das Routenfeld `lazy` (`appRoutes.tsx`). Der Router
 * holt den Chunk, bevor er die Navigation festschreibt, und meldet so lange
 * `useNavigation().state === 'loading'`. Das gilt für jede Navigation, gleich ob
 * per Link, Tastenkürzel, Programm oder Zurück-Taste.
 */

/**
 * Ab dieser Wartezeit erscheint der Hinweis. Eine vorgeladene oder kleine Seite
 * wechselt schneller (gemessen ≈ 20–230 ms unter Fast-3G) und blinkt so nicht auf.
 */
export const NAVIGATION_PENDING_DELAY_MS = 300;

/**
 * `true`, solange eine Navigation länger als `NAVIGATION_PENDING_DELAY_MS`
 * wartet; `false`, sobald der Router wieder `idle` meldet: mit der neuen Seite,
 * mit der Fehlerfläche oder weil eine weitere Navigation die wartende abgelöst hat.
 */
export function useNavigationPendingNotice(): boolean {
  const pending = useNavigation().state !== 'idle';
  const [delayElapsed, setDelayElapsed] = useState(false);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setDelayElapsed(true), NAVIGATION_PENDING_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setDelayElapsed(false);
    };
  }, [pending]);

  return pending && delayElapsed;
}

/**
 * Stellt `useNavigationPendingNotice()` über `NavigationPendingContext` bereit,
 * für den Hinweis der Shell und die Statusbereiche modaler Dialoge
 * (`DialogNavigationStatus`). Der Kontext reicht durch Portale.
 */
export function NavigationPendingProvider({ children }: { readonly children: ReactNode }) {
  const pending = useNavigationPendingNotice();
  return <NavigationPendingContext.Provider value={pending}>{children}</NavigationPendingContext.Provider>;
}

/**
 * Hinweis „Seite wird geladen…“ der Shell. Er schwebt unter der Kopfzeile und
 * fängt keine Zeiger ab: Die vorige Seite bleibt bedienbar. Der Statusbereich
 * steht dauerhaft im DOM, damit Screenreader das Erscheinen des Textes ansagen.
 * Bei offenem modalem Dialog ist `#root` und damit dieser Hinweis inert; dann
 * meldet `DialogNavigationStatus` im Dialog denselben Zustand.
 */
export function NavigationPendingIndicator() {
  return <NavigationPendingStatus className="fixed left-1/2 top-17 z-50" />;
}
