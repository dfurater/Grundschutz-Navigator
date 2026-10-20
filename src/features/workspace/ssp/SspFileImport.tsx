import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import { buildWorkspaceDocumentUrl } from '@/app/routes';
import { Button } from '@/components/Button';
import { CLASS_2_IMPORT_LIMITS, createClass2ByteLimitDiagnostic } from '@/domain/oscalImportContract';
import type { OscalDiagnosticStage } from '@/domain/oscalDiagnostics';
import type { LocalId, VerbundId } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';

type Rejection = { readonly stage: OscalDiagnosticStage; readonly code: string };

/** Der einzige Dateieingang der SSP-Station ist das bestehende Klasse-2-Importgate. */
export function SspFileImport({ verbundId }: Readonly<{ verbundId: VerbundId }>) {
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const cancellation = useRef<AbortController | null>(null);
  const running = useRef(false);
  const navigate = useNavigate();
  const { documents, writable, verbund } = useWorkspace();
  const [importedLocalId, setImportedLocalId] = useState<LocalId>();
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<Rejection>();
  useEffect(() => {
    const active = mounted;
    active.current = true;
    const controller = new AbortController();
    cancellation.current = controller;
    return () => { active.current = false; controller.abort(); };
  }, []);
  useEffect(() => {
    if (importedLocalId && verbund?.view?.documents.some(document => document.localId === importedLocalId)) {
      void navigate(buildWorkspaceDocumentUrl(verbundId, importedLocalId));
    }
  }, [importedLocalId, verbund, navigate, verbundId]);

  const admit = async (file: File): Promise<Rejection | null> => {
    if (file.size > CLASS_2_IMPORT_LIMITS.maxBytes) return createClass2ByteLimitDiagnostic();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!mounted.current) return null;
    const { importClass2OscalDocument } = await import('@/adapters/oscalImportGate');
    const imported = await importClass2OscalDocument(bytes, { trustClass: 'class-2-local-user' });
    if (!imported.ok) return imported.diagnostic;
    if (imported.document.rootType !== 'system-security-plan') return { stage: 'root-dispatch', code: 'OSCAL_ROOT_NOT_SSP' };
    if (!mounted.current) return null;
    const added = await documents.addDocument(verbundId, imported.document, 'imported', [], cancellation.current?.signal);
    if (added.ok && mounted.current) setImportedLocalId(added.value.localId);
    return null;
  };

  const read = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || running.current || importedLocalId || !writable) return;
    running.current = true;
    setBusy(true);
    setRejected(undefined);
    void admit(file)
      .catch((): Rejection => ({ stage: 'resource-limit', code: 'OSCAL_IMPORT_FILE_UNREADABLE' }))
      .then((result) => {
        if (!mounted.current) return;
        running.current = false;
        setBusy(false);
        if (result) setRejected(result);
      });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
      <input ref={input} id={inputId} aria-label="SSP-Datei" type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} disabled={!writable || busy || importedLocalId !== undefined} onChange={read} />
      <Button variant="secondary" className="min-h-touch desktop:min-h-0" disabled={!writable || busy || importedLocalId !== undefined} onClick={() => input.current?.click()}>
        {busy || importedLocalId ? 'SSP wird geprüft…' : 'SSP-Datei einlesen'}
      </Button>
      {rejected && <p role="alert" className="break-words text-xs text-[var(--color-danger-text)]">Nicht aufgenommen: <span className="font-mono">{rejected.stage} · {rejected.code}</span>. Eine gültige OSCAL-SSP-JSON-Datei auswählen.</p>}
    </div>
  );
}
