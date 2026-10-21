import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { buildStationUrl } from '@/app/routes';
import { BottomSheet } from '@/components/BottomSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/Button';
import { IconChevronLeft, IconDownload } from '@/components/icons';
import type { LocalId, VerbundId } from '@/domain/workspaceModel';
import { DESKTOP_QUERY } from '@/hooks/breakpointQueries';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { VerbundView, WorkspaceDocumentView } from '@/state/workspaceVerbundView';
import { FOCUS_RING, OriginLabel, ValidityBadge } from '@/features/workspace/DocumentMarks';
import { WorkspaceNotices } from '@/features/workspace/WorkspaceNotices';
import { CatalogPinNotice } from '@/features/workspace/CatalogPinNotice';
import { ReferenceEdges } from '@/features/workspace/ReferenceEdges';
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
  'catalog-locked': 'Der gebundene Katalogstand gibt das Speichern nicht frei; das Profil wurde nicht gespeichert.',
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

function Toolbar({ view, document, title, state, desktop, onDelete }: Readonly<{
  view: VerbundView;
  document: WorkspaceDocumentView;
  title: string;
  state: 'draft' | 'export-ready';
  desktop: boolean;
  onDelete: () => void;
}>) {
  const remove = <Button variant="ghost" size="sm" className="min-h-touch desktop:min-h-0" onClick={onDelete}>Profil löschen…</Button>;
  const back = (
    <Link to={buildStationUrl(view.verbund.verbundId, 'profile')} className={`inline-flex min-h-touch items-center gap-1 rounded text-sm catalog-link-color desktop:min-h-0 ${FOCUS_RING}`}>
      <IconChevronLeft className="h-3.5 w-3.5" />Profile
    </Link>
  );
  if (desktop) {
    return (
      <div className="flex h-panel-head shrink-0 items-center gap-3 border-b border-[var(--color-border-default)] px-4">
        {back}
        <span aria-hidden="true" className="text-[var(--color-border-strong)]">/</span>
        <h1 className="min-w-0 truncate text-sm font-semibold text-[var(--color-text-primary)]">{title}</h1>
        <ValidityBadge state={state} />
        <span className="font-mono text-xs text-[var(--color-text-secondary)]">OSCAL {document.oscalVersion}</span>
        <span className="ml-auto">{remove}</span>
      </div>
    );
  }
  return (
    <header className="space-y-2 px-4 pb-3 pt-2">
      {back}
      <h1 className="type-page-title break-words">{title}</h1>
      <div className="flex flex-wrap items-center gap-1.5">
        <ValidityBadge state={state} />
        <OriginLabel />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-[var(--color-text-secondary)]">OSCAL {document.oscalVersion}</p>
        {remove}
      </div>
    </header>
  );
}

function Panel({ children, footer }: Readonly<{ children: ReactNode; footer: ReactNode }>) {
  return (
    <aside aria-label="Anforderungspaket" className="flex w-90 shrink-0 flex-col border-l border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
      <h2 className="flex h-panel-head shrink-0 items-center border-b border-[var(--color-border-default)] px-4 text-sm font-semibold">Anforderungspaket</h2>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      <div className="shrink-0 border-t border-[var(--color-border-default)] p-4">{footer}</div>
    </aside>
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
  // Schreibschutz durch den Katalogstand: Lesen, Export und Löschen bleiben, Bearbeiten und Prüfen nicht.
  const locked = document.catalogPin !== undefined && document.catalogPin.state !== 'bound';
  const total = targets.length === 1 ? targets[0].count : undefined;
  const resolvedCount = analysis?.resolution.status === 'resolved' ? analysis.resolution.index.ids.length : 0;
  // Nach dem ersten Öffnen bleibt der Reiter eingehängt: ein Wechsel verwirft keine Freigabeeingaben.
  const selectTab = (next: Tab) => {
    setTab(next);
    if (next === 'review') setReviewStartedFor(localId);
  };
  const actions = (
    <PackageActions saveState={editor.saveState} dirty={editor.dirty} canExport={canExport} busy={editor.busy || locked} onSave={() => { void editor.save(); }} onExport={() => { void editor.exportDocument(); }} />
  );

  return (
    <div className="flex flex-col md:h-full desktop:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Toolbar view={view} document={document} title={document.title ?? 'Profile'} state={state} desktop={desktop} onDelete={() => setConfirming(true)} />
        <Tabs tab={tab} onSelect={selectTab} counts={{ imports: editor.imports.length, references: view.edges.get(localId)?.length ?? 0, review: undefined }} ids={ids} />
        <div className="min-h-0 flex-1 space-y-4 p-4 md:overflow-y-auto">
          <WorkspaceNotices />
          <CatalogPinNotice pin={document.catalogPin} busy={editor.busy} onBind={() => { void editor.bindCatalogStand(); }} />
          {editor.message && <output className="block text-sm text-[var(--color-text-primary)]">{MESSAGES[editor.message]}</output>}
          <div role="tabpanel" id={ids.imports} aria-labelledby={`${ids.imports}-tab`} hidden={tab !== 'imports'}>
            <fieldset disabled={locked} className="min-w-0">
              <ImportsTab editor={editor} analysis={analysis} analyzedBindings={analyzedBindings} options={options} oscalVersion={oscalVersion} />
            </fieldset>
          </div>
          <div role="tabpanel" id={ids.references} aria-labelledby={`${ids.references}-tab`} hidden={tab !== 'references'}>
            <ReferenceEdges view={view} document={document} />
          </div>
          <div role="tabpanel" id={ids.review} aria-labelledby={`${ids.review}-tab`} hidden={tab !== 'review'}>
            {/* Erst beim Öffnen geladen: der Prüf-Worker entsteht nicht auf jedem Profilaufruf. */}
            {reviewStartedFor === localId && (
              <fieldset disabled={locked} className="min-w-0">
              <ReviewTab key={localId} localId={localId} documentSavedAt={editor.envelope.savedAt} editorDirty={editor.dirty} approval={{ onSubmit: editor.approve }} onDocumentAdopted={editor.adopt} />
              </fieldset>
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
              <Button className="min-h-touch" disabled={editor.busy || locked} onClick={() => { void editor.save(); }}>Speichern</Button>
            </div>
          )}
        </div>
      </div>
      {desktop && <Panel footer={actions}><PackageContent analysis={analysis} targets={targets} total={total} /></Panel>}
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
