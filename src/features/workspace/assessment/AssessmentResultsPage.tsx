import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { buildStationUrl } from '@/app/routes';
import { Button } from '@/components/Button';
import { OWN_SCROLL_AREA_QUERY } from '@/hooks/breakpointQueries';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useWorkspace } from '@/hooks/useWorkspace';
import type { VerbundView, WorkspaceDocumentView } from '@/state/workspaceVerbundView';
import { FOCUS_RING, OriginLabel, ValidityBadge } from '@/features/workspace/DocumentMarks';
import { WorkspaceNotices } from '@/features/workspace/WorkspaceNotices';
import { CatalogPinNotice } from '@/features/workspace/CatalogPinNotice';
import { ReferenceEdges } from '@/features/workspace/ReferenceEdges';
import { loadAssessmentResults, type AssessmentResultsContent } from '@/features/workspace/assessment/loadAssessmentResults';
import { AssessmentResultList, SECTION_NAMES, type AssessmentEntry, type AssessmentSection } from '@/features/workspace/assessment/AssessmentResultList';
import { AssessmentDetail } from '@/features/workspace/assessment/AssessmentDetail';

function ModelDiagnostics({ content }: Readonly<{ content: AssessmentResultsContent }>) {
  const [visible, setVisible] = useState(50);
  return <details className="shrink-0 border-t border-[var(--color-border-default)] bg-[var(--color-surface-subtle)]">
    <summary className={`min-h-touch cursor-pointer px-4 py-3 text-sm font-semibold ${FOCUS_RING}`}>
      Modelldiagnosen <span className="font-normal tabular-nums">{content.model.diagnostics.length}</span>
    </summary>
    <div className="max-h-60 overflow-y-auto px-4 pb-3">
      {content.model.diagnostics.length ? <ul className="space-y-2">{content.model.diagnostics.slice(0, visible).map(diagnostic => <li key={diagnostic.signature} className="break-words font-mono text-xs">{diagnostic.stage} · {diagnostic.code} · {diagnostic.path}</li>)}</ul> : <p className="text-sm text-[var(--color-text-secondary)]">Keine Modelldiagnosen.</p>}
      {visible < content.model.diagnostics.length && <Button variant="secondary" className="mt-2 min-h-touch tabular-nums" onClick={() => setVisible(count => count + 50)}>Weitere Modelldiagnosen · {visible} von {content.model.diagnostics.length}</Button>}
    </div>
  </details>;
}

