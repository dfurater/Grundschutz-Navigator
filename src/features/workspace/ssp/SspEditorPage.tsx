import { useState } from 'react';
import { useNavigate } from 'react-router';
import { buildStationUrl } from '@/app/routes';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconDownload } from '@/components/icons';
import { missingSspStructure } from '@/domain/sspRequirements';
import { editLocked, reviewLocked } from '@/domain/workspaceCatalogPin';
import type { LocalId, VerbundId } from '@/domain/workspaceModel';
import { DESKTOP_QUERY } from '@/hooks/breakpointQueries';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { VerbundView, WorkspaceDocumentView } from '@/state/workspaceVerbundView';
import { EditorPanel, EditorToolbar } from '@/features/workspace/EditorFrame';
import { WorkspaceNotices } from '@/features/workspace/WorkspaceNotices';
import { CatalogPinNotice } from '@/features/workspace/CatalogPinNotice';
import { ReferenceEdges } from '@/features/workspace/ReferenceEdges';
import { ReviewSection } from '@/features/workspace/review/ReviewSection';
import { PackageActions } from '@/features/workspace/profile/PackagePanel';
import { SECTION_LABEL } from '@/features/workspace/profile/ProfileMarks';
import { targetKey, useImportTargets } from '@/features/workspace/profile/useImportTargets';
import {
  BaselineSection, CharacteristicsSection, ControlImplementationSection, ImplementationSection, MetadataSection,
} from '@/features/workspace/ssp/SspFormSections';
import { SspDocumentContent } from '@/features/workspace/ssp/SspDocumentContent';
import { useBaselineControls } from '@/features/workspace/ssp/useBaselineControls';
import { useSspEditor, type SspEditorMessage } from '@/features/workspace/ssp/useSspEditor';

const MESSAGES: Readonly<Record<SspEditorMessage, string>> = {
  'saved-as-draft': 'Schema oder Referenzprüfung sind nicht bestanden; das SSP ist als Entwurf gespeichert.',
  'save-failed': 'Das SSP wurde nicht gespeichert.',
  'export-failed': 'Der Export wurde abgelehnt; das Schema oder die Referenzprüfung ist nicht bestanden.',
  'delete-failed': 'Das SSP wurde nicht gelöscht.',
  'component-unresolved': 'Nicht gespeichert: Eine component-uuid zeigt auf keine Komponente.',
  'component-referenced': 'Die Komponente bleibt: Eine Umsetzungsaussage verweist auf sie.',
  'patch-failed': 'Die Änderung passt nicht zur Struktur des Dokuments und wurde nicht übernommen.',
  'catalog-locked': 'Der gebundene Katalogstand gibt das Speichern nicht frei; das SSP wurde nicht gespeichert.',
};

/** Offene Pflichtstruktur des Arbeitsstands als Liste mit OSCAL-Pfad. */
function OpenStructure({ missing }: Readonly<{ missing: readonly string[] }>) {
  return (
    <section aria-label="Offene Pflichtstruktur" className="space-y-2">
      <h2 className={`${SECTION_LABEL} flex justify-between gap-2`}>
        <span>Offene Pflichtstruktur</span>
        <span className="tabular-nums">{missing.length}</span>
      </h2>
      {missing.length === 0
        ? <p className="text-sm text-[var(--color-text-secondary)]">Keine offene Pflichtstruktur.</p>
        : (
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {missing.map((path) => <li key={path} className="break-all py-1.5 font-mono text-xs text-[var(--color-text-primary)]">{path}</li>)}
          </ul>
        )}
    </section>
  );
}

/**
 * Bearbeitungsansicht eines SSP auf der Dokumentroute: Metadaten, Baseline,
 * Systemmerkmale, Systemimplementierung und Anforderungsliste, offene
 * Pflichtstruktur, Speichern und Export, darunter lesende Ansicht, Referenzen
 * und Prüfspur. Der Seitentitel bleibt fest;
 * kein Dokumentwert erreicht Route, Titel oder Verlauf.
 */
