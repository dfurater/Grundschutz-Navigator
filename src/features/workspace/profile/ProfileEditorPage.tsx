import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { buildStationUrl } from '@/app/routes';
import { BottomSheet } from '@/components/BottomSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/Button';
import { IconDownload } from '@/components/icons';
import type { LocalId, VerbundId } from '@/domain/workspaceModel';
import { DESKTOP_QUERY } from '@/hooks/breakpointQueries';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { VerbundView, WorkspaceDocumentView } from '@/state/workspaceVerbundView';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { WorkspaceNotices } from '@/features/workspace/WorkspaceNotices';
import { ReferenceEdges } from '@/features/workspace/ReferenceEdges';
import { EditorPanel, EditorToolbar } from '@/features/workspace/EditorFrame';
import { ImportsTab } from '@/features/workspace/profile/ImportsTab';
import { PackageActions, PackageContent } from '@/features/workspace/profile/PackagePanel';
import { ProfileDiagnostics } from '@/features/workspace/profile/ProfileDiagnostics';
import { formatCount } from '@/features/workspace/profile/ProfileMarks';
import { targetKey, useImportTargets } from '@/features/workspace/profile/useImportTargets';
import { useProfileAnalysis } from '@/features/workspace/profile/useProfileAnalysis';
import { useProfileEditor, type ProfileEditorMessage } from '@/features/workspace/profile/useProfileEditor';
import { ReviewTab } from '@/features/workspace/review/ReviewTab';

type Tab = 'imports' | 'references' | 'review';

const MESSAGES: Readonly<Record<ProfileEditorMessage, string>> = {
  'saved-as-draft': 'Das Schema ist nicht bestanden; das Profil ist als Entwurf gespeichert.',
  'save-failed': 'Das Profil wurde nicht gespeichert.',
  'export-failed': 'Der Export wurde abgelehnt; die Diagnosen nennen die Stufe.',
  'delete-failed': 'Das Profil wurde nicht gelöscht.',
};

