import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, SyntheticEvent } from 'react';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';

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
  const [clampStyle, setClampStyle] = useState<CSSProperties>({});
  const [measureRun, setMeasureRun] = useState(0);
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
    setClampStyle({});
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

  // Bei geänderter Fenstergröße die Begrenzung neu messen.
  useGlobalEventListener('window', 'resize', () => {
    setClampStyle({});
    setMeasureRun((run) => run + 1);
  }, open);

  // Innerhalb des scrollbaren Detail-Panels und des Viewports halten.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const frame = requestAnimationFrame(() => {
      const tooltip = tooltipRef.current;
      if (!tooltip) {
        return;
      }
      const box = tooltip.getBoundingClientRect();
      const panel = tooltip.closest('[data-control-detail-scroll]')?.getBoundingClientRect();
      const minLeft = Math.max(0, panel?.left ?? 0) + 8;
      const maxRight = Math.min(globalThis.innerWidth, panel?.right ?? globalThis.innerWidth) - 8;
      const minTop = Math.max(0, panel?.top ?? 0) + 8;
      const maxBottom = Math.min(globalThis.innerHeight, panel?.bottom ?? globalThis.innerHeight) - 8;
      const availableWidth = Math.max(0, maxRight - minLeft);
      const availableHeight = Math.max(0, maxBottom - minTop);
      const width = Math.min(box.width, availableWidth);
      const height = Math.min(box.height, availableHeight);
      const left = Math.max(minLeft, Math.min(box.left, maxRight - width));
      const top = Math.max(minTop, Math.min(box.top, maxBottom - height));
      const next: CSSProperties = {};
      if (box.width > availableWidth) {
        next.maxWidth = availableWidth;
      }
      if (box.height > availableHeight) {
        next.maxHeight = availableHeight;
      }
      next.transform = `translate(${left - box.left}px, ${top - box.top}px)`;
      setClampStyle(next);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [open, measureRun]);

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
      style={{ transition: prefersReducedMotion ? 'none' : undefined, ...clampStyle }}
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
