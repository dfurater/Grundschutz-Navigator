import { describe, expect, it, vi } from 'vitest';
import { RUN_DEPLOY, SKIP_DEPLOY, checkDeployIdempotency } from './check-deploy-idempotency.mjs';

const REPOSITORY = 'dfurater/Grundschutz-Navigator';
const COMMIT_SHA = 'c3994ba0de1758f1ab6fae083d1aa1abfccf0433';
const CURRENT_RUN_ID = 30000000001;

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 29871256790,
    head_sha: COMMIT_SHA,
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    html_url: 'https://github.com/dfurater/Grundschutz-Navigator/actions/runs/29871256790',
    ...overrides,
  };
}

function makeFetch(runs: Array<ReturnType<typeof makeRun>> = [], status = 200) {
  return vi.fn(async () => ({
    ok: status < 400,
    status,
    json: async () => ({ workflow_runs: runs }),
  }));
}

function options(fetchImpl: ReturnType<typeof makeFetch>, overrides = {}) {
  return {
    repository: REPOSITORY,
    commitSha: COMMIT_SHA,
    currentRunId: CURRENT_RUN_ID,
    fetchImpl,
    token: 'opaque-test-token',
    log: () => {},
    ...overrides,
  };
}

describe('checkDeployIdempotency', () => {
  it('skips the deploy when the same commit already deployed successfully', async () => {
    const fetchImpl = makeFetch([makeRun()]);
    await expect(checkDeployIdempotency(options(fetchImpl))).resolves.toBe(SKIP_DEPLOY);
  });

  it('never treats its own run as a prior deploy, so a re-run still deploys', async () => {
    const fetchImpl = makeFetch([makeRun({ id: CURRENT_RUN_ID })]);
    await expect(checkDeployIdempotency(options(fetchImpl))).resolves.toBe(RUN_DEPLOY);
  });

  it('excludes its own run when the workflow passes the run id as a string', async () => {
    const fetchImpl = makeFetch([makeRun({ id: CURRENT_RUN_ID })]);
    await expect(
      checkDeployIdempotency(options(fetchImpl, { currentRunId: String(CURRENT_RUN_ID) })),
    ).resolves.toBe(RUN_DEPLOY);
  });

  it('ignores a run for a different commit, which must never suppress this deploy', async () => {
    const fetchImpl = makeFetch([makeRun({ head_sha: 'b'.repeat(40) })]);
    await expect(checkDeployIdempotency(options(fetchImpl))).resolves.toBe(RUN_DEPLOY);
  });

  it('never derives a skip from an error response, whatever body it carries', async () => {
    const fetchImpl = makeFetch([makeRun()], 503);
    await expect(checkDeployIdempotency(options(fetchImpl))).resolves.toBe(RUN_DEPLOY);
  });

  it('deploys instead of throwing when the lookup itself fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com');
    });
    await expect(checkDeployIdempotency(options(fetchImpl))).resolves.toBe(RUN_DEPLOY);
  });

  it('deploys when the only prior run for the commit failed', async () => {
    const fetchImpl = makeFetch([makeRun({ conclusion: 'failure' })]);
    await expect(checkDeployIdempotency(options(fetchImpl))).resolves.toBe(RUN_DEPLOY);
  });

  it('deploys when a prior run is still in flight, since it may yet fail', async () => {
    const fetchImpl = makeFetch([makeRun({ status: 'in_progress', conclusion: null })]);
    await expect(checkDeployIdempotency(options(fetchImpl))).resolves.toBe(RUN_DEPLOY);
  });

  it('skips on a successful dispatch deploy, not just on a push deploy', async () => {
    const fetchImpl = makeFetch([makeRun({ event: 'workflow_dispatch' })]);
    await expect(checkDeployIdempotency(options(fetchImpl))).resolves.toBe(SKIP_DEPLOY);
  });

  it('reports that a full result page may hide the successful run', async () => {
    const messages: string[] = [];
    const fullPage = Array.from({ length: 100 }, (_, index) => makeRun({
      id: 1000 + index,
      status: 'in_progress',
      conclusion: null,
    }));
    const fetchImpl = makeFetch(fullPage);

    await expect(
      checkDeployIdempotency(options(fetchImpl, { log: (m: string) => messages.push(m) })),
    ).resolves.toBe(RUN_DEPLOY);
    expect(messages.join('\n')).toMatch(/may be incomplete/);
  });

  it('stays silent about pagination when the result page is not full', async () => {
    const messages: string[] = [];
    const fetchImpl = makeFetch([makeRun({ status: 'in_progress', conclusion: null })]);

    await checkDeployIdempotency(options(fetchImpl, { log: (m: string) => messages.push(m) }));
    expect(messages.join('\n')).not.toMatch(/may be incomplete/);
  });

  it('does not even query for an abbreviated SHA, which the API never matches', async () => {
    const fetchImpl = makeFetch([makeRun()]);
    await expect(
      checkDeployIdempotency(options(fetchImpl, { commitSha: 'c3994ba' })),
    ).resolves.toBe(RUN_DEPLOY);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('deploys instead of throwing when the lookup returns invalid JSON', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    }));
    await expect(checkDeployIdempotency(options(fetchImpl))).resolves.toBe(RUN_DEPLOY);
  });
});
