import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { useScrollLock } from '@/hooks/useScrollLock';

export interface MobileDrawerPlacement {
  /** Merkt die aktuelle Dokumentposition; beim Öffnen der Schublade aufrufen. */
  readonly captureOffset: () => void;
  /** `top` der Schublade; ohne Wert auf der persistenten Navigation. */
  readonly top: number | undefined;
}

function isTranslateTransition(animation: Animation) {
  return 'transitionProperty' in animation && animation.transitionProperty === 'translate';
}

// Läuft an der Schublade noch eine Translate-Transition, etwa die umgekehrte
// nach einem Schließen während des Hereingleitens, ist das Hinausgleiten nicht
// vorbei. Ohne `getAnimations` (jsdom) zählt nur das Ereignis selbst.
function isTranslating(drawer: Element) {
  return drawer.getAnimations?.().some(isTranslateTransition) ?? false;
}

function subscribeToScroll(onScroll: () => void) {
  window.addEventListener('scroll', onScroll, { passive: true });
  return () => window.removeEventListener('scroll', onScroll);
}

function subscribeToNothing() {
  return () => {};
}

/**
 * Lage der mobilen Navigationsschublade (GSPP-486). Die Schublade ist weder
 * fest noch sticky, weil ein solches Element bis zum unteren Bildschirmrand
 * Safari seine Leiste mit einer undurchsichtigen Fläche füllen lässt. Sie liegt
 * absolut im Inhaltsbereich an der Dokumentposition beim Öffnen, also direkt
 * unter dem App-Kopf, und die Scroll-Sperre hält sie dort.
 *
 * Beim Hinausgleiten ist das Dokument frei. Damit die Schublade dabei unter
 * dem App-Kopf bleibt, folgt `top` bis zum Ende der `translate`-Transition der
 * Dokumentposition (GSPP-490). `useSyncExternalStore` prüft sie nach jedem
 * Commit erneut, erfasst also auch das `scrollTo` einer neuen Seite aus deren
 * Layout-Effekt, und danach jedes Scroll-Ereignis. Das Hinausgleiten endet
 * mit `transitionend` oder `transitioncancel` der `translate`-Transition der
 * Schublade, sofern danach keine weitere läuft. Hat der Browser im nächsten
 * Frame keine solche Transition, etwa weil die Schublade vor dem ersten Frame
 * wieder geschlossen wurde, endet es dort.
 * Danach geht `top` auf 0 zurück, damit die unsichtbare Schublade eine danach
 * kürzere Seite nicht verlängert. Ohne Überblendung oder ab `md` endet keine
 * Transition: Dann geschieht das beim Schließen oder, falls Einstellung oder
 * Breite während des Hinausgleitens wechseln, in diesem Moment.
 * Ab `md` scrollt das Dokument nicht, und der Browser setzt seine Position zu
 * einem nicht vorhersagbaren Zeitpunkt auf 0. Kehrt die Breite bei offener
 * Schublade unter `md` zurück, beginnen Schublade und Dokument deshalb oben,
 * dem einzigen Wert, den diese Rücksetzung nicht mehr verändert.
 */
export function useMobileDrawerPlacement(
  open: boolean,
  persistent: boolean,
  transitionDisabled: boolean,
  /** Die Schublade selbst; zeigt, ob ihr Hinausgleiten tatsächlich läuft. */
  drawerRef: RefObject<HTMLElement | null>,
): MobileDrawerPlacement {
  const [offset, setOffset] = useState(0);
  const [sliding, setSliding] = useState(false);
  const [placedFor, setPlacedFor] = useState({ open, persistent, transitionDisabled });
  if (
    placedFor.open !== open
    || placedFor.persistent !== persistent
    || placedFor.transitionDisabled !== transitionDisabled
  ) {
    setPlacedFor({ open, persistent, transitionDisabled });
    setSliding(!open && !persistent && !transitionDisabled && (placedFor.open || sliding));
    if (!open && (persistent || transitionDisabled)) setOffset(0);
    if (open && placedFor.persistent && !persistent) setOffset(0);
  }

  useScrollLock(open && !persistent);

  // Hält das Dokument an der Lage der offenen Schublade. Beim Öffnen ist das
  // die gerade erfasste Position; wirksam wird es nach einem Breitenwechsel.
  useLayoutEffect(() => {
    if (open && !persistent) window.scrollTo({ top: offset, behavior: 'instant' });
  }, [open, persistent, offset]);

  const documentY = useSyncExternalStore(
    sliding ? subscribeToScroll : subscribeToNothing,
    () => window.scrollY,
    () => 0,
  );
  const placedTop = sliding ? documentY : offset;

  const finishSliding = () => {
    setSliding(false);
    setOffset(0);
  };
  useEffect(() => {
    const drawer = drawerRef.current;
    if (!sliding || drawer === null) return;
    const settle = (event: TransitionEvent) => {
      if (event.target === drawer && event.propertyName === 'translate' && !isTranslating(drawer)) {
        finishSliding();
      }
    };
    // Im nächsten Frame hat der Browser die Transition des Schließens
    // angelegt; fehlt sie, endet das Hinausgleiten hier.
    const frame = requestAnimationFrame(() => {
      if (drawer.getAnimations !== undefined && !isTranslating(drawer)) finishSliding();
    });
    drawer.addEventListener('transitionend', settle);
    drawer.addEventListener('transitioncancel', settle);
    return () => {
      cancelAnimationFrame(frame);
      drawer.removeEventListener('transitionend', settle);
      drawer.removeEventListener('transitioncancel', settle);
    };
  }, [sliding, drawerRef]);

  return {
    captureOffset: () => setOffset(window.scrollY),
    top: persistent ? undefined : placedTop,
  };
}
