import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = (name: string) =>
  readFileSync(resolve(process.cwd(), '.github/workflows', name), 'utf8');

describe('CI supply-chain hardening', () => {
  it.each(['ci.yml', 'deploy.yml', 'update-catalog.yml'])(
    'installs dependencies without lifecycle scripts in %s',
    (name) => {
      expect(workflow(name)).toContain('run: npm ci --ignore-scripts');
    },
  );

  it('uses the installed, lockfile-pinned Vitest binary for the deploy coverage run', () => {
    const deploy = workflow('deploy.yml');

    expect(deploy).toContain('run: npm exec --no -- vitest run --coverage');
    expect(deploy).not.toContain('npx vitest run --coverage');
  });

  it('grants deploy privileges only to the job that needs them', () => {
    const deploy = workflow('deploy.yml');
    const [workflowScope] = deploy.split('\nconcurrency:');
    const [, buildAndDeploy] = deploy.split('\n  build-and-deploy:\n');

    expect(workflowScope).toContain('permissions:\n  contents: read\n');
    for (const permission of ['pages', 'id-token', 'attestations', 'artifact-metadata']) {
      expect(workflowScope).not.toContain(`\n  ${permission}: write`);
    }
    expect(buildAndDeploy).toContain(
      '    permissions:\n      contents: read\n      pages: write\n      id-token: write\n      attestations: write\n      artifact-metadata: write',
    );
  });
});
