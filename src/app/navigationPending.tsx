import { useEffect, useState } from 'react';
import { useNavigation } from 'react-router';

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
 * Hinweis „Seite wird geladen…“, solange eine Navigation länger als
 * `NAVIGATION_PENDING_DELAY_MS` wartet. Er schwebt unter der Kopfzeile und
 * fängt keine Zeiger ab: Die vorige Seite bleibt bedienbar. Der Statusbereich
 * steht dauerhaft im DOM, damit Screenreader das Erscheinen des Textes ansagen,
 * und gehört in keinen Bereich, der `inert` werden kann. Er verschwindet, sobald
 * der Router wieder `idle` meldet: mit der neuen Seite, mit der Fehlerfläche
 * oder weil eine weitere Navigation die wartende abgelöst hat.
 */
export function NavigationPendingIndicator() {
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