function ResultsView({ content, view, document }: Readonly<{ content: AssessmentResultsContent; view: VerbundView; document: WorkspaceDocumentView }>) {
  const twoPanels = useMediaQuery(OWN_SCROLL_AREA_QUERY);
  const [resultIndex, setResultIndex] = useState(0);
  const [section, setSection] = useState<AssessmentSection>('findings');
  const [selection, setSelection] = useState<string>();
  const list = useRef<HTMLDivElement>(null);
  const returnTo = useRef<string | undefined>(undefined);
  const selectId = useId();
  const sectionsId = useId();
  const result = content.model.results[resultIndex];
  const selected = result?.[section].find(entry => entry.path === selection);
  useEffect(() => {
    if (!selected && returnTo.current) {
      const target = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-assessment-entry]') ?? [])].find(button => button.dataset.assessmentEntry === returnTo.current);
      target?.focus();
      returnTo.current = undefined;
    }
  }, [selected]);
  const choose = (entry: AssessmentEntry) => { returnTo.current = entry.path; setSelection(entry.path); };
  const mobileDetail = selected && !twoPanels;
  return <div className="flex min-h-0 flex-1 flex-col bg-[var(--color-surface-base)] md:flex-row">
    <div ref={list} className={`${mobileDetail ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-1 flex-col`}>
      <header className="shrink-0 space-y-3 p-4">
        <Link to={buildStationUrl(view.verbund.verbundId, 'assessment')} className={`inline-flex min-h-touch items-center rounded text-sm text-[var(--color-text-secondary)] ${FOCUS_RING}`}>‹ {view.verbund.name}</Link>
        <h1 className="type-page-title break-words">{content.model.metadata.title ?? 'Prüfergebnisse'}</h1>
        <div className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-xs text-[var(--color-text-secondary)]">{document.oscalVersion}</span><OriginLabel /><ValidityBadge state={document.documentState} /></div>
        <WorkspaceNotices /><CatalogPinNotice pin={document.catalogPin} />
        <div className="space-y-2 rounded-md border border-[var(--color-border-default)] p-3 text-sm">
          <p className="break-words"><span className="text-[var(--color-text-secondary)]">Prüfplan (import-ap): </span>{content.model.importAp?.status === 'bound' ? `aufgelöst · ${content.planTitle ?? 'Prüfplan'}` : 'nicht auflösbar im aktuellen Kontext'}</p>
          <p className="break-all font-mono text-xs text-[var(--color-text-secondary)]">{content.model.importAp?.href}</p>
          {content.model.results.length > 1 ? <div className="flex flex-wrap items-center gap-2"><label htmlFor={selectId}>Ergebnis</label><select id={selectId} value={resultIndex} onChange={event => { setResultIndex(Number(event.target.value)); setSelection(undefined); }} className={`min-h-touch min-w-0 max-w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] px-2 text-base sm:text-sm ${FOCUS_RING}`}>{content.model.results.map((entry, index) => <option key={entry.path} value={index}>{entry.title ?? `Ergebnis ${index + 1}`}</option>)}</select></div> : <p className="break-words">Ergebnis: {result?.title ?? 'Kein Ergebnis.'}</p>}
          {result && <p className="break-words font-mono text-xs">{result.start ?? '—'} – {result.end ?? '—'}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="Ergebnisabschnitte" className="flex max-w-full flex-wrap rounded-md border border-[var(--color-border-default)] p-0.5">
            {(Object.keys(SECTION_NAMES) as AssessmentSection[]).map(key => <button key={key} type="button" aria-pressed={section === key} aria-controls={sectionsId} onClick={() => { setSection(key); setSelection(undefined); }} className={`min-h-touch rounded px-3 py-2 text-sm tabular-nums ${section === key ? 'bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary-main)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]'} ${FOCUS_RING}`}>{SECTION_NAMES[key]} · {result?.[key].length ?? 0}</button>)}
          </div>
          <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">Ergebnis {result ? resultIndex + 1 : 0} von {content.model.results.length}</span>
        </div>
      </header>
      <div id={sectionsId} className="flex min-h-0 flex-1 flex-col">{result && <AssessmentResultList key={`${result.path}:${section}`} result={result} section={section} selected={selection} onSelect={choose} />}</div>
      <ModelDiagnostics content={content} />
      <details className="shrink-0 border-t border-[var(--color-border-default)]">
        <summary className={`min-h-touch cursor-pointer px-4 py-3 text-sm ${FOCUS_RING}`}>Dokumentreferenzen</summary>
        <div className="max-h-60 overflow-y-auto p-4"><ReferenceEdges view={view} document={document} /></div>
      </details>
    </div>
    {selected && result && <AssessmentDetail key={selected.path} section={section} entry={selected} result={result} content={content} mobile={!twoPanels} onClose={() => setSelection(undefined)} />}
  </div>;
}

/** Lesepfad für genau das ausgewählte Dokument; Quellwerte bleiben im Seiteninhalt. */
export function AssessmentResultsPage({ view, document }: Readonly<{ view: VerbundView; document: WorkspaceDocumentView }>) {
  const { documents } = useWorkspace();
  const [loaded, setLoaded] = useState<{ view: VerbundView; content: AssessmentResultsContent | 'failed' }>();
  useEffect(() => {
    let active = true;
    void loadAssessmentResults(documents, view, document.localId)
      .then(content => { if (active) setLoaded({ view, content }); })
      .catch(() => { if (active) setLoaded({ view, content: 'failed' }); });
    return () => { active = false; };
  }, [documents, view, document.localId]);
  if (!loaded || loaded.view !== view) return <output className="p-4 text-sm">Prüfergebnisse werden geladen…</output>;
  if (loaded.content === 'failed') return <p role="alert" className="p-4 text-sm text-[var(--color-danger-text)]">Prüfergebnisse konnten nicht geladen werden. Die Dokumentansicht erneut öffnen.</p>;
  return <ResultsView key={document.localId} content={loaded.content} view={view} document={document} />;
}
