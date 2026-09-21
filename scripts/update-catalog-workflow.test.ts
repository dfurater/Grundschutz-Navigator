import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/update-catalog.yml');

function hasPushTrigger(workflow: string): boolean {
  return /^ {2}(?:push|['"]push['"])\s*:/m.test(workflow);
}

function jobScopes(workflow: string): Map<string, string> {
  const [, jobs = ''] = workflow.split('\njobs:\n');
  const headers = [...jobs.matchAll(/^\x20{2}([\w-]+):\n/gm)];

  return new Map(
    headers.map((header, index) => [
      header[1],
      jobs.slice(header.index, headers[index + 1]?.index ?? jobs.length),
    ]),
  );
}

describe('catalog update workflow schedule', () => {
  // Der Nachweis gehört an den Anfang *jedes* Jobs dieser Datei: `jq` liegt im
  // Runner-Image und nicht im Repository, und sein Fehlen bleibt im Sync-Pfad
  // still — die `jq`-Aufrufe stehen dort in Argumentposition von `printf`, wo
  // `set -euo pipefail` ihren Exit-Status nicht sieht. Ein Test, der nur den
  // global ersten Step prüft, verlöre seine Aussage mit dem zweiten Job.
  it('checks jq availability before any catalog-sync step runs', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    const scopes = jobScopes(workflow);

    expect(scopes.size).toBeGreaterThan(0);

    for (const [name, body] of scopes) {
      expect(body, `Job ${name} beginnt nicht mit dem jq-Nachweis`).toMatch(
        /\n\x20{4}steps:\n\x20{6}- name: Verify jq availability\n\x20{8}run: jq --version\n/,
      );
    }
  });

  it('runs twice on weekdays in Europe/Berlin away from the top of the hour', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain(
      [
        '  # Main-Pushes enthalten keinen neuen Upstream-Stand. Policy-Drift wird',
        '  # deshalb im nächsten regulären Werktagslauf erkannt.',
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

  it('keeps workflow dispatch without a push trigger', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain('  workflow_dispatch:');
    expect(hasPushTrigger(workflow)).toBe(false);
  });

  it.each([
    ['unquoted event key with a flow-style branch filter', '  push:\n    branches: [main]'],
    ['quoted event key with a quoted flow-style branch filter', "  'push':\n    branches: ['main']"],
    ['double-quoted event key with a block-style branch filter', '  "push":\n    branches:\n      - main'],
  ])('recognizes a push trigger with %s', (_description, trigger) => {
    expect(hasPushTrigger(trigger)).toBe(true);
  });

  it('checks out main independently of the triggering ref', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain(
      [
        '      - name: Checkout',
        '        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
        '        with:',
        '          ref: main',
        '          persist-credentials: false',
      ].join('\n'),
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
