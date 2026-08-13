import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/update-catalog.yml');

describe('catalog update workflow schedule', () => {
  it('runs twice on weekdays in Europe/Berlin away from the top of the hour', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain(
      [
        '  schedule:',
        "    - cron: '30 7 * * 1-5'",
        "      timezone: 'Europe/Berlin'",
        "    - cron: '30 17 * * 1-5'",
        "      timezone: 'Europe/Berlin'",
      ].join('\n'),
    );
    expect(workflow.match(/^\s+- cron:/gm)).toHaveLength(2);
    expect(workflow).not.toMatch(/^\s+- cron: ['"]0 /m);
  });

  it('keeps workflow dispatch and the main push trigger', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain(
      ['  workflow_dispatch:', '  push:', '    branches: [main]'].join('\n'),
    );
  });

  it('publishes the semantic control identity summary in the sync pull request', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain("printf 'control_identity_summary<<%s\\n'");
    expect(workflow).toContain(
      'CONTROL_IDENTITY_SUMMARY: ${{ steps.compare.outputs.control_identity_summary }}',
    );
    expect(workflow).toContain('## Semantisches Control-Identitätsdelta');
    expect(workflow).toContain('printf \'%s\\n\' "$CONTROL_IDENTITY_SUMMARY"');
  });
});
