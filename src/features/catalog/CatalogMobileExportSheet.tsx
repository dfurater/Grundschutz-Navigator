import { useCallback, useId, useState } from 'react';
import type { Control } from '@/domain/models';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { IconDownload } from '@/components/icons';
import { downloadCSV } from '@/features/export/csvExport';
import { exportFullCatalog, exportSelectedControls } from '@/features/catalog/selectionExport';
import { useOverlayScrollbars } from '@/hooks/useOverlayScrollbars';

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
  const headingId = useId();
  const actionsScrollRef = useOverlayScrollbars<HTMLDivElement>();
  const close = useCallback(() => setOpen(false), []);

  const exportSelected = () => {
    exportSelectedControls(allControls, checkedIds);
    close();
    onSelectionExported?.();
  };

  return (
    <>
      {/* Außerhalb des Desktops ein reiner Icon-Schalter wie Auswahl und Filter (GSPP-471);
          das Sheet beschriftet seine Optionen selbst. */}
      <Button
        variant="ghost"
        size="sm"
        className="desktop:hidden min-h-touch min-w-touch"
        onClick={() => setOpen(true)}
        disabled={checkedIds.size === 0 && filteredControls.length === 0}
        aria-label="CSV exportieren"
      >
        <IconDownload className="w-4 h-4" />
      </Button>

      <BottomSheet open={open} onClose={close} labelledBy={headingId}>
        {/* Die Schließaktion steht im Kopf: Das Sheet ist unten verankert und
            schneidet bei wenig Höhe unten ab, der Kopf bleibt sichtbar; die
            Exportaktionen scrollen darunter. */}
        <div className="px-4 py-3 border-b border-[var(--color-border-default)] shrink-0 flex items-center justify-between gap-2">
          <h2 id={headingId} className="type-meta">Exportieren als CSV</h2>
          <Button variant="ghost" size="sm" className="min-h-touch min-w-touch -my-3 -mr-2 text-sm" onClick={close} data-dialog-close>
            Schließen
          </Button>
        </div>
        <div ref={actionsScrollRef} className="min-h-0 overflow-y-auto overscroll-contain">
          <div className="w-full p-4 flex flex-col gap-2">
            {checkedIds.size > 0 && (
              <Button
                variant="secondary"
                className="w-full min-h-touch justify-start"
                onClick={exportSelected}
              >
                <IconDownload className="w-4 h-4 mr-2" />
                Auswahl exportieren ({checkedIds.size})
              </Button>
            )}
            <Button
              variant="secondary"
              className="w-full min-h-touch justify-start"
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
              className="w-full min-h-touch justify-start"
              onClick={() => {
                exportFullCatalog(allControls);
                close();
              }}
            >
              <IconDownload className="w-4 h-4 mr-2" />
              Gesamtkatalog ({allControls.length})
            </Button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
