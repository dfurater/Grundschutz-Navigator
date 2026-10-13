import { memo } from 'react';
import type { Control } from '@/domain/models';
import { getControlHierarchyDepth } from '@/domain/controlRelationships';
import { ModalverbBadge, SecurityLevelBadge } from '@/components/StatusMeta';
import { IconCheck, IconChevronRight } from '@/components/icons';

const EFFORT_TEXT_COLORS: Record<string, string> = {
  '1': 'var(--color-effort-level-1-text)',
  '2': 'var(--color-effort-level-2-text)',
  '3': 'var(--color-effort-level-3-text)',
  '4': 'var(--color-effort-level-4-text)',
  '5': 'var(--color-effort-level-5-text)',
};

interface ControlMobileReferenceRowProps {
  readonly control: Control;
  readonly controlsById: Map<string, Control>;
  readonly selectMode?: boolean;
  readonly checked?: boolean;
  readonly onSelect: (control: Control) => void;
  readonly onCheckedChange?: (control: Control, checked: boolean) => void;
}

export const ControlMobileReferenceRow = memo(function ControlMobileReferenceRow({
  control,
  controlsById,
  selectMode = false,
  checked = false,
  onSelect,
  onCheckedChange,
}: ControlMobileReferenceRowProps) {
  const depth = getControlHierarchyDepth(control, controlsById);
  const showCheckbox = selectMode && onCheckedChange !== undefined;

  // GSPP-517: Die Zeile navigiert immer; nur die echte Checkbox schaltet die
  // Auswahl. Beide sind Geschwister: Die Checkbox ist ein natives Label, der
  // Zeileninhalt ein nativer Button — kein umgedeuteter Container, daher auch
  // kein stopPropagation nötig (Sonar S6848/S6847/S1082).
  const handleSelect = () => {
    onSelect(control);
  };

  const handleCheckedChange = (next: boolean) => {
    onCheckedChange?.(control, next);
  };

  return (
    <div
      className={`catalog-mobile-reference-row w-full flex items-stretch gap-0 transition-colors active:bg-[var(--color-surface-subtle)] ${
        selectMode && checked
          ? 'bg-[var(--color-accent-soft)]'
          : 'bg-[var(--color-surface-base)] hover:bg-[var(--color-surface-subtle)]'
      }`}
    >
      {showCheckbox && (
        <label className="relative flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => handleCheckedChange(event.target.checked)}
            aria-label={`${control.id} auswählen`}
            className="peer sr-only"
          />
          <div
            aria-hidden="true"
            className="w-4 h-4 rounded border-[1.5px] transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-focus-ring)] peer-focus-visible:ring-offset-1 border-[var(--color-border-strong)] bg-[var(--color-surface-base)] peer-checked:bg-[var(--color-primary-main)] peer-checked:border-[var(--color-primary-main)]"
          />
          <IconCheck className="absolute w-2.5 h-2.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" />
        </label>
      )}
      <button
        type="button"
        data-control-row={control.id}
        onClick={handleSelect}
        className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 pl-2 pr-3 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]"
      >
        <div className="flex-1 min-w-0">
          {/* Zeile 1: ID */}
          <span className="catalog-reference-text text-primary-main">{control.id}</span>
          {/* Zeile 2: Titel — nur Titelzeile erhält Tiefeneinzug */}
          <div
            className="flex min-w-0 items-baseline gap-2 mt-0.5"
            style={depth > 0 ? { paddingInlineStart: `${Math.min(depth, 3) * 12}px` } : undefined}
          >
            {depth > 0 && (
              <span className="catalog-hierarchy-marker" aria-hidden="true">↳</span>
            )}
            <p className="catalog-title-text min-w-0 truncate">{control.title}</p>
          </div>
          {/* Zeile 3: Badges — feste Slots für stabile Positionen beim Scrollen */}
          <div className="mt-1 flex items-center gap-1">
            {/* Slot Verbindlichkeit — feste Breite */}
            <div className="w-16 shrink-0 flex items-center">
              <ModalverbBadge value={control.modalverb} className="w-full" />
            </div>
            {/* Slot Aufwand — feste Breite */}
            <div className="w-6 shrink-0 flex items-center justify-center">
              {control.effortLevel != null && (
                <span
                  className={`inline-flex w-full items-center justify-center rounded border px-1 py-0.5 text-xs font-medium leading-4 tabular-nums ${
                    control.effortLevel === '0'
                      ? 'border-[var(--color-border-default)] bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]'
                      : 'border-[var(--color-status-aufwand-border)] bg-[var(--color-status-aufwand-bg)]'
                  }`}
                  style={
                    control.effortLevel !== '0'
                      ? { color: EFFORT_TEXT_COLORS[control.effortLevel] }
                      : undefined
                  }
                >
                  {control.effortLevel}
                </span>
              )}
            </div>
            {/* Slot Niveau — nur wenn vorhanden */}
            <SecurityLevelBadge value={control.securityLevel} />
          </div>
        </div>
        <IconChevronRight className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
      </button>
    </div>
  );
});
