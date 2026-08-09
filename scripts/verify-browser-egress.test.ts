import { describe, expect, it, vi } from 'vitest';
import {
  EGRESS_FAILURE_MARKER,
  verifyBrowserEgress,
} from './verify-browser-egress.mjs';

function browserRun(overrides: Record<string, unknown> = {}) {
  return {
    status: 1,
    stdout: `${EGRESS_FAILURE_MARKER} Egress-Oracle GET <same-origin>`,
    stderr: '',
    ...overrides,
  };
}

function options(result: ReturnType<typeof browserRun>) {
  return {
    spawnSyncImpl: vi.fn(() => result),
    write: vi.fn(),
  };
}

describe('verifyBrowserEgress', () => {
  it('accepts the expected failed browser run with the egress marker', () => {
    const fixture = options(browserRun());

    expect(verifyBrowserEgress(fixture)).toBeUndefined();
    expect(fixture.write).toHaveBeenCalledWith(
      `${EGRESS_FAILURE_MARKER} Egress-Oracle GET <same-origin>`,
    );
  });

  it('propagates a spawn error instead of accepting incomplete evidence', () => {
    const spawnError = new Error('spawn EACCES');
    const fixture = options(browserRun({ error: spawnError }));

    expect(() => verifyBrowserEgress(fixture)).toThrow(spawnError);
  });

  it('rejects an unexpectedly successful browser run', () => {
    const fixture = options(browserRun({ status: 0 }));

    expect(() => verifyBrowserEgress(fixture)).toThrow(
      'Der negative Browser-Egress-Nachweis ist unerwartet grün.',
    );
  });

  it('rejects a failed browser run without the egress marker', () => {
    const fixture = options(browserRun({ stdout: 'Vitest failed before the egress check' }));

    expect(() => verifyBrowserEgress(fixture)).toThrow(
      'Der negative Browser-Egress-Nachweis scheiterte nicht am Egress-Oracle.',
    );
  });
});
