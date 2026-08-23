import type { Control } from '@/domain/models';
import { Button } from '@/components/Button';
import { IconDownload } from '@/components/icons';
import { downloadCSV } from '@/features/export/csvExport';

interface CatalogMobileSelectionBarProps {
  readonly checkedIds: ReadonlySet<string>;
  readonly allControls: Control[];
  readonly onDone: () => void;
}

export function CatalogMobileSelectionBar({
  checkedIds,
  allControls,
  onDone,
}: CatalogMobileSelectionBarProps) {
  const exportSelected = () => {
    downloadCSV(
      allControls.filter((control) => checkedIds.has(control.id)),
      'grundschutz-auswahl.csv',
    );
    onDone();
  };

  return (
    <div className="fixed bottom-0 pb-safe inset-x-0 z-30 border-t border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-3 py-2.5 flex items-center gap-2 lg:hidden shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      <span className="text-sm text-[var(--color-text-secondary)] flex-1 tabular-nums">
        {checkedIds.size > 0
          ? `${checkedIds.size} ausgewählt`
          : 'Tippen zum Auswählen'}
      </span>
      <Button
        variant="secondary"
        size="sm"
        className="min-h-[44px]"
        disabled={checkedIds.size === 0}
        onClick={exportSelected}
      >
        <IconDownload className="w-4 h-4 mr-1.5" />
        Export ({checkedIds.size})
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="min-h-[44px]"
        onClick={onDone}
      >
        Fertig
      </Button>
    </div>
  );
}
