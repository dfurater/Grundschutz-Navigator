import { useState } from 'react';
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
 * Nach dem Hinausgleiten geht `top` auf 0 zurück, ohne Überblendung sofort,
 * damit die unsichtbare Schublade eine danach kürzere Seite nicht verlängert.
 * Ab `md` scrollt das Dokument nicht; kehrt die Breite bei offener Schublade
 * zurück, wird die Lage an der dann geltenden Dokumentposition neu erfasst.
 */
export function useMobileDrawerPlacement(
  open: boolean,
  persistent: boolean,
  reducedMotion: boolean,
): MobileDrawerPlacement {
  const [offset, setOffset] = useState(0);
  const [placedPersistent, setPlacedPersistent] = useState(persistent);
  if (placedPersistent !== persistent) {
    setPlacedPersistent(persistent);
    if (!persistent && open) setOffset(window.scrollY);
  }

  useScrollLock(open && !persistent);

  let top: number | undefined;
  if (!persistent) top = open || !reducedMotion ? offset : 0;

  return {
    captureOffset: () => setOffset(window.scrollY),
    top,
    onTransitionEnd: (event) => {
      if (event.target === event.currentTarget && !open) setOffset(0);
    },
  };
}
