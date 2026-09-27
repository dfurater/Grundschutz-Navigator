import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, SyntheticEvent } from 'react';

export interface TooltipProps {
  /** Eindeutige ID des Tooltip-Containers; wird an `describeTarget` gereicht. */
  readonly id: string;
  /** Inhalt des Tooltip-Containers (`role="tooltip"`). */
  readonly content: ReactNode;
  /**
   * Render-Prop für das beschriebene Ziel-Element. Erhält `id` und MUSS sie im
   * Modus `hover` als `aria-describedby` setzen — sonst Bruch (s. Vertragstest).
   * In den Toggle-Modi trägt der umhüllende Button `aria-describedby`.
   */
  readonly describeTarget?: (describedById: string) => ReactNode;
  /**
   * `mode='hover'`: Öffnen nach `hoverDelayMs` ununterbrochenem Hover ODER bei Fokus
   * (Fokus öffnet SOFORT, ungeachtet `hoverDelayMs`; nicht nach Antippen);
   * Schließen bei Leave/Blur/Esc.
   * `mode='toggle'`: Öffnen/Schließen per Klick/Enter/Space + Schließen per Esc.
   * `mode='hover-toggle'`: außerdem Öffnen nach Hover-Verzögerung, Schließen
   * beim Verlassen. Für Platzhalter, die auch auf Touch antippbar bleiben.
   * Touch = Antippen (kein separater Touch-Pfad).
   */
  readonly mode?: 'hover' | 'toggle' | 'hover-toggle';
  /** Öffnungsverzögerung für `mode='hover'` in ms (Default 500). */
  readonly hoverDelayMs?: number;
}

/** Abstand des Tooltips zum Rand des sichtbaren Bereichs in px. */
const EDGE_GAP = 8;

/**
 * Hält einen geöffneten Tooltip im sichtbaren Teil des scrollbaren
 * Detail-Panels und des Viewports. Gemessen wird immer die natürliche Lage:
 * Die eigene Begrenzung wird im selben Durchlauf zurückgenommen, ohne dass
 * dazwischen gemalt wird. Reicht der Platz unter dem Auslöser nicht, klappt
 * der Tooltip über ihn, statt ihn beim Einklemmen am unteren Rand zu
 * verdecken. Liegt der Auslöser ganz außerhalb des sichtbaren Bereichs, bleibt
 * der Tooltip an ihm und scrollt mit ihm hinaus, statt allein am Panelrand zu
 * hängen.
 */
function clampToVisibleArea(tooltip: HTMLElement): void {
  const { style } = tooltip;
  style.transform = '';
  style.maxWidth = '';
  style.maxHeight = '';
  const panel = tooltip.closest('[data-control-detail-scroll]')?.getBoundingClientRect();
  const visibleLeft = Math.max(0, panel?.left ?? 0);
  const visibleRight = Math.min(globalThis.innerWidth, panel?.right ?? globalThis.innerWidth);
  const visibleTop = Math.max(0, panel?.top ?? 0);
  const visibleBottom = Math.min(globalThis.innerHeight, panel?.bottom ?? globalThis.innerHeight);
  const trigger = tooltip.parentElement?.getBoundingClientRect();
  if (
    trigger !== undefined
    && (trigger.bottom <= visibleTop || trigger.top >= visibleBottom
      || trigger.right <= visibleLeft || trigger.left >= visibleRight)
  ) {
    return;
  }
  const box = tooltip.getBoundingClientRect();
  const minLeft = visibleLeft + EDGE_GAP;
  const maxRight = visibleRight - EDGE_GAP;
  const minTop = visibleTop + EDGE_GAP;
  const maxBottom = visibleBottom - EDGE_GAP;
  const availableWidth = Math.max(0, maxRight - minLeft);
  const availableHeight = Math.max(0, maxBottom - minTop);
  const width = Math.min(box.width, availableWidth);
  const height = Math.min(box.height, availableHeight);
  let preferredTop = box.top;
  if (trigger !== undefined && box.bottom > maxBottom) {
    const aboveTop = trigger.top - Math.max(0, box.top - trigger.bottom) - box.height;
    if (aboveTop >= minTop) {
      preferredTop = aboveTop;
    }
  }
  const left = Math.max(minLeft, Math.min(box.left, maxRight - width));
  const top = Math.max(minTop, Math.min(preferredTop, maxBottom - height));
  if (box.width > availableWidth) {
    style.maxWidth = `${availableWidth}px`;
  }
  if (box.height > availableHeight) {
    style.maxHeight = `${availableHeight}px`;
  }
  style.transform = `translate(${left - box.left}px, ${top - box.top}px)`;
}

