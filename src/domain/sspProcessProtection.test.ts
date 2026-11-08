import { describe, expect, it } from 'vitest';
import { deriveSspProcessProtection } from '@/domain/sspProcessProtection';
import { makeProcessCiaSsp } from '@/test/fixtures/processCia';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import { PROJECT_PROPS_NAMESPACE as ns } from '@/domain/projectProps';
import { targetCoverage } from '@/domain/sspTargetObjects';
import { readSspValue } from '@/domain/sspAuthoring';
import type { JsonObject } from '@/domain/jsonGuards';
import type { RawOscalProp } from '@/domain/models';

function fixture(version = '1.2.2' as (typeof PINNED_OSCAL_VERSIONS)[number], category = false) {
  const source = makeProcessCiaSsp(version, category);
  const components = readSspValue(source, ['system-implementation', 'components']) as JsonObject[];
  const metadata = readSspValue(source, ['metadata']) as JsonObject;
  return { source, components, process: components[0], application: components[1], metadata };
}

function props(node: JsonObject): RawOscalProp[] { return node.props as RawOscalProp[]; }
function remove(node: JsonObject, name: string) { node.props = props(node).filter(prop => prop.name !== name); }
function set(node: JsonObject, name: string, value: string, extra: Partial<RawOscalProp> = {}) {
  node.props = [...(node.props as RawOscalProp[] | undefined ?? []).filter(prop => prop.name !== name), { ns, name, value, ...extra }];
}
function derive(source: unknown) { return deriveSspProcessProtection(source).processes[0]; }

describe.each(PINNED_OSCAL_VERSIONS)('Prozess-CIA-Vertrag %s', version => {
  it('F1: liefert Kontext, getrennte begründete CIA-Werte und Risikoanlass', () => {
    const { source } = fixture(version);
    expect(derive(source)).toMatchObject({
      context: 'context-complete', cia: 'complete', riskConsideration: 'required',
      objectives: {
        confidentiality: { value: 'normal', remarks: expect.any(String) },
        integrity: { value: 'hoch', remarks: expect.any(String) },
        availability: { value: 'normal', remarks: expect.any(String) },
      }, diagnostics: [],
    });
  });

  it('F2: kopiert Gesamtbewertungen weder bei Altprozessen noch bei reinen Assets nach CIA', () => {
    const { source, components, process, application } = fixture(version);
    process.props = [];
    delete process['responsible-roles'];
    for (const item of components) set(item, 'protection-need-level', 'hoch', { remarks: 'Synthetischer Gesamtgrund' });
    const info = (readSspValue(source, ['system-characteristics', 'system-information', 'information-types']) as JsonObject[])[0];
    set(info, 'protection-need-level', 'hoch', { remarks: 'Synthetischer Gesamtgrund' });
    expect(targetCoverage(source).value).toBe('complete');
    expect(derive(source)).toMatchObject({ context: 'context-open', cia: 'unknown', riskConsideration: 'unknown' });
    process.type = application.type;
    expect(deriveSspProcessProtection(source)).toMatchObject({ processes: [], context: 'unclassified', cia: 'unknown', riskConsideration: 'unknown' });
  });

  it('F2-B: neuer Prozess erhöht nur den Nenner der unveränderten Objekt-Coverage', () => {
    const { source, components, process, application } = fixture(version);
    const newProcess = structuredClone(process);
    components.splice(0, components.length, application, { ...structuredClone(application), uuid: 'bbbbbbbb-0000-4000-8000-000000000003' });
    delete (readSspValue(source, ['system-characteristics', 'system-information']) as JsonObject)['information-types'];
    for (const item of components) set(item, 'protection-need-level', 'hoch', { remarks: 'Altbewertung' });
    expect(targetCoverage(source)).toEqual({ assessed: 2, total: 2, value: 'complete' });
    components.push(newProcess);
    const before = structuredClone(source);
    expect(derive(source)).toMatchObject({ context: 'context-complete', cia: 'complete' });
    expect(targetCoverage(source)).toEqual({ assessed: 2, total: 3, value: 'incomplete' });
    expect(source).toEqual(before);
  });

  it('F3-A bis D: CIA-Lücke, fehlender/geänderter/zurückgenommener Beleg bleiben unabhängig', () => {
    const { source, process, metadata } = fixture(version);
    remove(process, 'process-protection-availability');
    delete metadata.actions;
    expect(derive(source)).toMatchObject({ cia: 'partial', riskConsideration: 'required' });
    set(process, 'process-protection-availability', 'normal', { remarks: 'Ersatzverfahren' });
    expect(derive(source).cia).toBe('complete');
    set(process, 'process-protection-integrity', 'hoch', { remarks: 'Geänderter Schadensgrund' });
    metadata.actions = [{ type: 'withdrawn', system: 'https://example.invalid/actions' }];
    expect(derive(source)).toMatchObject({ cia: 'complete', riskConsideration: 'required' });
  });

  it('F3-E: zweiter unbewerteter Prozess bleibt offen und macht die Gesamtprojektion unvollständig', () => {
    const { source, process, components } = fixture(version);
    components.push({ ...structuredClone(process), uuid: 'bbbbbbbb-0000-4000-8000-000000000002', props: [{ ns, name: 'process-id', value: 'P-02' }], purpose: undefined });
    const result = deriveSspProcessProtection(source);
    expect(result).toMatchObject({ context: 'context-open', cia: 'partial', riskConsideration: 'required' });
    expect(result.processes[0]).toMatchObject({ context: 'context-complete', cia: 'complete' });
    expect(result.processes[1]).toMatchObject({ context: 'context-open', cia: 'unknown' });
  });

  it('F4: Kategorie benötigt direkten Wert und gleiches gültiges Mapping', () => {
    const { source, process, metadata } = fixture(version, true);
    expect(derive(source).objectives.integrity).toMatchObject({ value: 'hoch', category: 'cat-kritisch', mappingRemarks: expect.any(String) });
    remove(metadata, 'process-category-mapping');
    expect(derive(source).objectives.integrity.value).toBe('unknown');
    set(metadata, 'process-category-mapping', 'hoch', { group: 'cat-kritisch', remarks: 'Mappinggrund' });
    remove(process, 'process-protection-integrity');
    expect(derive(source).objectives.integrity.value).toBe('unknown');
    set(process, 'process-protection-integrity', 'hoch', { remarks: 'Schadensgrund' });
    set(metadata, 'process-category-mapping', 'normal', { group: 'cat-kritisch', remarks: 'Mappinggrund' });
    expect(derive(source)).toMatchObject({ cia: 'conflict', riskConsideration: 'unknown' });
    expect(derive(source).objectives.integrity.value).toBe('conflict');
  });

  it.each(['normal', 'hoch'])('genau ein bewertetes Ziel %s ergibt partial mit unabhängigem Risikoanlass', value => {
    const { source, process } = fixture(version);
    remove(process, 'process-protection-confidentiality');
    remove(process, 'process-protection-availability');
    set(process, 'process-protection-integrity', value, { remarks: 'Synthetischer Schadensgrund' });
    expect(derive(source)).toMatchObject({ cia: 'partial', riskConsideration: value === 'hoch' ? 'required' : 'unknown',
      objectives: { confidentiality: { value: 'unknown' }, integrity: { value }, availability: { value: 'unknown' } } });
  });
});

