import { useContext } from 'react';
import type { Control } from '@/domain/models';
import { Button } from '@/components/Button';
import { IconDownload } from '@/components/icons';
import { downloadCSV } from '@/features/export/csvExport';
import { MobileNavigationContext } from '@/state/MobileNavigationContext';

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
  // Bei offener mobiler Navigation tritt die feste Leiste zurück: Sie läge
  // sonst über der Schublade, und ein festes Element am unteren Rand lässt
  // Safari seine Leiste füllen. Die Auswahl bleibt beim Aufrufer erhalten.
  const mobileNavigationOpen = useContext(MobileNavigationContext);
  const exportSelected = () => {
    downloadCSV(
      allControls.filter((control) => checkedIds.has(control.id)),
      'grundschutz-auswahl.csv',
    );
    onDone();
  };

  if (mobileNavigationOpen) return null;

  const count = checkedIds.size;

  // Auswahl-Blau (GSPP-471): Blau steht für Auswahl, daher tragen nur Icon und
  // Zähler des Export-Buttons die Akzentfarbe. Die Zahl steht genau einmal sichtbar.
  return (
    <div className="fixed bottom-0 pb-safe inset-x-0 z-30 border-t border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-3 py-2.5 flex items-center justify-between gap-2 lg:hidden shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
      <Button
        variant="ghost"
        size="sm"
        className="min-h-[44px]"
        onClick={onDone}
      >
        Fertig
      </Button>
      <output className="sr-only" aria-live="polite">
        {count} ausgewählt
      </output>
      <Button
        variant="secondary"
        size="sm"
        className="min-h-[44px]"
        disabled={count === 0}
        onClick={exportSelected}
        aria-label={`Auswahl als CSV exportieren, ${count} ausgewählt`}
      >
        <IconDownload className="w-4 h-4 text-[var(--color-accent-default)]" />
        Export
        <span
          className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded bg-[var(--color-accent-soft)] text-[var(--color-accent-default)] text-xs font-semibold tabular-nums"
          aria-hidden="true"
        >
          {count}
        </span>
      </Button>
    </div>
  );
}
