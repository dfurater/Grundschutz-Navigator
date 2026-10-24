import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportEvidencePackage } from '@/domain/evidenceExport';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { makeMinimalAssessmentResults, makeFullAssessmentResults, AR_UUIDS } from '@/test/fixtures/assessmentResults';
import { makeMinimalPoam, makeFullPoam } from '@/test/fixtures/poams';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { deepFreeze } from '@/test/oscalStructure';
import { runNoOpRoundTrip } from '@/test/oscalRoundTrip';
import { expectNoNetworkCalls, stubNoNetwork } from '@/test/noNetwork';
import * as storedZip from '@/adapters/storedZip';

const RESOURCE = AR_UUIDS.resource;
const SECOND = 'abcdefab-0000-4000-8000-000000000222';
const factories = { 'assessment-results': makeMinimalAssessmentResults, 'plan-of-action-and-milestones': makeMinimalPoam };
const resources = () => [
  { uuid: RESOURCE, base64: { filename: 'same.html', 'media-type': 'text/html', value: 'PHNjcmlwdD4=' }, rlinks: [{ href: 'https://evidence.invalid/secret', hashes: [{ algorithm: 'SHA-256', value: 'a'.repeat(64) }] }] },
  { uuid: SECOND, base64: { filename: 'same.html', value: 'cHJpdmF0ZQ==' } },
];
function fixture(root: keyof typeof factories = 'assessment-results', version = '1.2.2') {
  const source: Record<string, Record<string, unknown>> = factories[root]();
  Object.assign(source[root].metadata as object, { 'oscal-version': version, links: [{ href: '../private/file' }], props: [{ name: 'custom', ns: 'https://synthetic.invalid/ns', value: 'private metadata' }] });
  source[root]['back-matter'] = { resources: resources() };
  return source;
}
function unpack(zip: Uint8Array): Record<string, number[]> {
  return JSON.parse(execFileSync('python3', ['-c',
    'import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:list(z.read(n)) for n in z.namelist()}))',
  ], { input: zip, encoding: 'utf8' }));
}
const exportSource = (source: unknown, resourceUuids: readonly string[] = [RESOURCE], confirmedFullDocument = true) =>
  exportEvidencePackage({ source, resourceUuids, confirmedFullDocument });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('exportEvidencePackage', () => {
  for (const root of Object.keys(factories) as (keyof typeof factories)[]) {
    it.each(PINNED_OSCAL_VERSIONS)(`${root} %s: full frozen source, selected bytes and no egress`, async version => {
      const source = deepFreeze(fixture(root, version));
      const before = serializeWorkspaceJson(source);
      const network = stubNoNetwork();
      const atob = vi.spyOn(globalThis, 'atob');
      const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => vi.spyOn(console, level));
      const result = await exportSource(source, [RESOURCE.toUpperCase()]);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.code);
      const files = unpack(result.zip);
      expect(Object.keys(files)).toEqual(['document.json', `evidence/${RESOURCE}.bin`]);
      expect(files[`evidence/${RESOURCE}.bin`]).toEqual([...new TextEncoder().encode('<script>')]);
      const json = new TextDecoder().decode(new Uint8Array(files['document.json']));
      expect(json).toBe(before);
      expect(JSON.parse(json)).toEqual(source);
      expect(serializeWorkspaceJson(source)).toBe(before);
      expect(atob).toHaveBeenCalledTimes(1);
      expect(atob).toHaveBeenCalledWith('PHNjcmlwdD4=');
      expectNoNetworkCalls(network);
      for (const log of logs) expect(log).not.toHaveBeenCalled();
      expect(result.report).toEqual({ schema: 'passed', constraints: 'not-checked', references: 'not-checked' });
      const roundTrip = await runNoOpRoundTrip({ fixtureText: before, exportDocument: () => JSON.parse(json) });
      expect(roundTrip.graph.status).toBe('passed');
      expect(roundTrip.identities.status).toBe('passed');
      expect(roundTrip.stages.schemaValidation.status).toBe('passed');
    });

    it(`${root}: an empty selection keeps every attachment in JSON without decoding`, async () => {
      const source = fixture(root);
      const atob = vi.spyOn(globalThis, 'atob');
      const result = await exportSource(source, []);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.code);
      const files = unpack(result.zip);
      expect(Object.keys(files)).toEqual(['document.json']);
      expect(JSON.parse(new TextDecoder().decode(new Uint8Array(files['document.json'])))).toEqual(source);
      expect(atob).not.toHaveBeenCalled();
    });
  }

  it('requires literal confirmation and rejects malformed selection without decoding', async () => {
    const atob = vi.spyOn(globalThis, 'atob');
    for (const confirmation of [false, undefined, 'true', 1]) {
      expect(await exportEvidencePackage({ source: fixture(), resourceUuids: [RESOURCE], confirmedFullDocument: confirmation as boolean })).toEqual({ ok: false, code: 'EVIDENCE_EXPORT_CONFIRMATION_REQUIRED' });
    }
    for (const selection of [[RESOURCE, RESOURCE.toUpperCase()], ['../escape'], [AR_UUIDS.missing], [null], null, 'x', Array.from({ length: 1001 }, () => RESOURCE)]) {
      const result = await exportSource(fixture(), selection as readonly string[]);
      expect(result).toEqual({ ok: false, code: 'EVIDENCE_EXPORT_SELECTION_INVALID' });
    }
    expect(atob).not.toHaveBeenCalled();
  });

  it('rejects duplicate resource UUIDs, absent content and malformed base64 without partial output', async () => {
    for (const extra of [
      [resources()[0], { ...resources()[1], uuid: RESOURCE.toUpperCase() }],
      [{ uuid: RESOURCE, rlinks: [{ href: 'file:///private/secret' }] }],
      [{ uuid: RESOURCE, base64: { value: '%%%' } }],
    ]) {
      const source = fixture();
      source['assessment-results']['back-matter'] = { resources: extra };
      const result = await exportSource(source);
      expect(result.ok).toBe(false);
      expect(Object.keys(result).sort()).toEqual(['code', 'ok']);
      expect(JSON.stringify(result)).not.toMatch(/secret|private|%%%|unsafe|abcdefab/);
    }
  });

  it('exports missing filenames safely and rejects hostile filenames at the schema boundary', async () => {
    for (const filename of [undefined, '/absolute', '../x', 'a\\b', 'a\u0000b']) {
      const source = fixture();
      const selected = resources().map(resource => ({ ...resource, base64: { ...resource.base64, ...(filename === undefined ? {} : { filename }) } }));
      if (filename === undefined) for (const resource of selected) Reflect.deleteProperty(resource.base64, 'filename');
      source['assessment-results']['back-matter'] = { resources: selected };
      const result = await exportSource(source, [RESOURCE, SECOND.toUpperCase()]);
      if (filename !== undefined) {
        expect(result).toEqual({ ok: false, code: 'EVIDENCE_EXPORT_SOURCE_INVALID' });
      } else {
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.code);
        expect(Object.keys(unpack(result.zip))).toEqual(['document.json', `evidence/${RESOURCE}.bin`, `evidence/${SECOND}.bin`]);
      }
    }
  });

  it('rejects invalid versions, wrong roots and schema-invalid documents', async () => {
    const invalid = [fixture('assessment-results', '9.9.9'), makeSchemaValidOscalDocument('catalog', '1.2.2'), { 'assessment-results': { metadata: { 'oscal-version': '1.2.2' } } }];
    for (const source of invalid) expect(await exportSource(source)).toEqual({ ok: false, code: 'EVIDENCE_EXPORT_SOURCE_INVALID' });
  });

  it('does not resolve an external relevant-evidence href', async () => {
    const source = makeFullAssessmentResults();
    source['assessment-results'].results[0].observations![0]['relevant-evidence']![0].href = 'https://evidence.invalid/private';
    const network = stubNoNetwork();

    expect((await exportSource(source)).ok).toBe(true);
    expectNoNetworkCalls(network);
  });

  it('preserves a fixed ZIP adapter error code', async () => {
    vi.spyOn(storedZip, 'createStoredZip').mockImplementation(() => { throw new Error('EVIDENCE_ZIP_INVALID'); });

    expect(await exportSource(fixture())).toEqual({ ok: false, code: 'EVIDENCE_ZIP_INVALID' });
  });

  it('maps non-Error ZIP failures to the fixed source error code', async () => {
    const failure = Object.create(null);
    vi.spyOn(storedZip, 'createStoredZip').mockImplementation(() => { throw failure; });

    expect(await exportSource(fixture())).toEqual({ ok: false, code: 'EVIDENCE_EXPORT_SOURCE_INVALID' });
  });

  it('keeps the snapshot stable when the caller changes source or selection during validation', async () => {
    const source = fixture();
    const uuids: string[] = [RESOURCE];
    const before = serializeWorkspaceJson(source);
    const pending = exportSource(source, uuids);
    uuids.push(SECOND);
    source['assessment-results'].metadata = {};
    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    const files = unpack(result.zip);
    expect(Object.keys(files)).toHaveLength(2);
    expect(new TextDecoder().decode(new Uint8Array(files['document.json']))).toBe(before);
  });


  it('preserves full assessment graphs including observations, foreign props and resource fragments', async () => {
    for (const source of [makeFullAssessmentResults(), makeFullPoam()]) {
      const root = Object.values(source)[0];
      Object.assign(root.metadata, { links: [{ href: '#'+RESOURCE, 'resource-fragment': 'section-1' }], props: [{ name: 'foreign', ns: 'https://example.invalid/ns', value: 'unchanged' }] });
      const before = serializeWorkspaceJson(source);
      const result = await exportSource(deepFreeze(source));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.code);
      const json = new TextDecoder().decode(new Uint8Array(unpack(result.zip)['document.json']));
      expect(json).toBe(before);
      const roundTrip = await runNoOpRoundTrip({ fixtureText: before, exportDocument: () => JSON.parse(json) });
      expect(roundTrip.graph.status).toBe('passed');
      expect(roundTrip.identities.status).toBe('passed');
    }
  });

  it('accepts exactly 1000 selected resources and rejects the next one before decoding', async () => {
    const source = fixture();
    const selected = Array.from({ length: 1001 }, (_, i) => ({ uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, base64: { value: 'YQ==' } }));
    source['assessment-results']['back-matter'] = { resources: selected };
    const atob = vi.spyOn(globalThis, 'atob');
    expect((await exportSource(source, selected.slice(0, 1000).map(r => r.uuid))).ok).toBe(true);
    expect(atob).toHaveBeenCalledTimes(1000);
    atob.mockClear();
    expect(await exportSource(source, selected.map(r => r.uuid))).toEqual({ ok: false, code: 'EVIDENCE_EXPORT_SELECTION_INVALID' });
    expect(atob).not.toHaveBeenCalled();
  });

  it('rejects schema-accepted but undecodable base64 without exposing source values', async () => {
    const source = fixture();
    source['assessment-results']['back-matter'] = { resources: [{ uuid: RESOURCE, base64: { value: 'A' } }] };
    expect(await exportSource(source)).toEqual({ ok: false, code: 'EVIDENCE_EXPORT_CONTENT_INVALID' });
  });

  it('rejects an oversized source and a cyclic source without decoding', async () => {
    const atob = vi.spyOn(globalThis, 'atob');
    const source = fixture();
    const metadata = source['assessment-results'].metadata as Record<string, unknown>;
    metadata.title = '';
    const bytes = new TextEncoder().encode(serializeWorkspaceJson(source)).length;
    metadata.title = 'x'.repeat(CLASS_2_IMPORT_LIMITS.maxBytes - bytes);
    expect((await exportSource(source, [])).ok).toBe(true);
    metadata.title += 'x';
    expect(await exportSource(source)).toEqual({ ok: false, code: 'EVIDENCE_EXPORT_SOURCE_INVALID' });
    const cyclic = fixture();
    cyclic['assessment-results'].remarks = cyclic;
    expect(await exportSource(cyclic)).toEqual({ ok: false, code: 'EVIDENCE_EXPORT_SOURCE_INVALID' });
    expect(atob).not.toHaveBeenCalled();
  });

  it('enforces the cumulative decoded payload limit before decoding', async () => {
    const atob = vi.spyOn(globalThis, 'atob');
    const source = fixture();
    const embedded = [{ uuid: RESOURCE, base64: { value: Buffer.alloc(CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes).toString('base64') } }];
    source['assessment-results']['back-matter'] = { resources: embedded };
    expect((await exportSource(source)).ok).toBe(true);
    atob.mockClear();
    embedded[0].base64.value = Buffer.alloc(CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes + 1).toString('base64');
    expect(await exportSource(source)).toEqual({ ok: false, code: 'EVIDENCE_EXPORT_SOURCE_INVALID' });
    expect(atob).not.toHaveBeenCalled();
  });
});
