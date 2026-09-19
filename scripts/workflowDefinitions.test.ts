import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WorkflowDefinitionError,
  listDefinitionFiles,
  namedStep,
  readDefinitions,
  runScript,
  stepRange,
  stepText,
} from './workflowDefinitions.mjs';

const temporaryDirectories = new Set<string>();

async function makeRepository(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'gspp-workflow-definitions-'));
  temporaryDirectories.add(root);

  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(resolve(absolute, '..'), { recursive: true });
    await writeFile(absolute, contents, 'utf8');
  }

  return root;
}

const WORKFLOW = [
  'jobs:',
  '  build:',
  '    steps:',
  '      - name: Checkout',
  '        uses: actions/checkout@abc',
  '        with:',
  '          persist-credentials: false',
  '',
  '      - name: Read pinned snapshot SHA from manifest',
  '        id: manifest',
  '        run: |',
  '          set -euo pipefail',
  '          echo "sha=abc" >> "$GITHUB_OUTPUT"',
  '',
  '      - uses: ./.github/actions/setup-node-env',
  '',
].join('\n');

// Ein Composite-Action-Schritt steht zwei Ebenen flacher als ein
// Workflow-Schritt. Die Hilfen dürfen die Einrückung deshalb nicht
// festschreiben.
const ACTION = [
  'runs:',
  '  using: composite',
  '  steps:',
  '    - name: Setup Node.js',
  '      uses: actions/setup-node@abc',
  '      with:',
  '        node-version-file: .nvmrc',
  '',
  '    - name: Install dependencies',
  '      shell: bash',
  '      run: npm ci --ignore-scripts',
  '',
].join('\n');

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })),
  );
  temporaryDirectories.clear();
});

describe('listDefinitionFiles', () => {
  it('sammelt Workflows und Composite Actions, Workflows zuerst', async () => {
    const root = await makeRepository({
      '.github/workflows/validate.yml': WORKFLOW,
      '.github/workflows/ci.yml': WORKFLOW,
      '.github/workflows/notes.md': 'kein Workflow\n',
      '.github/actions/setup-node-env/action.yml': ACTION,
      '.github/actions/setup-node-env/README.md': 'keine Action\n',
    });

    expect(listDefinitionFiles(root).map((path) => path.slice(root.length + 1))).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/validate.yml',
      '.github/actions/setup-node-env/action.yml',
    ]);
  });

  it('findet Actions auch in tieferen Verzeichnissen', async () => {
    const root = await makeRepository({
      '.github/workflows/ci.yml': WORKFLOW,
      '.github/actions/gruppe/innen/action.yaml': ACTION,
    });

    expect(listDefinitionFiles(root)).toHaveLength(2);
  });

  // Fail-closed: Ohne diese Zusicherung bestünde jeder darauf aufbauende Guard
  // auf einem falsch aufgelösten Arbeitsverzeichnis, weil er nichts zu prüfen
  // fände.
  it('schlägt fehl, wenn kein Workflow gefunden wird', async () => {
    const root = await makeRepository({ '.github/workflows/notes.md': 'leer\n' });

    expect(() => listDefinitionFiles(root)).toThrow(WorkflowDefinitionError);
  });

  it('erlaubt ein fehlendes .github/actions', async () => {
    const root = await makeRepository({ '.github/workflows/ci.yml': WORKFLOW });

    expect(listDefinitionFiles(root)).toHaveLength(1);
  });

  it('besteht gegen dieses Repository', () => {
    const labels = readDefinitions().map(({ label }) => label);

    expect(labels).toContain('.github/workflows/validate.yml');
    expect(labels).toContain('.github/actions/setup-node-env/action.yml');
  });
});

describe('stepRange', () => {
  it('schneidet einen Workflow-Schritt an der nächsten Listenmarke ab', () => {
    const lines = WORKFLOW.split('\n');

    expect(stepRange(lines, 3)).toEqual([3, 8]);
  });

  it('schneidet einen Composite-Action-Schritt bei flacherer Einrückung ab', () => {
    const lines = ACTION.split('\n');

    expect(stepRange(lines, 3)).toEqual([3, 8]);
  });

  // Ein `uses:` ohne with-Block ist ein Schritt von einer Zeile — genau die
  // Aussage, die ein Guard dort braucht.
  it('gibt für einen Schritt ohne Folgeblock eine einzelne Zeile zurück', () => {
    const lines = WORKFLOW.split('\n');

    expect(stepText(lines, 14).trim()).toBe('- uses: ./.github/actions/setup-node-env');
  });

  it('verlässt den Block bei flacherer Einrückung', () => {
    const lines = ['    steps:', '      - name: A', '        run: true', 'jobs:'];

    expect(stepRange(lines, 1)).toEqual([1, 3]);
  });
});

describe('namedStep', () => {
  it('findet einen Schritt unabhängig von der Einrückung', () => {
    expect(namedStep(ACTION, 'Install dependencies')).toContain('npm ci --ignore-scripts');
    expect(namedStep(WORKFLOW, 'Checkout')).toContain('persist-credentials: false');
  });

  it('nimmt den Listenstrich der Namenszeile mit', () => {
    expect(namedStep(WORKFLOW, 'Checkout').trimStart()).toMatch(/^- name: Checkout/);
  });

  // Ein Guard, dessen Gegenstand verschwunden ist, darf nicht bestehen.
  it('wirft, wenn der Schritt fehlt', () => {
    expect(() => namedStep(WORKFLOW, 'Gibt es nicht')).toThrow(WorkflowDefinitionError);
  });
});

describe('runScript', () => {
  it('löst den run-Block eines Workflow-Schritts auf', () => {
    expect(runScript(namedStep(WORKFLOW, 'Read pinned snapshot SHA from manifest'))).toBe(
      'set -euo pipefail\necho "sha=abc" >> "$GITHUB_OUTPUT"\n',
    );
  });

  it('wirft, wenn der Schritt keinen mehrzeiligen run-Block trägt', () => {
    expect(() => runScript(namedStep(ACTION, 'Install dependencies'))).toThrow(
      WorkflowDefinitionError,
    );
  });
});
