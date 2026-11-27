import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent, ReactNode, RefCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { IconChevronDown } from '@/components/icons';
import type { CatalogDirectoryEntry, LoadedCatalogState } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';
import { catalogShortTitle } from '@/features/catalog/catalogShortTitle';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';

export interface CatalogSwitcherItem extends CatalogDirectoryEntry {
  readonly href: string;
}

interface CatalogSwitcherProps {
  readonly items: readonly CatalogSwitcherItem[];
  readonly activeKey: CatalogKey;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly trailing?: ReactNode;
  /** Ladezustand je Katalog. Fehlt er, öffnet eine Auswahl den Katalog sofort. */
  readonly loadStates?: ReadonlyMap<CatalogKey, LoadedCatalogState>;
  readonly requestCatalog?: (catalogKey: CatalogKey) => void;
  readonly retryCatalog?: (catalogKey: CatalogKey) => void;
  /** Scrollbereich unter dem Kopf: Liste (geöffnet) und darunter `children`. */
  readonly scrollRef?: RefCallback<HTMLDivElement>;
  readonly children?: ReactNode;
}

const numberFormat = new Intl.NumberFormat('de-DE');
const SWITCH_NAVIGATION = { fromCatalogSwitcher: true } as const;

export function isCatalogSwitchNavigation(state: unknown): boolean {
  return typeof state === 'object'
    && state !== null
    && (state as { fromCatalogSwitcher?: unknown }).fromCatalogSwitcher === true;
}

const focusRing = 'kbd-focus:outline-none kbd-focus:ring-2 kbd-focus:ring-inset kbd-focus:ring-[var(--color-focus-ring)]';

const shortTitleOf = (item: CatalogSwitcherItem | undefined, fallback: CatalogKey) =>
  catalogShortTitle(item?.catalogKey ?? fallback, item?.title ?? fallback);

interface ChoiceProps {
  readonly item: CatalogSwitcherItem;
  readonly id: string;
  readonly current: boolean;
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly onSelect: (event: MouseEvent, item: CatalogSwitcherItem) => void;
}

