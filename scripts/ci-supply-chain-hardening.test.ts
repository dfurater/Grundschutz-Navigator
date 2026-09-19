import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDefinitions, stepText } from './workflowDefinitions.mjs';

const workflow = (name: string) =>
  readFileSync(resolve(process.cwd(), '.github/workflows', name), 'utf8');

// Seit GSPP-419 stehen Setup und Installation in Composite Actions unter
// .github/actions/. Die Zusicherungen dieser Datei hängen am Vorkommen statt an
// einer Dateiliste; `readDefinitions` sammelt Workflows und Actions aus einer
// Quelle, damit die verschobene Stelle nicht stillschweigend aus dem Prüfgut
// fällt.
const action = (name: string) =>
  readFileSync(resolve(process.cwd(), '.github/actions', name, 'action.yml'), 'utf8');

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
  // Seit GSPP-419 installiert genau eine Stelle. Die sechs Jobs, die zuvor je
  // eine eigene Kopie trugen, rufen sie über `uses:` auf; die Zusicherung
  // wandert deshalb von der Aufrufliste auf die gemeinsame Quelle.
  it('installs dependencies without lifecycle scripts in the shared setup action', () => {
    expect(action('setup-node-env')).toContain('run: npm ci --ignore-scripts');
  });

  it.each([
    'validate.yml',
    'deploy.yml',
    'update-catalog.yml',
    'sonar.yml',
    'backmerge-main-to-develop.yml',
    'release-prepare.yml',
  ])('installs through the shared setup action in %s', (name) => {
    expect(workflow(name)).toContain('uses: ./.github/actions/setup-node-env');
  });

  // Die Listen oben benennen die Stellen, die heute installieren. Wandert ein
  // Job in eine andere Datei — wie `validate` in GSPP-415 — oder eine
  // Schrittfolge in eine Composite Action — wie in GSPP-419 —, verlören sie
  // stillschweigend ihren Gegenstand. Diese Prüfung hängt deshalb nicht an
  // Dateinamen, sondern am Vorkommen selbst: Wo `npm ci` steht, steht
  // `--ignore-scripts`.
  it('never installs with lifecycle scripts in any workflow or action', () => {
    for (const { label, content } of readDefinitions()) {
      for (const line of content.split('\n')) {
        // Kommentarzeilen sprechen über `npm ci`, ohne es auszuführen. Ein
        // Inline-`#` hinter einem echten Aufruf bleibt absichtlich Teil der
        // geprüften Zeile: Der Test fällt dann fail-closed aus.
        if (line.trimStart().startsWith('#')) continue;
        if (!line.includes('npm ci')) continue;

        expect(line, `${label}: ${line.trim()}`).toContain('npm ci --ignore-scripts');
      }
    }
  });

  // Fail-closed gegen die Erweiterung selbst: Löst .github/actions/ nicht auf,
  // liefen die drei Vorkommensprüfungen dort stillschweigend leer.
  it('collects the composite actions alongside the workflows', () => {
    const labels = readDefinitions().map(({ label }) => label);

    expect(labels).toContain('.github/actions/setup-node-env/action.yml');
    expect(labels).toContain('.github/actions/fetch-pinned-catalog/action.yml');
  });

  // Kein Workflow dieses Repositoriums pusht über die Checkout-Credentials; das
  // Token erreicht die Schritte, die es brauchen, als ausdrückliche Env-Variable.
  // Ein Checkout ohne `persist-credentials: false` ließe es dagegen in der
  // Git-Konfiguration des Arbeitsbaums zurück, wo jeder nachgelagerte Schritt
  // darauf zugreift — in `validate` sind das Kommandos aus dem Pull Request.
  // Auch diese Prüfung hängt am Vorkommen statt an einer Dateiliste.
  it('removes checkout credentials in every workflow or action', () => {
    const marker = 'uses: actions/checkout@';

    for (const { label, content } of readDefinitions()) {
      const lines = content.split('\n');

      // Der Schritt reicht bis zum nächsten Listeneintrag derselben Ebene; was
      // danach steht, gehört einem anderen Schritt und zählt nicht. `stepText`
      // liest die Einrückung aus der Fundstelle, weil ein Schritt im Workflow
      // sechs und in einer Composite Action vier Leerzeichen tief steht.
      lines.forEach((line, index) => {
        if (!line.includes(marker)) return;

        expect(stepText(lines, index), `${label}:${index + 1} Checkout ohne persist-credentials`)
          .toContain('persist-credentials: false');
      });
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
  // statt an einer Dateiliste, damit sie einen neuen Workflow und jede neue
  // Composite Action miterfasst.
  it('never resolves a binary outside the lockfile in any workflow or action', () => {
    for (const { label, content } of readDefinitions()) {
      for (const line of content.split('\n')) {
        if (line.trimStart().startsWith('#')) continue;

        expect(line, `${label}: ${line.trim()}`).not.toMatch(/\b(?:npx|npm exec)\b/);
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
