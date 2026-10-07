import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { flushSync } from 'react-dom';

/** Ab dieser Strecke entscheidet die Richtung, ob die Geste der Schublade gehört. */
const DIRECTION_SLOP_PX = 10;
/** Schneller geworfen entscheidet die Richtung, nicht die Strecke (px/ms). */
const FLING_VELOCITY = 0.3;
/** Zeitfenster vor dem Loslassen, aus dem die Wurfgeschwindigkeit stammt. */
const VELOCITY_WINDOW_MS = 100;
const RELEASE_MIN_MS = 90;
/** Entspricht `--duration-drawer` (src/index.css). */
const RELEASE_MAX_MS = 220;
/** Der Finger bewegt die Schublade bereits; die Freigabe bremst nur noch ab. */
const RELEASE_EASING = 'cubic-bezier(0, 0, 0.2, 1)';

interface Sample {
  readonly x: number;
  readonly time: number;
}

interface Gesture {
  /** `open`: Wischen nach rechts auf der Seite; `close`: nach links auf Schublade oder Abdunklung. */
  readonly mode: 'open' | 'close';
  readonly startX: number;
  readonly startY: number;
  readonly width: number;
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
  /** Träger von `data-mobile-nav` und den `--mobile-nav-*`-Variablen. */
  readonly shellRef: RefObject<HTMLElement | null>;
  readonly drawerRef: RefObject<HTMLElement | null>;
  readonly backdropRef: RefObject<HTMLElement | null>;
  /** Läuft im selben Commit wie der Beginn einer Öffnen-Geste. */
  readonly onPreview: () => void;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}

function releaseVelocity(samples: readonly Sample[], releaseTime: number) {
  const recent = samples.filter((sample) => releaseTime - sample.time <= VELOCITY_WINDOW_MS);
  if (recent.length < 2) return 0;
  const first = recent[0];
  const last = recent.at(-1)!;
  return last.time > first.time ? (last.x - first.x) / (last.time - first.time) : 0;
}

/**
 * Eine Öffnen-Geste beginnt nur auf der Seite selbst: nicht in festen
 * Ebenen (Sheets, Detailansicht, Auswahlleiste) und nicht in Bereichen, die
 * selbst waagerecht scrollen, etwa breiten Tabellen.
 */
function startsOpenGesture(target: EventTarget | null, shell: HTMLElement) {
  if (!(target instanceof Element) || target.closest('main, header') === null) return false;
  for (let element: Element | null = target; element && element !== shell; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.position === 'fixed') return false;
    if (/(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth) return false;
  }
  return true;
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
  shellRef,
  drawerRef,
  backdropRef,
  onPreview,
  onOpen,
  onClose,
}: MobileDrawerSwipeOptions): boolean {
  const [previewing, setPreviewing] = useState(false);
  const releasing = useRef(false);
  const preview = useEffectEvent(onPreview);
  const openDrawer = useEffectEvent(onOpen);
  const closeDrawer = useEffectEvent(onClose);

  // Ein Öffnen nimmt wieder Dauer und Kurve des Tokens, auch wenn die letzte
  // Freigabe ohne Transition endete und ihre Werte noch stehen. Das Öffnen
  // einer Geste behält die eben gesetzten Werte ihrer Freigabe.
  useLayoutEffect(() => {
    if (open && !releasing.current) shellRef.current?.style.removeProperty('--mobile-nav-motion');
  }, [open, shellRef]);

  // Dauer und Kurve einer Freigabe gelten nur für deren Bewegung. Der Listener
  // überdauert das Schließen, denn das Hinausgleiten läuft danach noch.
  useEffect(() => {
    const shell = shellRef.current;
    const drawer = drawerRef.current;
    if (shell === null || drawer === null) return;
    const settle = (event: TransitionEvent) => {
      if (event.target === drawer && event.propertyName === 'translate') {
        shell.style.removeProperty('--mobile-nav-motion');
      }
    };
    drawer.addEventListener('transitionend', settle);
    drawer.addEventListener('transitioncancel', settle);
    return () => {
      drawer.removeEventListener('transitionend', settle);
      drawer.removeEventListener('transitioncancel', settle);
    };
  }, [shellRef, drawerRef]);

  useEffect(() => {
    const shell = shellRef.current;
    const drawer = drawerRef.current;
    if (!enabled || shell === null || drawer === null) return;
    const surfaces = open
      ? [drawer, backdropRef.current].filter((surface) => surface !== null)
      : [shell];
    let gesture: Gesture | null = null;

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
      shell.style.removeProperty('--mobile-nav-motion');
      clearDrag();
      if (abandoned.mode === 'open') release(() => setPreviewing(false));
    };

    const onTouchStart = (event: TouchEvent) => {
      if (gesture?.dragging) abandon(gesture);
      gesture = null;
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
        dragging: false,
        offset: open ? 0 : -width,
        samples: [{ x: touch.clientX, time: event.timeStamp }],
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (gesture === null) return;
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
        gesture.dragging = true;
        shell.style.setProperty('--mobile-nav-motion', '0s');
        if (gesture.mode === 'open') {
          setDrag(-gesture.width, gesture.width);
          flushSync(() => {
            preview();
            setPreviewing(true);
          });
        }
      }
      // Erst eine waagerechte Geste hält den Browser vom Scrollen ab.
      event.preventDefault();
      const base = gesture.mode === 'open' ? -gesture.width : 0;
      gesture.offset = Math.min(0, Math.max(-gesture.width, base + dx));
      gesture.samples.push({ x: touch.clientX, time: event.timeStamp });
      if (gesture.samples.length > 8) gesture.samples.shift();
      setDrag(gesture.offset, gesture.width);
    };

    const onTouchEnd = (event: TouchEvent) => {
      const released = gesture;
      gesture = null;
      if (!released?.dragging) return;
      const { mode, offset, width } = released;
      const velocity = releaseVelocity(released.samples, event.timeStamp);
      const opens = velocity > FLING_VELOCITY || (velocity >= -FLING_VELOCITY && offset > -width / 2);
      const distance = opens ? -offset : width + offset;
      const speed = Math.abs(velocity);
      const duration = speed >= FLING_VELOCITY ? distance / speed : RELEASE_MAX_MS * (distance / width);
      if (distance >= 1) {
        const clamped = Math.round(Math.min(RELEASE_MAX_MS, Math.max(RELEASE_MIN_MS, duration)));
        shell.style.setProperty('--mobile-nav-motion', `${clamped}ms ${RELEASE_EASING}`);
      } else {
        shell.style.removeProperty('--mobile-nav-motion');
      }
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

    const onTouchCancel = () => {
      if (gesture?.dragging) abandon(gesture);
      gesture = null;
    };

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
      // Endet die Geste auf anderem Weg (Escape, Navigation, Breitenwechsel),
      // gleitet die Schublade mit der Standarddauer an ihr Ziel.
      if (gesture?.dragging) {
        shell.style.removeProperty('--mobile-nav-motion');
        clearDrag();
        if (gesture.mode === 'open') setPreviewing(false);
      }
    };
  }, [enabled, open, shellRef, drawerRef, backdropRef]);

  return previewing && enabled && !open;
}
