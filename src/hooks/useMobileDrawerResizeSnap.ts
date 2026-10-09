import { useEffect } from 'react';
import type { RefObject } from 'react';

/** Träger der Bewegung, die `--mobile-nav-width` folgt (src/index.css). */
const DRAWER_MOTION_SELECTOR = '.mobile-nav-drawer, .mobile-nav-push';

/**
 * Beendet die laufenden Transitionen von Schublade, verschobener Seite und
 * Abdunklung auf ihrem Zielwert. jsdom kennt `getAnimations` nicht.
 */
export function finishDrawerMotion(shell: Element) {
  for (const animation of shell.getAnimations?.({ subtree: true }) ?? []) {
    if (!(animation instanceof CSSTransition)) continue;
    const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
    if (target?.matches(DRAWER_MOTION_SELECTOR)) animation.finish();
  }
}

/**
 * Ein Breitenwechsel unter `md`, etwa beim Drehen, ändert `--mobile-nav-width`.
 * Schublade, Seite und Abdunklung stellen sich dann gemeinsam sofort auf die
 * neue Lage, statt dorthin zu gleiten. Liefe die Bewegung, begänne eine Geste
 * oder ein Schließen in dieser Zeit von einer Lage, die noch wandert, und
 * Schublade und Seite liefen auseinander.
 *
 * Der Aufruf von `getAnimations` im `resize`-Handler berechnet die Stile neu;
 * die vom Breitenwechsel ausgelösten Transitionen bestehen dann schon und
 * enden vor dem nächsten Frame.
 */
export function useMobileDrawerResizeSnap(enabled: boolean, shellRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const shell = shellRef.current;
    if (!enabled || shell === null) return;
    const snap = () => finishDrawerMotion(shell);
    globalThis.addEventListener('resize', snap);
    return () => globalThis.removeEventListener('resize', snap);
  }, [enabled, shellRef]);
}
