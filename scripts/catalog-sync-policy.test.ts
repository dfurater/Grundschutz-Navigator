import { describe, expect, it, vi } from 'vitest';
import {
  CATALOG_SYNC_REPOSITORY,
  CATALOG_SYNC_RULESET_ID,
  GITHUB_ACTIONS_INTEGRATION_ID,
  fetchAndValidateCatalogSyncPolicy,
  validateCatalogSyncPolicy,
} from './catalog-sync-policy.mjs';

function makeRepository() {
  return {
    full_name: CATALOG_SYNC_REPOSITORY,
    allow_auto_merge: true,
    delete_branch_on_merge: true,
  };
}

function makeRuleset() {
  return {
    id: CATALOG_SYNC_RULESET_ID,
    target: 'branch',
    source: CATALOG_SYNC_REPOSITORY,
    source_type: 'Repository',
    enforcement: 'active',
    updated_at: '2026-07-19T14:00:00Z',
    bypass_actors: [],
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      {
        type: 'pull_request',
        parameters: { required_approving_review_count: 0 },
      },
      {
        type: 'required_status_checks',
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [
            { context: 'validate', integration_id: GITHUB_ACTIONS_INTEGRATION_ID },
            { context: 'catalog-sync-guard', integration_id: GITHUB_ACTIONS_INTEGRATION_ID },
          ],
        },
      },
      {
        type: 'code_scanning',
        parameters: {
          code_scanning_tools: [
            {
              tool: 'CodeQL',
              security_alerts_threshold: 'high_or_higher',
              alerts_threshold: 'errors',
            },
          ],
        },
      },
    ],
  };
}

describe('validateCatalogSyncPolicy', () => {
  it('accepts the exact auto-merge, required-check, and CodeQL policy', () => {
    expect(validateCatalogSyncPolicy(makeRepository(), makeRuleset())).toBe(true);
  });

  it('rejects a missing required GitHub Actions check', () => {
    const ruleset = makeRuleset();
    ruleset.rules[3].parameters.required_status_checks = [
      { context: 'validate', integration_id: GITHUB_ACTIONS_INTEGRATION_ID },
    ];
    expect(() => validateCatalogSyncPolicy(makeRepository(), ruleset)).toThrow(
      'catalog-sync-guard must be required',
    );
  });

  it('rejects a bypass actor', () => {
    const ruleset = { ...makeRuleset(), bypass_actors: [{ actor_type: 'Integration' }] };
    expect(() => validateCatalogSyncPolicy(makeRepository(), ruleset)).toThrow('bypass actors');
  });

  it('rejects a missing CodeQL rule', () => {
    const ruleset = makeRuleset();
    ruleset.rules = ruleset.rules.filter((rule) => rule.type !== 'code_scanning');
    expect(() => validateCatalogSyncPolicy(makeRepository(), ruleset)).toThrow('CodeQL rule');
  });

  it('rejects disabled auto-merge and loose required checks', () => {
    const repository = { ...makeRepository(), allow_auto_merge: false };
    const ruleset = makeRuleset();
    ruleset.rules[3].parameters.strict_required_status_checks_policy = false;
    expect(() => validateCatalogSyncPolicy(repository, ruleset)).toThrow(/auto-merge[\s\S]*strict/);
  });

  it('accepts redacted bypass actors only for the exact audited ruleset version', () => {
    const redactedRuleset = { ...makeRuleset(), bypass_actors: undefined };
    expect(validateCatalogSyncPolicy(makeRepository(), redactedRuleset, {
      allowRedactedBypassActors: true,
      expectedRulesetUpdatedAt: redactedRuleset.updated_at,
    })).toBe(true);
    expect(() => validateCatalogSyncPolicy(makeRepository(), {
      ...redactedRuleset,
      updated_at: '2026-07-19T14:01:00Z',
    }, {
      allowRedactedBypassActors: true,
      expectedRulesetUpdatedAt: '2026-07-19T14:00:00Z',
    })).toThrow('audited version');
  });

  it('accepts equivalent timezone representations of the audited ruleset version', () => {
    const redactedRuleset = {
      ...makeRuleset(),
      updated_at: '2026-07-19T16:00:00+02:00',
      bypass_actors: undefined,
    };
    expect(validateCatalogSyncPolicy(makeRepository(), redactedRuleset, {
      allowRedactedBypassActors: true,
      expectedRulesetUpdatedAt: '2026-07-19T14:00:00.000Z',
    })).toBe(true);
  });

  it('fails closed when bypass actors are redacted without a version pin', () => {
    const redactedRuleset = { ...makeRuleset(), bypass_actors: undefined };
    expect(() => validateCatalogSyncPolicy(makeRepository(), redactedRuleset, {
      allowRedactedBypassActors: true,
    })).toThrow('redacted without an audited version pin');
  });

  it('validates GraphQL merge settings and a version-pinned redacted ruleset', async () => {
    const redactedRuleset = { ...makeRuleset(), bypass_actors: undefined };
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const payload = String(url).endsWith('/graphql')
        ? {
            data: {
              repository: {
                autoMergeAllowed: true,
                deleteBranchOnMerge: true,
                nameWithOwner: CATALOG_SYNC_REPOSITORY,
              },
            },
          }
        : redactedRuleset;
      return { ok: true, status: 200, json: async () => payload };
    });

    await expect(fetchAndValidateCatalogSyncPolicy({
      repository: CATALOG_SYNC_REPOSITORY,
      token: 'opaque-test-token',
      expectedRulesetUpdatedAt: redactedRuleset.updated_at,
      fetchImpl,
    })).resolves.toMatchObject({
      repository: { allow_auto_merge: true, delete_branch_on_merge: true },
      ruleset: { id: CATALOG_SYNC_RULESET_ID },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
