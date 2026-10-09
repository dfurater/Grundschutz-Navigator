import { useCallback, useId, useRef, useState } from 'react';
import type { Control } from '@/domain/models';
import { BackdropTint } from '@/components/BackdropTint';
import { Button } from '@/components/Button';
import { IconDownload } from '@/components/icons';
import { ModalPortal } from '@/components/ModalPortal';
import { downloadCSV } from '@/features/export/csvExport';
import { useGlobalEventListener } from '@/hooks/useGlobalEventListener';
import { useModalDialog } from '@/hooks/useModalDialog';
import { useScrollLock } from '@/hooks/useScrollLock';

interface CatalogMobileExportSheetProps {
  readonly checkedIds: ReadonlySet<string>;
  readonly filteredControls: Control[];
  readonly allControls: Control[];
  readonly sectionFilename: string;
  readonly onSelectionExported?: () => void;
}

export function CatalogMobileExportSheet({
  checkedIds,
  filteredControls,
  allControls,
  sectionFilename,
  onSelectionExported,
}: CatalogMobileExportSheetProps) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const close = useCallback(() => setOpen(false), []);

  useModalDialog(sheetRef, open);
  useScrollLock(open);
  useGlobalEventListener('document', 'keydown', (event) => {
    if (event.key === 'Escape') close();
  }, open);

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
      {/* Unter lg ein reiner Icon-Schalter wie Auswahl und Filter (GSPP-471);
          das Sheet beschriftet seine Optionen selbst. */}
      <Button
        variant="ghost"
        size="sm"
        className="lg:hidden min-h-[44px] min-w-[44px]"
        onClick={() => setOpen(true)}
        disabled={checkedIds.size === 0 && filteredControls.length === 0}
        aria-label="CSV exportieren"
      >
        <IconDownload className="w-4 h-4" />
      </Button>

      {open && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-40 lg:hidden"
            onClick={close}
            aria-hidden="true"
          >
            <BackdropTint className="bg-black/30" />
          </div>
          <dialog
            open
            ref={sheetRef}
            aria-modal="true"
            aria-labelledby={headingId}
            className="m-0 p-0 border-0 w-full max-w-none text-[inherit] fixed inset-x-0 bottom-0 z-50 bg-[var(--color-surface-raised)] rounded-t-2xl shadow-xl max-h-[80dvh] flex flex-col overflow-hidden lg:hidden animate-slide-up"
          >
            <div
              className="flex justify-center items-center min-h-[44px] shrink-0 select-none"
              aria-hidden="true"
            >
              <div className="w-10 h-1 bg-[var(--color-border-strong)] rounded-full" />
            </div>
            <div className="px-4 py-3 border-b border-[var(--color-border-default)] shrink-0">
              <h2 id={headingId} className="type-meta">Exportieren als CSV</h2>
            </div>
            <div className="p-4 flex flex-col gap-2 min-h-0 overflow-y-auto overscroll-contain">
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
            <div className="px-4 py-3 border-t border-[var(--color-border-default)] shrink-0">
              <Button
                variant="secondary"
                className="w-full min-h-[44px]"
                onClick={close}
              >
                Schließen
              </Button>
            </div>
          </dialog>
        </ModalPortal>
      )}
    </>
  );
}
