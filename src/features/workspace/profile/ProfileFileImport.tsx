import { useId, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import { buildWorkspaceDocumentUrl } from '@/app/routes';
import { Button } from '@/components/Button';
import { CLASS_2_IMPORT_LIMITS, createClass2ByteLimitDiagnostic } from '@/domain/oscalImportContract';
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

  /** Liefert den Ablehnungscode oder die `localId` des aufgenommenen Profils. */
  const admit = async (file: File): Promise<{ rejected: string } | { localId: string } | null> => {
    // Vor dem Lesen: Eine übergroße Datei wird nie in den Speicher geladen.
    if (file.size > CLASS_2_IMPORT_LIMITS.maxBytes) return { rejected: createClass2ByteLimitDiagnostic().code };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { importClass2OscalDocument } = await import('@/adapters/oscalImportGate');
    const imported = await importClass2OscalDocument(bytes, { trustClass: 'class-2-local-user' });
    if (!imported.ok) return { rejected: imported.diagnostic.code };
    if (imported.document.rootType !== 'profile') return { rejected: 'OSCAL_ROOT_NOT_PROFILE' };
    const added = await documents.addDocument(verbundId, imported.document, 'imported');
    // Ein Speicherfehler erscheint als Speichermeldung des Bereichs.
    return added.ok ? { localId: added.value.localId } : null;
  };

  const read = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setRejected(undefined);
    void admit(file)
      .catch(() => ({ rejected: 'OSCAL_IMPORT_FILE_UNREADABLE' }))
      .then((result) => {
        setBusy(false);
        if (result && 'rejected' in result) setRejected(result.rejected);
        else if (result) void navigate(buildWorkspaceDocumentUrl(verbundId, result.localId));
      });
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
        onChange={read}
      />
      <Button variant="secondary" className="min-h-touch desktop:min-h-0" disabled={!writable || busy} onClick={() => input.current?.click()}>
        Profil-Datei einlesen
      </Button>
      {rejected && (
        <output id={statusId} className="text-xs text-[var(--color-danger-text)]">
          Nicht aufgenommen: <span className="font-mono">{rejected}</span>
        </output>
      )}
    </div>
  );
}
