#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { appendFile } from 'node:fs/promises';

export const DEPLOY_WORKFLOW_FILE = 'deploy.yml';
export const PROTECTED_BRANCH = 'main';
export const MANIFEST_PATH = 'upstream-manifest.json';

export const DEPLOY_CONFIRMED = 'deploy-confirmed';
export const FALLBACK_REQUIRED = 'fallback-required';

// Discovery covers the gap between the merge event and GitHub registering the
// push run. The terminal budget covers the deploy itself (fetch, test, build,
// Pages upload) and is deliberately generous: an unconfirmed deploy fails the
// job, so a budget that is too tight would produce false alarms.
export const DEFAULT_DISCOVERY_ATTEMPTS = 6;
export const DEFAULT_DISCOVERY_DELAY_MS = 10_000;
export const DEFAULT_TERMINAL_ATTEMPTS = 60;
export const DEFAULT_TERMINAL_DELAY_MS = 15_000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Entfernt Steuerzeichen, bevor fehlerabgeleitete Texte ins Aktionslog
 * geschrieben werden (SonarCloud jssecurity:S5145): Die Meldungen können
 * Fragmente aus GitHub-API-Antworten tragen (Run-URLs, Statuswerte); eine
 * Kontrolle über diese Felder darf keine Logzeilen fälschen können.
 */
export function stripControlCharacters(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return [...value]
    .filter((char) => char.charCodeAt(0) > 0x1f && char.charCodeAt(0) !== 0x7f)
    .join('');
}

async function fetchGitHubJson(url, { fetchImpl, token, label }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (error) {
    throw new Error(`${label} failed: ${error instanceof Error ? error.message : 'network error'}`);
  }
  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

/**
 * Looks up the push-triggered deploy run for an exact commit SHA. The GitHub API
 * matches `head_sha` only against full SHAs, never abbreviated ones.
 */
export async function findPushDeployRun(repository, commitSha, { fetchImpl = fetch, token } = {}) {
  if (!/^[0-9a-f]{40}$/.test(commitSha ?? '')) {
    throw new Error('merge commit SHA must be a full 40-character SHA');
  }

  const url = `https://api.github.com/repos/${repository}/actions/workflows/${DEPLOY_WORKFLOW_FILE}/runs`
    + `?event=push&head_sha=${commitSha}&per_page=1`;
  const payload = await fetchGitHubJson(url, { fetchImpl, token, label: 'deploy run lookup' });
  const run = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs[0] : undefined;
  if (!run) {
    return undefined;
  }
  // Never trust the filter alone: a mismatching head_sha here would confirm a
  // deploy of a different commit.
  if (run.head_sha !== commitSha) {
    throw new Error(`deploy run ${run.id} reports head_sha ${run.head_sha} instead of ${commitSha}`);
  }
  return run;
}

async function readRun(repository, runId, { fetchImpl, token }) {
  return fetchGitHubJson(
    `https://api.github.com/repos/${repository}/actions/runs/${runId}`,
    { fetchImpl, token, label: `deploy run ${runId} status lookup` },
  );
}

/**
 * Waits for the deploy run to reach a terminal state and asserts that it
 * succeeded. Existence alone is not a confirmation — the run is usually seconds
 * old when it is discovered.
 */
export async function awaitDeploySuccess(repository, run, {
  fetchImpl = fetch,
  token,
  sleep = defaultSleep,
  terminalAttempts = DEFAULT_TERMINAL_ATTEMPTS,
  terminalDelayMs = DEFAULT_TERMINAL_DELAY_MS,
  log = console.log,
} = {}) {
  let current = run;

  for (let attempt = 1; attempt <= terminalAttempts; attempt += 1) {
    if (current.status === 'completed') {
      if (current.conclusion !== 'success') {
        throw new Error(
          `push deploy ${current.html_url} completed with conclusion ${current.conclusion}`,
        );
      }
      log(`Push deploy succeeded: ${current.html_url}`);
      return current;
    }
    if (attempt === terminalAttempts) {
      break;
    }
    await sleep(terminalDelayMs);
    current = await readRun(repository, current.id, { fetchImpl, token });
  }

  throw new Error(
    `push deploy ${current.html_url} did not reach a terminal state within the verification budget `
    + `(last status ${current.status})`,
  );
}

async function verifyMergeCommitOnMain(repository, commitSha, { fetchImpl, token }) {
  const comparison = await fetchGitHubJson(
    `https://api.github.com/repos/${repository}/compare/${PROTECTED_BRANCH}...${commitSha}`,
    { fetchImpl, token, label: 'merge commit compare' },
  );
  if (comparison?.status !== 'identical' && comparison?.status !== 'behind') {
    throw new Error(
      `merge commit is no longer verifiably on ${PROTECTED_BRANCH} (status=${comparison?.status}); `
      + 'refusing fallback dispatch',
    );
  }
}

async function verifyManifestOnMain(repository, { snapshotSha, signature }, { fetchImpl, token }) {
  const contents = await fetchGitHubJson(
    `https://api.github.com/repos/${repository}/contents/${MANIFEST_PATH}?ref=${PROTECTED_BRANCH}`,
    { fetchImpl, token, label: 'manifest lookup' },
  );
  if (contents?.encoding !== 'base64' || typeof contents.content !== 'string') {
    throw new Error('manifest lookup did not return base64 content; refusing fallback dispatch');
  }

  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(contents.content, 'base64').toString('utf8'));
  } catch {
    throw new Error(`${MANIFEST_PATH} on ${PROTECTED_BRANCH} is not valid JSON`);
  }
  if (manifest?.snapshotCommitSha !== snapshotSha || manifest?.signatureSha256 !== signature) {
    throw new Error(
      `${PROTECTED_BRANCH} no longer contains the verified manifest; refusing fallback dispatch`,
    );
  }
}

