import { describe, expect, it } from 'vitest';
import { makeProcessCiaSsp } from '@/test/fixtures/processCia';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import { readSspValue } from '@/domain/sspAuthoring';
import type { JsonObject } from '@/domain/jsonGuards';
import { processContentHash } from '@/domain/sspProcessProjection';
import { deriveProcessApproval, appendProcessDecision, processHandoff } from '@/domain/sspProcessApproval';
import { PROJECT_PROPS_NAMESPACE as ns, PROCESS_CIA_ACTIONS_SYSTEM } from '@/domain/projectProps';
import { processProjection } from '@/domain/sspProcessProjection';
import { validateSspTargets } from '@/domain/sspTargetObjects';

const processUuid = 'aaaaaaaa-0000-4000-8000-000000000002';
const partyUuid = 'aaaaaaaa-0000-4000-8000-000000000005';
const decisionParties = [{ 'role-id': 'institution-management', 'party-uuids': [partyUuid] }];
const hashes = ['52fbb117f6b08864545649a04d95893ce245be47808b43b8ebc2524b72f6c6cf', '7bfc32828d8f29ef903595334fef5c058c9685b4c529a7f4362fb540b5aa77b7', '586a5a2270cb22adca1ab7f5cfa3b9ffc47c26da6939005aa47cba03a8d1f950', '24dbad90c73d6cdb255e97f7826be3e9e7770ccbdca6b66f8c22cce3bb13f640'];

function fixture(category = false) {
  const source = makeProcessCiaSsp('1.2.2', category);
  const metadata = readSspValue(source, ['metadata']) as JsonObject;
  const components = readSspValue(source, ['system-implementation', 'components']) as JsonObject[];
  return { source, metadata, components, process: components[0], application: components[1] };
}
const decision = { processUuid, type: 'approved' as const, uuid: 'bbbbbbbb-0000-4000-8000-000000000006', date: '2026-11-08T12:00:00Z', partyUuids: [partyUuid], remarks: 'Erklärte Leitungsentscheidung' };
function props(node: JsonObject) { return node.props as JsonObject[]; }
function changeProp(node: JsonObject, name: string, change: JsonObject) { Object.assign(props(node).find(prop => prop.name === name)!, change); }

