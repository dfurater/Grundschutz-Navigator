import { useLayoutEffect, useState } from 'react';
import type { TransitionEvent } from 'react';
import { useScrollLock } from '@/hooks/useScrollLock';

export interface MobileDrawerPlacement {
  /** Merkt die aktuelle Dokumentposition; beim Öffnen der Schublade aufrufen. */
  readonly captureOffset: () => void;
  /** `top` der Schublade; ohne Wert auf der persistenten Navigation. */
  readonly top: number | undefined;
  readonly onTransitionEnd: (event: TransitionEvent<HTMLElement>) => void;
}

/**
 * Lage der mobilen Navigationsschublade (GSPP-486). Die Schublade ist weder
 * fest noch sticky, weil ein solches Element bis zum unteren Bildschirmrand
 * Safari seine Leiste mit einer undurchsichtigen Fläche füllen lässt. Sie liegt
 * absolut im Inhaltsbereich an der Dokumentposition beim Öffnen, also direkt
 * unter dem App-Kopf, und die Scroll-Sperre hält sie dort.
 *
 * Nach dem Hinausgleiten geht `top` auf 0 zurück, damit die unsichtbare
 * Schublade eine danach kürzere Seite nicht verlängert. Ohne Überblendung
 * endet keine Transition: Dann geschieht das beim Schließen oder, falls die
 * Einstellung während des Hinausgleitens wechselt, in diesem Moment.
 * Ab `md` scrollt das Dokument nicht, und der Browser setzt seine Position zu
 * einem nicht vorhersagbaren Zeitpunkt auf 0. Kehrt die Breite bei offener
 * Schublade unter `md` zurück, beginnen Schublade und Dokument deshalb oben,
 * dem einzigen Wert, den diese Rücksetzung nicht mehr verändert.
 */
export function useMobileDrawerPlacement(
  open: boolean,
  persistent: boolean,
  reducedMotion: boolean,
): MobileDrawerPlacement {
  const [offset, setOffset] = useState(0);
  const [placedFor, setPlacedFor] = useState({ open, persistent, reducedMotion });
  if (
    placedFor.open !== open
    || placedFor.persistent !== persistent
    || placedFor.reducedMotion !== reducedMotion
  ) {
    setPlacedFor({ open, persistent, reducedMotion });
    if (!open && reducedMotion) setOffset(0);
    if (open && placedFor.persistent && !persistent) setOffset(0);
  }

  useScrollLock(open && !persistent);

  // Hält das Dokument an der Lage der offenen Schublade. Beim Öffnen ist das
  // die gerade erfasste Position; wirksam wird es nach einem Breitenwechsel.
  useLayoutEffect(() => {
    if (open && !persistent) window.scrollTo({ top: offset, behavior: 'instant' });
  }, [open, persistent, offset]);

  return {
    captureOffset: () => setOffset(window.scrollY),
    top: persistent ? undefined : offset,
    onTransitionEnd: (event) => {
      if (event.target === event.currentTarget && !open) setOffset(0);
    },
  };
}