/**
 * Resolves the post-merge deploy state. Returns DEPLOY_CONFIRMED when a push
 * deploy for the merge commit finished successfully, and FALLBACK_REQUIRED when
 * no push deploy appeared and merge commit plus manifest are still verifiably on
 * the protected branch. Every other case throws.
 */
export async function verifyCatalogDeploy({
  repository,
  mergeCommitSha,
  snapshotSha,
  signature,
  fetchImpl = fetch,
  token,
  sleep = defaultSleep,
  discoveryAttempts = DEFAULT_DISCOVERY_ATTEMPTS,
  discoveryDelayMs = DEFAULT_DISCOVERY_DELAY_MS,
  terminalAttempts = DEFAULT_TERMINAL_ATTEMPTS,
  terminalDelayMs = DEFAULT_TERMINAL_DELAY_MS,
  log = console.log,
}) {
  for (let attempt = 1; attempt <= discoveryAttempts; attempt += 1) {
    const run = await findPushDeployRun(repository, mergeCommitSha, { fetchImpl, token });
    if (run) {
      log(`Push deploy found: ${run.html_url} (${run.status}/${run.conclusion ?? 'pending'})`);
      await awaitDeploySuccess(repository, run, {
        fetchImpl,
        token,
        sleep,
        terminalAttempts,
        terminalDelayMs,
        log,
      });
      return DEPLOY_CONFIRMED;
    }
    if (attempt < discoveryAttempts) {
      await sleep(discoveryDelayMs);
    }
  }

  await verifyMergeCommitOnMain(repository, mergeCommitSha, { fetchImpl, token });
  await verifyManifestOnMain(repository, { snapshotSha, signature }, { fetchImpl, token });

  // The push run can still register while the re-verification above is in
  // flight. Dispatching then would deploy the same commit a second time, so
  // look once more immediately before authorizing the fallback.
  const lateRun = await findPushDeployRun(repository, mergeCommitSha, { fetchImpl, token });
  if (lateRun) {
    log(`Push deploy registered late: ${lateRun.html_url}`);
    await awaitDeploySuccess(repository, lateRun, {
      fetchImpl,
      token,
      sleep,
      terminalAttempts,
      terminalDelayMs,
      log,
    });
    return DEPLOY_CONFIRMED;
  }

  log('No push deploy appeared after bounded retries; fallback deploy is required.');
  return FALLBACK_REQUIRED;
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const mergeCommitSha = process.env.MERGE_COMMIT_SHA;
  const snapshotSha = process.env.SNAPSHOT_SHA;
  const signature = process.env.SIGNATURE;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  for (const [name, value] of Object.entries({
    GITHUB_REPOSITORY: repository,
    MERGE_COMMIT_SHA: mergeCommitSha,
    SNAPSHOT_SHA: snapshotSha,
    SIGNATURE: signature,
  })) {
    if (!value) {
      throw new Error(`${name} is required`);
    }
  }

  const outcome = await verifyCatalogDeploy({
    repository,
    mergeCommitSha,
    snapshotSha,
    signature,
    token,
  });

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `fallback_dispatch_required=${outcome === FALLBACK_REQUIRED}\n`,
    );
  }
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    await main();
  } catch (error) {
    console.error(stripControlCharacters(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}
