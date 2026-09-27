import { useCallback, type RefCallback } from 'react';
import { OverlayScrollbars, type PartialOptions } from 'overlayscrollbars';

/**
 * Überlagernde Scrollleisten (GSPP-303): unsichtbar im Ruhezustand, erst beim
 * Scrollen eingeblendet und danach wieder ausgeblendet — auch vor der ersten
 * Scroll-Bewegung (`autoHideSuspend: false`; `true` hielte sie bis dahin
 * sichtbar). `clickScroll: 'instant'` lässt einen Klick in die Spur scrollen,
 * ohne das ClickScroll-Plugin zu laden.
 */
export const OVERLAY_SCROLLBARS_OPTIONS = {
  scrollbars: {
    theme: 'os-theme-gspp',
    autoHide: 'scroll',
    autoHideSuspend: false,
    clickScroll: 'instant',
  },
} satisfies PartialOptions;

/**
 * Callback-Ref, die ein bestehendes Scroll-Element selbst zum Viewport macht.
 * Ref, Scroll-Events und Datenattribute bleiben so am selben Element — die
 * Zeilenfensterung der Tabelle (`useRowWindow`) misst weiter dort, und der
 * Tooltip findet `[data-control-detail-scroll]` unverändert. Die Aufräum-
 * funktion (React 19) zerstört die Instanz, sobald das Element wechselt oder
 * entfernt wird; ein neues Element erhält damit immer eine eigene Instanz.
 *
 * `enabled: false` lässt das Element unberührt. Das braucht es für Bereiche,
 * die erst ab einer Breite selbst scrollen (`md:overflow-y-auto`): Darunter
 * scrollt das Dokument mit den nativen, auf Mobilgeräten ohnehin
 * überlagernden Leisten, und eine Instanz würde das Element zum eigenen
 * Scrollbereich machen. Wechselt `enabled`, tauscht React die Callback-Ref
 * und ruft die Aufräumfunktion der alten auf.
 */
export function useOverlayScrollbars<T extends HTMLElement>(enabled = true): RefCallback<T> {
  return useCallback((element: T | null) => {
    if (!element || !enabled) return undefined;
    const instance = OverlayScrollbars(
      { target: element, elements: { viewport: element } },
      OVERLAY_SCROLLBARS_OPTIONS,
    );
    return () => {
      instance.destroy();
    };
  }, [enabled]);
}

/** Ab dieser Breite scrollen Seiteninhalt und mobile Trefferlisten selbst (Tailwind `md`). */
export const OWN_SCROLL_AREA_QUERY = '(min-width: 768px)';
