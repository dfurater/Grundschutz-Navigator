import { ROOT_TYPE_LABELS } from '@/domain/workspaceStations';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { OriginMark, formatCount } from '@/features/workspace/profile/ProfileMarks';
import type { ImportTargetOption } from '@/features/workspace/profile/useImportTargets';

function OptionRow({ option, name, checked, disabled, onSelect }: Readonly<{
  option: ImportTargetOption;
  name: string;
  checked: boolean;
  disabled: boolean;
  onSelect: (option: ImportTargetOption) => void;
}>) {
  return (
    <li>
      <label
        data-target={option.key}
        className={`flex min-h-touch flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 ${disabled ? 'cursor-not-allowed text-[var(--color-text-muted)]' : 'cursor-pointer hover:bg-[var(--color-surface-subtle)]'} ${checked ? 'bg-[var(--color-accent-soft)]' : ''}`}
      >
        <input
          type="radio"
          name={name}
          className={`h-4 w-4 accent-[var(--color-primary-main)] ${FOCUS_RING}`}
          checked={checked}
          disabled={disabled}
          onChange={() => onSelect(option)}
        />
        <span className="flex min-w-0 flex-1 basis-48 flex-col">
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{option.title || ROOT_TYPE_LABELS[option.rootType]}</span>
          <span className="font-mono text-xs text-[var(--color-text-secondary)]">{option.artifactKey ?? 'Im Verbund'}</span>
        </span>
        {option.origin === 'class-1' && option.verification !== 'valid' && <OriginMark origin="class-1" verification={option.verification} />}
        <span className="text-xs text-[var(--color-text-secondary)]">
          {ROOT_TYPE_LABELS[option.rootType]} · OSCAL <span className="font-mono">{option.oscalVersion}</span>
        </span>
        {option.count !== undefined && (
          <span className="min-w-28 text-right text-xs tabular-nums text-[var(--color-text-secondary)]">{formatCount(option.count)} Anforderungen</span>
        )}
      </label>
    </li>
  );
}

/**
 * Importziele in zwei Gruppen nach Herkunft. `requiredVersion` graut jedes
 * Ziel mit anderer `oscal-version` aus: Alle Importe eines Profils tragen
 * dieselbe Version.
 */
export function ImportTargetPicker({ name, options, selected, requiredVersion, onSelect }: Readonly<{
  name: string;
  options: readonly ImportTargetOption[];
  selected?: string;
  requiredVersion?: string;
  onSelect: (option: ImportTargetOption) => void;
}>) {
  const groups = (['class-1', 'local'] as const).map((origin) => ({ origin, entries: options.filter((option) => option.origin === origin) }));
  return (
    <div className="space-y-3">
      {groups.filter((group) => group.entries.length > 0).map((group) => (
        <div key={group.origin} role="radiogroup" aria-label={group.origin === 'class-1' ? 'BSI-Kataloge' : 'Eigene Daten'} className="space-y-2">
          {group.origin === 'class-1' && group.entries.some((option) => option.verification !== 'valid')
            ? <p className="text-xs font-medium text-[var(--color-text-secondary)]">BSI-Kataloge</p>
            : <OriginMark origin={group.origin} verification="valid" />}
          <ul className="divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-md border border-[var(--color-border-default)]">
            {group.entries.map((option) => (
              <OptionRow
                key={option.key}
                option={option}
                name={name}
                checked={selected === option.key}
                disabled={requiredVersion !== undefined && option.oscalVersion !== requiredVersion}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
