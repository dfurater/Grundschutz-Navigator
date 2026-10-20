import { useId, useState } from 'react';
import { ModalverbBadge, SecurityLevelBadge } from '@/components/StatusMeta';
import type { Control } from '@/domain/models';
import type { TargetControlIndex, TargetGroup } from '@/domain/profileTargetControls';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { DESKTOP_QUERY } from '@/hooks/breakpointQueries';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { EffortScale, TableCheckbox, formatCount } from '@/features/workspace/profile/ProfileMarks';

const SELECT = `min-h-touch max-w-full truncate rounded-md bg-transparent py-1 pr-1 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)] desktop:min-h-0 ${FOCUS_RING}`;
const ID_MARK = 'shrink-0 rounded bg-[var(--color-surface-subtle)] px-1.5 py-0.5 font-mono text-xs font-medium text-[var(--color-text-secondary)]';

function countSelected(ids: readonly string[], selected: ReadonlySet<string>): number {
  return ids.reduce((sum, id) => sum + (selected.has(id) ? 1 : 0), 0);
}

function Row({ control, details, checked, onToggle, desktop }: Readonly<{
  control: TargetGroup['controls'][number];
  details?: Control;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  desktop: boolean;
}>) {
  const label = `${control.id} auswählen`;
  const indent = control.depth > 0 ? 'pl-4' : '';
  if (!desktop) {
    return (
      <li className="flex gap-2 px-2 py-2">
        <TableCheckbox checked={checked} label={label} onChange={onToggle} />
        <div className={`min-w-0 flex-1 space-y-1 py-2.5 ${indent}`}>
          <p className="text-sm text-[var(--color-text-primary)]"><span className={`${ID_MARK} mr-2`}>{control.id}</span>{control.title}</p>
          {details && (
            <p className="flex flex-wrap items-center gap-1.5">
              <ModalverbBadge value={details.modalverb} />
              <SecurityLevelBadge value={details.securityLevel} />
              <EffortScale value={details.effortLevel} />
            </p>
          )}
        </div>
      </li>
    );
  }
  return (
    <tr className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-subtle)]">
      <td className="w-10 px-3 py-2"><TableCheckbox checked={checked} label={label} onChange={onToggle} /></td>
      <td className={`whitespace-nowrap px-3 py-2 font-mono text-xs text-[var(--color-text-primary)] ${indent}`}>{control.id}</td>
      <td className="px-3 py-2 text-sm text-[var(--color-text-primary)]">{control.title}</td>
      <td className="px-3 py-2"><ModalverbBadge value={details?.modalverb} /></td>
      <td className="px-3 py-2"><SecurityLevelBadge value={details?.securityLevel} /></td>
      <td className="px-3 py-2"><EffortScale value={details?.effortLevel} /></td>
    </tr>
  );
}

/**
 * Auswahl einzelner Anforderungen eines Importziels (Mockup 2): Praktik und
 * Gruppe als Kontextwahl, je Anforderung ein Häkchen. Ein Häkchen ändert
 * `with-ids` direkt; Katalogtext wird nie in das Profil kopiert.
 */
export function RequirementSelection({ index, selected, details, onChange }: Readonly<{
  index: TargetControlIndex;
  selected: ReadonlySet<string>;
  details?: ReadonlyMap<string, Control>;
  onChange: (ids: readonly string[], checked: boolean) => void;
}>) {
  const practiceId = useId();
  const groupId = useId();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [groupIndex, setGroupIndex] = useState(0);
  const practice = index.practices[Math.min(practiceIndex, index.practices.length - 1)];
  const group = practice?.groups[Math.min(groupIndex, practice.groups.length - 1)];
  if (!practice || !group) return <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">Das Importziel enthält keine Anforderung.</p>;

  const practiceIds = practice.groups.flatMap((entry) => entry.controls.map((control) => control.id));
  const groupIds = group.controls.map((control) => control.id);
  const groupSelected = countSelected(groupIds, selected);
  const rows = group.controls.map((control) => (
    <Row
      key={control.id}
      control={control}
      details={details?.get(control.id)}
      checked={selected.has(control.id)}
      onToggle={(checked) => onChange([control.id], checked)}
      desktop={desktop}
    />
  ));

  return (
    <section aria-label="Anforderungen des Importziels" className="rounded-md border border-[var(--color-border-default)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[var(--color-border-subtle)] px-3 py-2 desktop:min-h-panel-head">
        <label htmlFor={practiceId} className="flex min-w-0 items-center gap-2">
          <span className="sr-only">Praktik</span>
          {practice.id && <span className={ID_MARK}>{practice.id}</span>}
          <select id={practiceId} className={SELECT} value={practiceIndex} onChange={(event) => { setPracticeIndex(Number(event.target.value)); setGroupIndex(0); }}>
            {index.practices.map((entry, position) => {
              const ids = entry.groups.flatMap((item) => item.controls.map((control) => control.id));
              return <option key={entry.id ?? position} value={position}>{entry.title || entry.id || '—'} {countSelected(ids, selected)}/{ids.length}</option>;
            })}
          </select>
        </label>
        <label htmlFor={groupId} className="flex min-w-0 items-center gap-2">
          <span className="sr-only">Gruppe</span>
          {group.id && <span className={ID_MARK}>{group.id}</span>}
          <select id={groupId} className={SELECT} value={groupIndex} onChange={(event) => setGroupIndex(Number(event.target.value))}>
            {practice.groups.map((entry, position) => (
              <option key={entry.id ?? position} value={position}>{entry.title || entry.id || '—'} {countSelected(entry.controls.map((control) => control.id), selected)}/{entry.controls.length}</option>
            ))}
          </select>
        </label>
        <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">{formatCount(groupIds.length)} Anforderungen</span>
        <span aria-live="polite" className="ml-auto rounded bg-[var(--color-accent-soft)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--color-accent-default)]">
          {formatCount(countSelected(practiceIds, selected))} ausgewählt
        </span>
      </div>
      {desktop ? (
        <table className="w-full border-collapse text-left">
          <thead className="bg-[var(--color-surface-subtle)] text-xs font-medium text-[var(--color-text-secondary)]">
            <tr>
              <th scope="col" className="w-10 px-3 py-2">
                <TableCheckbox
                  checked={groupSelected === groupIds.length}
                  indeterminate={groupSelected > 0 && groupSelected < groupIds.length}
                  label="Alle Anforderungen der Gruppe auswählen"
                  onChange={(checked) => onChange(groupIds, checked)}
                />
              </th>
              <th scope="col" className="px-3 py-2">ID</th>
              <th scope="col" className="px-3 py-2">Titel</th>
              <th scope="col" className="px-3 py-2">Modalverb</th>
              <th scope="col" className="px-3 py-2">Sicherheitsniveau</th>
              <th scope="col" className="px-3 py-2">Aufwand</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      ) : (
        <ul className="divide-y divide-[var(--color-border-subtle)]">{rows}</ul>
      )}
    </section>
  );
}
