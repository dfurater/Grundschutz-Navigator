import { describe, expect, it } from 'vitest';
import { buildTimingInput, measureIsolatedTiming } from './measureClass2Timing.mjs';

describe('isolated class-2 timing', () => {
  it('runs the productive import on its own surface before direct stages', async () => {
    const calls: string[] = [];
    const direct = async (method: string) => { calls.push(`direct:${method}`); return method; };
    const worker = async (method: string) => { calls.push(`worker:${method}`); return method; };
    expect(await measureIsolatedTiming(direct, worker, { id: 'fixture' })).toEqual({
      id: 'fixture', stage1: 'stage1', objectChain: 'objectChain', endToEnd: 'endToEnd',
    });
    expect(calls).toEqual([
      'worker:prepareBytes', 'worker:endToEnd', 'worker:release',
      'direct:prepareBytes', 'direct:stage1', 'direct:objectChain', 'direct:release',
    ]);
  });

  it('cleans up a failed import and neither retries nor starts direct work', async () => {
    const calls: string[] = [];
    const direct = async () => { throw new Error('must not run'); };
    const worker = async (method: string) => {
      calls.push(method);
      if (method === 'endToEnd') throw new Error('broken');
    };
    await expect(measureIsolatedTiming(direct, worker, {})).rejects.toThrow('broken');
    expect(calls).toEqual(['prepareBytes', 'endToEnd', 'release']);
  });

  it('builds deterministic scaled input outside the browser', () => {
    const first = buildTimingInput('node-bound', 12);
    const second = buildTimingInput('node-bound', 12);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.metadata).toMatchObject({ id: 'node-bound', expectedCode: null, totalNodes: 12, bytes: first.bytes.length });
    expect(() => buildTimingInput('missing')).toThrow(/Fixture/);
    expect(() => buildTimingInput('byte-bound', 12)).toThrow(/skalierbar/);
  });
});
