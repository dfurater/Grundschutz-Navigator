import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Link } from 'react-router';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { IconCheck, IconChevronDown } from './icons';

/**
 * Eintrag der Datenklasse 1: ein teilbarer Ort mit eigener URL. Eigene Daten
 * (Datenklasse 2) bekommen später einen zweiten Eintragstyp mit `onSelect`
 * statt `href`, damit nichts davon in Verlauf, Lesezeichen oder Referrer landet.
 */
export interface ScopeSwitcherLinkItem<K extends string = string> {
  readonly key: K;
  /** Titel wörtlich aus der Quelle, ohne Kürzen oder Umformen. */
  readonly title: string;
  readonly href: string;
}

export type ScopeSwitcherItem<K extends string = string> = ScopeSwitcherLinkItem<K>;

export interface ScopeSwitcherProps<K extends string = string> {
  /** Klasse des Kontexts, etwa „Katalog“; Teil des zugänglichen Namens. */
  readonly label: string;
  /** Einträge genau einer Datenklasse. */
  readonly items: readonly ScopeSwitcherItem<K>[];
  readonly activeKey: K;
  /** Element rechts im Kopf, etwa Einklappen oder Schließen. */
  readonly trailing?: ReactNode;
  /** Nach einer Auswahl, etwa um einen Drawer zu schließen. */
  readonly onItemActivate?: (key: K) => void;
}

// Die Sprache erbt der Titel vom Dokument; die OSCAL-Metadaten tragen keine eigene.
const TITLE_CLASS = 'line-clamp-2 min-w-0 flex-1 hyphens-auto text-sm leading-[18px]';

export function ScopeSwitcher<K extends string = string>({
  label,
  items,
  activeKey,
  trailing,
  onItemActivate,
}: ScopeSwitcherProps<K>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const menuId = useId();
  const headingId = useId();

  const activeIndex = items.findIndex((item) => item.key === activeKey);
  const activeItem = activeIndex === -1 ? undefined : items[activeIndex];

  useGlobalEventListener('document', 'mousedown', (event) => {
    if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
  }, open);

  useEffect(() => {
    if (open) itemRefs.current[Math.max(activeIndex, 0)]?.focus();
  }, [open, activeIndex]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const focusItem = (index: number) => {
    const count = items.length;
    itemRefs.current[(index + count) % count]?.focus();
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = itemRefs.current.indexOf(document.activeElement as HTMLAnchorElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(current === -1 ? items.length - 1 : current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(items.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        close();
        break;
      case 'Tab':
        // Der Fokus geht an den Auslöser zurück; der Tab-Schritt läuft von dort weiter.
        close();
        break;
      case ' ':
        // Links reagieren nativ nur auf Enter.
        if (event.target instanceof HTMLAnchorElement) {
          event.preventDefault();
          event.target.click();
        }
        break;
    }
  };

  const handleSelect = (key: K) => {
    close();
    onItemActivate?.(key);
  };

  return (
    // 51 px auf der Linie der Toolbar: Nach der 1-px-Unterlinie bleiben 50 px,
    // davon 3 px Rand oben und unten um den 44 px hohen Auslöser. Zwei Titelzeilen
    // (2 × 18 px) passen mit 4 px Innenabstand oben und unten genau hinein.
    <div className="relative flex shrink-0 items-center gap-1 border-b border-slate-200 px-1 py-[3px]" style={{ height: 51 }}>
      <div
        ref={containerRef}
        className="min-w-0 flex-1"
        onBlur={(event) => {
          if (open && !containerRef.current?.contains(event.relatedTarget as Node | null)) {
            setOpen(false);
          }
        }}
      >
        {activeItem && (
          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            onKeyDown={handleTriggerKeyDown}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            className={`group flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)] ${open ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
          >
            {/* Das Leerzeichen steht zwischen den Spans: Am Spanende fiele es aus dem Namen. */}
            <span className="sr-only">{`${label}:`}</span>{' '}
            <span className={`${TITLE_CLASS} font-semibold text-[var(--color-text-primary)]`}>
              {activeItem.title}
            </span>
            <IconChevronDown
              className={`h-3.5 w-3.5 shrink-0 transition-[rotate,color] ${open ? 'rotate-180 text-slate-600' : 'text-slate-400 group-hover:text-slate-600'}`}
            />
          </button>
        )}

        {/*
          100 % endet über der Unterlinie des Kopfs; 5 px setzen das Menü 4 px darunter.
          Die Höhe endet vor dem Viewport-Rand (Header 56 + Kopf 51 + Abstände), damit
          bei niedrigen Viewports jeder Eintrag per Scrollen erreichbar bleibt.
        */}
        {open && (
          <div
            id={menuId}
            role="menu"
            tabIndex={-1}
            aria-labelledby={headingId}
            onKeyDown={handleMenuKeyDown}
            className="absolute inset-x-1 top-[calc(100%+5px)] z-40 max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] p-1.5 shadow-[var(--shadow-overlay)]"
          >
            <div
              id={headingId}
              className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
            >
              {`${label} wechseln`}
            </div>
            {items.map((item, index) => {
              const isActive = item.key === activeKey;
              return (
                <Link
                  key={item.key}
                  ref={(element) => { itemRefs.current[index] = element; }}
                  to={item.href}
                  role="menuitemradio"
                  aria-checked={isActive}
                  tabIndex={-1}
                  onClick={() => handleSelect(item.key)}
                  className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
                >
                  <span
                    className={`${TITLE_CLASS} ${isActive ? 'font-semibold text-[var(--color-text-primary)]' : 'font-medium text-slate-700'}`}
                  >
                    {item.title}
                  </span>
                  {isActive && (
                    <IconCheck className="h-4 w-4 shrink-0 text-[var(--color-accent-default)]" />
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
      {trailing}
    </div>
  );
}
