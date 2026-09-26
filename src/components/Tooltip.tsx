import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

export interface TooltipProps {
  /** Eindeutige ID des Tooltip-Containers; wird an `describeTarget` gereicht. */
  readonly id: string;
  /** Inhalt des Tooltip-Containers (`role="tooltip"`). */
  readonly content: ReactNode;
  /**
   * Render-Prop für das beschriebene Ziel-Element. Erhält `id` und MUSS sie als
   * `aria-describedby` setzen — sonst Bruch (s. Vertragstest).
   */
  readonly describeTarget?: (describedById: string) => ReactNode;
  /**
   * `mode='hover'`: Öffnen nach `hoverDelayMs` ununterbrochenem Hover ODER bei Fokus
   * (Fokus öffnet SOFORT, ungeachtet `hoverDelayMs`); Schließen bei Leave/Blur/Esc.
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

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

  // Esc-Listener nur bei geöffnetem Tooltip aktiv.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeTooltip();
      }
    };
    // eslint-disable-next-line no-restricted-syntax -- GSPP-303 T10: Esc-Listener lebt und stirbt in diesem Effekt (single owner), daher legitimer add/remove-Pfad.
    globalThis.document.addEventListener('keydown', handleKeyDown);
    return () => {
      // eslint-disable-next-line no-restricted-syntax -- GSPP-303 T10: Cleanup des obigen Listeners im selben Effekt (single owner).
      globalThis.document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, closeTooltip]);

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
  }, [open]);

  // prefers-reduced-motion-Wächter: gatet nur Transition/Animation, nie die Messung.
  const prefersReducedMotion =
    globalThis.window !== undefined &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const tooltipNode = open ? (
    <div
      ref={tooltipRef}
      role="tooltip"
      id={id}
      className="absolute z-50 max-w-xs rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs shadow-[var(--shadow-overlay)]"
      style={{ transition: prefersReducedMotion ? 'none' : undefined, ...clampStyle }}
    >
      {content}
    </div>
  ) : null;

  if (mode === 'toggle' || mode === 'hover-toggle') {
    // Constraint: Toggle-Wrapper nur mit nicht-interaktivem Phrasing-Content
    // (Platzhalter-Text) verwenden — keine Buttons/Links darin verschachteln.
    const handleToggle = () => {
      clearTimer();
      if (open) {
        closeTooltip();
      } else {
        setOpen(true);
      }
    };
    const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
      // Nur Space scrollt per Default (Seiten-Scroll verhindern); Enter hat auf
      // dem Toggle-Wrapper keinen Default zu unterdrücken.
      if (event.key === ' ') {
        event.preventDefault();
        handleToggle();
      } else if (event.key === 'Enter') {
        handleToggle();
      }
    };
    return (
      <span
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={id}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        onMouseEnter={mode === 'hover-toggle' ? () => {
          clearTimer();
          timerRef.current = globalThis.setTimeout(() => setOpen(true), hoverDelayMs);
        } : undefined}
        onMouseLeave={mode === 'hover-toggle' ? closeTooltip : undefined}
        onBlur={closeTooltip}
        className="relative inline"
      >
        {describeTarget?.(id)}
        {tooltipNode}
      </span>
    );
  }

  const handleMouseEnter = () => {
    clearTimer();
    timerRef.current = globalThis.setTimeout(() => {
      setOpen(true);
    }, hoverDelayMs);
  };
  const handleMouseLeave = () => {
    closeTooltip();
  };
  const handleFocus = () => {
    clearTimer();
    setOpen(true);
  };
  const handleBlur = () => {
    closeTooltip();
  };

  return (
    <span
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className="relative inline"
    >
      {describeTarget?.(id)}
      {tooltipNode}
    </span>
  );
}
