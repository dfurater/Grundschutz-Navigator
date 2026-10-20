import { Button } from '@/components/Button';
import { IconDownload } from '@/components/icons';
import type { ProfileAnalysis } from '@/state/workspaceProfileAnalysis';
import { OriginMark, SECTION_LABEL, formatCount } from '@/features/workspace/profile/ProfileMarks';
import type { ImportTargetOption } from '@/features/workspace/profile/useImportTargets';
import type { ProfileSaveState } from '@/features/workspace/profile/useProfileEditor';

/** Höchstzahl der Anforderungen je Praktik in der Liste; der Rest erscheint als Zählung. */
const LIST_LIMIT = 12;

function time(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** Speicherstand: Bernstein für den Entwurf, Grün für das ausdrücklich Gespeicherte. */
export function SaveStateLine({ state, dirty }: Readonly<{ state: ProfileSaveState; dirty: boolean }>) {
  let text: string;
  let tone = 'bg-[var(--color-document-draft-border)]';
  switch (state.kind) {
    case 'pending': text = 'Ungesicherte Änderungen'; break;
    case 'autosaved': text = `Gesichert ${time(state.at)}`; break;
    case 'failed': text = 'Sicherung fehlgeschlagen'; tone = 'bg-[var(--color-danger-border)]'; break;
    case 'saved': text = `Gespeichert ${time(state.at)}`; tone = 'bg-[var(--color-document-valid-border)]'; break;
    default: text = dirty ? 'Ungesicherte Änderungen' : 'Gespeichert'; tone = dirty ? tone : 'bg-[var(--color-document-valid-border)]';
  }
  return (
    <p aria-live="polite" className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${tone}`} />
      {text}
    </p>
  );
}

/** Inhalt des Panels „Anforderungspaket“: Herkunft, Umfang und die aufgelösten Anforderungen. */
export function PackageContent({ analysis, targets, total }: Readonly<{
  analysis: ProfileAnalysis | null;
  targets: readonly ImportTargetOption[];
  total: number | undefined;
}>) {
  const resolution = analysis?.resolution;
  return (
    <div className="space-y-4">
      <dl className="space-y-2 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-subtle)] p-3 text-sm">
        <dt className="text-xs text-[var(--color-text-secondary)]">Importziel</dt>
        {targets.length === 0 && <dd className="text-[var(--color-text-secondary)]">nicht zugeordnet</dd>}
        {targets.map((target) => (
          <dd key={target.key} className="space-y-1">
            <OriginMark origin={target.origin} />
            <p className="font-medium text-[var(--color-text-primary)]">{target.title}</p>
          </dd>
        ))}
        <dt className="pt-1 text-xs text-[var(--color-text-secondary)]">Profile</dt>
        <dd><OriginMark origin="local" /></dd>
      </dl>
      {resolution?.status === 'resolved' ? (
        <>
          <p className="text-sm tabular-nums text-[var(--color-text-secondary)]">
            {formatCount(resolution.index.ids.length)}{total === undefined ? '' : ` von ${formatCount(total)}`} Anforderungen
          </p>
          {resolution.index.practices.filter((practice) => practice.controlCount > 0).map((practice, position) => {
            const controls = practice.groups.flatMap((group) => group.controls);
            return (
              <section key={practice.id ?? position} aria-label={practice.title || practice.id || 'Ohne Gruppe'}>
                <h3 className={`${SECTION_LABEL} flex justify-between gap-2 border-b border-[var(--color-border-subtle)] pb-1`}>
                  <span>{practice.id && <span className="font-mono">{practice.id} · </span>}{practice.title}</span>
                  <span className="tabular-nums">{formatCount(practice.controlCount)}</span>
                </h3>
                <ul className="divide-y divide-[var(--color-border-subtle)]">
                  {controls.slice(0, LIST_LIMIT).map((control) => (
                    <li key={control.id} className={`flex gap-3 py-1.5 text-sm ${control.depth > 0 ? 'pl-4' : ''}`}>
                      <span className="w-20 shrink-0 font-mono text-xs leading-5 text-[var(--color-text-secondary)]">{control.id}</span>
                      <span className="min-w-0 truncate text-[var(--color-text-primary)]">{control.title}</span>
                    </li>
                  ))}
                </ul>
                {controls.length > LIST_LIMIT && <p className="pt-1 text-xs tabular-nums text-[var(--color-text-secondary)]">+ {formatCount(controls.length - LIST_LIMIT)} weitere</p>}
              </section>
            );
          })}
        </>
      ) : (
        <p className="text-sm text-[var(--color-text-secondary)]">{resolution?.status === 'error' ? 'Auflösung mit Fehler abgebrochen' : 'Noch nicht auflösbar'}</p>
      )}
    </div>
  );
}

/** Fuß des Panels: Speicherstand, Export (Secondary) und Speichern (einzige Primary-Aktion). */
export function PackageActions({ saveState, dirty, canExport, busy, onSave, onExport }: Readonly<{
  saveState: ProfileSaveState;
  dirty: boolean;
  canExport: boolean;
  busy: boolean;
  onSave: () => void;
  onExport: () => void;
}>) {
  return (
    <div className="space-y-3">
      <SaveStateLine state={saveState} dirty={dirty} />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" icon={IconDownload} className="min-h-touch desktop:min-h-0" disabled={!canExport} onClick={onExport}>Export</Button>
        <Button className="min-h-touch desktop:min-h-0" disabled={busy} onClick={onSave}>Speichern</Button>
      </div>
    </div>
  );
}
