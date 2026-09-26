import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSPORT_MAX_CODE_UNITS, TRANSPORT_MAX_OPERATIONS } from '@/domain/oscalImportTransport';
import { maxRepetitions } from '../profileResolutionWorstCaseFixtures.mjs';

const pipeline = vi.hoisted(() => ({ parse: vi.fn(), process: vi.fn() }));
vi.mock('@/domain/oscalImportProcessing', () => ({ parseClass2OscalInput: pipeline.parse }));
vi.mock('@/domain/oscalObjectPipeline', () => ({ processClass2OscalValue: pipeline.process }));

type Harness = {
  prepareBytes(metadata: { bytes: number }): Promise<unknown>;
  stage1(): Promise<unknown>;
  objectChain(): Promise<unknown>;
  holdTransportInventory(): Record<string, unknown>;
  release(): void;
  profileResolutionCalibration(category: string, repetitions: number): Promise<unknown>;
};
let harness: Harness;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  pipeline.parse.mockReset();
  pipeline.process.mockReset();
  fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  vi.stubGlobal('fetch', fetchMock);
  await import('./class2-budget.harness.mjs');
  harness = (globalThis as unknown as { __gspp382: Harness }).__gspp382;
});
afterEach(() => { harness?.release(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('binary measurement input', () => {
  it('loads bytes without parsing and only passes them into the explicit direct stage', async () => {
    const metadata = { bytes: 3 };
    expect(await harness.prepareBytes(metadata)).toBe(metadata);
    expect(fetchMock).toHaveBeenCalledWith('/__class2_fixture.bin', { cache: 'no-store' });
    expect(pipeline.parse).not.toHaveBeenCalled();
    pipeline.parse.mockReturnValue({ ok: false, diagnostic: { code: 'rejected' } });
    await harness.stage1();
    expect(pipeline.parse).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  });

  it('rejects failed loading and mismatched byte length', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    await expect(harness.prepareBytes({ bytes: 3 })).rejects.toThrow('Fixturebytes fehlen');
    await expect(harness.prepareBytes({ bytes: 4 })).rejects.toThrow('Fixture-Bytelänge');
    expect(pipeline.parse).not.toHaveBeenCalled();
  });
});

describe('held transport inventory', () => {
  it('does not transport a rejected document', async () => {
    await harness.prepareBytes({ bytes: 3 });
    pipeline.parse.mockReturnValue({ ok: true, source: {} });
    pipeline.process.mockResolvedValue({ ok: false, diagnostic: { code: 'rejected' } });
    await harness.stage1(); await harness.objectChain();
    expect(harness.holdTransportInventory()).toEqual({ transported: false });
  });

  it('uses the real decoder and accounts for keys, text and bounded fragments', async () => {
    // Import after resetModules so the spy observes the same codec as the harness.
    const codec = await import('@/domain/oscalImportTransport');
    const finish = vi.spyOn(codec.OscalSourceDecoder.prototype, 'finish');
    const source = { a: [{ longkey: 'hello world' }] };
    await harness.prepareBytes({ bytes: 3 });
    pipeline.parse.mockReturnValue({ ok: true, source });
    pipeline.process.mockResolvedValue({ ok: true });
    await harness.stage1(); await harness.objectChain();
    expect(harness.holdTransportInventory()).toEqual({
      transported: true, traversalKeyArrays: 2, longestText: 11,
      fragmentOperations: TRANSPORT_MAX_OPERATIONS, fragmentCodeUnits: TRANSPORT_MAX_CODE_UNITS,
    });
    expect(finish).toHaveBeenCalledOnce();
    expect(finish.mock.results[0].value).toEqual(source);
    expect(finish.mock.results[0].value).not.toBe(source);
  });
});

describe('profile resolution calibration', () => {
  it('rejects a repetition count beyond the document limits before building the case', async () => {
    // `buildWorkUnitCalibration` never marks a case as capped, so the capped
    // branch in `runResolutionFixture` cannot catch an oversized calibration.
    const beyond = maxRepetitions('alter-target-lookup') + 1;
    await expect(harness.profileResolutionCalibration('alter-target-lookup', beyond))
      .rejects.toThrow(new RangeError(
        `Kalibrierfall alter-target-lookup mit ${beyond} Wiederholungen liegt jenseits der Dokumentgrenze (${beyond - 1})`,
      ));
  });
});