describe('Unabhängige Achsen und rein lesende Ableitung', () => {
  it('meldet no-high-trigger ausschließlich bei drei gültigen normalen Zielen', () => {
    const { source, process } = fixture();
    set(process, 'process-protection-integrity', 'normal', { remarks: 'Begrenzter Schaden' });
    expect(derive(source).riskConsideration).toBe('no-high-trigger');
    remove(process, 'process-protection-availability');
    expect(derive(source).riskConsideration).toBe('unknown');
  });

  it.each([
    { value: 'hoch' }, { value: 'hoch', remarks: ' ' }, { value: 'kritisch', remarks: 'Grund' },
    { value: 3, remarks: 'Grund' }, { value: 'hoch', remarks: 3 }, { value: 'hoch', remarks: 'Grund', group: 'integrity' },
  ])('wertet ungültiges vorhandenes Ziel %j als Konflikt', invalid => {
    const { source, process } = fixture();
    remove(process, 'process-protection-integrity');
    props(process).push({ ns, name: 'process-protection-integrity', ...invalid } as RawOscalProp);
    expect(derive(source)).toMatchObject({ cia: 'conflict', riskConsideration: 'unknown' });
    expect(derive(source).diagnostics.length).toBeGreaterThan(0);
  });

  it('erhält einen anderen verlässlichen hohen Anlass bei Zielkonflikt', () => {
    const { source, process } = fixture();
    set(process, 'process-protection-confidentiality', 'hoch', { remarks: 'Verlässlicher Schadensgrund' });
    props(process).push({ ns, name: 'process-protection-integrity', value: 'normal', remarks: 'Doppelung' });
    expect(derive(source)).toMatchObject({ cia: 'conflict', riskConsideration: 'required' });
    expect(derive(source).objectives.integrity.value).toBe('conflict');
  });

  it.each(['P-01', ' p-01 ', 'P-ä', 'P-ä'])('markiert alle kollidierenden fachlichen IDs invalid: %s', id => {
    const { source, process, components } = fixture();
    set(process, 'process-id', id.startsWith('P-') && id !== 'P-01' ? 'P-ä' : 'P-01');
    const other = structuredClone(process);
    other.uuid = 'bbbbbbbb-0000-4000-8000-000000000002';
    set(other, 'process-id', id);
    components.push(other);
    expect(deriveSspProcessProtection(source).processes.map(row => row.context)).toEqual(['invalid', 'invalid']);
    expect(deriveSspProcessProtection(source).processes.map(row => row.cia)).toEqual(['complete', 'complete']);
  });

  it('hält fehlende Kategoriebezeichnung/Definition im Kontext offen, Mapping bleibt auswertbar', () => {
    const { source, metadata } = fixture(undefined, true);
    remove(metadata, 'process-category-definition');
    expect(derive(source)).toMatchObject({ context: 'context-open', cia: 'complete' });
    remove(metadata, 'process-category-label');
    expect(derive(source)).toMatchObject({ context: 'context-open', cia: 'complete' });
  });

  it.each([' kritisch ', 'KRÍTISCH'])('ordnet kollidierende Kategorienamen nur den betroffenen Prozessen zu: %s', duplicate => {
    const { source, process, components, metadata } = fixture(undefined, true);
    props(metadata).find(prop => prop.name === 'process-category-label')!.value = duplicate.includes('́') ? 'Krítisch' : 'Kritisch';
    props(metadata).push({ ns, name: 'process-category-label', group: 'cat-zwei', value: duplicate });
    const other = structuredClone(process);
    other.uuid = 'bbbbbbbb-0000-4000-8000-000000000002';
    set(other, 'process-id', 'P-02');
    remove(other, 'process-protection-category');
    components.push(other);
    const before = structuredClone(source);
    const result = deriveSspProcessProtection(source);
    expect(result.processes.map(row => row.context)).toEqual(['invalid', 'context-complete']);
    expect(result.processes[0]).toMatchObject({ cia: 'complete', riskConsideration: 'required' });
    expect(result.processes[0].diagnostics).toContainEqual({ code: 'OSCAL_PROJECT_PROP_DUPLICATE_VALUE', path: '/system-security-plan/metadata/props' });
    expect(source).toEqual(before);
  });

  it('unterscheidet fehlende und ungültige Angaben und bewahrt Fremdfelder unverändert', () => {
    const { source, process } = fixture();
    delete process.purpose;
    process['foreign-field'] = { secret: 'Synthetisch', nested: [1, 2] };
    props(process).push({ ns: 'https://example.invalid', name: 'process-protection-integrity', value: 'unbekannt' });
    const before = structuredClone(source);
    expect(derive(source).context).toBe('context-open');
    expect(source).toEqual(before);
    process.purpose = 3;
    expect(derive(source).context).toBe('invalid');
    expect(JSON.stringify(derive(source).diagnostics)).not.toContain('Synthetisch');
  });

  it.each(['invalid-mapping', 'duplicate-mapping', 'invalid-category', 'duplicate-category-use', 'invalid-definition'])('meldet Kategoriefehler ohne automatische Korrektur: %s', kind => {
    const { source, process, metadata } = fixture(undefined, true);
    if (kind === 'invalid-mapping') set(metadata, 'process-category-mapping', 'hoch', { group: 'cat-kritisch' });
    if (kind === 'duplicate-mapping') props(metadata).push({ ...props(metadata).find(prop => prop.name === 'process-category-mapping')! });
    if (kind === 'invalid-category') props(process).find(prop => prop.name === 'process-protection-category')!.group = 'unbekannt';
    if (kind === 'duplicate-category-use') props(process).push({ ...props(process).find(prop => prop.name === 'process-protection-category')! });
    if (kind === 'invalid-definition') set(metadata, 'process-category-definition', ' ', { group: 'cat-kritisch' });
    const before = structuredClone(source);
    const result = derive(source);
    expect(kind === 'invalid-definition' ? result.context : result.cia).toBe(kind === 'invalid-definition' ? 'invalid' : 'conflict');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(source).toEqual(before);
  });

  it.each([null, 'keine Liste', [null]])('meldet fehlerhafte Property-Listen als Fehler: %j', invalid => {
    const { source, process } = fixture();
    process.props = invalid;
    expect(derive(source)).toMatchObject({ context: 'invalid', cia: 'conflict', riskConsideration: 'unknown' });
  });

  it('hält Diagnosepfade am Quellindex und nimmt keine Quellwerte in Diagnosen auf', () => {
    const { source, components, process } = fixture();
    components.unshift(null as unknown as JsonObject);
    process.title = '';
    set(process, 'process-id', 'Synthetische vertrauliche ID', { group: 'falsche-gruppe' });
    const result = derive(source);
    expect(result.path).toBe('/system-security-plan/system-implementation/components/1');
    expect(result.diagnostics.some(({ path }) => path.endsWith('/components/1/title'))).toBe(true);
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/vertrauliche|falsche-gruppe/);
  });

  it('hält eine leere Prozessmenge offen und errät Typen nicht aus Namen', () => {
    const { source, process } = fixture();
    process.type = 'Business-Process';
    expect(deriveSspProcessProtection(source)).toMatchObject({ processes: [], context: 'unclassified', cia: 'unknown' });
    expect(deriveSspProcessProtection({})).toMatchObject({ processes: [], context: 'unclassified', cia: 'unknown' });
  });
});

