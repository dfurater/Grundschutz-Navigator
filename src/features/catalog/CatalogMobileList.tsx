import type { Control } from '@/domain/models';
import { useOverlayScrollbars } from '@/hooks/useOverlayScrollbars';
import { CatalogMobileSelectionBar } from './CatalogMobileSelectionBar';
import { ControlMobileReferenceRow } from './ControlMobileReferenceRow';

interface CatalogMobileListProps {
  readonly controls: Control[];
  readonly controlsById: Map<string, Control>;
  readonly allControls: Control[];
  /** Ab `md` scrollt die Liste selbst, darunter das Dokument. */
  readonly hasOwnScrollArea: boolean;
  readonly selectMode: boolean;
  readonly checkedIds: ReadonlySet<string>;
  readonly onSelect: (control: Control) => void;
  readonly onCheckedChange: (control: Control, checked: boolean) => void;
  readonly onSelectionDone: () => void;
}

/** Trefferliste des Katalogs unterhalb `lg` mit optionalem Auswahlmodus. */
export function CatalogMobileList({
  controls,
  controlsById,
  allControls,
  hasOwnScrollArea,
  selectMode,
  checkedIds,
  onSelect,
  onCheckedChange,
  onSelectionDone,
}: CatalogMobileListProps) {
  const scrollRef = useOverlayScrollbars<HTMLDivElement>(hasOwnScrollArea);
  return (
    <div className="lg:hidden flex-1 min-w-0 flex flex-col md:overflow-hidden">
      <div ref={scrollRef} className={`flex-1 md:overflow-y-auto divide-y divide-[var(--color-border-subtle)] ${selectMode ? 'pb-[calc(7rem+env(safe-area-inset-bottom,0px))]' : 'pb-safe'}`}>
        {controls.map((control) => (
          <ControlMobileReferenceRow
            key={control.id}
            control={control}
            controlsById={controlsById}
            selectMode={selectMode}
            checked={checkedIds.has(control.id)}
            onSelect={onSelect}
            onCheckedChange={onCheckedChange}
          />
        ))}
        {controls.length === 0 && (
          <p className="text-sm text-[var(--color-text-secondary)] text-center py-8">
            Keine Kontrollen gefunden
          </p>
        )}
      </div>
      {selectMode && (
        <CatalogMobileSelectionBar
          checkedIds={checkedIds}
          allControls={allControls}
          onDone={onSelectionDone}
        />
      )}
    </div>
  );
}