export function SspEditorPage({ view, document }: Readonly<{ view: VerbundView; document: WorkspaceDocumentView }>) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const localId = document.localId as LocalId;
  const editor = useSspEditor(localId);
  const options = useImportTargets(view);
  const controls = useBaselineControls(view.verbund.verbundId as VerbundId, editor.baseline, document.catalogPin);
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();

  if (editor.status !== 'ready' || !editor.envelope) {
    return <output className="block p-4 text-sm text-[var(--color-text-secondary)]">{editor.status === 'failed' ? 'Das SSP konnte nicht gelesen werden.' : 'SSP wird geladen…'}</output>;
  }
  const missing = missingSspStructure(editor.working);
  const state = editor.envelope.documentState === 'draft' || editor.dirty ? 'draft' : 'export-ready';
  const canExport = editor.envelope.documentState === 'export-ready' && !editor.dirty && !editor.busy;
  // Schreibschutz durch den Katalogstand: Lesen, Export und Löschen bleiben, Bearbeiten und Prüfen nicht.
  const locked = editLocked(document.catalogPin);
  const save = () => { void editor.save(); };
  const exportDocument = () => { void editor.exportDocument(); };

  return (
    <div className="flex flex-col md:h-full desktop:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <EditorToolbar view={view} document={document} station="ssp" backLabel="SSP" deleteLabel="SSP löschen…" title={document.title ?? 'SSP'} state={state} desktop={desktop} onDelete={() => setConfirming(true)} />
        <div className="min-h-0 flex-1 space-y-4 p-4 md:overflow-y-auto">
          <WorkspaceNotices />
          <CatalogPinNotice pin={document.catalogPin} busy={editor.busy} onBind={() => { void editor.bindCatalogStand(); }} />
          {editor.message && <output className="block text-sm text-[var(--color-text-primary)]">{MESSAGES[editor.message]}</output>}
          {!desktop && <OpenStructure missing={missing} />}
          <fieldset disabled={locked} className="min-w-0 space-y-4">
            <MetadataSection editor={editor} />
            <BaselineSection editor={editor} options={options} />
            <CharacteristicsSection editor={editor} />
            <ImplementationSection editor={editor} />
            {/* Ein Baseline-Wechsel setzt die offene Anforderungswahl zurück. */}
            <ControlImplementationSection key={editor.baseline ? targetKey(editor.baseline) : 'ohne-baseline'} editor={editor} controls={controls} />
          </fieldset>
          <SspDocumentContent key={`${localId}:${editor.envelope.savedAt}`} localId={localId} />
          <ReferenceEdges view={view} document={document} />
          <ReviewSection localId={localId} locked={reviewLocked(document.catalogPin)} documentSavedAt={editor.envelope.savedAt} editorDirty={editor.dirty} onDocumentAdopted={editor.adopt} />
        </div>
        {!desktop && (
          <div className="sticky bottom-0 z-10 grid shrink-0 grid-cols-2 gap-2 border-t border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-3 pb-safe shadow-footer">
            <Button variant="secondary" icon={IconDownload} className="min-h-touch" disabled={!canExport} onClick={exportDocument}>Export</Button>
            <Button className="min-h-touch" disabled={editor.busy || locked} onClick={save}>Speichern</Button>
          </div>
        )}
      </div>
      {desktop && (
        <EditorPanel label="Speichern und Export" footer={<PackageActions saveState={editor.saveState} dirty={editor.dirty} canExport={canExport} busy={editor.busy || locked} onSave={save} onExport={exportDocument} />}>
          <OpenStructure missing={missing} />
        </EditorPanel>
      )}
      <ConfirmDialog
        open={confirming}
        title="SSP endgültig löschen?"
        confirmLabel="Endgültig löschen"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void editor.remove().then((removed) => { if (removed) void navigate(buildStationUrl(view.verbund.verbundId, 'ssp')); });
        }}
      >
        Das SSP, sein Entwurf und seine Bindungen werden aus diesem Browser gelöscht. Verweise anderer Dokumente auf dieses SSP verlieren ihr Ziel.
      </ConfirmDialog>
    </div>
  );
}
