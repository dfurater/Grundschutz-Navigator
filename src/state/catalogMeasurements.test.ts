import { describe, expect, it, vi } from 'vitest';
import {
  recordCatalogDuration,
  measureCatalogAsyncPhase,
  measureCatalogPhase,
  type UserTiming,
} from './catalogMeasurements';

function makeUserTiming(values: readonly number[]): UserTiming {
  let index = 0;
  return {
    now: () => values[index++] ?? 0,
    measure: vi.fn(),
  };
}

describe('measureCatalogPhase', () => {
  it('records the operation duration with the supplied User-Timing name', () => {
    const timing = makeUserTiming([12, 19]);

    const value = measureCatalogPhase('gspp:catalog-json-parse', () => 'parsed', timing);

    expect(value).toBe('parsed');
    expect(timing.measure).toHaveBeenCalledWith('gspp:catalog-json-parse', {
      start: 12,
      end: 19,
    });
  });

  it('keeps parsing errors observable even when it records their duration', () => {
    const timing = makeUserTiming([5, 11]);

    expect(() =>
      measureCatalogPhase(
        'gspp:catalog-domain-parse',
        () => {
          throw new Error('Invalid OSCAL catalog');
        },
        timing,
      ),
    ).toThrow('Invalid OSCAL catalog');

    expect(timing.measure).toHaveBeenCalledWith('gspp:catalog-domain-parse', {
      start: 5,
      end: 11,
    });
  });

  it('keeps parsing errors observable when User Timing is unavailable', () => {
    expect(() =>
      measureCatalogPhase(
        'gspp:catalog-json-parse',
        () => {
          throw new Error('Ungültiges JSON');
        },
        null,
      ),
    ).toThrow('Ungültiges JSON');
  });

  it('records an awaited artifact download only after its promise resolves', async () => {
    const timing = makeUserTiming([3, 17]);

    await expect(
      measureCatalogAsyncPhase('gspp:catalog-download', async () => 'downloaded', timing),
    ).resolves.toBe('downloaded');

    expect(timing.measure).toHaveBeenCalledWith('gspp:catalog-download', {
      start: 3,
      end: 17,
    });
  });

  it('records a worker-reported duration at the receiving point', () => {
    const timing = makeUserTiming([30]);

    recordCatalogDuration('gspp:catalog-domain-parse', 7, timing);

    expect(timing.measure).toHaveBeenCalledWith('gspp:catalog-domain-parse', {
      start: 23,
      end: 30,
    });
  });
});
