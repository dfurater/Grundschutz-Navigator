import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { buildWorkspaceDocumentUrl } from '@/app/routes';
import { Button } from '@/components/Button';
import { createProfileSource, importHrefPointer, isProfileTitle } from '@/domain/profileImportList';
import { isPinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import type { VerbundId } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import type { VerbundView } from '@/state/workspaceVerbundView';
import { ImportTargetPicker } from '@/features/workspace/profile/ImportTargetPicker';
import { INPUT, OscalKey } from '@/features/workspace/profile/ProfileMarks';
import { useImportTargets, type ImportTargetOption } from '@/features/workspace/profile/useImportTargets';

/**
 * Neuanlage eines Profils (Mockup 1): Titel, dann das Importziel. Erst „Profil
 * anlegen“ speichert; das Dokument trägt von Anfang an die `oscal-version`
 * des Ziels, einen Import mit `href` und die Bindung auf das Ziel.
 */
export function NewProfileForm({ view, onCancel }: Readonly<{ view: VerbundView; onCancel: () => void }>) {
  const titleId = useId();
  const pickerName = useId();
  const navigate = useNavigate();
  const { documents, writable } = useWorkspace();
  const options = useImportTargets(view);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState<ImportTargetOption>();
  const [saving, setSaving] = useState(false);
  const ready = isProfileTitle(title) && target !== undefined && writable && !saving;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || !target) return;
    const oscalVersion = target.oscalVersion;
    if (!isPinnedOscalVersion(oscalVersion)) return;
    setSaving(true);
    const resourceUuid = crypto.randomUUID();
    const { source, href } = createProfileSource({
      uuid: crypto.randomUUID(), resourceUuid, title: target.title, profileTitle: title.trim(),
      oscalVersion, lastModified: new Date().toISOString(),
    });
    const added = await documents.addDocument(view.verbund.verbundId as VerbundId, {
      source, context: { trustClass: 'class-2-local-user' }, rootType: 'profile', oscalVersion,
    }, 'draft');
    if (!added.ok) {
      setSaving(false);
      return;
    }
    const bound = await documents.setBinding({ fromLocalId: added.value.localId, pointer: importHrefPointer(0), href, target: target.target }, added.value.savedAt);
    if (!bound.ok) {
      // Ohne Bindung bleibt kein halbes Profil zurück.
      await documents.deleteDocument(added.value.localId);
      setSaving(false);
      return;
    }
    void navigate(buildWorkspaceDocumentUrl(view.verbund.verbundId, added.value.localId));
  };

  return (
    <form onSubmit={(event) => { void submit(event); }} aria-labelledby={`${titleId}-heading`} className="space-y-4 px-4 pb-4 pt-3">
      <h3 id={`${titleId}-heading`} className="text-base font-semibold text-[var(--color-text-primary)]">Neues Profil</h3>
      <div className="max-w-2xl space-y-1">
        <label htmlFor={titleId} className="flex items-baseline gap-2 text-sm font-medium text-[var(--color-text-primary)]">
          Titel <OscalKey>metadata.title</OscalKey>
        </label>
        <input id={titleId} className={INPUT} value={title} required autoComplete="off" onChange={(event) => setTitle(event.target.value)} />
      </div>
      <fieldset className="max-w-2xl space-y-2">
        <legend className="mb-2 flex items-baseline gap-2 text-sm font-medium text-[var(--color-text-primary)]">
          Importziel <OscalKey>imports[0]</OscalKey>
        </legend>
        <ImportTargetPicker name={pickerName} options={options} selected={target?.key} onSelect={setTarget} />
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-touch desktop:min-h-0" disabled={!ready}>Profil anlegen</Button>
        <Button variant="ghost" className="min-h-touch desktop:min-h-0" onClick={onCancel}>Abbrechen</Button>
      </div>
    </form>
  );
}
