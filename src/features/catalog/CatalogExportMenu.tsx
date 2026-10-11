import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Control } from '@/domain/models';
import { Button } from '@/components/Button';
import { IconChevronDown, IconDownload } from '@/components/icons';
import { downloadCSV } from '@/features/export/csvExport';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';

interface CatalogExportMenuProps {
  readonly checkedIds: ReadonlySet<string>;
  readonly filteredControls: Control[];
  readonly allControls: Control[];
  readonly sectionFilename: string;
}

export function CatalogExportMenu({
  checkedIds,
  filteredControls,
  allControls,
  sectionFilename,
}: CatalogExportMenuProps) {
  const [open, setOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const enabledItems = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      close();
      return;
    }
    const items = enabledItems();
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = current + 1; break;
      case 'ArrowUp': next = current < 0 ? items.length - 1 : current - 1; break;
      case 'Home': next = 0; break;
      case 'End': next = items.length - 1; break;
      default: return;
    }
    event.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  };
  const selectedControls = allControls.filter((control) =>
    checkedIds.has(control.id),
  );

  const exportSelected = () => {
    downloadCSV(selectedControls, 'grundschutz-auswahl.csv');
    close();
  };
  const exportSection = () => {
    downloadCSV(filteredControls, sectionFilename);
    close();
  };
  const exportAll = () => {
    downloadCSV(allControls, 'grundschutz-gesamtkatalog.csv');
    close();
  };

  useGlobalEventListener('document', 'mousedown', (event) => {
    if (!menuContainerRef.current?.contains(event.target as Node)) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]):not([disabled]), [contenteditable]:not([contenteditable="false"])')) {
        // Der native Mousedown auf statischen Flächen würde den Rückkehrfokus löschen.
        event.preventDefault();
      }
      close();
    }
  }, open);

  useEffect(() => {
    const menu = menuRef.current;
    if (open && (!menu?.contains(document.activeElement) || document.activeElement?.matches(':disabled'))) {
      menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
  }, [open, checkedIds.size, filteredControls.length, allControls.length]);

  // Kein CSS-Breakpoint-Gate mehr: Das Mount-Gate liegt beim Aufrufer
  // (isDesktop), damit auf Mobile kein unsichtbar gemounteter Knoten
  // übrig bleibt (GSPP-268).
  return (
    <div className="flex relative" ref={menuContainerRef} onBlur={(event) => {
      if (open && event.relatedTarget && !menuContainerRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
      <Button
        variant="secondary"
        size="sm"
        onClick={checkedIds.size > 0 ? exportSelected : exportSection}
        disabled={checkedIds.size === 0 && filteredControls.length === 0}
        className="rounded-r-none border-r border-[var(--color-border-strong)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <IconDownload className="w-4 h-4 mr-1.5" />
        {checkedIds.size > 0 ? `Export (${checkedIds.size})` : 'CSV Export'}
      </Button>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="px-2 py-1.5 text-sm font-medium border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)] rounded-r-md transition-colors border-l-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        aria-label="Weitere Exportoptionen"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      >
        <IconChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-56 bg-[var(--color-surface-raised)] border border-[var(--color-border-default)] rounded-lg shadow-[var(--shadow-overlay)] z-50 py-1"
          ref={menuRef}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label="Exportoptionen"
          onKeyDown={handleMenuKeyDown}
        >
          {checkedIds.size > 0 && (
            <button
              type="button"
              role="menuitem"
            tabIndex={-1}
              onClick={exportSelected}
              className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)] flex items-center gap-2"
            >
              <IconDownload className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
              <span>
                Auswahl exportieren{' '}
                <span className="text-[var(--color-text-secondary)]">
                  ({checkedIds.size})
                </span>
              </span>
            </button>
          )}
          {filteredControls.length < allControls.length && (
            <>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={exportSection}
                className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:text-[var(--color-text-muted)]"
                disabled={filteredControls.length === 0}
              >
                <IconDownload className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                <span>
                  Aktuelle Ansicht{' '}
                  <span className="text-[var(--color-text-secondary)]">
                    ({filteredControls.length})
                  </span>
                </span>
              </button>
              <div className="border-t border-[var(--color-border-subtle)] my-1" />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={exportAll}
            className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)] flex items-center gap-2"
          >
            <IconDownload className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
            <span>
              Gesamtkatalog{' '}
              <span className="text-[var(--color-text-secondary)]">
                ({allControls.length})
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
