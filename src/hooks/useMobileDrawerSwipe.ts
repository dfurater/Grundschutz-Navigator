import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { flushSync } from 'react-dom';
import { DIRECTION_SLOP_PX, releaseGesture, startsOpenGesture } from './mobileDrawerGesture';
import type { Sample } from './mobileDrawerGesture';

interface Gesture {
  /** `open`: Wischen nach rechts auf der Seite; `close`: nach links auf Schublade oder Abdunklung. */
  readonly mode: 'open' | 'close';
  readonly startX: number;
  readonly startY: number;
  readonly width: number;
  /** Sichtbare Lage beim Übernehmen der Geste, relativ zur offenen Endlage. */
  base: number;
  dragging: boolean;
  /** Lage der Schublade relativ zur offenen Endlage, zwischen `-width` und 0. */
  offset: number;
  samples: Sample[];
}

interface MobileDrawerSwipeOptions {
  /** Die Schublade ist mobil (nicht die persistente Seitenleiste ab `md`). */
  readonly enabled: boolean;
  /** Die mobile Schublade ist offen. */
  readonly open: boolean;
  /** `location.key` der aktuellen Route: Jede Navigation beendet eine laufende Geste. */
  readonly routeKey: string;
  /** Träger von `data-mobile-nav` und den `--mobile-nav-*`-Variablen. */
  readonly shellRef: RefObject<HTMLElement | null>;
  readonly drawerRef: RefObject<HTMLElement | null>;
  readonly backdropRef: RefObject<HTMLElement | null>;
  /** Läuft im selben Commit wie der Beginn einer Öffnen-Geste. */
  readonly onPreview: () => void;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}

/**
 * Wischgesten der mobilen Navigationsschublade (GSPP-493). Nach
 * rechts über die Seite gewischt, zieht der Finger die Schublade herein; nach
 * links über Schublade oder Abdunklung schiebt er sie wieder hinaus. In beiden
 * Richtungen folgen Schublade und verschobene Seite dem Finger, die
 * Abdunklung blendet anteilig. Beim Loslassen entscheidet ein Wurf die
 * Richtung, sonst die halbe Strecke; die Freigabe übernimmt die
 * Geschwindigkeit des Fingers, statt mit der Standarddauer neu anzusetzen.
 *
 * Während des Ziehens schreibt die Geste nur Variablen am Shell-Element; React
 * rendert nur an Beginn und Ende. Senkrechte Gesten bleiben dem Scrollen.
 *
 * @returns ob eine Öffnen-Geste die Schublade gerade zeigt. Die Shell
 *   behandelt sie dann für Lage, Scroll-Sperre und `data-mobile-nav` als offen.
 */
