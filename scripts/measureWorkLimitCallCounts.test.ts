// =============================================================================
// Die Aufrufzählung der Messwegprovenienz (GSPP-445). Was sie übersieht, fehlt
// in der Hülle: Eine Verlangsamung dort löste keine Neumessung aus.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  countedRun,
  executedRanges,
  resolveSchemaJson,
  startBlockCounting,
} from './measureWorkLimitCallCounts.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '..');

describe('executedRanges', () => {
  it('gibt jeden ausgeführten Bereich aus, auch Blöcke innerhalb einer Funktion', () => {
    const coverage = [{
      url: 'file:///a.ts',
      functions: [
        { functionName: 'walk', ranges: [{ startOffset: 0, endOffset: 90, count: 1 }, { startOffset: 20, endOffset: 60, count: 8 }] },
        { functionName: 'unbenutzt', ranges: [{ startOffset: 100, endOffset: 140, count: 0 }] },
      ],
    }];
    expect(executedRanges(coverage)).toEqual([
      ['file:///a.ts', 'walk', 0, 90, 1],
      ['file:///a.ts', 'walk', 20, 60, 8],
    ]);
  });

  it('lässt Bereiche aus, die im gezählten Abschnitt nicht liefen', () => {
    const coverage = [{
      url: 'file:///a.ts',
      functions: [{ functionName: 'f', ranges: [{ startOffset: 0, endOffset: 9, count: 3 }, { startOffset: 2, endOffset: 5, count: 0 }] }],
    }];
    expect(executedRanges(coverage)).toEqual([['file:///a.ts', 'f', 0, 9, 3]]);
  });
});

describe('resolveSchemaJson', () => {
  const schema = pathToFileURL(resolve(REPO_ROOT, 'schemas/oscal/v1.1.3/oscal_profile_schema.json')).href;

  it('reicht das JSON-Importattribut für gepinnte OSCAL-Schemas nach', () => {
    const next = vi.fn(() => ({ url: schema, format: 'json' }));
    const context = { conditions: [], importAttributes: {} };
    expect(resolveSchemaJson('../../schemas/x.json', context, next)).toEqual({
      url: schema, format: 'json', importAttributes: { type: 'json' },
    });
    expect(next).toHaveBeenCalledWith('../../schemas/x.json', context);
  });

  it('lässt jede andere Auflösung unverändert', () => {
    for (const url of [
      pathToFileURL(resolve(REPO_ROOT, 'package.json')).href,
      pathToFileURL(resolve(REPO_ROOT, 'schemas/oscal/README.md')).href,
      pathToFileURL(resolve(REPO_ROOT, 'src/domain/profileResolutionEngine.ts')).href,
    ]) {
      const resolved = { url, format: 'module' };
      expect(resolveSchemaJson('x', { importAttributes: {} }, () => resolved)).toBe(resolved);
    }
  });
});

describe('startBlockCounting', () => {
  it('startet die Zählung auf Blockebene', async () => {
    // Ohne `detailed` meldet V8 nur Aufrufzahlen je Funktion; eine Schleife in
    // einer einmal aufgerufenen Funktion bliebe unsichtbar.
    const session = { post: vi.fn(async () => ({})) };
    await startBlockCounting(session);
    expect(session.post.mock.calls).toEqual([
      ['Profiler.enable'],
      ['Profiler.startPreciseCoverage', { callCount: true, detailed: true }],
    ]);
  });
});

describe('countedRun', () => {
  const coverage = [{ url: 'file:///b.ts', functions: [{ functionName: 'g', ranges: [{ startOffset: 0, endOffset: 5, count: 2 }] }] }];

  function fakes(overrides: Record<string, unknown> = {}) {
    const events: string[] = [];
    const session = {
      post: vi.fn(async (method: string) => {
        events.push(method);
        return { result: coverage };
      }),
    };
    const domain = {
      buildWorkUnitCalibration: () => ({
        topProfileArtifactKey: 'profile-top',
        documents: { 'profile-top': { profile: {} }, 'catalog-a': { catalog: {} } },
        edges: {},
      }),
      buildProfileResolutionPlan: () => ({ ok: true, order: ['catalog-a', 'profile-top'] }),
      parseProfileDocument: vi.fn(() => {
        events.push('parseProfileDocument');
        return { ok: true };
      }),
      resolveProfile: vi.fn(async () => {
        events.push('resolveProfile');
        return { ok: true, output: { budgetUsage: { workUnits: 42 } } };
      }),
      ...overrides,
    };
    return { events, session, domain };
  }

  it('zählt genau den Auflösungslauf, nach der Vorbereitung', async () => {
    const { events, session, domain } = fakes();
    expect(await countedRun(session, domain, 'merge-step', 4)).toEqual({
      workUnits: 42,
      ranges: [['file:///b.ts', 'g', 0, 5, 2]],
    });
    expect(events).toEqual([
      'parseProfileDocument',
      'Profiler.takePreciseCoverage',
      'resolveProfile',
      'Profiler.takePreciseCoverage',
    ]);
    // Nur Profile werden vorab gelesen, Kataloge nicht.
    expect(domain.parseProfileDocument).toHaveBeenCalledTimes(1);
  });

  it('bricht ab, wenn die Fixture jenseits der Dokumentgrenze liegt', async () => {
    const { session, domain } = fakes({ buildWorkUnitCalibration: () => ({ capped: true }) });
    await expect(countedRun(session, domain, 'glob-state', 8))
      .rejects.toThrow('Kalibrierfixture glob-state mit 8 Wiederholungen liegt jenseits der Dokumentgrenze');
    expect(session.post).not.toHaveBeenCalled();
  });

  it('bricht ab, wenn der Plan scheitert', async () => {
    const { session, domain } = fakes({
      buildProfileResolutionPlan: () => ({ ok: false, diagnostic: { code: 'PLAN_KAPUTT' } }),
    });
    await expect(countedRun(session, domain, 'import-edge', 4)).rejects.toThrow('Plan für import-edge gescheitert: PLAN_KAPUTT');
  });

  it('bricht ab, wenn die Auflösung scheitert, statt eine leere Zählung zu liefern', async () => {
    const { session, domain } = fakes({
      resolveProfile: async () => ({ ok: false, diagnostic: { code: 'BUDGET' } }),
    });
    await expect(countedRun(session, domain, 'alter-candidate', 4)).rejects.toThrow('Auflösung für alter-candidate gescheitert: BUDGET');
  });
});

describe('als Skript', () => {
  it('schreibt je Kategorie eine Zählung bei N und 2N auf stdout', () => {
    const output = JSON.parse(execFileSync(process.execPath, [resolve(REPO_ROOT, 'scripts/measureWorkLimitCallCounts.mjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
    expect(output.repetitions).toEqual({ n: 4, twoN: 8 });
    expect(output.categories).toHaveLength(6);
    for (const { n, twoN } of output.categories) {
      expect(twoN.workUnits).toBeGreaterThan(n.workUnits);
      expect(n.ranges.length).toBeGreaterThan(0);
      for (const range of n.ranges) expect(range).toHaveLength(5);
    }
  }, 120_000);
});
