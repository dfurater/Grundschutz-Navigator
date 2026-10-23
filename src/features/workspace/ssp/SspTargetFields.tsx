import { useEffect, useId, useState } from 'react';
import { uuidKey } from '@/adapters/oscalSspReaders';
import { Button } from '@/components/Button';
import { CheckboxLabel } from '@/components/CheckboxLabel';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { isJsonObject, readArray, readString } from '@/domain/jsonGuards';
import { bindSspCategories, setTargetCategories, setTargetProtection, targetCategoryClosure, targetProps } from '@/domain/sspTargetObjects';
import { readSspValue, setSspValue, type SspPath } from '@/domain/sspAuthoring';
import { INPUT } from '@/features/workspace/profile/ProfileMarks';
import { SspRowList } from '@/features/workspace/ssp/SspFormControls';
import type { SspEditor } from '@/features/workspace/ssp/useSspEditor';

function ProtectionForm({ editor, path }: Readonly<{ editor: SspEditor; path: SspPath }>) {
  const prop = targetProps(readSspValue(editor.working, path), 'protection-need-level')[0];
  const id = useId();
  const [level, setLevel] = useState(prop?.value ?? '');
  const [remarks, setRemarks] = useState(prop?.remarks ?? '');
  const [confirming, setConfirming] = useState(false);
  const { setTargetFormPending } = editor;
  useEffect(() => () => setTargetFormPending(id, false), [id, setTargetFormPending]);
  const update = (nextLevel: string, nextRemarks: string) => {
    setLevel(nextLevel);
    setRemarks(nextRemarks);
    setTargetFormPending(id, nextLevel !== (prop?.value ?? '') || nextRemarks !== (prop?.remarks ?? ''));
  };
  return <div className="space-y-2 border-t border-[var(--color-border-subtle)] pt-3">
    {!prop && <p className="text-sm text-[var(--color-text-secondary)]">Schutzbedarf noch nicht bewertet</p>}
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1"><label htmlFor={id} className="text-sm font-medium">Schutzbedarf</label><select id={id} className={INPUT} value={level} onChange={event => update(event.target.value, remarks)}><option value="">Bitte wählen</option><option value="normal">normal</option><option value="hoch">hoch</option></select></div>
      <div className="space-y-1"><label htmlFor={`${id}-remarks`} className="text-sm font-medium">Begründung des Schutzbedarfs</label><textarea id={`${id}-remarks`} className={`${INPUT} min-h-20`} value={remarks} onChange={event => update(level, event.target.value)} /></div>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" className="min-h-touch desktop:min-h-0" disabled={(level !== 'normal' && level !== 'hoch') || !remarks.trim() || (level === prop?.value && remarks === prop?.remarks)} onClick={() => { editor.apply(source => setTargetProtection(source, path, level as 'normal' | 'hoch', remarks)); }}>Bewertung übernehmen</Button>
      {prop && <Button variant="ghost" size="sm" className="min-h-touch desktop:min-h-0" onClick={() => setConfirming(true)}>Bewertung entfernen…</Button>}
      {(level !== (prop?.value ?? '') || remarks !== (prop?.remarks ?? '')) && <Button variant="ghost" size="sm" className="min-h-touch desktop:min-h-0" onClick={() => update(prop?.value ?? '', prop?.remarks ?? '')}>Eingaben zurücksetzen</Button>}
    </div>
    <ConfirmDialog open={confirming} title="Schutzbedarfsbewertung entfernen?" confirmLabel="Bewertung entfernen" onCancel={() => setConfirming(false)} onConfirm={() => { editor.apply(source => setTargetProtection(source, path, undefined)); setConfirming(false); }}>Die Bewertung und ihre Begründung werden entfernt. Das Zielobjekt ist anschließend noch nicht bewertet.</ConfirmDialog>
  </div>;
}

