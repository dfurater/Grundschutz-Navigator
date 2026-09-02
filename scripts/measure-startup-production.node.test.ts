// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  summarizeStartupRuns,
  taskOverlapsParse,
} from './measure-startup-production.mjs';

const phase = (startTime: number, duration: number) => ({ startTime, duration });

describe('Startup-Produktionsmessung', () => {
  it('ordnet nur Long Tasks zu, die JSON- oder Domain-Parsing überlappen', () => {
    const run = {
      download: phase(10, 25),
      jsonParse: phase(100, 8),
      domainParse: phase(108, 12),
      reactRender: phase(120, 4),
    };

    expect(taskOverlapsParse({ startTime: 80, duration: 15 }, run)).toBe(false);
    expect(taskOverlapsParse({ startTime: 95, duration: 12 }, run)).toBe(true);
    expect(taskOverlapsParse({ startTime: 116, duration: 20 }, run)).toBe(true);
    expect(taskOverlapsParse({ startTime: 130, duration: 15 }, run)).toBe(false);
  });

  it('recommends a worker only for a parse-overlapping Long Task', () => {
    const summary = summarizeStartupRuns([
      {
        download: phase(0, 20),
        jsonParse: phase(100, 8),
        domainParse: phase(108, 12),
        reactRender: phase(120, 4),
        longTasks: [{ startTime: 125, duration: 80 }],
      },
      {
        download: phase(0, 30),
        jsonParse: phase(100, 9),
        domainParse: phase(109, 13),
        reactRender: phase(122, 5),
        longTasks: [{ startTime: 105, duration: 60 }],
      },
      {
        download: phase(0, 40),
        jsonParse: phase(100, 10),
        domainParse: phase(110, 14),
        reactRender: phase(124, 6),
        longTasks: [],
      },
    ]);

    expect(summary).toMatchObject({
      medianDownloadMs: 30,
      medianJsonParseMs: 9,
      medianDomainParseMs: 13,
      medianReactRenderMs: 5,
      parseLongTaskRuns: 1,
      workerRecommended: true,
    });
  });

  it('reports post-worker Long Tasks without re-deciding an already active worker', () => {
    const summary = summarizeStartupRuns(
      [
        {
          download: phase(0, 20),
          jsonParse: phase(100, 5),
          domainParse: phase(100, 5),
          reactRender: phase(110, 3),
          longTasks: [{ startTime: 120, duration: 55 }],
        },
      ],
      { parserRunsOnMainThread: false },
    );

    expect(summary).toMatchObject({
      mainThreadLongTaskRuns: 1,
      workerRecommended: null,
    });
  });
});
