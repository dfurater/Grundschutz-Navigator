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

// Per-Request-Abbruchfrist für GitHub-API-Aufrufe (GSPP-430). Deutlich unter
// dem 30-min-Job-Limit von `verify-catalog-merge`: Ein hängender API-Call
// scheitert damit kontrolliert fail-closed, statt bis zum Job-Timeout zu
// hängen.
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** `owner/repo` in der von GitHub zugelassenen Zeichenmenge (vgl. greptile-review-nudge). */
const REPOSITORY_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

function assertValidRepository(repository) {
  if (typeof repository !== 'string' || !REPOSITORY_PATTERN.test(repository)) {
    throw new Error('repository must have the form owner/repo');
  }
  // `..` bestünde die Zeichenklasse, trüge aber eine Traversierung in den Pfad.
  const [owner, repo] = repository.split('/');
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') {
    throw new Error('repository must have the form owner/repo');
  }
}

function assertValidRunId(runId) {
  if (!Number.isInteger(runId) || runId <= 0) {
    throw new Error('deploy run id must be a positive integer');
  }
}

function repoApiBase(repository) {
  assertValidRepository(repository);
  const [owner, repo] = repository.split('/');
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

/** Einzige zulässige API-Herkunft (jssecurity:S8476-Allowlist, String-Präfix). */
const ALLOWED_API_BASE = 'https://api.github.com/repos/';
/** Zulässige API-Herkünfte (jssecurity:S8476-Allowlist, dokumentiertes Idiom). */
const ALLOWED_API_ORIGINS = ['https://api.github.com'];

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchGitHubJson(url, { fetchImpl, token, label, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }) {
  // Allowlist gegen Client-Side Request Forgery (jssecurity:S8476): Nur die
  // GitHub-API-Herkunft ist zulässig — kein aus Eingaben gebauter Host. Der
  // rohe Präfix-Check steht bewusst vor dem URL-Parse, damit die Allowlist
  // direkt an der übergebenen Zeichenkette hängt.
  if (typeof url !== 'string' || !url.startsWith(ALLOWED_API_BASE)) {
    throw new Error(`${label} refused: non-allowlisted host`);
  }
  let requestOrigin;
  try {
    requestOrigin = new URL(url).origin;
  } catch {
    throw new Error(`${label} refused: invalid URL`);
  }
  if (!ALLOWED_API_ORIGINS.includes(requestOrigin)) {
    throw new Error(`${label} refused: non-allowlisted host`);
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(requestTimeoutMs) });
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
export async function findPushDeployRun(repository, commitSha, { fetchImpl = fetch, token, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
  if (!/^[0-9a-f]{40}$/.test(commitSha ?? '')) {
    throw new Error('merge commit SHA must be a full 40-character SHA');
  }
  assertValidRepository(repository);

  const url = `${repoApiBase(repository)}/actions/workflows/${encodeURIComponent(DEPLOY_WORKFLOW_FILE)}/runs`
    + `?event=push&head_sha=${encodeURIComponent(commitSha)}&per_page=1`;
  const payload = await fetchGitHubJson(url, { fetchImpl, token, label: 'deploy run lookup', requestTimeoutMs });
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

async function readRun(repository, runId, { fetchImpl, token, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }) {
  assertValidRepository(repository);
  assertValidRunId(runId);
  return fetchGitHubJson(
    `${repoApiBase(repository)}/actions/runs/${encodeURIComponent(String(runId))}`,
    { fetchImpl, token, label: `deploy run ${runId} status lookup`, requestTimeoutMs },
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
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  log = console.log,
} = {}) {
  assertValidRepository(repository);
  assertValidRunId(run?.id);
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
    current = await readRun(repository, current.id, { fetchImpl, token, requestTimeoutMs });
  }

  throw new Error(
    `push deploy ${current.html_url} did not reach a terminal state within the verification budget `
    + `(last status ${current.status})`,
  );
}

async function verifyMergeCommitOnMain(repository, commitSha, { fetchImpl, token, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }) {
  assertValidRepository(repository);
  if (!/^[0-9a-f]{40}$/.test(commitSha ?? '')) {
    throw new Error('merge commit SHA must be a full 40-character SHA');
  }
  const comparison = await fetchGitHubJson(
    `${repoApiBase(repository)}/compare/${encodeURIComponent(PROTECTED_BRANCH)}...${encodeURIComponent(commitSha)}`,
    { fetchImpl, token, label: 'merge commit compare', requestTimeoutMs },
  );
  if (comparison?.status !== 'identical' && comparison?.status !== 'behind') {
    throw new Error(
      `merge commit is no longer verifiably on ${PROTECTED_BRANCH} (status=${comparison?.status}); `
      + 'refusing fallback dispatch',
    );
  }
}

async function verifyManifestOnMain(repository, { snapshotSha, signature }, { fetchImpl, token, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }) {
  assertValidRepository(repository);
  const contents = await fetchGitHubJson(
    `${repoApiBase(repository)}/contents/${encodeURIComponent(MANIFEST_PATH)}?ref=${encodeURIComponent(PROTECTED_BRANCH)}`,
    { fetchImpl, token, label: 'manifest lookup', requestTimeoutMs },
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
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  log = console.log,
}) {
  assertValidRepository(repository);
  if (!/^[0-9a-f]{40}$/.test(mergeCommitSha ?? '')) {
    throw new Error('merge commit SHA must be a full 40-character SHA');
  }
  for (let attempt = 1; attempt <= discoveryAttempts; attempt += 1) {
    const run = await findPushDeployRun(repository, mergeCommitSha, { fetchImpl, token, requestTimeoutMs });
    if (run) {
      log(`Push deploy found: ${run.html_url} (${run.status}/${run.conclusion ?? 'pending'})`);
      await awaitDeploySuccess(repository, run, {
        fetchImpl,
        token,
        sleep,
        terminalAttempts,
        terminalDelayMs,
        requestTimeoutMs,
        log,
      });
      return DEPLOY_CONFIRMED;
    }
    if (attempt < discoveryAttempts) {
      await sleep(discoveryDelayMs);
    }
  }

  await verifyMergeCommitOnMain(repository, mergeCommitSha, { fetchImpl, token, requestTimeoutMs });
  await verifyManifestOnMain(repository, { snapshotSha, signature }, { fetchImpl, token, requestTimeoutMs });

  // The push run can still register while the re-verification above is in
  // flight. Dispatching then would deploy the same commit a second time, so
  // look once more immediately before authorizing the fallback.
  const lateRun = await findPushDeployRun(repository, mergeCommitSha, { fetchImpl, token, requestTimeoutMs });
  if (lateRun) {
    log(`Push deploy registered late: ${lateRun.html_url}`);
    await awaitDeploySuccess(repository, lateRun, {
      fetchImpl,
      token,
      sleep,
      terminalAttempts,
      terminalDelayMs,
      requestTimeoutMs,
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
  // Top-Level-Await ohne Catch: Ein Verifikationsversagen soll den Workflow
  // laut failen (Node beendet mit Exit-Code 1). Fehlerabgeleitete Texte werden
  // bewusst nicht selbst geloggt — GitHub-API-Antworten (Run-URLs, Statuswerte)
  // sind keine Log-Eingabe (jssecurity:S5145).
  await main();
}