describe('Prozesskontext und Referenzen', () => {
  it.each(['title', 'description', 'purpose', 'responsible-roles'])('fehlendes %s hält den Kontext offen', field => {
    const { source, process } = fixture();
    delete process[field];
    expect(derive(source).context).toBe('context-open');
  });

  it('fehlende ID oder Anwendungen bleiben offen; bestätigter Nullfall ist vollständig', () => {
    const { source, process } = fixture();
    remove(process, 'process-id');
    expect(derive(source).context).toBe('context-open');
    set(process, 'process-id', 'P-01');
    remove(process, 'process-application-uuid');
    expect(derive(source).context).toBe('context-open');
    set(process, 'process-applications-none', 'true', { remarks: 'Rein manuell' });
    expect(derive(source).context).toBe('context-complete');
    set(process, 'process-applications-none', 'true');
    expect(derive(source).context).toBe('invalid');
  });

  it.each(['self', 'business-process', 'missing', 'duplicate', 'no-name', 'none-with-reference'])('weist ungültige Anwendungsbezüge ab: %s', kind => {
    const { source, process, application, components } = fixture();
    if (kind === 'self') set(process, 'process-application-uuid', process.uuid as string);
    if (kind === 'business-process') application.type = 'business-process';
    if (kind === 'missing') components.pop();
    if (kind === 'duplicate') components.push(structuredClone(application));
    if (kind === 'no-name') delete application.title;
    if (kind === 'none-with-reference') set(process, 'process-applications-none', 'true', { remarks: 'Widerspruch' });
    expect(derive(source).context).toBe('invalid');
  });

  it.each(['role-missing', 'role-duplicate', 'role-title', 'party-missing', 'party-duplicate', 'party-name', 'party-type', 'assignment-duplicate', 'party-ref-duplicate', 'empty-party-list'])('prüft Verantwortung: %s', kind => {
    const { source, process, metadata } = fixture();
    const roles = metadata.roles as JsonObject[];
    const parties = metadata.parties as JsonObject[];
    const assignments = process['responsible-roles'] as JsonObject[];
    if (kind === 'role-missing') roles.shift();
    if (kind === 'role-duplicate') roles.push(structuredClone(roles[0]));
    if (kind === 'role-title') roles[0].title = '';
    if (kind === 'party-missing') parties.shift();
    if (kind === 'party-duplicate') parties.push(structuredClone(parties[0]));
    if (kind === 'party-name') parties[0].name = '';
    if (kind === 'party-type') parties[0].type = 'unknown';
    if (kind === 'assignment-duplicate') assignments.push(structuredClone(assignments[0]));
    if (kind === 'party-ref-duplicate') (assignments[0]['party-uuids'] as string[]).push((assignments[0]['party-uuids'] as string[])[0]);
    if (kind === 'empty-party-list') assignments[0]['party-uuids'] = [];
    expect(derive(source).context).toBe('invalid');
  });

  it.each(['missing', 'invalid', 'duplicate'])('prüft technische Prozessidentität: %s', kind => {
    const { source, process, components } = fixture();
    if (kind === 'missing') delete process.uuid;
    if (kind === 'invalid') process.uuid = 'keine-uuid';
    if (kind === 'duplicate') components[1].uuid = process.uuid;
    expect(derive(source).context).toBe('invalid');
  });

  it('löst UUIDs ohne Änderung der Schreibweise case-insensitiv auf', () => {
    const { source, process, application, metadata } = fixture();
    application.uuid = (application.uuid as string).toUpperCase();
    (metadata.parties as JsonObject[])[0].uuid = ((metadata.parties as JsonObject[])[0].uuid as string).toUpperCase();
    set(process, 'process-priority', '0');
    expect(derive(source)).toMatchObject({ context: 'context-complete', cia: 'complete' });
  });
});
