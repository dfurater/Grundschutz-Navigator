import type { ReactNode } from 'react';
import { Button } from '@/components/Button';
import { classOnePin, type RequirementPackageState } from '@/domain/requirementPackage';
import type { DocumentSnapshot, DocumentStamp, RequirementPackage, WorkspaceVerbund } from '@/domain/workspaceModel';
import { ROW_BUTTON } from '@/features/workspace/WorkspaceForms';
import { useWorkspace } from '@/hooks/useWorkspace';

const MARK = 'inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-xs leading-4';
const STAND = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const META = 'text-[var(--color-text-secondary)]';

export const PACKAGE_UNREADABLE = 'Paketstand nicht lesbar';

/** „Paket fehlt“ und „Nicht auflösbar“ tragen die Aussage im Wort; „Überholt“ zusätzlich im Warnton. */
export function PackageChip({ stale = false, children }: Readonly<{ stale?: boolean; children: ReactNode }>) {
  const tone = stale
    ? 'border-[var(--color-warning)] font-medium text-[var(--color-warning-text)]'
    : 'border-[var(--color-border-strong)] font-semibold text-[var(--color-text-primary)]';
  return <span className={`${MARK} bg-[var(--color-surface-base)] ${tone}`}>{children}</span>;
}

/** `metadata.last-modified` als „Stand 12.11.2026, 10:41“; ein nicht lesbarer Wert erscheint unverändert. */
export function standText(lastModified: string): string {
  const date = new Date(lastModified);
  return `Stand ${Number.isNaN(date.getTime()) ? lastModified : STAND.format(date)}`;
}

/** Quellenstand aus einem vollständigen `derivedFrom` beziehungsweise `class-1`-Pin, sonst offen. */
export function SourceState({ pin }: Readonly<{ pin?: { readonly artifactKey: string; readonly snapshotCommit: string } }>) {
  if (!pin) return <>Quellenstand offen</>;
  return <>Quelle <span className="font-mono text-xs">{pin.artifactKey}</span> · Commit <span className="font-mono text-xs">{pin.snapshotCommit.slice(0, 8)}</span></>;
}

export function RootAndVersion({ stamp }: Readonly<{ stamp: Pick<DocumentStamp, 'rootType' | 'version'> }>) {
  return <><span className="font-mono text-xs">{stamp.rootType}</span> · Version {stamp.version}</>;
}

function packageName(state: Extract<RequirementPackageState, { kind: 'set' | 'stale' }>): string {
  return state.title ?? state.requirementPackage.baseline.stand.rootType;
}

/** Der gelesene Zustand eines Verbunds; ohne Eintrag bei vorhandenem Paket ist der Stand nicht gelesen. */
export function usePackageState(verbund: WorkspaceVerbund): RequirementPackageState | null {
  const { packages } = useWorkspace();
  if (!verbund.requirementPackage) return { kind: 'missing' };
  return packages?.get(verbund.verbundId) ?? null;
}

/** Paketspalte und „Bleibt erhalten“: Bezeichnung, „Paket fehlt“, Bezeichnung mit „Überholt“ oder „Nicht auflösbar“. */
export function PackageLabel({ verbund }: Readonly<{ verbund: WorkspaceVerbund }>) {
  const state = usePackageState(verbund);
  if (!state) return <span>{PACKAGE_UNREADABLE}</span>;
  switch (state.kind) {
    case 'missing': return <PackageChip>Paket fehlt</PackageChip>;
    case 'unresolvable': return <PackageChip>Nicht auflösbar</PackageChip>;
    case 'set': return <span className="break-words">{packageName(state)}</span>;
    case 'stale': return <span className="inline-flex flex-wrap items-center gap-1.5"><span className="break-words">{packageName(state)}</span><PackageChip stale>Überholt</PackageChip></span>;
  }
}

function Line({ children }: Readonly<{ children: ReactNode }>) {
  return <span className={`${META} tabular-nums`}>{children}</span>;
}

function stateLine(state: RequirementPackageState, requirementPackage: RequirementPackage | undefined): { body: ReactNode; action: string } {
  if (state.kind === 'missing' || !requirementPackage) return { body: <PackageChip>Paket fehlt</PackageChip>, action: 'Festlegen…' };
  const stand: DocumentSnapshot = requirementPackage.baseline.stand;
  if (state.kind === 'unresolvable') {
    return {
      body: <><PackageChip>Nicht auflösbar</PackageChip><Line><RootAndVersion stamp={stand} /> · {standText(stand.lastModified)} · Dokument nicht mehr vorhanden</Line></>,
      action: 'Neu festlegen…',
    };
  }
  if (state.kind === 'stale') {
    return {
      body: <>
        <PackageChip stale>Überholt</PackageChip>
        <span className="break-words">{packageName(state)}</span>
        <Line>festgelegt: {standText(stand.lastModified)}{state.current ? <> · aktuell: {standText(state.current.lastModified)}</> : null}</Line>
      </>,
      action: 'Neu festlegen…',
    };
  }
  return {
    body: <><span className="break-words">{packageName(state)}</span><Line><RootAndVersion stamp={stand} /> · {standText(stand.lastModified)} · <SourceState pin={classOnePin(requirementPackage)} /></Line></>,
    action: 'Ändern…',
  };
}

/** Zeile „Anforderungspaket:“ im Verbundkopf mit Zustand und dem Weg in die Festlegeansicht. */
export function PackageHeadLine({ verbund, onPick }: Readonly<{ verbund: WorkspaceVerbund; onPick: (trigger: HTMLButtonElement) => void }>) {
  const { writable } = useWorkspace();
  const state = usePackageState(verbund);
  const line = state ? stateLine(state, verbund.requirementPackage) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className={META}>Anforderungspaket:</span>
      {line ? line.body : <span>{PACKAGE_UNREADABLE}</span>}
      {line && (
        <Button variant="ghost" className={ROW_BUTTON} disabled={!writable} onClick={(event) => onPick(event.currentTarget)}>{line.action}</Button>
      )}
    </div>
  );
}
