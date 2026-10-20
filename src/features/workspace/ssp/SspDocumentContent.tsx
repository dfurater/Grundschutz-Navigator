import { useEffect, useState } from 'react';
import { parseSspDocument } from '@/adapters/oscalSspDocument';
import type { LocalId } from '@/domain/workspaceModel';
import type { SystemSecurityPlan } from '@/domain/systemSecurityPlanModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { SspFields, SspSection } from '@/features/workspace/ssp/SspFields';
import { Button } from '@/components/Button';

/** Hält nur die Projektion des ausgewählten SSP; der geladene Quellgraph wird danach entlassen. */
export function SspDocumentContent({ localId }: Readonly<{ localId: LocalId }>) {
  const { documents } = useWorkspace();
  const [result, setResult] = useState<SystemSecurityPlan | 'failed' | null>(null);
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(50);
  useEffect(() => {
    let current = true;
    void documents.getDocument(localId).then(loaded => {
      if (!current) return;
      if (!loaded.ok || loaded.value?.rootType !== 'system-security-plan') {
        setResult('failed');
        return;
      }
      setResult(parseSspDocument(loaded.value.source, { trustClass: loaded.value.trustClass }).view);
    }).catch(() => { if (current) setResult('failed'); });
    return () => { current = false; };
  }, [documents, localId]);

  if (!result) return <p role="status" className="text-sm text-[var(--color-text-secondary)]">SSP wird geladen…</p>;
  if (result === 'failed') return <p role="alert" className="text-sm text-[var(--color-danger-text)]">SSP konnte nicht geladen werden. Die Dokumentansicht erneut öffnen.</p>;
  return (
    <>
      <p className="text-sm text-[var(--color-text-secondary)]">Lesende Ansicht der dokumentierten Umsetzung. Eine Implementierungsbehauptung ist kein Prüfergebnis.</p>
      <div className="min-w-0 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
        <SspSection title="Metadaten"><SspFields value={{ uuid: result.uuid, ...result.metadata }} /></SspSection>
        <SspSection title="Baseline">
          <SspFields value={result.importProfile} />
          <p className="text-sm text-[var(--color-text-secondary)]">Anforderungsbezüge: nicht auflösbar im aktuellen Kontext. Verknüpfte Dokumente stehen unter Referenzen.</p>
        </SspSection>
        <SspSection title="Systemmerkmale"><SspFields value={result.systemCharacteristics} /></SspSection>
        <SspSection title="Systemimplementierung"><SspFields value={result.systemImplementation} /></SspSection>
        <SspSection title="Anforderungsumsetzung"><SspFields value={result.controlImplementation} /></SspSection>
      </div>
      <section aria-labelledby="ssp-model-diagnostics">
        <h2 id="ssp-model-diagnostics" className="text-base font-semibold text-[var(--color-text-primary)]">Modelldiagnosen</h2>
        {result.diagnostics.length ? <ul className="divide-y divide-[var(--color-border-subtle)]">{result.diagnostics.slice(0, diagnosticsVisible).map((diagnostic, index) => (
          <li key={index} className="break-words py-2 font-mono text-xs text-[var(--color-text-secondary)]">{diagnostic.stage} · {diagnostic.code} · {diagnostic.path}</li>
        ))}</ul> : <p className="text-sm text-[var(--color-text-secondary)]">Keine Modelldiagnosen.</p>}
        {diagnosticsVisible < result.diagnostics.length && <Button variant="secondary" className="min-h-touch tabular-nums" onClick={() => setDiagnosticsVisible(count => count + 50)}>Weitere Modelldiagnosen · {diagnosticsVisible} von {result.diagnostics.length}</Button>}
      </section>
    </>
  );
}
