#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

export const CATALOG_SYNC_REPOSITORY = 'dfurater/Grundschutz-Navigator';
export const CATALOG_SYNC_RULESET_ID = 15503378;
export const GITHUB_ACTIONS_INTEGRATION_ID = 15368;
export const REQUIRED_CHECKS = ['validate', 'catalog-sync-guard'];
export const CATALOG_SYNC_PROTECTED_BRANCH = 'main';

// A branch ruleset without a ref scope is `active` but applies to no branch at all.
// Only these three include patterns are recognised as covering the protected branch;
// fnmatch globs are rejected on purpose so that any scope drift fails the preflight
// instead of silently widening or narrowing enforcement.
export const ACCEPTED_REF_INCLUDES = Object.freeze([
  '~DEFAULT_BRANCH',
  '~ALL',
  `refs/heads/${CATALOG_SYNC_PROTECTED_BRANCH}`,
]);

function findRule(ruleset, type) {
  return Array.isArray(ruleset.rules)
    ? ruleset.rules.find((rule) => rule?.type === type)
    : undefined;
}

function representsSameInstant(actualTimestamp, expectedTimestamp) {
  if (typeof actualTimestamp !== 'string' || typeof expectedTimestamp !== 'string') {
    return false;
  }

  const actualInstant = Date.parse(actualTimestamp);
  const expectedInstant = Date.parse(expectedTimestamp);
  return Number.isFinite(actualInstant) &&
    Number.isFinite(expectedInstant) &&
    actualInstant === expectedInstant;
}

function collectRepositoryMergeErrors(repository, expectedRepository) {
  const errors = [];

  if (repository?.full_name !== expectedRepository) {
    errors.push(`repository must be ${expectedRepository}`);
  }
  if (repository?.allow_auto_merge !== true) {
    errors.push('repository auto-merge must be enabled');
  }
  if (repository?.delete_branch_on_merge !== true) {
    errors.push('automatic branch deletion must be enabled');
  }
  // The whole sync lane is hard-wired to `main` (workflow triggers, compare bases,
  // fallback dispatch). `~DEFAULT_BRANCH` in the ruleset only protects `main` while
  // `main` actually is the default branch, so pin it here rather than assume it.
  if (repository?.default_branch !== CATALOG_SYNC_PROTECTED_BRANCH) {
    errors.push(`repository default branch must be ${CATALOG_SYNC_PROTECTED_BRANCH}`);
  }

  return errors;
}

function collectRulesetIdentityErrors(ruleset, { expectedRepository, expectedRulesetId }) {
  const errors = [];

  if (ruleset?.id !== expectedRulesetId) {
    errors.push(`ruleset id must be ${expectedRulesetId}`);
  }
  if (ruleset?.target !== 'branch' || ruleset?.enforcement !== 'active') {
    errors.push('ruleset must be an active branch ruleset');
  }
  if (ruleset?.source !== expectedRepository || ruleset?.source_type !== 'Repository') {
    errors.push('ruleset must belong to the expected repository');
  }

  return errors;
}

function collectRefConditionErrors(refName) {
  const errors = [];

  if (!refName || typeof refName !== 'object' || Array.isArray(refName)) {
    errors.push(
      `ruleset conditions.ref_name must scope the ruleset to ${CATALOG_SYNC_PROTECTED_BRANCH}`,
    );
    return errors;
  }

  const include = Array.isArray(refName.include) ? refName.include : undefined;
  if (!include?.some((pattern) => ACCEPTED_REF_INCLUDES.includes(pattern))) {
    errors.push(
      `ruleset conditions.ref_name.include must cover ${CATALOG_SYNC_PROTECTED_BRANCH} via one of ${ACCEPTED_REF_INCLUDES.join(', ')}`,
    );
  }
  // Any exclude entry is rejected: matching fnmatch patterns against `main` here
  // would reimplement GitHub's ref matching, and getting that wrong fails open.
  if (!Array.isArray(refName.exclude)) {
    errors.push('ruleset conditions.ref_name.exclude must be an explicit array');
  } else if (refName.exclude.length > 0) {
    errors.push(
      `ruleset conditions.ref_name.exclude must be empty so that ${CATALOG_SYNC_PROTECTED_BRANCH} cannot be carved out`,
    );
  }

  return errors;
}

function collectBypassActorErrors(ruleset, { allowRedactedBypassActors, expectedRulesetUpdatedAt }) {
  const errors = [];

  if (Array.isArray(ruleset?.bypass_actors)) {
    if (ruleset.bypass_actors.length !== 0) {
      errors.push('ruleset must not contain bypass actors');
    }
  } else if (!allowRedactedBypassActors || !expectedRulesetUpdatedAt) {
    errors.push('ruleset bypass actors are redacted without an audited version pin');
  }

  return errors;
}

function collectRulePresenceErrors(ruleset) {
  const errors = [];

  const pullRequestRule = findRule(ruleset, 'pull_request');
  if (pullRequestRule?.parameters?.required_approving_review_count !== 0) {
    errors.push('pull request rule must require zero approvals for the automated lane');
  }
  for (const preservedRule of ['deletion', 'non_fast_forward']) {
    if (!findRule(ruleset, preservedRule)) {
      errors.push(`ruleset must preserve the ${preservedRule} rule`);
    }
  }

  return errors;
}