describe('Prozessbindung process-cia/3', () => {
  it.each(PINNED_OSCAL_VERSIONS)('reproduziert den Vertrags-Hash %s ohne Mutation', async version => {
    const source = makeProcessCiaSsp(version);
    const before = structuredClone(source);
    expect(await processContentHash(source, processUuid, decisionParties)).toBe(`process-cia/3:sha-256:${hashes[PINNED_OSCAL_VERSIONS.indexOf(version)]}`);
    expect(source).toEqual(before);
  });

  it('liest F1 als current und liefert einen freigegebenen Übergabestand', async () => {
    const { source } = fixture();
    const approval = await deriveProcessApproval(source, processUuid);
    expect(approval).toMatchObject({ state: 'current', sequence: 1 });
    expect(processHandoff(source, processUuid, approval)).toMatchObject({ status: 'approved', sspUuid: 'aaaaaaaa-0000-4000-8000-000000000001', processUuid, id: 'P-01', riskConsideration: 'required', gaps: [] });
  });

  it.each(['priority', 'excluded-process', 'excluded-application', 'excluded-info', 'other-process', 'other-party', 'document-action', 'reserialization', 'catalog'])(`behält current bei %s`, async kind => {
    const f = fixture();
    if (kind === 'priority') f.process.props = props(f.process).filter(prop => prop.name !== 'process-priority');
    if (kind.startsWith('excluded-')) {
      const info = (readSspValue(f.source, ['system-characteristics', 'system-information', 'information-types']) as JsonObject[])[0];
      const node = kind === 'excluded-process' ? f.process : kind === 'excluded-application' ? f.application : info;
      node.props = [...(node.props as JsonObject[] ?? []), ...['protection-need-level', 'target-object-category', 'effective-target-object-category'].map(name => ({ ns, name, value: 'synthetic', remarks: 'Ungebundener Grund', group: 'gspp' }))];
    }
    if (kind === 'other-process') f.components.push({ uuid: 'bbbbbbbb-0000-4000-8000-000000000002', type: 'business-process' });
    if (kind === 'other-party') (f.metadata.parties as JsonObject[]).push({ uuid: 'bbbbbbbb-0000-4000-8000-000000000004', type: 'organization', name: 'Unbeteiligt' });
    if (kind === 'document-action') (f.metadata.actions as JsonObject[]).push({ uuid: 'cccccccc-0000-4000-8000-000000000006', system: 'https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/actions', type: 'approved' });
    if (kind === 'reserialization') { f.metadata['last-modified'] = '2026-10-27T16:00:00+00:00'; f.source = JSON.parse(JSON.stringify(f.source)); }
    if (kind === 'catalog') f.metadata.props = [{ ns, name: 'catalog-commit', value: 'b'.repeat(40), group: 'gspp' }];
    expect(await deriveProcessApproval(f.source, processUuid)).toMatchObject({ state: 'current' });
  });

  it.each(['reason', 'id', 'responsibility', 'party', 'application', 'scope', 'native-impact', 'foreign-property'])(`macht den Beleg stale bei %s`, async kind => {
    const f = fixture();
    if (kind === 'reason') changeProp(f.process, 'process-protection-integrity', { remarks: 'Geänderter Grund' });
    if (kind === 'id') changeProp(f.process, 'process-id', { value: 'P-02' });
    if (kind === 'responsibility') (f.process['responsible-roles'] as JsonObject[])[0]['party-uuids'] = [partyUuid];
    if (kind === 'party') (f.metadata.parties as JsonObject[])[0].name = 'Anderer Fachbereich';
    if (kind === 'application') f.application.description = 'Andere Anwendung';
    if (kind === 'scope') (readSspValue(f.source, ['system-characteristics']) as JsonObject).description = 'Anderer Scope';
    if (kind === 'native-impact') (readSspValue(f.source, ['system-characteristics', 'system-information', 'information-types']) as JsonObject[])[0]['integrity-impact'] = { base: 'high' };
    if (kind === 'foreign-property') props(f.process).push({ ns: 'https://example.invalid', name: 'process-priority', value: '2' });
    expect(await deriveProcessApproval(f.source, processUuid)).toMatchObject({ state: 'stale' });
  });

  it('bindet Kategorienmapping und transitive Organisationsparteien vollständig', async () => {
    const f = fixture(true);
    const hash = await processContentHash(f.source, processUuid, decisionParties);
    changeProp(f.metadata, 'process-category-mapping', { remarks: 'Neue Mappingbegründung' });
    expect(await processContentHash(f.source, processUuid, decisionParties)).not.toBe(hash);
    const parties = f.metadata.parties as JsonObject[];
    parties[0]['member-of-organizations'] = [partyUuid];
    expect((processProjection(f.source, processUuid, decisionParties).parties as JsonObject[])).toHaveLength(2);
    parties[1]['member-of-organizations'] = [parties[0].uuid];
    expect(() => processProjection(f.source, processUuid, decisionParties)).toThrow('SSP_PROCESS_BINDING_INVALID');
  });

  it('blockiert neue Freigaben bei ID-Kollision und erhält bestehende current-Belege', async () => {
    const f = fixture();
    const other = structuredClone(f.process);
    other.uuid = 'bbbbbbbb-0000-4000-8000-000000000002';
    changeProp(other, 'process-id', { value: ' p-01 ' });
    f.components.push(other);
    const approval = await deriveProcessApproval(f.source, processUuid);
    expect(approval.state).toBe('current');
    expect(processHandoff(f.source, processUuid, approval)).toMatchObject({ status: 'provisional', gaps: ['context'] });
    expect(() => appendProcessDecision(f.source, decision, hashes[3])).toThrow();
  });

  it('schreibt ohne Priorität oder vollständige Objekt-Coverage und erhält fremde Aktionen', async () => {
    const f = fixture();
    delete f.metadata.actions;
    f.process.props = props(f.process).filter(prop => prop.name !== 'process-priority');
    const source = appendProcessDecision(f.source, decision, await processContentHash(f.source, processUuid, decisionParties));
    expect(await deriveProcessApproval(source, processUuid)).toMatchObject({ state: 'current', sequence: 1, actionUuid: decision.uuid });
    expect(f.metadata.actions).toBeUndefined();
  });

  it.each(['purpose', 'process-protection-availability'])('schreibt bei fehlendem %s keine Freigabe', async field => {
    const f = fixture();
    if (field === 'purpose') delete f.process.purpose;
    else f.process.props = props(f.process).filter(prop => prop.name !== field);
    const hash = await processContentHash(f.source, processUuid, decisionParties);
    expect(() => appendProcessDecision(f.source, decision, hash)).toThrow();
  });

  it('ersetzt Freigaben fachlich, nimmt nur die letzte zurück und reaktiviert keinen Vorgänger', async () => {
    const f = fixture();
    const hash = await processContentHash(f.source, processUuid, decisionParties);
    const twice = appendProcessDecision(f.source, decision, hash);
    const withdrawn = appendProcessDecision(twice, { ...decision, uuid: 'cccccccc-0000-4000-8000-000000000006', type: 'withdrawn' });
    expect(await deriveProcessApproval(withdrawn, processUuid)).toMatchObject({ state: 'withdrawn', sequence: 3 });
    const actions = readSspValue(withdrawn, ['metadata', 'actions']) as JsonObject[];
    expect(actions).toHaveLength(3);
    expect(props(actions[2])).toContainEqual({ ns, name: 'process-cia-withdraws', value: decision.uuid });
    expect(() => appendProcessDecision(withdrawn, { ...decision, uuid: 'dddddddd-0000-4000-8000-000000000006', type: 'withdrawn' })).toThrow();
    const again = appendProcessDecision(withdrawn, { ...decision, uuid: 'eeeeeeee-0000-4000-8000-000000000006' }, hash);
    expect(await deriveProcessApproval(again, processUuid)).toMatchObject({ state: 'current', sequence: 4 });
  });

  it.each(['gap', 'duplicate-sequence', 'duplicate-uuid', 'foreign-withdrawal', 'unknown-hash', 'date', 'remarks', 'party', 'system', 'missing-target'])(`weist eine fehlerhafte Kette ab: %s`, async kind => {
    const f = fixture();
    const first = (f.metadata.actions as JsonObject[])[0];
    const next = structuredClone(first);
    next.uuid = decision.uuid;
    changeProp(next, 'process-cia-sequence', { value: '2' });
    if (kind === 'gap') changeProp(next, 'process-cia-sequence', { value: '3' });
    if (kind === 'duplicate-sequence') changeProp(next, 'process-cia-sequence', { value: '1' });
    if (kind === 'duplicate-uuid') next.uuid = first.uuid;
    if (kind === 'foreign-withdrawal') { next.type = 'withdrawn'; next.props = props(next).filter(prop => prop.name !== 'process-cia-content-hash'); props(next).push({ ns, name: 'process-cia-withdraws', value: decision.uuid }); }
    if (kind === 'unknown-hash') changeProp(next, 'process-cia-content-hash', { value: `process-cia/2:sha-256:${hashes[3]}` });
    if (kind === 'date') next.date = 'yesterday';
    if (kind === 'remarks') next.remarks = ' ';
    if (kind === 'party') next['responsible-parties'] = [{ 'role-id': 'process-owner', 'party-uuids': [partyUuid] }];
    if (kind === 'system') next.system = PROCESS_CIA_ACTIONS_SYSTEM;
    if (kind === 'missing-target') next.props = props(next).filter(prop => prop.name !== 'process-cia-process-uuid');
    if (kind === 'system') next.type = 'reviewed';
    (f.metadata.actions as JsonObject[]).push(next);
    expect(await deriveProcessApproval(f.source, processUuid)).toMatchObject({ state: 'invalid' });
  });

  it('hält jede Kontext-/CIA-/Freigabelücke vorläufig, unabhängig von Reihenfolge', async () => {
    const f = fixture();
    expect(processHandoff(f.source, processUuid, await deriveProcessApproval(f.source, processUuid), { state: 'conflict' }).status).toBe('approved');
    delete f.metadata.actions;
    expect(processHandoff(f.source, processUuid, await deriveProcessApproval(f.source, processUuid))).toMatchObject({ status: 'provisional', gaps: ['approval'] });
    delete f.process.purpose;
    f.process.props = props(f.process).filter(prop => prop.name !== 'process-protection-availability');
    expect(processHandoff(f.source, processUuid, { state: 'missing', sequence: 0 })).toMatchObject({ status: 'provisional', gaps: ['context', 'cia', 'approval'] });
  });

  it('sperrt semantisches Speichern und Export bei einer ungültigen Kette', () => {
    const f = fixture();
    changeProp((f.metadata.actions as JsonObject[])[0], 'process-cia-sequence', { value: '2' });
    expect(validateSspTargets(f.source)).toMatchObject({ code: 'SSP_PROCESS_BINDING_INVALID' });
  });

  it('weist unmögliche Kalenderdaten auch im rein lesenden Pfad ab', async () => {
    const f = fixture();
    (f.metadata.actions as JsonObject[])[0].date = '2026-02-30T12:00:00Z';
    expect(await deriveProcessApproval(f.source, processUuid)).toMatchObject({ state: 'invalid' });
  });
  it('bindet eine Anwendungsrolle ohne optionale direkte Parteizuordnung', () => {
    const f = fixture();
    f.application['responsible-roles'] = [{ 'role-id': 'institution-management' }];
    expect(() => processProjection(f.source, processUuid, decisionParties)).not.toThrow();
  });

  it('trennt eine nicht berechenbare aktuelle Projektion von der intakten Belegkette', async () => {
    const f = fixture();
    // Das referenzierte Component ist jetzt selbst ein Prozess: Kontext offen, alte Aktion intakt.
    f.application.type = 'business-process';
    expect(await deriveProcessApproval(f.source, processUuid)).toMatchObject({ state: 'stale' });
    expect(validateSspTargets(f.source)).toBeUndefined();
    const withdrawn = appendProcessDecision(f.source, { ...decision, type: 'withdrawn' });
    expect(await deriveProcessApproval(withdrawn, processUuid)).toMatchObject({ state: 'withdrawn' });
    expect(validateSspTargets(withdrawn)).toBeUndefined();
  });

  it('hält einen gelöschten Aktionsgegenstand oder eine verlorene Entscheidungspartei ungültig', async () => {
    const f = fixture();
    f.components.shift();
    expect(validateSspTargets(f.source)).toMatchObject({ code: 'SSP_PROCESS_BINDING_INVALID' });
    const other = fixture();
    (other.metadata.parties as JsonObject[]).pop();
    expect(await deriveProcessApproval(other.source, processUuid)).toMatchObject({ state: 'invalid' });
  });
});
