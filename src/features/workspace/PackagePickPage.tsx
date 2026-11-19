import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { buildStationUrl } from '@/app/routes';
import { Button } from '@/components/Button';
import { isRequirementPackageRoot } from '@/domain/requirementPackage';
import type { LocalId, VerbundId, WorkspaceVerbund } from '@/domain/workspaceModel';
import { FOCUS_RING, ValidityBadge } from '@/features/workspace/DocumentMarks';
import { Facts } from '@/features/workspace/RestoreSheetParts';
import { PACKAGE_UNREADABLE, PackageChip, SourceState, standText, usePackageState } from '@/features/workspace/RequirementPackageState';
import { ROW_BUTTON } from '@/features/workspace/WorkspaceForms';
import { WorkspaceNotices } from '@/features/workspace/WorkspaceNotices';
import { useWorkspace } from '@/hooks/useWorkspace';
import type { VerbundView, WorkspaceDocumentView } from '@/state/workspaceVerbundView';

const PANEL = 'rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]';
const CHOICE = 'flex min-h-touch cursor-pointer items-start gap-3 px-4 py-3 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-60 has-checked:bg-[var(--color-accent-soft)]';
const CHOICE_INPUT = `mt-0.5 shrink-0 accent-[var(--color-accent-default)] ${FOCUS_RING}`;
const META = 'block text-xs tabular-nums text-[var(--color-text-secondary)]';
const NONE = 'none';

function Previous({ verbund }: Readonly<{ verbund: WorkspaceVerbund }>) {
  const state = usePackageState(verbund);
  if (!state) return <>{PACKAGE_UNREADABLE}</>;
  if (state.kind === 'missing') return <>Paket nicht festgelegt</>;
  const stand = state.requirementPackage.baseline.stand;
  const chip = { set: null, stale: <PackageChip stale>Überholt</PackageChip>, unresolvable: <PackageChip>Nicht auflösbar</PackageChip> }[state.kind];
  const name = state.kind === 'unresolvable' ? stand.rootType : state.title ?? stand.rootType;
  return <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">{chip}<span>{name} · festgelegt: {standText(stand.lastModified)}</span></span>;
}

function Candidate({ document, name, checked, onSelect }: Readonly<{ document: WorkspaceDocumentView; name: string; checked: boolean; onSelect: () => void }>) {
  return (
    <li>
      <label className={CHOICE}>
        <input type="radio" name={name} checked={checked} onChange={onSelect} className={CHOICE_INPUT} />
        <span className="min-w-0 flex-1">
          <span className="block break-words font-semibold text-[var(--color-text-primary)]">{document.title ?? document.rootType}</span>
          <span className={META}>
            <span className="font-mono">{document.rootType}</span>
            {document.version ? ` · Version ${document.version}` : ''}
            {document.lastModified ? ` · ${standText(document.lastModified)}` : ''}
          </span>
          <span className={META}><SourceState pin={document.derivedFrom} /></span>
        </span>
        <ValidityBadge state={document.documentState} />
      </label>
    </li>
  );
}

function confirmLabel(clearing: boolean, chosen: WorkspaceDocumentView | undefined): string {
  if (clearing) return 'Festlegung aufheben';
  return chosen ? `„${chosen.title ?? chosen.rootType}“ festlegen` : 'Festlegen';
}

/**
 * Ansicht „Anforderungspaket festlegen“ als lokaler Zustand der Verbundseite: alle gespeicherten Profiles
 * und Catalogs des Verbunds, keine Vorauswahl außer dem bisherigen Paket. Ein Konflikt ändert nichts.
 */
export function PackagePickPage({ view, onClose, onSaved }: Readonly<{ view: VerbundView; onClose: () => void; onSaved: () => void }>) {
  const { writable, verbuende, setRequirementPackage, clearRequirementPackage } = useWorkspace();
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  const verbund = verbuende?.find((row) => row.verbundId === view.verbund.verbundId) ?? view.verbund;
  const candidates = view.documents.filter((document) => isRequirementPackageRoot(document.rootType));
  const previous = verbund.requirementPackage?.baseline.localId;
  const [selection, setSelection] = useState<string | null>(() => candidates.some((document) => document.localId === previous) ? previous ?? null : null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = useId();
  const chosen = candidates.find((document) => document.localId === selection);
  const clearing = selection === NONE && verbund.requirementPackage !== undefined;
  const label = confirmLabel(clearing, chosen);

  const confirm = async () => {
    if (busy || (!chosen && !clearing)) return;
    setBusy(true);
    const verbundId = verbund.verbundId as VerbundId;
    const result = chosen
      ? await setRequirementPackage(verbundId, { savedAt: verbund.savedAt, baselineSavedAt: chosen.savedAt }, chosen.localId as LocalId)
      : await clearRequirementPackage(verbundId, { savedAt: verbund.savedAt });
    setBusy(false);
    if (result.ok) onSaved();
    else setConflict(result.diagnostic.code === 'WORKSPACE_SAVE_CONFLICT');
  };

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-4 p-4 desktop:px-7 desktop:py-6">
      <h1 ref={heading} tabIndex={-1} className="type-page-title focus:outline-none">Anforderungspaket festlegen</h1>
      <WorkspaceNotices />
      <form className="max-w-2xl space-y-4" onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
        <Facts rows={[['Informationsverbund', verbund.name], ['Bisher', <Previous key="bisher" verbund={verbund} />]]} />
        {candidates.length === 0 && (
          <div className={`${PANEL} flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm`}>
            <span className="text-[var(--color-text-secondary)]">Kein Profile oder Catalog in diesem Informationsverbund</span>
            <Link to={buildStationUrl(verbund.verbundId, 'profile')} className={`flex min-h-touch items-center rounded font-semibold catalog-prose-link desktop:min-h-0 ${FOCUS_RING}`}>
              Anforderungspaket anlegen<span aria-hidden="true">&nbsp;→</span>
            </Link>
          </div>
        )}
        {/* „Kein Paket“ bleibt auch ohne Kandidaten erreichbar, damit ein nicht auflösbares Paket aufhebbar ist. */}
        {(candidates.length > 0 || verbund.requirementPackage) && (
          <fieldset disabled={!writable || busy}>
            <legend className="mb-2 text-sm font-semibold">Neu</legend>
            <ul className={`${PANEL} divide-y divide-[var(--color-border-subtle)]`}>
              {candidates.map((document) => (
                <Candidate key={document.localId} document={document} name={name} checked={selection === document.localId} onSelect={() => setSelection(document.localId)} />
              ))}
              {verbund.requirementPackage && (
                <li>
                  <label className={CHOICE}>
                    <input type="radio" name={name} checked={selection === NONE} onChange={() => setSelection(NONE)} className={CHOICE_INPUT} />
                    <span className="font-semibold text-[var(--color-text-primary)]">Kein Paket</span>
                  </label>
                </li>
              )}
            </ul>
          </fieldset>
        )}
        {conflict && (
          <p role="alert" className="text-sm text-[var(--color-danger-text)]">Paket oder Dokument inzwischen geändert. Nichts festgelegt. Aktuellen Stand laden und erneut prüfen.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className={ROW_BUTTON} disabled={!writable || busy || (!chosen && !clearing)}>{label}</Button>
          {/* Gesperrt während des Speicherns: Ein später eintreffendes Ergebnis darf keine neu geöffnete Auswahl schließen. */}
          <Button variant="secondary" className={ROW_BUTTON} disabled={busy} onClick={onClose}>Abbrechen</Button>
        </div>
      </form>
    </div>
  );
}
