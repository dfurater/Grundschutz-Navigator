import { useCallback, useRef, useState } from 'react';
import type { Control } from '@/domain/models';
import { Button } from '@/components/Button';
import { IconDownload } from '@/components/icons';
import { downloadCSV } from '@/features/export/csvExport';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useScrollLock } from '@/hooks/useScrollLock';

interface CatalogMobileExportSheetProps {
  checkedIds: ReadonlySet<string>;
  filteredControls: Control[];
  allControls: Control[];
  sectionFilename: string;
  onSelectionExported?: () => void;
}

export function CatalogMobileExportSheet({
  checkedIds,
  filteredControls,
  allControls,
  sectionFilename,
  onSelectionExported,
}: CatalogMobileExportSheetProps) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useFocusTrap(sheetRef, open);
  useScrollLock(open);

  const exportSelected = () => {
    downloadCSV(
      allControls.filter((control) => checkedIds.has(control.id)),
      'grundschutz-auswahl.csv',
    );
    close();
    onSelectionExported?.();
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="lg:hidden min-h-[44px]"
        onClick={() => setOpen(true)}
        disabled={checkedIds.size === 0 && filteredControls.length === 0}
      >
        <IconDownload className="w-4 h-4 mr-1.5" />
        CSV
      </Button>

      {open && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40 lg:hidden"
            onClick={close}
            aria-hidden="true"
          />
          <div
            ref={sheetRef}
            className="fixed inset-x-0 bottom-0 z-50 bg-[var(--color-surface-raised)] rounded-t-2xl shadow-xl flex flex-col overflow-hidden lg:hidden animate-slide-up"
            onKeyDown={(event) => {
              if (event.key === 'Escape') close();
            }}
          >
            <div
              className="flex justify-center items-center min-h-[44px] shrink-0 select-none"
              aria-hidden="true"
            >
              <div className="w-10 h-1 bg-[var(--color-border-strong)] rounded-full" />
            </div>
            <div className="px-4 py-3 border-b border-[var(--color-border-default)] shrink-0">
              <h3 className="type-meta">Exportieren als CSV</h3>
            </div>
            <div className="p-4 flex flex-col gap-2">
              {checkedIds.size > 0 && (
                <Button
                  variant="secondary"
                  className="w-full min-h-[44px] justify-start"
                  onClick={exportSelected}
                >
                  <IconDownload className="w-4 h-4 mr-2" />
                  Auswahl exportieren ({checkedIds.size})
                </Button>
              )}
              <Button
                variant="secondary"
                className="w-full min-h-[44px] justify-start"
                disabled={filteredControls.length === 0}
                onClick={() => {
                  downloadCSV(filteredControls, sectionFilename);
                  close();
                }}
              >
                <IconDownload className="w-4 h-4 mr-2" />
                Aktuelle Ansicht ({filteredControls.length})
              </Button>
              <Button
                variant="ghost"
                className="w-full min-h-[44px] justify-start"
                onClick={() => {
                  downloadCSV(allControls, 'grundschutz-gesamtkatalog.csv');
                  close();
                }}
              >
                <IconDownload className="w-4 h-4 mr-2" />
                Gesamtkatalog ({allControls.length})
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
