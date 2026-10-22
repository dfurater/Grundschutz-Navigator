import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import { isJsonObject, readArray, readString } from '@/domain/jsonGuards';
import {
  addSspItem, readSspValue, removeSspComponent, sspOscalVersion, sspProtocolNameRequired, sspUsersRequired,
  SSP_COMPONENT_STATES, SSP_SYSTEM_STATES,
} from '@/domain/sspAuthoring';
import { INPUT, OscalKey, SECTION_LABEL } from '@/features/workspace/profile/ProfileMarks';
import { ImportTargetPicker } from '@/features/workspace/profile/ImportTargetPicker';
import { targetKey, type ImportTargetOption } from '@/features/workspace/profile/useImportTargets';
import { SspRowList, SspSelectField, SspTextField } from '@/features/workspace/ssp/SspFormControls';
import type { BaselineControls } from '@/features/workspace/ssp/useBaselineControls';
import type { SspEditor } from '@/features/workspace/ssp/useSspEditor';

/** Übliche Komponententypen des Metaschemas; der Typ ist freier Text. */
const COMPONENT_TYPES = ['this-system', 'system', 'interconnection', 'software', 'hardware', 'service', 'policy', 'physical', 'process-procedure', 'plan', 'guidance', 'standard', 'validation'];

export const NOT_RESOLVABLE_LABEL = 'nicht auflösbar im aktuellen Kontext';

function text(item: unknown, field: string): string | undefined {
  return isJsonObject(item) ? readString(item[field]) : undefined;
}

function rowTitle(kind: string, field: string) {
  return (item: unknown, index: number) => `${kind} ${index + 1}${text(item, field) ? ` · ${text(item, field)}` : ''}`;
}

export function FormSection({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-4 rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)] p-4">
      <h2 id={id} className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
      {children}
    </section>
  );
}

const GRID = 'grid gap-3 md:grid-cols-2';

export function MetadataSection({ editor }: Readonly<{ editor: SspEditor }>) {
  return (
    <FormSection title="Metadaten">
      <div className={GRID}>
        <SspTextField editor={editor} path={['metadata', 'title']} label="Titel" required />
        <SspTextField editor={editor} path={['metadata', 'version']} label="Dokumentversion" required />
        <SspTextField editor={editor} path={['metadata', 'published']} label="Veröffentlicht" mono />
      </div>
      <SspRowList editor={editor} path={['metadata', 'roles']} title="Rollen" uuidKeyed={false} addLabel="Rolle hinzufügen"
        newItem={() => ({})} rowTitle={rowTitle('Rolle', 'id')}
        renderRow={(path) => (
          <div className={GRID}>
            <SspTextField editor={editor} path={[...path, 'id']} label="Kennung" required mono />
            <SspTextField editor={editor} path={[...path, 'title']} label="Titel" required />
          </div>
        )} />
      <SspRowList editor={editor} path={['metadata', 'parties']} title="Parteien" uuidKeyed addLabel="Partei hinzufügen"
        newItem={() => ({ uuid: crypto.randomUUID(), type: 'organization' })} rowTitle={rowTitle('Partei', 'name')}
        renderRow={(path) => (
          <div className={GRID}>
            <SspSelectField editor={editor} path={[...path, 'type']} label="Art" options={['organization', 'person']} required />
            <SspTextField editor={editor} path={[...path, 'name']} label="Name" />
          </div>
        )} />
    </FormSection>
  );
}

export function BaselineSection({ editor, options }: Readonly<{ editor: SspEditor; options: readonly ImportTargetOption[] }>) {
  const name = useId();
  const href = readString(readSspValue(editor.working, ['import-profile', 'href']));
  return (
    <FormSection title="Baseline">
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-[var(--color-text-secondary)]">
        <OscalKey>import-profile.href</OscalKey><span className="break-all font-mono text-xs">{href ?? '–'}</span>
      </p>
      <ImportTargetPicker name={name} options={options} selected={editor.baseline ? targetKey(editor.baseline) : undefined}
        onSelect={(option) => editor.chooseBaseline(option.target, option.title)} />
    </FormSection>
  );
}

export function CharacteristicsSection({ editor }: Readonly<{ editor: SspEditor }>) {
  const sc = 'system-characteristics';
  return (
    <FormSection title="Systemmerkmale">
      <SspRowList editor={editor} path={[sc, 'system-ids']} title="Systemkennungen" required uuidKeyed={false} addLabel="Systemkennung hinzufügen"
        newItem={() => ({})} rowTitle={rowTitle('Systemkennung', 'id')}
        renderRow={(path) => (
          <div className={GRID}>
            <SspTextField editor={editor} path={[...path, 'id']} label="Kennung" required mono />
            <SspTextField editor={editor} path={[...path, 'identifier-type']} label="Kennungssystem" mono />
          </div>
        )} />
      <div className={GRID}>
        <SspTextField editor={editor} path={[sc, 'system-name']} label="Systemname" required />
        <SspTextField editor={editor} path={[sc, 'system-name-short']} label="Kurzname" />
      </div>
      <SspTextField editor={editor} path={[sc, 'description']} label="Beschreibung" required multiline />
      <SspSelectField editor={editor} path={[sc, 'status', 'state']} label="Betriebsstatus" options={SSP_SYSTEM_STATES} required />
      <SspTextField editor={editor} path={[sc, 'authorization-boundary', 'description']} label="Systemgrenze" required multiline />
      <SspRowList editor={editor} path={[sc, 'system-information', 'information-types']} title="Informationsarten" required uuidKeyed
        addLabel="Informationsart hinzufügen" newItem={() => ({ uuid: crypto.randomUUID() })} rowTitle={rowTitle('Informationsart', 'title')}
        renderRow={(path) => (
          <>
            <SspTextField editor={editor} path={[...path, 'title']} label="Titel" required />
            <SspTextField editor={editor} path={[...path, 'description']} label="Beschreibung" required multiline />
          </>
        )} />
    </FormSection>
  );
}

