import { useEffect, useRef, useState } from 'react';
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
  const firstMenuItemRef = useRef<HTMLButtonElement>(null);
  const selectedControls = allControls.filter((control) =>
    checkedIds.has(control.id),
  );

  const exportSelected = () => {
    downloadCSV(selectedControls, 'grundschutz-auswahl.csv');
    setOpen(false);
  };
  const exportSection = () => {
    downloadCSV(filteredControls, sectionFilename);
    setOpen(false);
  };
  const exportAll = () => {
    downloadCSV(allControls, 'grundschutz-gesamtkatalog.csv');
    setOpen(false);
  };

  useGlobalEventListener('document', 'mousedown', (event) => {
    if (!menuContainerRef.current?.contains(event.target as Node)) {
      setOpen(false);
    }
  }, open);

  useEffect(() => {
    if (open) firstMenuItemRef.current?.focus();
  }, [open]);

  return (
    <div className="hidden lg:flex relative" ref={menuContainerRef}>
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
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="px-2 py-1.5 text-sm font-medium border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] hover:bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)] rounded-r-md transition-colors border-l-0"
        aria-label="Weitere Exportoptionen"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <IconChevronDown className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-56 bg-[var(--color-surface-raised)] border border-[var(--color-border-default)] rounded-lg shadow-[var(--shadow-overlay)] z-50 py-1"
          role="menu"
          tabIndex={-1}
          aria-label="Exportoptionen"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          {checkedIds.size > 0 && (
            <button
              ref={firstMenuItemRef}
              type="button"
              role="menuitem"
              onClick={exportSelected}
              className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-surface-subtle)] flex items-center gap-2"
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
                ref={checkedIds.size === 0 ? firstMenuItemRef : undefined}
                type="button"
                role="menuitem"
                onClick={exportSection}
                className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-surface-subtle)] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:text-[var(--color-text-muted)]"
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
            ref={
              checkedIds.size === 0 &&
              filteredControls.length >= allControls.length
                ? firstMenuItemRef
                : undefined
            }
            type="button"
            role="menuitem"
            onClick={exportAll}
            className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--color-surface-subtle)] flex items-center gap-2"
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
