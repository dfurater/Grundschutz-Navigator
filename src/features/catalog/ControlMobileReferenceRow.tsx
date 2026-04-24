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
  control: Control;
  controlsById: Map<string, Control>;
  selectMode?: boolean;
  checked?: boolean;
  onSelect: (control: Control) => void;
  onCheckedChange?: (control: Control, checked: boolean) => void;
}

export function ControlMobileReferenceRow({
  control,
  controlsById,
  selectMode = false,
  checked = false,
  onSelect,
  onCheckedChange,
}: ControlMobileReferenceRowProps) {
  const depth = getControlHierarchyDepth(control, controlsById);

  const handleClick = () => {
    if (selectMode) {
      onCheckedChange?.(control, !checked);
    } else {
      onSelect(control);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={selectMode ? checked : undefined}
      className={`w-full flex items-center gap-2 px-3 py-2 transition-colors cursor-pointer active:bg-[var(--color-surface-subtle)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)] ${
        selectMode && checked
          ? 'bg-[var(--color-accent-soft)]'
          : 'bg-[var(--color-surface-base)] hover:bg-[var(--color-surface-subtle)]'
      }`}
    >
      {selectMode && (
        <div
          className={`w-4 h-4 shrink-0 rounded border-[1.5px] flex items-center justify-center transition-colors ${
            checked
              ? 'bg-[var(--color-primary-main)] border-[var(--color-primary-main)]'
              : 'border-[var(--color-border-strong)] bg-[var(--color-surface-base)]'
          }`}
        >
          {checked && <IconCheck className="w-2.5 h-2.5 text-white" />}
        </div>
      )}
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
      {!selectMode && <IconChevronRight className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />}
    </button>
  );
}