function collectRequiredStatusChecksErrors(ruleset, githubActionsIntegrationId) {
  const errors = [];

  const requiredStatusRule = findRule(ruleset, 'required_status_checks');
  if (requiredStatusRule?.parameters?.strict_required_status_checks_policy !== true) {
    errors.push('required status checks must use strict up-to-date enforcement');
  }
  const configuredChecks = requiredStatusRule?.parameters?.required_status_checks;
  if (!Array.isArray(configuredChecks)) {
    errors.push('required status checks rule is missing');
  } else {
    for (const context of REQUIRED_CHECKS) {
      const configured = configuredChecks.find((check) => check?.context === context);
      if (configured?.integration_id !== githubActionsIntegrationId) {
        errors.push(`${context} must be required from GitHub Actions integration ${githubActionsIntegrationId}`);
      }
    }
  }

  return errors;
}

function collectCodeScanningErrors(ruleset) {
  const errors = [];

  const codeScanningRule = findRule(ruleset, 'code_scanning');
  const codeQl = codeScanningRule?.parameters?.code_scanning_tools?.find(
    (tool) => tool?.tool === 'CodeQL',
  );
  if (
    codeQl?.security_alerts_threshold !== 'high_or_higher' ||
    codeQl?.alerts_threshold !== 'errors'
  ) {
    errors.push('CodeQL rule must block high-or-higher security alerts and errors');
  }

  return errors;
}

export function validateCatalogSyncPolicy(repository, ruleset, {
  expectedRepository = CATALOG_SYNC_REPOSITORY,
  expectedRulesetId = CATALOG_SYNC_RULESET_ID,
  expectedRulesetUpdatedAt,
  githubActionsIntegrationId = GITHUB_ACTIONS_INTEGRATION_ID,
  allowRedactedBypassActors = false,
} = {}) {
  const errors = [
    ...collectRepositoryMergeErrors(repository, expectedRepository),
    ...collectRulesetIdentityErrors(ruleset, { expectedRepository, expectedRulesetId }),
    ...collectRefConditionErrors(ruleset?.conditions?.ref_name),
    ...(expectedRulesetUpdatedAt &&
    !representsSameInstant(ruleset?.updated_at, expectedRulesetUpdatedAt)
      ? [`ruleset updated_at must match the audited version ${expectedRulesetUpdatedAt}`]
      : []),
    ...collectBypassActorErrors(ruleset, { allowRedactedBypassActors, expectedRulesetUpdatedAt }),
    ...collectRulePresenceErrors(ruleset),
    ...collectRequiredStatusChecksErrors(ruleset, githubActionsIntegrationId),
    ...collectCodeScanningErrors(ruleset),
  ];

  if (errors.length > 0) {
    throw new Error(`Catalog sync policy check failed:\n- ${errors.join('\n- ')}`);
  }

  return true;
}

async function fetchGitHubJson(path, token, fetchImpl = fetch) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetchImpl(`https://api.github.com/${path}`, { headers });
  } catch (error) {
    throw new Error(`GitHub policy API request failed: ${error instanceof Error ? error.message : 'network error'}`);
  }

  if (!response.ok) {
    throw new Error(`GitHub policy API request failed with HTTP ${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error('GitHub policy API returned invalid JSON');
  }
}

async function fetchRepositoryMergeSettings(repository, token, fetchImpl = fetch) {
  if (!token) {
    throw new Error('GITHUB_TOKEN is required for repository merge policy checks');
  }

  const [owner, name] = repository.split('/');
  const query = `
    query CatalogSyncRepositoryPolicy($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        autoMergeAllowed
        deleteBranchOnMerge
        nameWithOwner
        defaultBranchRef {
          name
        }
      }
    }
  `;

  let response;
  try {
    response = await fetchImpl('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ query, variables: { owner, name } }),
    });
  } catch (error) {
    throw new Error(`GitHub policy GraphQL request failed: ${error instanceof Error ? error.message : 'network error'}`);
  }

  if (!response.ok) {
    throw new Error(`GitHub policy GraphQL request failed with HTTP ${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('GitHub policy GraphQL request returned invalid JSON');
  }
  if (payload?.errors?.length || !payload?.data?.repository) {
    throw new Error('GitHub policy GraphQL request returned errors or no repository');
  }

  return {
    full_name: payload.data.repository.nameWithOwner,
    allow_auto_merge: payload.data.repository.autoMergeAllowed,
    delete_branch_on_merge: payload.data.repository.deleteBranchOnMerge,
    default_branch: payload.data.repository.defaultBranchRef?.name,
  };
}

export async function fetchAndValidateCatalogSyncPolicy({
  repository = process.env.GITHUB_REPOSITORY,
  rulesetId = CATALOG_SYNC_RULESET_ID,
  token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
  expectedRulesetUpdatedAt = process.env.CATALOG_SYNC_RULESET_UPDATED_AT,
  fetchImpl = fetch,
} = {}) {
  if (repository !== CATALOG_SYNC_REPOSITORY) {
    throw new Error(`GITHUB_REPOSITORY must be ${CATALOG_SYNC_REPOSITORY}`);
  }

  if (!expectedRulesetUpdatedAt) {
    throw new Error('CATALOG_SYNC_RULESET_UPDATED_AT must pin the audited ruleset version');
  }

  const [repositoryState, ruleset] = await Promise.all([
    fetchRepositoryMergeSettings(repository, token, fetchImpl),
    fetchGitHubJson(`repos/${repository}/rulesets/${rulesetId}`, token, fetchImpl),
  ]);
  validateCatalogSyncPolicy(repositoryState, ruleset, {
    allowRedactedBypassActors: true,
    expectedRulesetId: rulesetId,
    expectedRulesetUpdatedAt,
  });
  return { repository: repositoryState, ruleset };
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    await fetchAndValidateCatalogSyncPolicy();
    console.log('Catalog sync repository policy is active and valid.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