export function ImplementationSection({ editor }: Readonly<{ editor: SspEditor }>) {
  const si = 'system-implementation';
  const version = sspOscalVersion(editor.working);
  const typesId = useId();
  return (
    <FormSection title="Systemimplementierung">
      <datalist id={typesId}>{COMPONENT_TYPES.map((type) => <option key={type} value={type} />)}</datalist>
      <SspRowList editor={editor} path={[si, 'components']} title="Komponenten" required uuidKeyed addLabel="Komponente hinzufügen"
        newItem={() => ({ uuid: crypto.randomUUID() })} remove={removeSspComponent} rowTitle={rowTitle('Komponente', 'title')}
        renderRow={(path, item) => (
          <>
            <div className={GRID}>
              <SspTextField editor={editor} path={[...path, 'title']} label="Titel" required />
              <SspTextField editor={editor} path={[...path, 'type']} label="Typ" required mono list={typesId} />
            </div>
            <SspTextField editor={editor} path={[...path, 'description']} label="Beschreibung" required multiline />
            <SspSelectField editor={editor} path={[...path, 'status', 'state']} label="Status" options={SSP_COMPONENT_STATES} required />
            {readArray(isJsonObject(item) ? item.protocols : undefined).map((protocol, index) => (
              <SspTextField key={text(protocol, 'uuid') ?? `protocol-${index}`} editor={editor} path={[...path, 'protocols', index, 'name']} label={`Protokoll ${index + 1}`} required={sspProtocolNameRequired(version)} mono />
            ))}
          </>
        )} />
      <SspRowList editor={editor} path={[si, 'users']} title="Benutzer" required={sspUsersRequired(version)} uuidKeyed addLabel="Benutzer hinzufügen"
        newItem={() => ({ uuid: crypto.randomUUID() })} rowTitle={rowTitle('Benutzer', 'title')}
        renderRow={(path) => (
          <div className={GRID}>
            <SspTextField editor={editor} path={[...path, 'title']} label="Titel" />
            <SspTextField editor={editor} path={[...path, 'short-name']} label="Kurzname" />
          </div>
        )} />
    </FormSection>
  );
}

export function ControlImplementationSection({ editor, controls }: Readonly<{ editor: SspEditor; controls: BaselineControls }>) {
  const ci = 'control-implementation';
  const selectId = useId();
  const [choice, setChoice] = useState('');
  const known = controls === null ? undefined : new Set(controls);
  const add = () => {
    const controlId = choice.trim();
    if (controlId === '') return;
    if (editor.apply((source) => addSspItem(source, [ci, 'implemented-requirements'], { uuid: crypto.randomUUID(), 'control-id': controlId }))) setChoice('');
  };
  return (
    <FormSection title="Anforderungsumsetzung">
      <SspTextField editor={editor} path={[ci, 'description']} label="Beschreibung" required multiline />
      <SspRowList editor={editor} path={[ci, 'implemented-requirements']} title="Anforderungen" required uuidKeyed addLabel="Anforderung hinzufügen"
        rowTitle={rowTitle('Anforderung', 'control-id')}
        renderRow={(_path, item) => {
          const controlId = text(item, 'control-id');
          let state: string | undefined = NOT_RESOLVABLE_LABEL;
          if (known) state = controlId !== undefined && known.has(controlId) ? undefined : 'nicht in der Baseline';
          return (
            <p className="flex flex-wrap items-baseline gap-x-3 text-sm">
              <span className="font-mono text-[var(--color-text-primary)]">{controlId ?? '–'}</span>
              {state && <span className="text-xs text-[var(--color-text-secondary)]">{state}</span>}
            </p>
          );
        }} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-48 space-y-1">
          <label htmlFor={selectId} className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-[var(--color-text-primary)]">
            Neue Anforderung <OscalKey>control-id</OscalKey>
            {controls === null && <span className={SECTION_LABEL}>{NOT_RESOLVABLE_LABEL}</span>}
          </label>
          {controls === null
            ? <input id={selectId} className={`${INPUT} font-mono`} value={choice} autoComplete="off" onChange={(event) => setChoice(event.target.value)} />
            : (
              <select id={selectId} className={`${INPUT} font-mono`} value={choice} onChange={(event) => setChoice(event.target.value)}>
                <option value="">–</option>
                {controls.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            )}
        </div>
        <Button variant="secondary" className="min-h-touch desktop:min-h-0" disabled={choice.trim() === ''} onClick={add}>Anforderung hinzufügen</Button>
      </div>
    </FormSection>
  );
}