/** Direkte Auswahl ist bedienbar, abgeleitete Eltern tragen ausschließlich Herkunftstext. */
export function SspTargetFields({ editor, path }: Readonly<{ editor: SspEditor; path: SspPath }>) {
  const id = useId();
  const item = readSspValue(editor.working, path);
  const prop = targetProps(item, 'protection-need-level')[0];
  const closure = targetCategoryClosure(editor.working, path, editor.categories, id);
  const [binding, setBinding] = useState(false);
  const categoryLabel = (uuid: string) => editor.categories?.namespace.entries.find(entry => entry.columns.UUID.toLowerCase() === uuid)?.value ?? uuid;
  return <>
    <ProtectionForm key={JSON.stringify(prop)} editor={editor} path={path} />
    <fieldset className="space-y-2 border-t border-[var(--color-border-subtle)] pt-3">
      <legend className="text-sm font-semibold">Zielobjektkategorien</legend>
      {closure.status === 'ready' && editor.categories ? <>
        <div className="grid gap-x-4 md:grid-cols-2">{editor.categories.namespace.entries.map(entry => {
          const uuid = entry.columns.UUID.toLowerCase();
          return <CheckboxLabel key={uuid} checked={closure.direct.includes(uuid)} label={entry.value} onChange={checked => {
            const selected = checked ? [...closure.direct, uuid] : closure.direct.filter(value => value !== uuid);
            editor.apply(source => setTargetCategories(source, path, selected, editor.categories!));
          }} />;
        })}</div>
        {closure.direct.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">Keine Kategorie gewählt. Eine passende Kategorie muss fachlich geprüft werden.</p>}
        <p className="text-sm font-medium tabular-nums">Wirksame Kategorien · {closure.effective.length}</p>
        <ul className="space-y-1 text-sm text-[var(--color-text-secondary)]">{closure.entries.map(entry => <li key={entry.uuid}>{categoryLabel(entry.uuid)} · {entry.direct ? 'direkt gewählt' : 'abgeleitet'}{entry.derivedFrom.length > 0 && ` · aus ${entry.derivedFrom.map(categoryLabel).join(', ')}`}</li>)}</ul>
      </> : <>
        <p className="text-sm text-[var(--color-text-secondary)]">Kategorien nicht nachgeprüft. Für Änderungen ist derselbe verifizierte Katalog- und Vokabularstand erforderlich.</p>
        {targetProps(item, 'effective-target-object-category').map(prop => <p key={prop.value} className="break-all font-mono text-xs">{prop.value} · nicht nachgeprüft</p>)}
        {editor.categories && !editor.targetFailure && <Button variant="secondary" size="sm" className="min-h-touch desktop:min-h-0" onClick={() => setBinding(true)}>Kategorienstand binden…</Button>}
      </>}
    </fieldset>
    <ConfirmDialog open={binding} title="GSPP-Kategorienstand binden?" confirmLabel="Kategorienstand binden" onCancel={() => setBinding(false)} onConfirm={() => {
      if (editor.categories) editor.apply(source => bindSspCategories(source, editor.categories!));
      setBinding(false);
    }}>Die Kategorienbewertung wird an den ausgelieferten, verifizierten GSPP-Stand gebunden. Ein vorhandener anderer Stand wird nicht ersetzt.<span className="block break-all font-mono text-xs">{editor.categories?.commit}</span></ConfirmDialog>
  </>;
}

export function InventoryReferences({ editor, path }: Readonly<{ editor: SspEditor; path: SspPath }>) {
  const id = useId();
  const components = readArray(readSspValue(editor.working, ['system-implementation', 'components'])).filter(isJsonObject);
  return <SspRowList editor={editor} path={[...path, 'implemented-components']} title="Lokale Komponentenbezüge" uuidKeyed={false} addLabel="Komponentenbezug hinzufügen" newItem={() => ({})} rowTitle={(_, index) => `Komponentenbezug ${index + 1}`} renderRow={(row, item) => {
    const value = isJsonObject(item) ? readString(item['component-uuid']) ?? '' : '';
    const fieldId = `${id}-${row.at(-1)}`;
    return <div className="space-y-1"><label htmlFor={fieldId} className="text-sm font-medium">Lokale Komponente</label><select id={fieldId} className={`${INPUT} font-mono`} value={value} onChange={event => { editor.apply(source => setSspValue(source, [...row, 'component-uuid'], event.target.value)); }}>
      <option value="">Bitte wählen</option>
      {value && !components.some(component => uuidKey(String(component.uuid)) === uuidKey(value)) && <option value={value}>{value} · nicht auflösbar</option>}
      {components.map(component => <option key={String(component.uuid)} value={uuidKey(String(component.uuid)) === uuidKey(value) ? value : String(component.uuid)}>{readString(component.title) ?? 'Komponente'} · {String(component.uuid)}</option>)}
    </select></div>;
  }} />;
}

/** Rollen und Parteien sind native lokale Referenzen; vorhandene Zuweisungsfelder bleiben erhalten. */
export function TargetResponsibility({ editor, path, inventory = false }: Readonly<{ editor: SspEditor; path: SspPath; inventory?: boolean }>) {
  const id = useId();
  const roles = readArray(readSspValue(editor.working, ['metadata', 'roles'])).filter(isJsonObject);
  const parties = readArray(readSspValue(editor.working, ['metadata', 'parties'])).filter(isJsonObject);
  return <SspRowList editor={editor} path={[...path, inventory ? 'responsible-parties' : 'responsible-roles']} title="Verantwortlichkeiten" uuidKeyed={false} addLabel="Verantwortlichkeit hinzufügen" newItem={() => ({})} rowTitle={(_, index) => `Verantwortlichkeit ${index + 1}`} renderRow={(row, item) => {
    const value = isJsonObject(item) ? readString(item['role-id']) ?? '' : '';
    const fieldId = `${id}-${row.at(-1)}`;
    return <div className="space-y-2">
      <label htmlFor={fieldId} className="block text-sm font-medium">Verantwortliche Rolle</label>
      <select id={fieldId} className={INPUT} value={value} onChange={event => { editor.apply(source => setSspValue(source, [...row, 'role-id'], event.target.value)); }}>
        <option value="">Bitte wählen</option>
        {value && !roles.some(role => role.id === value) && <option value={value}>{value} · nicht auflösbar</option>}
        {roles.map(role => <option key={String(role.id)} value={String(role.id)}>{readString(role.title) ?? String(role.id)}</option>)}
      </select>
      <SspRowList editor={editor} path={[...row, 'party-uuids']} title="Verantwortliche Parteien" uuidKeyed={false} addLabel="Parteibezug hinzufügen" newItem={() => ''} rowTitle={(_, index) => `Parteibezug ${index + 1}`} renderRow={(partyPath, party) => {
        const partyId = `${fieldId}-party-${partyPath.at(-1)}`;
        return <><label htmlFor={partyId} className="block text-sm font-medium">Lokale Partei</label><select id={partyId} className={`${INPUT} font-mono`} value={typeof party === 'string' ? party : ''} onChange={event => { editor.apply(source => setSspValue(source, partyPath, event.target.value)); }}>
          <option value="">Bitte wählen</option>
          {typeof party === 'string' && party && !parties.some(candidate => uuidKey(String(candidate.uuid)) === uuidKey(party)) && <option value={party}>{party} · nicht auflösbar</option>}
          {parties.map(candidate => <option key={String(candidate.uuid)} value={typeof party === 'string' && uuidKey(String(candidate.uuid)) === uuidKey(party) ? party : String(candidate.uuid)}>{readString(candidate.name) ?? String(candidate.uuid)}</option>)}
        </select></>;
      }} />
    </div>;
  }} />;
}