function CatalogChoice({ item, id, current, pending, disabled, onSelect }: Readonly<ChoiceProps>) {
  const facts = [
    item.implementsNorm && `Norm: ${item.implementsNorm}`,
    item.targetAudience && `Zielgruppe: ${item.targetAudience}`,
  ].filter(Boolean).join(' · ');
  const hasCount = item.controlCount !== undefined;
  const description = [current && `${id}-current`, facts && `${id}-facts`, hasCount && `${id}-count`]
    .filter(Boolean).join(' ');
  const rowClass = `grid w-full min-h-11 grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 rounded-md px-2.5 py-2 text-left wrap-anywhere ${focusRing}`;
  const content = (
    <>
      <span id={`${id}-title`} className="line-clamp-2 text-sm font-semibold leading-snug text-[var(--color-text-primary)]">
        {item.title}
      </span>
      <span className="text-right text-sm font-medium leading-snug tabular-nums text-[var(--color-text-primary)]">
        {hasCount && (
          <span id={`${id}-count`}>
            {numberFormat.format(item.controlCount!)}{' '}
            <span className="sr-only">{item.controlCount === 1 ? 'Kontrolle' : 'Kontrollen'}</span>
          </span>
        )}
      </span>
      {pending ? (
        <span className="col-span-2 flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
          <span aria-hidden="true" className="size-2.5 shrink-0 animate-spin rounded-full border-2 border-[var(--color-border-strong)] border-t-[var(--color-primary-main)] motion-reduce:animate-none" />
          <span>Katalog wird geladen… · Esc bricht ab</span>
        </span>
      ) : (current || facts) && (
        <span className="col-span-2 truncate text-xs text-[var(--color-text-secondary)]">
          {current && <span id={`${id}-current`} className="font-semibold text-primary-main">Geöffnet</span>}
          {current && facts && ' · '}
          {facts && <span id={`${id}-facts`}>{facts}</span>}
        </span>
      )}
    </>
  );
  const accessible = {
    'aria-labelledby': `${id}-title`,
    'aria-describedby': description || undefined,
    // Während eines Wechsels behält die ladende Zeile den Fokus: WebKit fokussiert weder Links noch
    // Schaltflächen beim Zeigerklick und schöbe ihn sonst auf `body`, wo Escape den Schnellwechsel verfehlt.
    onMouseDown: (event: MouseEvent) => { if (pending || disabled) event.preventDefault(); },
  };

  return current ? (
    <button
      type="button"
      aria-current="true"
      {...accessible}
      aria-disabled={disabled || undefined}
      className={`${rowClass} bg-primary-light ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      onClick={(event) => onSelect(event, item)}
    >
      {content}
    </button>
  ) : (
    <Link
      to={item.href}
      state={SWITCH_NAVIGATION}
      {...accessible}
      aria-busy={pending || undefined}
      aria-disabled={disabled || undefined}
      className={`${rowClass} ${disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-[var(--color-surface-subtle)]'}`}
      onClick={(event) => onSelect(event, item)}
    >
      {content}
    </Link>
  );
}

export function CatalogSwitcher({
  items, activeKey, open, onToggle, trailing, loadStates, requestCatalog, retryCatalog, scrollRef, children,
}: CatalogSwitcherProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const [pendingKey, setPendingKey] = useState<CatalogKey | null>(null);
  const [failedKey, setFailedKey] = useState<CatalogKey | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const active = items.find(({ catalogKey }) => catalogKey === activeKey);
  const activeShortTitle = shortTitleOf(active, activeKey);
  const itemOf = (catalogKey: CatalogKey) => items.find((item) => item.catalogKey === catalogKey);
  const pendingState = pendingKey ? loadStates?.get(pendingKey) : undefined;

  // Eine geschlossene Liste hält keinen Wechsel und keine Fehlermeldung offen.
  if (!open && (pendingKey !== null || failedKey !== null || announcement !== '')) {
    setPendingKey(null);
    setFailedKey(null);
    setAnnouncement('');
  }
  // Fail-closed: Scheitert das Laden, bleibt der bisherige Katalog geöffnet.
  if (pendingKey !== null && pendingState?.error) {
    setPendingKey(null);
    setFailedKey(pendingKey);
    setAnnouncement(`${shortTitleOf(itemOf(pendingKey), pendingKey)} konnte nicht geladen werden. ${activeShortTitle} bleibt geöffnet.`);
  }

  const pendingHref = pendingKey !== null && pendingState?.catalog ? itemOf(pendingKey)?.href : undefined;
  useEffect(() => {
    if (pendingHref) void navigate(pendingHref, { state: SWITCH_NAVIGATION });
  }, [navigate, pendingHref]);

  // Geöffnet beginnt der gemeinsame Scrollbereich oben, damit die Liste über dem Baum sichtbar ist.
  const scrollElement = useRef<HTMLDivElement | null>(null);
  const setScrollElement = useCallback((element: HTMLDivElement | null) => {
    scrollElement.current = element;
    return scrollRef?.(element);
  }, [scrollRef]);
  useEffect(() => {
    if (open && scrollElement.current) scrollElement.current.scrollTop = 0;
  }, [open]);

  const toggle = () => {
    onToggle();
    triggerRef.current?.focus({ preventScroll: true });
  };

  const startLoad = (item: CatalogSwitcherItem) => {
    const { catalogKey } = item;
    // Die Zeile hält den Fokus, damit Escape den Wechsel abbricht: WebKit fokussiert Links beim Klick nicht,
    // und der Knopf „Erneut versuchen“ verschwindet mit der Meldung.
    const titleId = CSS.escape(`${panelId}-${catalogKey}-title`);
    rootRef.current?.querySelector<HTMLElement>(`[aria-labelledby="${titleId}"]`)?.focus();
    setFailedKey(null);
    setPendingKey(catalogKey);
    setAnnouncement(`${shortTitleOf(item, catalogKey)} wird geladen. Escape bricht ab.`);
    if (loadStates?.get(catalogKey)?.error) retryCatalog?.(catalogKey);
    else requestCatalog?.(catalogKey);
  };

  const select = (event: MouseEvent, item: CatalogSwitcherItem) => {
    const { catalogKey } = item;
    // Während eines Wechsels ist auch die Zeile des geöffneten Katalogs gesperrt.
    if (catalogKey === activeKey) return pendingKey === null ? toggle() : undefined;
    // Ein Klick mit Modifikator öffnet den Link wie gewohnt, etwa in einem neuen Tab, auch während eines Wechsels.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (pendingKey !== null) return event.preventDefault();
    // Ohne Ladeschnittstelle oder bei geladenem Katalog navigiert der Link direkt.
    if (!loadStates || !requestCatalog || loadStates.get(catalogKey)?.catalog) return;
    event.preventDefault();
    startLoad(item);
  };

  const moveFocus = (event: globalThis.KeyboardEvent) => {
    const rows = [...(rootRef.current?.querySelectorAll<HTMLElement>(`#${CSS.escape(panelId)} li > :is(a, button)`) ?? [])];
    const index = rows.indexOf(document.activeElement as HTMLElement);
    const target = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: rows.length - 1 }[event.key];
    if (index < 0 || target === undefined) return;
    event.preventDefault();
    rows[Math.max(0, Math.min(rows.length - 1, target))]?.focus();
  };

  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.defaultPrevented || !(event.target instanceof Node) || !rootRef.current?.contains(event.target)) return;
    if (event.key !== 'Escape') return moveFocus(event);
    event.preventDefault();
    event.stopPropagation();
    if (pendingKey === null) return toggle();
    setPendingKey(null);
    setAnnouncement(`Wechsel abgebrochen. ${activeShortTitle} bleibt geöffnet.`);
  }, open, undefined, true);

  const failed = failedKey ? loadStates?.get(failedKey) : undefined;

  return (
    <div ref={rootRef} data-catalog-switcher="" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-panel-head shrink-0 items-center gap-0.5 border-b border-[var(--color-border-default)] pl-1.5 pr-1">
        {active && (
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-describedby={`${panelId}-active-title`}
            onClick={toggle}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              if (!open) onToggle();
              requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`#${CSS.escape(panelId)} [aria-current="true"]`)?.focus());
            }}
            className={`flex h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 text-left transition-colors hover:bg-[var(--color-surface-subtle)] aria-expanded:bg-[var(--color-surface-subtle)] motion-reduce:transition-none ${focusRing}`}
          >
            <span className="min-w-0">
              <span className="block text-xs text-[var(--color-text-secondary)]">Katalog</span>{' '}
              <span className="block truncate text-sm font-semibold leading-snug text-[var(--color-text-primary)]">
                {activeShortTitle}{' '}
                <span className="sr-only">wechseln</span>
              </span>
            </span>
            <IconChevronDown className={`size-4 shrink-0 text-[var(--color-text-secondary)] transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
        {!open && trailing}
      </div>
      {active && <span id={`${panelId}-active-title`} hidden>{active.title}</span>}
      {/* Nur bei offener Liste: Sie existiert vor jeder Ansage und verdoppelt sonst keine Statusregion der Shell. */}
      {open && <output className="sr-only">{announcement}</output>}
      <div ref={setScrollElement} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <nav
          id={panelId}
          aria-label="Verfügbare Kataloge"
          hidden={!open}
          className="border-b border-[var(--color-border-default)] px-1.5 pb-1.5"
        >
          {open && (
            <>
              <div aria-hidden="true" className="flex justify-between gap-2 px-2.5 pb-1.5 pt-2 text-xs font-semibold text-[var(--color-text-secondary)]">
                <span className="tabular-nums">{items.length} {items.length === 1 ? 'Katalog' : 'Kataloge'}</span>
                <span>Kontrollen</span>
              </div>
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.catalogKey}>
                    <CatalogChoice
                      item={item}
                      id={`${panelId}-${item.catalogKey}`}
                      current={item.catalogKey === activeKey}
                      pending={item.catalogKey === pendingKey}
                      disabled={pendingKey !== null && item.catalogKey !== pendingKey}
                      onSelect={select}
                    />
                    {item.catalogKey === failedKey && (
                      <div className="mt-1 mb-1.5 rounded-md border border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] px-2.5 py-2 text-xs text-[var(--color-danger-text)]">
                        <p>{shortTitleOf(item, item.catalogKey)} konnte nicht geladen werden{failed?.error ? `: ${failed.error}` : '.'}</p>
                        <p className="mt-0.5">{activeShortTitle} bleibt geöffnet.</p>
                        <button
                          type="button"
                          onClick={() => startLoad(item)}
                          className={`mt-2 min-h-8 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] px-2.5 text-xs font-medium text-[var(--color-text-secondary)] shadow-sm hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] ${focusRing}`}
                        >
                          Erneut versuchen
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>
        {children}
      </div>
    </div>
  );
}
