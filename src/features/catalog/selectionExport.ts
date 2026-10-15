import type { Control } from '@/domain/models';
import { downloadCSV } from '@/features/export/csvExport';

export const SELECTION_CSV_FILENAME = 'grundschutz-auswahl.csv';
export const FULL_CATALOG_CSV_FILENAME = 'grundschutz-gesamtkatalog.csv';

export function exportSelectedControls(allControls: Control[], checkedIds: ReadonlySet<string>) {
  downloadCSV(
    allControls.filter((control) => checkedIds.has(control.id)),
    SELECTION_CSV_FILENAME,
  );
}

export function exportFullCatalog(allControls: Control[]) {
  downloadCSV(allControls, FULL_CATALOG_CSV_FILENAME);
}