function Tabs({ tab, onSelect, counts, ids }: Readonly<{ tab: Tab; onSelect: (tab: Tab) => void; counts: Readonly<Record<Tab, number | undefined>>; ids: Readonly<Record<Tab, string>> }>) {
  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const order: readonly Tab[] = ['imports', 'references', 'review'];
  const labels: Readonly<Record<Tab, string>> = { imports: 'Importe', references: 'Referenzen', review: 'Prüfung' };
  const move = (event: KeyboardEvent, current: Tab) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = order[(order.indexOf(current) + (event.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
    onSelect(next);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Bereiche des Profils" className="flex gap-1 border-b border-[var(--color-border-default)] px-2">
      {order.map((entry) => (
        <button
          key={entry}
          ref={(element) => { refs.current[entry] = element; }}
          type="button"
          role="tab"
          id={`${ids[entry]}-tab`}
          aria-selected={tab === entry}
          aria-controls={ids[entry]}
          tabIndex={tab === entry ? 0 : -1}
          className={`-mb-px min-h-touch border-b-2 px-3 text-sm ${tab === entry ? 'border-[var(--color-accent-default)] font-semibold text-[var(--color-accent-default)]' : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'} ${FOCUS_RING} focus-visible:ring-inset`}
          onClick={() => onSelect(entry)}
          onKeyDown={(event) => move(event, entry)}
        >
          {labels[entry]} {counts[entry] !== undefined && <span className="ml-0.5 text-xs tabular-nums">{counts[entry]}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Bearbeitungsansicht eines Profils auf der Dokumentroute (Mockups 2, 3, 6,
 * 7): Werkzeugleiste, Reiter Importe und Referenzen, rechtes Panel
 * „Anforderungspaket“, Diagnosen am Fuß der Hauptspalte. Der Seitentitel
 * bleibt fest; kein Dokumentwert erreicht Route, Titel oder Verlauf.
 */
export function ProfileEditorPage({ view, document }: Readonly<{ view: VerbundView; document: WorkspaceDocumentView }>) {
  const ids = { imports: useId(), references: useId(), review: useId() };
  const sheetTitle = useId();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const localId = document.localId as LocalId;
  const editor = useProfileEditor(localId);
  const { analysis, current, failed, analyzedBindings } = useProfileAnalysis(view.verbund.verbundId as VerbundId, localId, editor.working, editor.bindings);
  const options = useImportTargets(view, localId);
  const [tab, setTab] = useState<Tab>('imports');
  const [reviewStartedFor, setReviewStartedFor] = useState<LocalId | null>(null);
  const [sheet, setSheet] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();
  const targets = useMemo(() => editor.imports.flatMap((entry) => {
    const target = editor.targetFor(entry);
    const option = target && options.find((candidate) => candidate.key === targetKey(target));
    return option ? [option] : [];
  }), [editor, options]);

  if (editor.status !== 'ready' || !editor.envelope) {
    return <output className="block p-4 text-sm text-[var(--color-text-secondary)]">{editor.status === 'failed' ? 'Das Profil konnte nicht gelesen werden.' : 'Profil wird geladen…'}</output>;
  }
  const oscalVersion = editor.envelope.oscalVersion;
  const state = editor.envelope.documentState === 'draft' || editor.dirty ? 'draft' : 'export-ready';
  const canExport = editor.envelope.documentState === 'export-ready' && !editor.dirty && !editor.busy;
  const total = targets.length === 1 ? targets[0].count : undefined;
  const resolvedCount = analysis?.resolution.status === 'resolved' ? analysis.resolution.index.ids.length : 0;
  // Nach dem ersten Öffnen bleibt der Reiter eingehängt: ein Wechsel verwirft keine Freigabeeingaben.
  const selectTab = (next: Tab) => {
    setTab(next);
    if (next === 'review') setReviewStartedFor(localId);
  };
  const actions = (
    <PackageActions saveState={editor.saveState} dirty={editor.dirty} canExport={canExport} busy={editor.busy} onSave={() => { void editor.save(); }} onExport={() => { void editor.exportDocument(); }} />
  );

  return (
    <div className="flex flex-col md:h-full desktop:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <EditorToolbar view={view} document={document} station="profile" backLabel="Profile" deleteLabel="Profil löschen…" title={document.title ?? 'Profile'} state={state} desktop={desktop} onDelete={() => setConfirming(true)} />
        <Tabs tab={tab} onSelect={selectTab} counts={{ imports: editor.imports.length, references: view.edges.get(localId)?.length ?? 0, review: undefined }} ids={ids} />
        <div className="min-h-0 flex-1 space-y-4 p-4 md:overflow-y-auto">
          <WorkspaceNotices />
          {editor.message && <output className="block text-sm text-[var(--color-text-primary)]">{MESSAGES[editor.message]}</output>}
          <div role="tabpanel" id={ids.imports} aria-labelledby={`${ids.imports}-tab`} hidden={tab !== 'imports'}>
            <ImportsTab editor={editor} analysis={analysis} analyzedBindings={analyzedBindings} options={options} oscalVersion={oscalVersion} />
          </div>
          <div role="tabpanel" id={ids.references} aria-labelledby={`${ids.references}-tab`} hidden={tab !== 'references'}>
            <ReferenceEdges view={view} document={document} />
          </div>
          <div role="tabpanel" id={ids.review} aria-labelledby={`${ids.review}-tab`} hidden={tab !== 'review'}>
            {/* Erst beim Öffnen geladen: der Prüf-Worker entsteht nicht auf jedem Profilaufruf. */}
            {reviewStartedFor === localId && (
              <ReviewTab key={localId} localId={localId} documentSavedAt={editor.envelope.savedAt} editorDirty={editor.dirty} approval={{ onSubmit: editor.approve }} onDocumentAdopted={editor.adopt} />
            )}
          </div>
        </div>
        <div className="sticky bottom-0 z-10 shrink-0 bg-[var(--color-surface-base)] desktop:static">
          <ProfileDiagnostics analysis={analysis} current={current} failed={failed} oscalVersion={oscalVersion} />
          {!desktop && (
            <div className="grid grid-cols-2 gap-2 border-t border-[var(--color-border-default)] p-3 pb-safe shadow-footer">
              <Button variant="secondary" className="min-h-touch" aria-haspopup="dialog" onClick={() => setSheet(true)}>
                Paket <span className="ml-1 inline-flex min-w-4.5 justify-center rounded-full bg-[var(--color-text-primary)] px-1 text-2xs font-semibold tabular-nums text-[var(--color-text-inverse)]">{formatCount(resolvedCount)}</span>
              </Button>
              <Button className="min-h-touch" disabled={editor.busy} onClick={() => { void editor.save(); }}>Speichern</Button>
            </div>
          )}
        </div>
      </div>
      {desktop && <EditorPanel label="Anforderungspaket" footer={actions}><PackageContent analysis={analysis} targets={targets} total={total} /></EditorPanel>}
      <ConfirmDialog
        open={confirming}
        title="Profil endgültig löschen?"
        confirmLabel="Endgültig löschen"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void editor.remove().then((removed) => { if (removed) void navigate(buildStationUrl(view.verbund.verbundId, 'profile')); });
        }}
      >
        Das Profil, sein Entwurf und seine Bindungen werden aus diesem Browser gelöscht. Verweise anderer Dokumente auf dieses Profil verlieren ihr Ziel.
      </ConfirmDialog>
      {!desktop && (
        <BottomSheet open={sheet} onClose={() => setSheet(false)} labelledBy={sheetTitle}>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
            <h2 id={sheetTitle} className="text-base font-semibold">Anforderungspaket</h2>
            <PackageContent analysis={analysis} targets={targets} total={total} />
            <Button variant="secondary" icon={IconDownload} className="min-h-touch w-full" disabled={!canExport} onClick={() => { void editor.exportDocument(); }}>Export</Button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
