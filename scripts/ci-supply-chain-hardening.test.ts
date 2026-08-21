import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = (name: string) =>
  readFileSync(resolve(process.cwd(), '.github/workflows', name), 'utf8');

const DEPLOY_WRITE_PERMISSIONS = [
  'pages: write',
  'id-token: write',
  'attestations: write',
  'artifact-metadata: write',
];

function jobScopes(workflowContent: string): Map<string, string> {
  const [, jobs] = workflowContent.split('\njobs:\n');
  const headers = [...jobs.matchAll(/^\x20{2}([\w-]+):\n/gm)];

  return new Map(
    headers.map((header, index) => [
      header[1],
      jobs.slice(header.index, headers[index + 1]?.index ?? jobs.length),
    ]),
  );
}

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
    const [workflowScope] = deploy.split('\njobs:\n');
    const scopes = jobScopes(deploy);
    const buildAndDeployScope = scopes.get('build-and-deploy');

    expect(workflowScope).toContain('permissions:\n  contents: read\n');
    for (const permission of DEPLOY_WRITE_PERMISSIONS) {
      expect(workflowScope).not.toContain(permission);
    }
    for (const [job, scope] of scopes) {
      if (job === 'build-and-deploy') continue;

      for (const permission of DEPLOY_WRITE_PERMISSIONS) {
        expect(scope).not.toContain(permission);
      }
    }
    for (const permission of [
      'contents: read',
      ...DEPLOY_WRITE_PERMISSIONS,
    ]) {
      expect(buildAndDeployScope).toContain(permission);
    }
  });
});
