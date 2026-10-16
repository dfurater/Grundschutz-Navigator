// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { jobScopes } from '@/test/workflowFixtures';

describe('workflow job scopes', () => {
  it('keeps nested step keys in their job and separates sibling jobs', () => {
    const scopes = jobScopes('name: CI\njobs:\n  build:\n    steps:\n      - run: echo build\n  test-job:\n    steps:\n      - run: echo test\n');
    expect([...scopes.keys()]).toEqual(['build', 'test-job']);
    expect(scopes.get('build')).toBe('  build:\n    steps:\n      - run: echo build\n');
    expect(scopes.get('test-job')).toBe('  test-job:\n    steps:\n      - run: echo test\n');
  });

  it('preserves the optional empty-workflow result', () => {
    expect(jobScopes('name: CI\n').size).toBe(0);
  });

  it('rejects a missing jobs block for strict supply-chain checks', () => {
    expect(() => jobScopes('name: CI\n', { requireJobsBlock: true })).toThrow(TypeError);
  });
});
