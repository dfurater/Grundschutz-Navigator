import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

interface CloseDrawerOnNavigationOptions {
  /** `location.key` der aktuellen Route. */
  readonly locationKey: string;
  readonly open: boolean;
  /** Schließt die Schublade ohne eigene Fokusführung. */
  readonly close: () => void;
  /** Auf der persistenten Navigation gibt es keine Fokusrückgabe. */
  readonly persistent: boolean;
  readonly drawerId: string;
  readonly menuButtonRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Jede Navigation schließt die mobile Schublade, auch eine aus dem App-Kopf
 * (Marke, Lupe, Suchfeld) oder über Browser-Zurück. Sonst bliebe die neue
 * Seite im `inert` gesetzten Hauptbereich unbedienbar. Lag der Fokus noch in
 * der Schublade (etwa bei Browser-Zurück), geht er wie bei jedem anderen
 * Schließen an das Menü-Symbol; sonst bleibt er am auslösenden Element. Die
 * Prüfung läuft vor dem Commit, solange die Schublade noch nicht `inert` ist.
 * Hat die neue Seite den Fokus schon selbst gesetzt (Layout-Effekte der Kinder
 * laufen zuerst, etwa die Überschrift einer mobilen Detailseite), bleibt er dort.
 * Der Auftrag ist ein Zähler, kein `location.key`: Browser-Zurück und -Vorwärts
 * verwenden den Schlüssel eines Verlaufseintrags wieder, und derselbe Wert
 * löste den Effekt kein zweites Mal aus.
 */
export function useCloseDrawerOnNavigation({
  locationKey,
  open,
  close,
  persistent,
  drawerId,
  menuButtonRef,
}: CloseDrawerOnNavigationOptions) {
  const [drawerLocationKey, setDrawerLocationKey] = useState(locationKey);
  const [focusReturnCount, setFocusReturnCount] = useState(0);
  if (drawerLocationKey !== locationKey) {
    setDrawerLocationKey(locationKey);
    if (open) {
      close();
      if (!persistent && document.getElementById(drawerId)?.contains(document.activeElement)) {
        setFocusReturnCount((count) => count + 1);
      }
    }
  }
  useLayoutEffect(() => {
    if (focusReturnCount === 0) return;
    if (document.activeElement?.closest('main, header')) return;
    menuButtonRef.current?.focus({ preventScroll: true });
  }, [focusReturnCount, menuButtonRef]);
}
