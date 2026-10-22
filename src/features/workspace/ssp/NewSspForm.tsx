import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { buildWorkspaceDocumentUrl } from '@/app/routes';
import { Button } from '@/components/Button';
import { createSspSource, isSspTitle, NEW_SSP_OSCAL_VERSION, SSP_IMPORT_PROFILE_POINTER } from '@/domain/sspAuthoring';
import type { VerbundId } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import type { VerbundView } from '@/state/workspaceVerbundView';
import { ImportTargetPicker } from '@/features/workspace/profile/ImportTargetPicker';
import { INPUT, OscalKey } from '@/features/workspace/profile/ProfileMarks';
import { useImportTargets, type ImportTargetOption } from '@/features/workspace/profile/useImportTargets';

/**
 * Neuanlage eines SSP: Titel, dann die Baseline. Erst „SSP anlegen“ speichert;
 * das Dokument entsteht als Entwurf in OSCAL 1.2.2 mit `import-profile.href`
 * und der Bindung auf die gewählte Baseline. Die Version der Baseline begrenzt
 * die Auswahl nicht.
 */
export function NewSspForm({ view, onCancel }: Readonly<{ view: VerbundView; onCancel: () => void }>) {
  const titleId = useId();
  const pickerName = useId();
  const navigate = useNavigate();
  const { documents, writable } = useWorkspace();
  const options = useImportTargets(view);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState<ImportTargetOption>();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = isSspTitle(title) && target !== undefined && writable && !saving;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || !target) return;
    setSaving(true);
    setFailed(false);
    const { source, href } = createSspSource({
      uuid: crypto.randomUUID(), resourceUuid: crypto.randomUUID(), title, baselineTitle: target.title,
      lastModified: new Date().toISOString(),
    });
    // Dokument und Bindung in einer Transaktion: Ohne gültige Bindung entsteht kein SSP.
    const added = await documents.addDocument(view.verbund.verbundId as VerbundId, {
      source, context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion: NEW_SSP_OSCAL_VERSION,
    }, 'draft', [{ pointer: SSP_IMPORT_PROFILE_POINTER, href, target: target.target }]);
    if (!added.ok) {
      setSaving(false);
      setFailed(true);
      return;
    }
    void navigate(buildWorkspaceDocumentUrl(view.verbund.verbundId, added.value.localId));
  };

  return (
    <form onSubmit={(event) => { void submit(event); }} aria-labelledby={`${titleId}-heading`} className="space-y-4 px-4 pb-4 pt-3">
      <h3 id={`${titleId}-heading`} className="text-base font-semibold text-[var(--color-text-primary)]">Neues SSP</h3>
      <div className="max-w-2xl space-y-1">
        <label htmlFor={titleId} className="flex items-baseline gap-2 text-sm font-medium text-[var(--color-text-primary)]">
          Titel <OscalKey>metadata.title</OscalKey>
        </label>
        <input id={titleId} className={INPUT} value={title} required autoComplete="off" onChange={(event) => setTitle(event.target.value)} />
      </div>
      <fieldset className="max-w-2xl space-y-2">
        <legend className="mb-2 flex items-baseline gap-2 text-sm font-medium text-[var(--color-text-primary)]">
          Baseline <OscalKey>import-profile</OscalKey>
        </legend>
        <ImportTargetPicker name={pickerName} options={options} selected={target?.key} onSelect={setTarget} />
      </fieldset>
      {failed && <p role="alert" className="text-sm text-[var(--color-danger-text)]">Das SSP wurde nicht angelegt.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-touch desktop:min-h-0" disabled={!ready}>SSP anlegen</Button>
        <Button variant="ghost" className="min-h-touch desktop:min-h-0" onClick={onCancel}>Abbrechen</Button>
      </div>
    </form>
  );
}
