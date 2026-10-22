// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePoamDocument, validatePoamSchema } from './oscalPoamDocument';
import { derivePoam } from './oscalPoamAdapter';
import { makeFullPoam, makeMinimalPoam } from '@/test/fixtures/poams';
import { makeMaximalOscalDocument } from '@/test/fixtures/oscalRoundTripCorpus';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import { processClass2OscalBytes } from '@/domain/oscalClass2Import';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { runNoOpRoundTrip } from '@/test/oscalRoundTrip';
import { rootUuidPolicy } from '@/domain/rootUuidPolicy';
import { stubNoNetwork, expectNoNetworkCalls } from '@/test/noNetwork';

const context = { trustClass: 'class-2-local-user' } as const;
const root = 'plan-of-action-and-milestones';
const bytes = (source: unknown) => new TextEncoder().encode(JSON.stringify(source));
afterEach(() => vi.unstubAllGlobals());
describe('POA&M-Import und Verlustfreiheit', () => {
  it.each(PINNED_OSCAL_VERSIONS)('validiert %s aus metadata und erhält die Quelle', async (version) => {
    const source = makeMinimalPoam(version);
    const imported = await processClass2OscalBytes(bytes(source), context);
    expect(imported.ok).toBe(true);
    const document = parsePoamDocument(source, context);
    expect(document.source).toBe(source);
    expect(document.pin).toMatchObject({ rootKey: root, oscalVersion: version });
    expect((await validatePoamSchema(document)).ok).toBe(true);
    expect(document.view.diagnostics).toEqual([]);
  });
  it('importiert den Vollfall ohne Netz, Dekodierung oder Veränderung', async () => {
    const source = makeFullPoam();
    const before = structuredClone(source);
    const stubs = stubNoNetwork();
    vi.stubGlobal('atob', vi.fn());
    expect(await processClass2OscalBytes(bytes(source), context)).toMatchObject({ ok: true });
    expect((await validatePoamSchema(parsePoamDocument(source, context))).ok).toBe(true);
    expect(source).toEqual(before);
    expectNoNetworkCalls(stubs);
    expect(globalThis.atob).not.toHaveBeenCalled();
  });
  it.each(['class-1-verified-public', 'class-1-unverified-public'] as const)('weist %s ab', (trustClass) => {
    expect(() => parsePoamDocument(makeMinimalPoam(), { trustClass })).toThrow(/OSCAL_POAM_TRUST_CLASS_REJECTED/);
  });
  it.each([undefined, '9.9.9'])('weist Version %s fail-closed ab', async (version) => {
    const source = makeMinimalPoam();
    Object.assign(source[root].metadata, { 'oscal-version': version });
    expect(await processClass2OscalBytes(bytes(source), context)).toMatchObject({ ok: false, diagnostic: { stage: 'root-dispatch' } });
  });
  it.each(['missing', 'empty', 'empty-observations', 'empty-risks', 'empty-findings'])('weist %s in Stufe 3 ab', async (testCase) => {
    const source = makeFullPoam();
    if (testCase === 'missing') Reflect.deleteProperty(source[root], 'poam-items');
    else if (testCase === 'empty') Object.assign(source[root], { 'poam-items': [] });
    else Object.assign(source[root], { [testCase.slice(6)]: [] });
    expect(await processClass2OscalBytes(bytes(source), context)).toMatchObject({ ok: false, diagnostic: { stage: 'json-schema' } });
  });
  it('weist mehrere Roots, XML, YAML und Übergröße vor der Ableitung ab', async () => {
    for (const input of [bytes({ ...makeMinimalPoam(), catalog: {} }), new TextEncoder().encode('<plan/>'), new TextEncoder().encode('plan-of-action-and-milestones:\n  uuid: synthetic'), new Uint8Array(CLASS_2_IMPORT_LIMITS.maxBytes + 1)])
      expect(await processClass2OscalBytes(input, context)).toMatchObject({ ok: false });
  });
  it.each(PINNED_OSCAL_VERSIONS)('besteht No-op mit Adapter in %s einschließlich last-modified und UUID', async (version) => {
    const source = makeMaximalOscalDocument(root, version);
    const result = await runNoOpRoundTrip({ fixtureText: JSON.stringify(source), exportDocument: (parsed) => {
      const before = JSON.stringify(parsed);
      parsePoamDocument(parsed, context);
      expect(JSON.stringify(parsed)).toBe(before);
      return parsed;
    } });
    expect(result.serialization).toEqual({ status: 'passed' });
    expect(result.graph).toEqual({ status: 'passed', differences: [] });
    expect(result.identities).toEqual({ status: 'passed', findings: [] });
    expect(result.stages.schemaValidation.status).toBe('passed');
    expect(rootUuidPolicy(root)).toBe('keep');
  });
  it('erhält dokumentinterne Evidenzverweise ohne AR über den vollständigen JSON-Round-trip', async () => {
    const source = makeFullPoam();
    const references = parsePoamDocument(source, context).view.poamItems[0].relatedObservations;
    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(source),
      exportDocument: (parsed) => {
        expect(parsePoamDocument(parsed, context).view.poamItems[0].relatedObservations).toEqual(references);
        return parsed;
      },
    });
    expect(result.serialization.status).toBe('passed');
    expect(result.graph).toEqual({ status: 'passed', differences: [] });
    expect(result.stages.schemaValidation.status).toBe('passed');
  });
  it('bewahrt unbekannte Quellfelder und liefert strukturierte Diagnosen für fehlende Pflichtstrukturen', () => {
    const source = makeMinimalPoam();
    Object.assign(source[root], { extension: { nested: [0, false, null] } });
    const before = structuredClone(source);
    parsePoamDocument(source, context);
    expect(source).toEqual(before);
    expect(derivePoam(null, context).diagnostics.map((d) => d.path)).toContain('/plan-of-action-and-milestones');
  });
});
