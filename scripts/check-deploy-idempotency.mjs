#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { appendFile } from 'node:fs/promises';

export const SKIP_DEPLOY = 'skip-deploy';
export const RUN_DEPLOY = 'run-deploy';

export const DEPLOY_WORKFLOW_FILE = 'deploy.yml';
export const RESULT_PAGE_SIZE = 100;

export async function checkDeployIdempotency({
  repository,
  commitSha,
  currentRunId,
  fetchImpl = fetch,
  token,
  log = console.log,
}) {
  // The GitHub API matches `head_sha` only against full SHAs, never abbreviated
  // ones, so an abbreviated SHA would make the guard a silent no-op.
  if (!/^[0-9a-f]{40}$/.test(commitSha ?? '')) {
    log(`Commit SHA ${commitSha} is not a full 40-character SHA; deploying without an idempotency check.`);
    return RUN_DEPLOY;
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const url = `https://api.github.com/repos/${repository}/actions/workflows/${DEPLOY_WORKFLOW_FILE}/runs`
    + `?head_sha=${commitSha}&per_page=${RESULT_PAGE_SIZE}`;

  let payload;
  try {
    const response = await fetchImpl(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    payload = await response.json();
  } catch (error) {
    // A lookup that cannot answer must never suppress a deploy: the worst case
    // of deploying is a redundant run, the worst case of skipping is no deploy.
    log(`Deploy run lookup failed (${error instanceof Error ? error.message : 'unknown error'}); `
      + 'deploying rather than skipping.');
    return RUN_DEPLOY;
  }

  const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];

  // `github.run_id` arrives as a string, the API reports a number.
  const ownRunId = String(currentRunId);
  // Never trust the `head_sha` filter alone: a mismatching run here would
  // suppress a deploy that is actually still owed.
  const completed = runs.find((run) => String(run.id) !== ownRunId
    && run.head_sha === commitSha
    && run.status === 'completed'
    && run.conclusion === 'success');
  if (completed) {
    log(`Commit ${commitSha} already deployed successfully: ${completed.html_url}`);
    return SKIP_DEPLOY;
  }

  // A single page is enough for any realistic number of deploy runs per commit.
  // If it ever fills up, the guard simply deploys — the safe direction — but it
  // says so, so a silently ineffective guard stays diagnosable.
  if (runs.length >= RESULT_PAGE_SIZE) {
    log(`Found ${runs.length} runs for ${commitSha}; the result may be incomplete and a `
      + 'successful deploy could have been missed. Deploying.');
  }

  return RUN_DEPLOY;
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const commitSha = process.env.GITHUB_SHA;
  const currentRunId = process.env.GITHUB_RUN_ID;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  // Missing inputs mean the guard cannot decide anything, which is a reason to
  // deploy, not a reason to fail the workflow.
  let outcome = RUN_DEPLOY;
  if (!repository || !commitSha) {
    console.log('GITHUB_REPOSITORY or GITHUB_SHA missing; deploying without an idempotency check.');
  } else {
    outcome = await checkDeployIdempotency({ repository, commitSha, currentRunId, token });
  }

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `skip_deploy=${outcome === SKIP_DEPLOY}\n`);
  }
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    await main();
  } catch (error) {
    // Same rule at the top level: an unexpected failure must not cancel a deploy.
    console.error(error instanceof Error ? error.message : error);
  }
}
