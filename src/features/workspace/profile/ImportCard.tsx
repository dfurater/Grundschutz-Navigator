import { useId } from 'react';
import { CheckboxLabel } from '@/components/CheckboxLabel';
import { IconX } from '@/components/icons';
import type { Control } from '@/domain/models';
import {
  addPattern, removePattern, setImportMode, setPattern, setSelectedControls, setWithChildControls,
  type ProfileImportView, type ProfileSelectionScope,
} from '@/domain/profileAuthoring';
import type { TargetControlIndex } from '@/domain/profileTargetControls';
import { EDGE_STATE_LABELS } from '@/domain/workspaceStations';
import type { WorkspaceEdgeView } from '@/state/workspaceVerbundView';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { OriginMark } from '@/features/workspace/profile/ProfileMarks';
import { RequirementSelection } from '@/features/workspace/profile/RequirementSelection';
import { SelectionCriteria, type SelectionCriteriaActions } from '@/features/workspace/profile/SelectionCriteria';
import type { ImportTargetOption } from '@/features/workspace/profile/useImportTargets';

const MODE_LABELS = { controls: 'Einzelne Anforderungen', all: 'Alle Anforderungen' } as const;
/** Der Umschalter bietet genau die beiden Zweige an; ein 1.1.x-Import ohne beide bleibt unverändert gültig. */
const MODES = ['controls', 'all'] as const;
const CHILD_LABEL = 'Unteranforderungen einschließen';

type Patch = (source: unknown) => unknown;

/** Zweigwahl nach der Auswahlregel: aktiv ist Petrol auf Petrol-Lasur. Ein Klick setzt genau einen Zweig. */
function ModeSwitch({ entry, oscalVersion, onChange }: Readonly<{ entry: ProfileImportView; oscalVersion: string; onChange: (patch: Patch) => void }>) {
  const labelId = useId();
  return (
    <div className="flex w-full flex-wrap items-center gap-2 desktop:w-auto">
      <span id={labelId} className="text-sm text-[var(--color-text-secondary)]">Auswahl</span>
      <div role="radiogroup" aria-labelledby={labelId} className="grid w-full grid-cols-2 rounded-md border border-[var(--color-border-strong)] p-0.5 desktop:inline-flex desktop:w-auto">
        {MODES.map((mode) => {
          const active = entry.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={active}
              className={`min-h-touch rounded px-3 text-sm desktop:min-h-8 ${active ? 'bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent-default)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]'} ${FOCUS_RING}`}
              onClick={() => { if (!active) onChange((source) => setImportMode(source, entry.index, mode, oscalVersion)); }}
            >
              {MODE_LABELS[mode]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function criteriaActions(index: number, scope: ProfileSelectionScope, onChange: (patch: Patch) => void): SelectionCriteriaActions {
  return {
    setId: (id, selected) => onChange((source) => setSelectedControls(source, index, scope, [id], selected)),
    addPattern: () => onChange((source) => addPattern(source, index, scope)),
    setPattern: (ref, pattern) => onChange((source) => setPattern(source, index, scope, ref, pattern)),
    removePattern: (ref) => onChange((source) => removePattern(source, index, scope, ref)),
    setWithChildControls: (value) => onChange((source) => setWithChildControls(source, index, scope, value)),
  };
}

export function ImportCard({ entry, position, oscalVersion, target, edge, controls, details, canRemove, onChange, onRemove, onAssign }: Readonly<{
  entry: ProfileImportView;
  position: number;
  oscalVersion: string;
  target?: ImportTargetOption;
  edge?: WorkspaceEdgeView;
  controls?: TargetControlIndex;
  details?: ReadonlyMap<string, Control>;
  canRemove: boolean;
  onChange: (patch: Patch) => void;
  onRemove: () => void;
  onAssign: () => void;
}>) {
  const headingId = useId();
  const ids = controls?.ids ?? [];
  const selected = new Set(entry.include.withIds);
  return (
    <article aria-labelledby={headingId} className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
      <header className="space-y-2 px-4 pb-3 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={headingId} className="text-sm font-semibold text-[var(--color-text-primary)]">Import {position}</h2>
          {target && <OriginMark origin={target.origin} />}
          <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-primary)]">{target?.title ?? entry.resourceTitle}</span>
          <button
            type="button"
            disabled={!canRemove}
            aria-label={`Import ${position} entfernen`}
            className={`inline-flex min-h-touch min-w-touch items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50 desktop:min-h-8 desktop:min-w-8 ${FOCUS_RING}`}
            onClick={onRemove}
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
        <p className="flex flex-wrap gap-x-2 font-mono text-xs text-[var(--color-text-secondary)]">
          {target?.artifactKey && <span>{target.artifactKey} ·</span>}
          <span>OSCAL {oscalVersion} ·</span>
          <span className="break-all">href {entry.href ?? '—'}</span>
        </p>
        {!target && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            {edge ? EDGE_STATE_LABELS[edge.state] : EDGE_STATE_LABELS['not-evaluable']}
            {edge?.diagnosticCode && <span className="font-mono text-xs">{edge.diagnosticCode}</span>}
            {entry.href !== undefined && (
              <button type="button" className={`min-h-touch rounded-md px-2 text-sm catalog-link-color hover:bg-[var(--color-surface-subtle)] desktop:min-h-8 ${FOCUS_RING}`} onClick={onAssign}>
                Importziel zuordnen
              </button>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
          <ModeSwitch entry={entry} oscalVersion={oscalVersion} onChange={onChange} />
          {entry.mode === 'controls' && (
            <CheckboxLabel
              label={CHILD_LABEL}
              checked={entry.include.withChildControls === 'yes'}
              onChange={(checked) => onChange((source) => setWithChildControls(source, entry.index, 'include', checked ? 'yes' : 'no'))}
            />
          )}
        </div>
      </header>
      {entry.mode === 'controls' && (
        <div className="space-y-4 border-t border-[var(--color-border-subtle)] p-4">
          {controls
            ? <RequirementSelection index={controls} selected={selected} details={details} onChange={(changed, checked) => onChange((source) => setSelectedControls(source, entry.index, 'include', changed, checked))} />
            : <p className="text-sm text-[var(--color-text-secondary)]">Die Anforderungen des Importziels stehen zur Auswahl, sobald das Ziel gebunden und geladen ist.</p>}
          <SelectionCriteria title="Weitere Auswahl" oscalKey="include-controls" view={entry.include} ids={ids} actions={{ ...criteriaActions(entry.index, 'include', onChange), setWithChildControls: undefined }} showIds={false} />
        </div>
      )}
      {(entry.mode === 'all' || entry.mode === 'controls') && (
        <div className="border-t border-[var(--color-border-subtle)] p-4">
          <SelectionCriteria title="Ausschlüsse" oscalKey="exclude-controls" view={entry.exclude} ids={ids} actions={criteriaActions(entry.index, 'exclude', onChange)} childLabel={CHILD_LABEL} />
        </div>
      )}
    </article>
  );
}
