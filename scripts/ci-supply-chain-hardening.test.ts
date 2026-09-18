import { readFileSync, readdirSync } from 'node:fs';
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
  it.each(['validate.yml', 'deploy.yml', 'update-catalog.yml'])(
    'installs dependencies without lifecycle scripts in %s',
    (name) => {
      expect(workflow(name)).toContain('run: npm ci --ignore-scripts');
    },
  );

  // Die Liste oben benennt die Workflows, die heute installieren. Wandert ein
  // Job in eine andere Datei — wie `validate` in GSPP-415 —, verlöre sie
  // stillschweigend ihren Gegenstand. Diese Prüfung hängt deshalb nicht an
  // Dateinamen, sondern am Vorkommen selbst: Wo `npm ci` steht, steht
  // `--ignore-scripts`.
  it('never installs with lifecycle scripts in any workflow', () => {
    const directory = resolve(process.cwd(), '.github/workflows');

    for (const name of readdirSync(directory).filter((file) => file.endsWith('.yml'))) {
      for (const line of workflow(name).split('\n')) {
        // Kommentarzeilen sprechen über `npm ci`, ohne es auszuführen. Ein
        // Inline-`#` hinter einem echten Aufruf bleibt absichtlich Teil der
        // geprüften Zeile: Der Test fällt dann fail-closed aus.
        if (line.trimStart().startsWith('#')) continue;
        if (!line.includes('npm ci')) continue;

        expect(line, `${name}: ${line.trim()}`).toContain('npm ci --ignore-scripts');
      }
    }
  });

  // Kein Workflow dieses Repositoriums pusht über die Checkout-Credentials; das
  // Token erreicht die Schritte, die es brauchen, als ausdrückliche Env-Variable.
  // Ein Checkout ohne `persist-credentials: false` ließe es dagegen in der
  // Git-Konfiguration des Arbeitsbaums zurück, wo jeder nachgelagerte Schritt
  // darauf zugreift — in `validate` sind das Kommandos aus dem Pull Request.
  // Auch diese Prüfung hängt am Vorkommen statt an einer Dateiliste.
  it('removes checkout credentials in every workflow', () => {
    const directory = resolve(process.cwd(), '.github/workflows');
    const marker = 'uses: actions/checkout@';

    for (const name of readdirSync(directory).filter((file) => file.endsWith('.yml'))) {
      const content = workflow(name);

      for (let index = content.indexOf(marker); index >= 0; index = content.indexOf(marker, index + 1)) {
        // Der Schritt reicht bis zum nächsten `- name:` derselben Liste; was
        // danach steht, gehört einem anderen Schritt und zählt nicht.
        const rest = content.slice(index);
        const end = rest.indexOf('\n      - name:');
        const step = end < 0 ? rest : rest.slice(0, end);

        expect(step, `${name}: Checkout ohne persist-credentials`).toContain(
          'persist-credentials: false',
        );
      }
    }
  });

  // Seit GSPP-416 ruft der Deploy denselben package.json-Eintrag auf wie jeder
  // andere Coverage-Lauf, statt Vitest in zweiter Schreibweise zu starten. Die
  // Zusicherung bleibt dieselbe: Der Lauf kommt aus der durch package-lock.json
  // festgelegten Installation und nicht aus der Registry.
  it('runs the deploy coverage suite through the lockfile-pinned npm script', () => {
    const deploy = workflow('deploy.yml');

    expect(deploy).toContain('run: npm run test:coverage');
  });

  // `npx` und `npm exec` fallen ohne `--no` auf die Registry zurueck und holen
  // ein Paket, das im Lockfile nicht steht. Die Pruefung haengt am Vorkommen
  // statt an einer Dateiliste, damit sie einen neuen Workflow miterfasst.
  it('never resolves a binary outside the lockfile in any workflow', () => {
    const directory = resolve(process.cwd(), '.github/workflows');

    for (const name of readdirSync(directory).filter((file) => file.endsWith('.yml'))) {
      for (const line of workflow(name).split('\n')) {
        if (line.trimStart().startsWith('#')) continue;

        expect(line, `${name}: ${line.trim()}`).not.toMatch(/\b(?:npx|npm exec)\b/);
      }
    }
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