export function useMobileDrawerSwipe({
  enabled,
  open,
  routeKey,
  shellRef,
  drawerRef,
  backdropRef,
  onPreview,
  onOpen,
  onClose,
}: MobileDrawerSwipeOptions): boolean {
  const [previewing, setPreviewing] = useState(false);
  const releasing = useRef(false);
  const dragging = useRef(false);
  const preview = useEffectEvent(onPreview);
  const openDrawer = useEffectEvent(onOpen);
  const closeDrawer = useEffectEvent(onClose);

  // Ein Öffnen nimmt wieder Dauer und Kurve des Tokens, auch wenn die letzte
  // Freigabe ohne Transition endete und ihre Werte noch stehen. Das Öffnen
  // einer Geste behält die eben gesetzten Werte ihrer Freigabe.
  useLayoutEffect(() => {
    if (open && !releasing.current) shellRef.current?.style.removeProperty('--mobile-nav-motion');
  }, [open, shellRef]);

  // Dauer und Kurve einer Freigabe gelten bis zum Ende einer Bewegung. Der
  // Listener überdauert das Schließen, denn das Hinausgleiten läuft danach
  // noch. Ein `transitioncancel` setzt sie nicht zurück: Das einer Bewegung,
  // die ein neues Ziehen unterbricht, kommt erst danach an, bei einem kurzen
  // Wurf sogar nach dessen Freigabe, und gehört zu keiner der beiden.
  useEffect(() => {
    const shell = shellRef.current;
    const drawer = drawerRef.current;
    if (shell === null || drawer === null) return;
    const settle = (event: TransitionEvent) => {
      if (dragging.current) return;
      if (event.target === drawer && event.propertyName === 'translate') {
        shell.style.removeProperty('--mobile-nav-motion');
      }
    };
    drawer.addEventListener('transitionend', settle);
    return () => drawer.removeEventListener('transitionend', settle);
  }, [shellRef, drawerRef]);

  useEffect(() => {
    const shell = shellRef.current;
    const drawer = drawerRef.current;
    if (!enabled || shell === null || drawer === null) return;
    const surfaces = open
      ? [drawer, backdropRef.current].filter((surface) => surface !== null)
      : [shell];
    let gesture: Gesture | null = null;
    // Das Touch-Ziel erhält alle Ereignisse seiner Berührung, auch wenn es
    // inzwischen ausgehängt ist, etwa ein Sheet-Auslöser, den die Vorschau
    // abbaut. Dann erreichen sie die Flächen nicht mehr; deshalb hört die
    // Geste zusätzlich am Ziel und verarbeitet jedes Ereignis nur einmal.
    let tracked: EventTarget | null = null;
    let lastEvent: Event | null = null;
    const firstDelivery = (event: Event) => {
      if (event === lastEvent) return false;
      lastEvent = event;
      return true;
    };

    const setDrag = (offset: number, width: number) => {
      shell.style.setProperty('--mobile-nav-drag', `${offset}px`);
      shell.style.setProperty('--mobile-nav-progress', String(1 + offset / width));
    };

    const clearDrag = () => {
      shell.style.removeProperty('--mobile-nav-drag');
      shell.style.removeProperty('--mobile-nav-progress');
    };

    const release = (commit: () => void) => {
      releasing.current = true;
      try {
        flushSync(commit);
      } finally {
        releasing.current = false;
      }
    };

    // Bricht die Geste ab, gleitet die Schublade mit der Standarddauer dorthin
    // zurück, wo sie vor der Geste lag.
    const abandon = (abandoned: Gesture) => {
      dragging.current = false;
      shell.style.removeProperty('--mobile-nav-motion');
      clearDrag();
      if (abandoned.mode === 'open') release(() => setPreviewing(false));
    };

    const onTouchStart = (event: TouchEvent) => {
      if (gesture?.dragging) abandon(gesture);
      gesture = null;
      untrack();
      if (event.touches.length !== 1) return;
      if (!open && !startsOpenGesture(event.target, shell)) return;
      const width = drawer.getBoundingClientRect().width;
      if (width <= 0) return;
      const touch = event.touches[0];
      gesture = {
        mode: open ? 'close' : 'open',
        startX: touch.clientX,
        startY: touch.clientY,
        width,
        base: 0,
        dragging: false,
        offset: 0,
        samples: [{ x: touch.clientX, time: event.timeStamp }],
      };
      track(event.target);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (gesture === null || !firstDelivery(event)) return;
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;
      if (!gesture.dragging) {
        if (Math.abs(dx) < DIRECTION_SLOP_PX && Math.abs(dy) < DIRECTION_SLOP_PX) return;
        // Eine geschlossene Schublade öffnet nur ein Wischen nach rechts.
        if (Math.abs(dy) >= Math.abs(dx) || (gesture.mode === 'open' && dx < 0)) {
          gesture = null;
          return;
        }
        // Gemessen wird erst hier, wo die Geste die Schublade übernimmt: Seit
        // dem Aufsetzen des Fingers kann sie noch weitergeglitten sein.
        gesture.base = Math.min(0, Math.max(-gesture.width, drawer.getBoundingClientRect().left));
        gesture.dragging = true;
        dragging.current = true;
        shell.style.setProperty('--mobile-nav-motion', '0s');
        if (gesture.mode === 'open') {
          setDrag(gesture.base, gesture.width);
          flushSync(() => {
            preview();
            setPreviewing(true);
          });
        }
      }
      // Erst eine waagerechte Geste hält den Browser vom Scrollen ab.
      event.preventDefault();
      gesture.offset = Math.min(0, Math.max(-gesture.width, gesture.base + dx));
      gesture.samples.push({ x: touch.clientX, time: event.timeStamp });
      if (gesture.samples.length > 8) gesture.samples.shift();
      setDrag(gesture.offset, gesture.width);
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!firstDelivery(event)) return;
      const released = gesture;
      gesture = null;
      untrack();
      if (!released?.dragging) return;
      dragging.current = false;
      const { mode, offset, width } = released;
      const { opens, motion } = releaseGesture(released.samples, event.timeStamp, offset, width);
      if (motion === null) shell.style.removeProperty('--mobile-nav-motion');
      else shell.style.setProperty('--mobile-nav-motion', motion);
      clearDrag();
      // Zielwert und Freigabe fallen in denselben Frame.
      if (mode === 'close' && !opens) release(closeDrawer);
      if (mode === 'open') {
        release(() => {
          setPreviewing(false);
          if (opens) openDrawer();
        });
      }
    };

    const onTouchCancel = (event: TouchEvent) => {
      if (!firstDelivery(event)) return;
      if (gesture?.dragging) abandon(gesture);
      gesture = null;
      untrack();
    };

    function track(target: EventTarget | null) {
      if (target === null) return;
      tracked = target;
      target.addEventListener('touchmove', onTouchMove as EventListener, { passive: false });
      target.addEventListener('touchend', onTouchEnd as EventListener, { passive: true });
      target.addEventListener('touchcancel', onTouchCancel as EventListener, { passive: true });
    }

    function untrack() {
      tracked?.removeEventListener('touchmove', onTouchMove as EventListener);
      tracked?.removeEventListener('touchend', onTouchEnd as EventListener);
      tracked?.removeEventListener('touchcancel', onTouchCancel as EventListener);
      tracked = null;
    }

    for (const surface of surfaces) {
      surface.addEventListener('touchstart', onTouchStart, { passive: true });
      // Nicht passiv: Nur so hält `preventDefault` das Scrollen während des Ziehens an.
      surface.addEventListener('touchmove', onTouchMove, { passive: false });
      surface.addEventListener('touchend', onTouchEnd, { passive: true });
      surface.addEventListener('touchcancel', onTouchCancel, { passive: true });
    }
    return () => {
      for (const surface of surfaces) {
        surface.removeEventListener('touchstart', onTouchStart);
        surface.removeEventListener('touchmove', onTouchMove);
        surface.removeEventListener('touchend', onTouchEnd);
        surface.removeEventListener('touchcancel', onTouchCancel);
      }
      untrack();
      // Endet die Geste auf anderem Weg (Escape, Navigation, Breitenwechsel),
      // gleitet die Schublade mit der Standarddauer an ihr Ziel. Eine
      // Öffnen-Vorschau ändert `open` nicht; erst `routeKey` beendet sie bei
      // einer Navigation. Weitere Ereignisse derselben Berührung treffen danach
      // auf eine neue Geste und bleiben ohne Wirkung.
      if (gesture?.dragging) {
        dragging.current = false;
        shell.style.removeProperty('--mobile-nav-motion');
        clearDrag();
        if (gesture.mode === 'open') setPreviewing(false);
      }
    };
  }, [enabled, open, routeKey, shellRef, drawerRef, backdropRef]);

  return previewing && enabled && !open;
}