/**
 * Tooltip-Baustein (GSPP-303 T3).
 *
 * T5/T6/T7 nutzen `Tooltip`/`TooltipProps`: `mode='hover'` für Kennungen/Satzteile,
 * `mode='hover-toggle'` für Platzhalter. Kein Fokus-Trap.
 */
export function Tooltip({
  id,
  content,
  describeTarget,
  mode = 'hover',
  hoverDelayMs = 500,
}: TooltipProps): ReactNode {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Fokus durch Antippen öffnet im Modus `hover` nichts (Touch-Regel GSPP-303).
  const touchFocusRef = useRef(false);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  const closeTooltip = useCallback((): void => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  // Timer-Ref bei Leave/Blur/Unmount aufräumen.
  useEffect(() => {
    const timer = timerRef;
    return () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        timer.current = undefined;
      }
    };
  }, []);

  // Esc-Listener nur bei geöffnetem Tooltip aktiv. Capture-Phase und
  // stopPropagation: Esc schließt nur den Tooltip, nicht zusätzlich das mobile
  // Detail-Overlay, das auf `document` in der Bubble-Phase lauscht.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeTooltip();
      }
    };
    // eslint-disable-next-line no-restricted-syntax -- GSPP-303 T10: Esc-Listener lebt und stirbt in diesem Effekt (single owner); `useGlobalEventListener` kennt keine Capture-Phase.
    globalThis.document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      // eslint-disable-next-line no-restricted-syntax -- GSPP-303 T10: Cleanup des obigen Listeners im selben Effekt (single owner).
      globalThis.document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, closeTooltip]);

  // Begrenzung vor dem ersten Malen und nach jedem Scrollen (auch des Panels,
  // daher Capture-Phase) oder jeder Größenänderung neu messen: Der Auslöser
  // bewegt sich, ein einmal berechneter Versatz passte nicht mehr. Die
  // Begrenzung setzt `clampToVisibleArea` direkt am Element, nicht über
  // React-State, damit Scrollen keinen zusätzlichen Render auslöst.
  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!open || !tooltip) {
      return undefined;
    }
    const reclamp = () => {
      clampToVisibleArea(tooltip);
    };
    reclamp();
    // eslint-disable-next-line no-restricted-syntax -- Scroll-/Resize-Listener leben und sterben in diesem Effekt (single owner); `useGlobalEventListener` kennt keine Capture-Phase.
    globalThis.document.addEventListener('scroll', reclamp, { capture: true, passive: true });
    // eslint-disable-next-line no-restricted-syntax -- siehe oben, derselbe Effekt.
    globalThis.addEventListener('resize', reclamp);
    return () => {
      // eslint-disable-next-line no-restricted-syntax -- Cleanup der obigen Listener im selben Effekt (single owner).
      globalThis.document.removeEventListener('scroll', reclamp, { capture: true });
      // eslint-disable-next-line no-restricted-syntax -- siehe oben, derselbe Effekt.
      globalThis.removeEventListener('resize', reclamp);
    };
  }, [open]);

  // prefers-reduced-motion-Wächter: gatet nur Transition/Animation, nie die Messung.
  const prefersReducedMotion =
    globalThis.window !== undefined &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Der Tooltip bleibt versteckt im DOM, damit `aria-describedby` schon beim
  // Fokus auf einen vorhandenen Beschreibungstext zeigt.
  const tooltipNode = (
    <span
      ref={tooltipRef}
      role="tooltip"
      id={id}
      hidden={!open}
      className="absolute z-50 block max-w-xs rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs shadow-[var(--shadow-overlay)]"
      style={{ transition: prefersReducedMotion ? 'none' : undefined }}
    >
      {content}
    </span>
  );

  if (mode === 'toggle' || mode === 'hover-toggle') {
    // Constraint: `describeTarget` liefert hier nur nicht-interaktiven
    // Phrasing-Content (Platzhalter-Text) — er landet in einem <button>.
    const handleToggle = () => {
      clearTimer();
      if (open) {
        closeTooltip();
      } else {
        setOpen(true);
      }
    };
    // Enter/Space liefert der native Button als Klick.
    return (
      <span
        onMouseEnter={mode === 'hover-toggle' ? () => {
          clearTimer();
          timerRef.current = globalThis.setTimeout(() => setOpen(true), hoverDelayMs);
        } : undefined}
        onMouseLeave={mode === 'hover-toggle' ? closeTooltip : undefined}
        data-tooltip-root={id}
        className="relative inline"
      >
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          aria-describedby={id}
          onClick={handleToggle}
          onBlur={closeTooltip}
          className="inline cursor-pointer rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
        >
          {describeTarget?.(id)}
        </button>
        {tooltipNode}
      </span>
    );
  }

  // Verschachtelte Ziele mit eigenem Tooltip (z. B. Platzhalter in einem
  // Satzteil) öffnen nur ihren eigenen Tooltip, nicht zusätzlich diesen.
  // Jeder Tooltip markiert seinen Bereich (Ziel und Erklärung) mit
  // `data-tooltip-root`; der nächstgelegene Bereich entscheidet.
  const isForeignTarget = (event: SyntheticEvent<HTMLSpanElement>): boolean => {
    const root = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-tooltip-root]')
      : null;
    return root !== null && root.dataset.tooltipRoot !== id;
  };
  const handlePointerOver = (event: SyntheticEvent<HTMLSpanElement>) => {
    if (isForeignTarget(event)) {
      closeTooltip();
      return;
    }
    if (open || timerRef.current !== undefined) {
      return;
    }
    timerRef.current = globalThis.setTimeout(() => {
      timerRef.current = undefined;
      setOpen(true);
    }, hoverDelayMs);
  };
  const handleMouseLeave = () => {
    closeTooltip();
  };
  const handleFocus = (event: SyntheticEvent<HTMLSpanElement>) => {
    clearTimer();
    const fromTouch = touchFocusRef.current;
    touchFocusRef.current = false;
    if (isForeignTarget(event)) {
      closeTooltip();
      return;
    }
    if (!fromTouch) {
      setOpen(true);
    }
  };
  const handleBlur = (event: SyntheticEvent<HTMLSpanElement>) => {
    // Blur eines verschachtelten Ziels (z. B. Platzhalter) darf die
    // Touch-Markierung für den folgenden Fokus dieses Ziels nicht löschen.
    if (isForeignTarget(event)) {
      return;
    }
    touchFocusRef.current = false;
    closeTooltip();
  };

  return (
    <span
      onMouseEnter={handlePointerOver}
      onMouseOver={handlePointerOver}
      onMouseLeave={handleMouseLeave}
      onPointerDown={(event) => {
        touchFocusRef.current = event.pointerType === 'touch';
      }}
      onFocus={handleFocus}
      onBlur={handleBlur}
      data-tooltip-root={id}
      className="relative inline"
    >
      {describeTarget?.(id)}
      {tooltipNode}
    </span>
  );
}
