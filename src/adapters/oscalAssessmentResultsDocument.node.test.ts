// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseAssessmentResultsDocument,
  validateAssessmentResultsSchema,
} from './oscalAssessmentResultsDocument';
import { parseOscalDocument } from './oscalRootAdapters';
import {
  AR_UUIDS,
  makeFullAssessmentResults,
  makeMinimalAssessmentResults,
} from '@/test/fixtures/assessmentResults';
import { makeMaximalOscalDocument } from '@/test/fixtures/oscalRoundTripCorpus';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import { processClass2OscalBytes } from '@/domain/oscalClass2Import';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { rootUuidPolicy } from '@/domain/rootUuidPolicy';
import { runNoOpRoundTrip } from '@/test/oscalRoundTrip';
import { expectNoNetworkCalls, stubNoNetwork } from '@/test/noNetwork';

const context = { trustClass: 'class-2-local-user' } as const;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const parse = (value: unknown) => parseAssessmentResultsDocument(value, context);
type Body = Record<string, unknown> & { results: Record<string, unknown>[] };
const body = (source: { 'assessment-results': unknown }) => source['assessment-results'] as Body;

const STAGE_3_CASES: readonly (readonly [string, (b: Body) => unknown])[] = [
  ['ohne import-ap', (b: Body) => Reflect.deleteProperty(b, 'import-ap')],
  ['ohne results', (b: Body) => Reflect.deleteProperty(b, 'results')],
  ['mit leerem results', (b: Body) => (b.results = [])],
  ...(['observations', 'risks', 'findings']).map(
    (key) => [`mit leerem ${key}`, (b: Body) => (b.results[0][key] = [])] as const,
  ),
  ['mit finding ohne target', (b: Body) => Reflect.deleteProperty((b.results[0].findings as Body[])[0], 'target')],
  ['mit risk ohne status', (b: Body) => Reflect.deleteProperty((b.results[0].risks as Body[])[0], 'status')],
  [
    'mit response ohne lifecycle',
    (b: Body) => Reflect.deleteProperty(((b.results[0].risks as Body[])[0].remediations as Body[])[0], 'lifecycle'),
  ],
];

afterEach(() => vi.unstubAllGlobals());

describe('Assessment-Results-Dokument und Importgrenze', () => {
  it.each(PINNED_OSCAL_VERSIONS)('importiert den Minimalfall in %s mit leeren Bereichen', async (version) => {
    const source = makeMinimalAssessmentResults(version);
    const imported = await processClass2OscalBytes(bytes(source), context);
    expect(imported.ok).toBe(true);
    const document = parse(source);
    expect(document.source).toBe(source);
    expect(document.pin).toMatchObject({ rootKey: 'assessment-results', oscalVersion: version });
    expect((await validateAssessmentResultsSchema(document)).ok).toBe(true);
    expect(document.view).toMatchObject({ uuid: AR_UUIDS.results, diagnostics: [] });
    expect(document.view.results[0]).toMatchObject({ observations: [], risks: [], findings: [] });
    expect(document.view.importAp?.status).toBe('not-resolvable-in-context');
  });
  it('ist über parseOscalDocument registriert', () => {
    const result = parseOscalDocument(makeMinimalAssessmentResults(), context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.view).toMatchObject({ uuid: AR_UUIDS.results, results: [{ findings: [] }] });
  });
  it.each(['class-1-verified-public', 'class-1-unverified-public'] as const)('weist %s fail-closed ab', (trustClass) => {
    expect(() => parseAssessmentResultsDocument(makeMinimalAssessmentResults(), { trustClass })).toThrow(
      /OSCAL_AR_TRUST_CLASS_REJECTED/,
    );
  });
  it.each([undefined, '9.9.9'])('weist die Version %s in Stufe 2 ab', async (version) => {
    const source = makeMinimalAssessmentResults();
    Object.assign(source['assessment-results'].metadata, { 'oscal-version': version });
    expect(await processClass2OscalBytes(bytes(source), context)).toMatchObject({
      ok: false,
      diagnostic: { stage: 'root-dispatch' },
    });
  });
  it.each(STAGE_3_CASES)('weist ein Dokument %s in Stufe 3 ab', async (_, mutate) => {
    const source = makeFullAssessmentResults();
    expect((await processClass2OscalBytes(bytes(source), context)).ok).toBe(true);
    mutate(body(source));
    expect(await processClass2OscalBytes(bytes(source), context)).toMatchObject({
      ok: false,
      diagnostic: { stage: 'json-schema' },
    });
  });
  it('weist ein überdimensioniertes Dokument vor dem Parsen ab', async () => {
    const oversized = new Uint8Array(CLASS_2_IMPORT_LIMITS.maxBytes + 1);
    expect(await processClass2OscalBytes(oversized, context)).toMatchObject({
      ok: false,
      diagnostic: { code: 'OSCAL_BYTE_LIMIT_EXCEEDED' },
    });
  });
  it('importiert und leitet ohne jeden Netzwerkzugriff ab', async () => {
    const stubs = stubNoNetwork();
    const source = makeFullAssessmentResults();
    const imported = await processClass2OscalBytes(bytes(source), context);
    expect(imported.ok).toBe(true);
    const { view } = parse(source);
    expect(view.results[0].risks[0].threatIds[0].href).toBe('https://threats.invalid/T-1.json');
    expectNoNetworkCalls(stubs);
  });
});

describe('Identität und No-op-Round-trip', () => {
  it.each(PINNED_OSCAL_VERSIONS)('bleibt über den Adapter in %s verlustfrei', async (version) => {
    const fixture = makeMaximalOscalDocument('assessment-results', version);
    const result = await runNoOpRoundTrip({
      fixtureText: JSON.stringify(fixture),
      // Der Adapter läuft auf der privaten Kopie; exportiert wird die unveränderte Quelle.
      exportDocument: (parsed) => {
        const before = JSON.stringify(parsed);
        const { view } = parse(parsed);
        expect(view.uuid).toBe(body(parsed as never).uuid);
        expect(JSON.stringify(parsed)).toBe(before);
        return parsed;
      },
    });
    expect(result.serialization).toEqual({ status: 'passed' });
    expect(result.graph).toEqual({ status: 'passed', differences: [] });
    expect(result.identities).toEqual({ status: 'passed', findings: [] });
    expect(result.stages.schemaValidation.status).toBe('passed');
  });
  it('führt die Root-UUID per-subject und übernimmt Objekt-UUIDs unverändert', () => {
    expect(rootUuidPolicy('assessment-results')).toBe('keep');
    const { view } = parse(makeFullAssessmentResults());
    const [result] = view.results;
    expect(result.observations.map((o) => o.uuid)).toEqual([AR_UUIDS.observation, AR_UUIDS.expiredObservation]);
    expect(result.findings.map((f) => f.uuid)).toEqual([AR_UUIDS.finding, AR_UUIDS.bareFinding]);
    expect(result.risks.map((r) => r.uuid)).toEqual([AR_UUIDS.risk]);
  });
});
