import { useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { IconChevronDown, IconChevronRight } from '@/components/icons';
import type { CatalogDirectoryEntry } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';
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
}

const CATALOG_COPY: Partial<Record<CatalogKey, { shortTitle?: string; scope: string }>> = {
  gspp: { shortTitle: 'Grundschutz++', scope: 'Grundschutz-Methodik und Anforderungen zur Absicherung.' },
  lieferkette: { scope: 'Beschaffung und Steuerung von Dienstleistern.' },
  diva: { shortTitle: 'DIVA · Identitäten und Zugriffe', scope: 'Identitäten, Berechtigungen und Zugriffe nach Zero Trust.' },
  'wlan-gastnetze': { shortTitle: 'WLAN-Personal- und Gastnetze', scope: 'Für Gäste, kleine Büros und vernetzte Geräte.' },
};

const numberFormat = new Intl.NumberFormat('de-DE');
const numberOfControls = (count: number) => `${numberFormat.format(count)} ${count === 1 ? 'Kontrolle' : 'Kontrollen'}`;

const SWITCH_NAVIGATION = { fromCatalogSwitcher: true } as const;

export function isCatalogSwitchNavigation(state: unknown): boolean {
  return typeof state === 'object'
    && state !== null
    && (state as { fromCatalogSwitcher?: unknown }).fromCatalogSwitcher === true;
}

const focusRing = 'kbd-focus:outline-none kbd-focus:ring-2 kbd-focus:ring-inset kbd-focus:ring-[var(--color-focus-ring)]';

function CatalogChoice({ item, current, onClose, id }: Readonly<{
  item: CatalogSwitcherItem;
  current: boolean;
  onClose: () => void;
  id: string;
}>) {
  const scope = CATALOG_COPY[item.catalogKey]?.scope;
  const count = item.controlCount === undefined ? undefined : numberOfControls(item.controlCount);
  const rowClass = `grid w-full min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded px-2.5 py-2 text-left ${focusRing}`;
  const label = (
    <span className="col-span-2 min-w-0 wrap-anywhere">
      <span id={`${id}-title`} className="block text-sm font-semibold leading-snug text-[var(--color-text-primary)]">
        {item.title}
      </span>
      {scope && <span id={`${id}-scope`} className="mt-0.5 block text-xs leading-snug text-[var(--color-text-secondary)]">{scope}</span>}
    </span>
  );
  const countLabel = count && (
    <span id={`${id}-count`} className="col-start-1 text-xs tabular-nums text-[var(--color-text-secondary)]">{count}</span>
  );
  const description = [current && `${id}-current`, scope && `${id}-scope`, count && `${id}-count`]
    .filter(Boolean).join(' ');
  const accessibleName = { 'aria-labelledby': `${id}-title`, 'aria-describedby': description || undefined };

  return (
    <li className="border-b border-[var(--color-border-default)] last:border-b-0">
      {current ? (
        <button
          type="button"
          aria-current="true"
          {...accessibleName}
          className={`${rowClass} bg-primary-light`}
          onClick={onClose}
        >
          {label}
          {countLabel}
          <span id={`${id}-current`} className="col-start-2 row-start-2 text-xs font-semibold text-primary-main">Geöffnet</span>
        </button>
      ) : (
        <Link
          to={item.href}
          state={SWITCH_NAVIGATION}
          {...accessibleName}
          className={`${rowClass} hover:bg-white`}
        >
          {label}
          {countLabel}
          <IconChevronRight className="col-start-2 row-start-2 size-4 justify-self-end text-primary-main" />
        </Link>
      )}
    </li>
  );
}

export function CatalogSwitcher({ items, activeKey, open, onToggle, trailing }: CatalogSwitcherProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = items.find(({ catalogKey }) => catalogKey === activeKey);
  const fullTitle = active?.title;
  const shortTitle = CATALOG_COPY[activeKey]?.shortTitle ?? fullTitle;
  const describeFullTitle = fullTitle && (open || shortTitle !== fullTitle);

  const toggle = () => {
    onToggle();
    triggerRef.current?.focus({ preventScroll: true });
  };

  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    toggle();
  }, open, undefined, true);

  return (
    <div
      ref={rootRef}
      data-catalog-switcher=""
      className={open
        ? 'flex min-h-0 flex-1 flex-col bg-[var(--color-surface-subtle)] px-2 pt-2'
        : 'shrink-0 border-b border-[var(--color-border-default)] p-2'}
    >
      <div className="flex shrink-0 items-center gap-1">
        {active && (
          <button
            ref={triggerRef}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-labelledby={open ? `${panelId}-action` : `${panelId}-short-title ${panelId}-action`}
            aria-describedby={describeFullTitle ? `${panelId}-active-title` : undefined}
            onClick={toggle}
            className={`flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded border px-2.5 py-2 text-left hover:bg-primary-light ${focusRing} ${open ? 'border-transparent' : 'border-[var(--color-border-default)]'}`}
          >
            <span className="min-w-0 wrap-anywhere">
              {!open && <span id={`${panelId}-short-title`} className="block text-sm font-bold leading-snug text-[var(--color-text-primary)]">{shortTitle}</span>}
              <span id={`${panelId}-action`} className={open ? 'block text-sm font-semibold text-primary-main' : 'mt-0.5 block text-xs font-semibold text-primary-main'}>Katalog wechseln</span>
            </span>
            <IconChevronDown className={`size-4 shrink-0 text-primary-main ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
        {!open && trailing}
      </div>
      {describeFullTitle && <span id={`${panelId}-active-title`} hidden>{fullTitle}</span>}
      <nav id={panelId} aria-label="Verfügbare Kataloge" hidden={!open} className="min-h-0 overflow-y-auto overscroll-contain py-1">
        {open && (
          <ul className="border-y border-[var(--color-border-default)]">
            {items.map((item) => (
              <CatalogChoice
                key={item.catalogKey}
                id={`${panelId}-${item.catalogKey}`}
                item={item}
                current={item.catalogKey === activeKey}
                onClose={toggle}
              />
            ))}
          </ul>
        )}
      </nav>
    </div>
  );
}
