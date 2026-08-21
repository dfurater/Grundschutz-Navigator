import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { buildCatalogUrl } from '@/app/routes';
import { SUPPORTED_CATALOGS } from '@/domain/sourceRegistry';
import type { CatalogKey } from '@/domain/sourceRegistry';
import { useCatalog } from '@/hooks/useCatalog';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import {
  IconCheck,
  IconChevronDown,
  IconLayers,
  IconLink,
  IconShield,
  IconWifi,
} from './icons';

const CATALOG_ICONS: Partial<Record<CatalogKey, typeof IconShield>> = {
  gspp: IconShield,
  lieferkette: IconLink,
  wlan: IconWifi,
};

const CATALOG_DESCRIPTIONS: Partial<Record<CatalogKey, string>> = {
  gspp: 'BSI Kernel G0 + Grundschutz++-Methodik',
  lieferkette: 'Kontrollen für Lieferketten- und Drittparteirisiken',
  wlan: 'WLAN-Sicherheit, Taxonomie und externe Referenzen',
};

export function CatalogSwitcher() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const { activeCatalogKey } = useCatalog();

  useGlobalEventListener('document', 'mousedown', (event) => {
    if (!containerRef.current?.contains(event.target as Node)) {
      setOpen(false);
    }
  }, open);

  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  if (SUPPORTED_CATALOGS.length === 0) return null;

  const activeEntry =
    SUPPORTED_CATALOGS.find((entry) => entry.catalogKey === activeCatalogKey) ??
    SUPPORTED_CATALOGS[0];
  const ActiveIcon = CATALOG_ICONS[activeEntry.catalogKey] ?? IconLayers;

  const handleSelect = (catalogKey: CatalogKey) => {
    navigate(buildCatalogUrl(catalogKey));
    setOpen(false);
  };

  return (
    <div className="justify-self-end relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 rounded-md border border-[var(--header-surface-hover)] bg-[var(--header-surface)] px-2 py-1.5 text-[var(--header-text)] transition-colors hover:bg-[var(--header-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--header-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--header-bg)] sm:px-3"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Katalog wechseln"
      >
        <ActiveIcon className="h-4 w-4 shrink-0 text-[var(--header-brand-accent)]" />
        <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:inline">
          {activeEntry.title}
        </span>
        <IconChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--header-text-muted)]" />
      </button>

      {open && (
        <div
          role="menu"
          tabIndex={-1}
          aria-label="Katalog wechseln"
          className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-raised)] p-1.5 shadow-[var(--shadow-overlay)]"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Katalog wechseln
          </div>
          {SUPPORTED_CATALOGS.map((entry, index) => {
            const isActive = entry.catalogKey === activeEntry.catalogKey;
            const Icon = CATALOG_ICONS[entry.catalogKey] ?? IconLayers;
            const description = CATALOG_DESCRIPTIONS[entry.catalogKey];

            return (
              <button
                key={entry.catalogKey}
                ref={index === 0 ? firstItemRef : undefined}
                type="button"
                role="menuitem"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => handleSelect(entry.catalogKey)}
                className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-soft)]">
                  <Icon className="h-[18px] w-[18px] text-[var(--color-accent-default)]" />
                </span>
                <span className="flex min-w-0 flex-grow flex-col gap-0.5">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {entry.title}
                  </span>
                  {description && (
                    <span className="text-xs text-[var(--color-text-muted)]">{description}</span>
                  )}
                </span>
                {isActive && (
                  <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent-default)]" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
