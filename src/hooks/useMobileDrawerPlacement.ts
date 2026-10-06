import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { TransitionEvent } from 'react';
import { useScrollLock } from '@/hooks/useScrollLock';

export interface MobileDrawerPlacement {
  /** Merkt die aktuelle Dokumentposition; beim Öffnen der Schublade aufrufen. */
  readonly captureOffset: () => void;
  /** `top` der Schublade; ohne Wert auf der persistenten Navigation. */
  readonly top: number | undefined;
  readonly onTransitionEnd: (event: TransitionEvent<HTMLElement>) => void;
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
 * Layout-Effekt, und danach jedes Scroll-Ereignis.
 * Danach geht `top` auf 0 zurück, damit die unsichtbare Schublade eine danach
 * kürzere Seite nicht verlängert. Ohne Überblendung endet keine Transition:
 * Dann geschieht das beim Schließen oder, falls die Einstellung während des
 * Hinausgleitens wechselt, in diesem Moment.
 * Ab `md` scrollt das Dokument nicht, und der Browser setzt seine Position zu
 * einem nicht vorhersagbaren Zeitpunkt auf 0. Kehrt die Breite bei offener
 * Schublade unter `md` zurück, beginnen Schublade und Dokument deshalb oben,
 * dem einzigen Wert, den diese Rücksetzung nicht mehr verändert.
 */
export function useMobileDrawerPlacement(
  open: boolean,
  persistent: boolean,
  transitionDisabled: boolean,
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
    if (!open && transitionDisabled) setOffset(0);
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

  return {
    captureOffset: () => setOffset(window.scrollY),
    top: persistent ? undefined : placedTop,
    onTransitionEnd: (event) => {
      if (
        event.target === event.currentTarget
        && event.propertyName === 'translate'
        && !open
      ) {
        setSliding(false);
        setOffset(0);
      }
    },
  };
}
