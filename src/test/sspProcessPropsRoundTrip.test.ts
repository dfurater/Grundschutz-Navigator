import { afterEach, describe, expect, it, vi } from 'vitest';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import { PROJECT_PROP_DIAGNOSTIC_CODES as codes, PROJECT_PROP_REGISTRY } from '@/domain/projectProps';
import { exportSspDocument } from '@/domain/sspExport';
import { prepareSspTargets, validateSspTargets } from '@/domain/sspTargetObjects';
import { makeProcessCiaSsp } from '@/test/fixtures/processCia';
import { runNoOpRoundTrip } from '@/test/oscalRoundTrip';

type Ssp = { 'system-security-plan': Record<string, Record<string, unknown>> };

function body(document: Record<string, unknown>) {
  return (document as Ssp)['system-security-plan'];
}

function components(document: Record<string, unknown>) {
  return body(document)['system-implementation'].components as Array<Record<string, unknown>>;
}

function actions(document: Record<string, unknown>) {
  return body(document).metadata.actions as Array<Record<string, unknown>>;
}

const cases = PINNED_OSCAL_VERSIONS.flatMap(version => [[version, 'F1', false], [version, 'F4', true]] as const);

describe('Prozessträger im SSP-Export', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(cases)('%s %s: schema-, referenz- und round-trip-gültig ohne Quelländerung', async (version, _case, withOwnCategory) => {
    const source = makeProcessCiaSsp(version, withOwnCategory);
    const fixtureText = JSON.stringify(source);

    expect(validateSspTargets(source)).toBeUndefined();
    const exported = await exportSspDocument({ documentState: 'export-ready', rootType: 'system-security-plan', source });
    expect(exported).toMatchObject({ ok: true, report: { schema: 'passed', references: 'passed' } });
    if (exported.ok) expect(JSON.parse(exported.json)).toEqual(source);

    const roundTrip = await runNoOpRoundTrip({ fixtureText });
    expect(roundTrip).toMatchObject({
      serialization: { status: 'passed' },
      graph: { status: 'passed', differences: [] },
      identities: { status: 'passed' },
      stages: { schemaValidation: { status: 'passed' } },
    });
    expect(JSON.stringify(source)).toBe(fixtureText);
  });

  it('ergänzt beim Speichern weder Prozesswerte noch Zeitstempel', () => {
    const source = makeProcessCiaSsp('1.2.2', true);
    const prepared = prepareSspTargets(source);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const before = structuredClone(source);
    const after = structuredClone(prepared.source) as Record<string, unknown>;
    const beforeMeta = body(before).metadata;
    const afterMeta = body(after).metadata;
    // Die bestehende Objektabdeckung wird beim Speichern abgeleitet; sie ist kein Prozessfeld.
    afterMeta.props = (afterMeta.props as Array<{ name: string }>).filter(prop => prop.name !== 'protection-need-coverage');
    expect(after).toEqual(before);
    expect(afterMeta['last-modified']).toBe(beforeMeta['last-modified']);
  });

  it.each([
    ['Prozessname an einem Component anderen Typs', (document: Record<string, unknown>) => { components(document)[0].type = 'service'; },
      codes.CARRIER_INVALID, '/system-security-plan/system-implementation/components/0/props'],
    ['Prozessaktion unter fremdem System', (document: Record<string, unknown>) => { actions(document)[0].system = 'https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/actions'; },
      codes.CARRIER_INVALID, '/system-security-plan'],
    ['Aktionsname an einem Geschäftsprozess', (document: Record<string, unknown>) => {
      (components(document)[0].props as unknown[]).push(...(actions(document)[0].props as unknown[]).slice(0, 1));
    }, codes.CARRIER_INVALID, '/system-security-plan/system-implementation/components/0/props'],
    ['doppelte fachliche Prozess-ID', (document: Record<string, unknown>) => {
      const second = structuredClone(components(document)[0]);
      second.uuid = 'aaaaaaaa-0000-4000-8000-000000000011';
      second.props = [{ ns: 'https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props', name: 'process-id', value: 'p-01' }];
      components(document).push(second);
    }, codes.DUPLICATE_VALUE, '/system-security-plan/system-implementation/components'],
  ] as const)('%s sperrt den validierten Export', async (_label, mutate, code, path) => {
    const source = makeProcessCiaSsp('1.2.2');
    mutate(source);
    expect(validateSspTargets(source)).toMatchObject({ code, path });
    expect(await exportSspDocument({ documentState: 'export-ready', rootType: 'system-security-plan', source }))
      .toEqual({ ok: false, code, path });
  });

  it('erhält ein Dokument mit Prozessnamen unter einer älteren Registry-Stufe und sperrt Semantik und Export', async () => {
    const hasOwn = Object.hasOwn;
    vi.spyOn(Object, 'hasOwn').mockImplementation((target, key) =>
      !(target === PROJECT_PROP_REGISTRY && String(key).startsWith('process-')) && hasOwn(target, key));
    const source = makeProcessCiaSsp('1.2.2', true);
    const fixtureText = JSON.stringify(source);

    expect(validateSspTargets(source)?.code).toBe(codes.UNKNOWN);
    expect(prepareSspTargets(source).ok).toBe(false);
    expect(await exportSspDocument({ documentState: 'export-ready', rootType: 'system-security-plan', source }))
      .toMatchObject({ ok: false, code: codes.UNKNOWN });
    const roundTrip = await runNoOpRoundTrip({ fixtureText });
    expect(roundTrip.graph).toEqual({ status: 'passed', differences: [] });
    expect(JSON.stringify(source)).toBe(fixtureText);
  });
});
