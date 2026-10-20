import { useId, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import { buildWorkspaceDocumentUrl } from '@/app/routes';
import { Button } from '@/components/Button';
import type { VerbundId } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';

/**
 * Nimmt eine Profil-Datei als lokale Kopie in den Verbund auf. Der einzige
 * Eingang ist das Klasse-2-Importgate (Größenlimit vor dem Parsen, Root-
 * Dispatch, gepinntes Schema der deklarierten Version); nur OSCAL-JSON.
 */
export function ProfileFileImport({ verbundId }: Readonly<{ verbundId: VerbundId }>) {
  const inputId = useId();
  const statusId = useId();
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { documents, writable } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<string>();

  const read = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setRejected(undefined);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { importClass2OscalDocument } = await import('@/adapters/oscalImportGate');
    const imported = await importClass2OscalDocument(bytes, { trustClass: 'class-2-local-user' });
    if (!imported.ok || imported.document.rootType !== 'profile') {
      setBusy(false);
      setRejected(imported.ok ? 'OSCAL_ROOT_NOT_PROFILE' : imported.diagnostic.code);
      return;
    }
    const added = await documents.addDocument(verbundId, imported.document, 'imported');
    setBusy(false);
    if (added.ok) void navigate(buildWorkspaceDocumentUrl(verbundId, added.value.localId));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={input}
        id={inputId}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-describedby={rejected ? statusId : undefined}
        onChange={(event) => { void read(event); }}
      />
      <Button variant="secondary" className="min-h-touch desktop:min-h-0" disabled={!writable || busy} onClick={() => input.current?.click()}>
        Profil-Datei einlesen
      </Button>
      {rejected && (
        <p id={statusId} role="status" className="text-xs text-[var(--color-danger-text)]">
          Nicht aufgenommen: <span className="font-mono">{rejected}</span>
        </p>
      )}
    </div>
  );
}
