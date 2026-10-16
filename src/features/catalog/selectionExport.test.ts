import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import { downloadCSV } from '@/features/export/csvExport';
import { exportFullCatalog, exportSelectedControls } from '@/features/catalog/selectionExport';

vi.mock('@/features/export/csvExport', () => ({ downloadCSV: vi.fn() }));

const controls = [{ id: 'first' }, { id: 'second' }, { id: 'third' }] as Control[];

beforeEach(() => vi.mocked(downloadCSV).mockReset());

describe('selectionExport', () => {
  it('exports checked controls in catalog order and ignores IDs absent from the catalog', () => {
    exportSelectedControls(controls, new Set(['third', 'missing', 'first']));
    expect(downloadCSV).toHaveBeenCalledExactlyOnceWith(
      [controls[0], controls[2]], 'grundschutz-auswahl.csv',
    );
  });

  it('passes an empty selection to the CSV exporter', () => {
    exportSelectedControls(controls, new Set());
    expect(downloadCSV).toHaveBeenCalledExactlyOnceWith([], 'grundschutz-auswahl.csv');
  });

  it('forwards the complete catalog with its filename', () => {
    exportFullCatalog(controls);
    expect(downloadCSV).toHaveBeenCalledExactlyOnceWith(controls, 'grundschutz-gesamtkatalog.csv');
  });
});
