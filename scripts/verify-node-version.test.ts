import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NodeVersionError,
  assertNvmrcSatisfiesEngines,
  assertRuntimeSatisfiesEngines,
  findVersionSourceViolations,
  parseEnginesNode,
  parseNvmrc,
  verifyNodeVersion,
} from './verify-node-version.mjs';
import { listDefinitionFiles } from './workflowDefinitions.mjs';

const temporaryDirectories = new Set<string>();

async function makeRepository(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'gspp-node-version-'));
  temporaryDirectories.add(root);

  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path);
    await mkdir(resolve(absolute, '..'), { recursive: true });
    await writeFile(absolute, contents, 'utf8');
  }

  return root;
}

const SETUP_NODE_SHA = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0';

const CLEAN_WORKFLOW = [
  'jobs:',
  '  build:',
  '    steps:',
  '      - name: Setup Node.js',
  `        uses: ${SETUP_NODE_SHA}`,
  '        with:',
  '          node-version-file: .nvmrc',
  '          cache: npm',
  '',
].join('\n');

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })),
  );
  temporaryDirectories.clear();
});

describe('parseNvmrc', () => {
  it.each([
    ['22\n', { major: 22, minor: undefined, patch: undefined }],
    ['22.22\n', { major: 22, minor: 22, patch: undefined }],
    ['  22.22.0  \n', { major: 22, minor: 22, patch: 0 }],
  ])('liest %j als Versionsangabe', (contents, expected) => {
    expect(parseNvmrc(contents)).toMatchObject(expected);
  });

  // Aliasse und Bereiche ließen sich gegen engines.node nicht mehr eindeutig
  // vergleichen und sind deshalb ein Fehler statt einer stillen Ausnahme.
  it.each(['lts/*', 'v22', '>=22', 'node', '22.x', ''])(
    'lehnt %j ab',
    (contents) => {
      expect(() => parseNvmrc(contents)).toThrow(NodeVersionError);
    },
  );
});

describe('parseEnginesNode', () => {
  it('liest die untere Schranke', () => {
    expect(parseEnginesNode('>=22.22.0')).toMatchObject({ major: 22, minor: 22, patch: 0 });
    expect(parseEnginesNode('>= 22.22.0')).toMatchObject({ major: 22, minor: 22, patch: 0 });
  });

  it.each(['^22.22.0', '>=22', '>=22.22.0 <23', '', undefined, 22])(
    'lehnt %j ab, statt die Prüfung leerlaufen zu lassen',
    (engines) => {
      expect(() => parseEnginesNode(engines as string)).toThrow(NodeVersionError);
    },
  );
});

describe('assertNvmrcSatisfiesEngines', () => {
  const engines = parseEnginesNode('>=22.22.0');

  it.each(['22', '22.22', '22.22.0', '22.23', '22.22.1', '23.0.0'])(
    'akzeptiert oder verwirft %s nachvollziehbar',
    (value) => {
      const nvmrc = parseNvmrc(value);
      const run = () => assertNvmrcSatisfiesEngines(nvmrc, engines);

      if (value === '23.0.0') expect(run).toThrow(/verschiedene Major-Versionen/);
      else expect(run).not.toThrow();
    },
  );

  it.each(['21', '21.99.99'])('verwirft den kleineren Major %s', (value) => {
    expect(() => assertNvmrcSatisfiesEngines(parseNvmrc(value), engines)).toThrow(
      /verschiedene Major-Versionen/,
    );
  });

  it.each(['22.21', '22.21.9', '22.22.0'])(
    'vergleicht Minor und Patch komponentenweise (%s)',
    (value) => {
      const run = () => assertNvmrcSatisfiesEngines(parseNvmrc(value), engines);

      if (value === '22.22.0') expect(run).not.toThrow();
      else expect(run).toThrow(/unterschreitet/);
    },
  );

  it('verwirft einen zu kleinen Patch in derselben Minor-Linie', () => {
    expect(() =>
      assertNvmrcSatisfiesEngines(parseNvmrc('22.22.0'), parseEnginesNode('>=22.22.3')),
    ).toThrow(/unterschreitet/);
  });
});

describe('assertRuntimeSatisfiesEngines', () => {
  const engines = parseEnginesNode('>=22.22.0');

  it.each(['v22.22.0', 'v22.22.3', 'v22.23.0', 'v23.0.0'])('akzeptiert %s', (version) => {
    expect(() => assertRuntimeSatisfiesEngines(version, engines)).not.toThrow();
  });

  // Genau die Lücke, die ein reiner Dateivergleich offenlässt: `.nvmrc` mit
  // bloßem Major bleibt vereinbar, während die aufgelöste Version die Schranke
  // unterschreitet (Greptile-P2 auf PR #257).
  it.each(['v22.21.9', 'v22.0.0', 'v21.99.99'])('verwirft %s', (version) => {
    expect(() => assertRuntimeSatisfiesEngines(version, engines)).toThrow(/unterschreitet/);
  });

  it('akzeptiert die Angabe auch ohne v-Präfix', () => {
    expect(() => assertRuntimeSatisfiesEngines('22.22.0', engines)).not.toThrow();
  });

  it.each([undefined, '', 'unbekannt', 'v22'])(
    'verwirft die nicht interpretierbare Angabe %j',
    (version) => {
      expect(() => assertRuntimeSatisfiesEngines(version as string, engines)).toThrow(
        /nicht interpretierbar/,
      );
    },
  );
});

describe('findVersionSourceViolations', () => {
  it('meldet nichts, wenn jedes Setup .nvmrc liest', async () => {
    const root = await makeRepository({ '.github/workflows/ci.yml': CLEAN_WORKFLOW });

    expect(findVersionSourceViolations(listDefinitionFiles(root), root)).toEqual([]);
  });

  it('meldet ein wiedereingeführtes Versionsliteral', async () => {
    const root = await makeRepository({
      '.github/workflows/ci.yml': CLEAN_WORKFLOW.replace(
        '          node-version-file: .nvmrc\n',
        '          node-version-file: .nvmrc\n          node-version: 22\n',
      ),
    });

    expect(findVersionSourceViolations(listDefinitionFiles(root), root)).toEqual([
      expect.stringContaining('führt die Node-Version als Literal'),
    ]);
  });

  it('meldet ein Setup ohne node-version-file', async () => {
    const root = await makeRepository({
      '.github/workflows/ci.yml': CLEAN_WORKFLOW.replace(
        '        with:\n          node-version-file: .nvmrc\n',
        '        with:\n',
      ),
    });

    expect(findVersionSourceViolations(listDefinitionFiles(root), root)).toEqual([
      expect.stringContaining('ohne "node-version-file: .nvmrc"'),
    ]);
  });

  it('meldet ein Setup ganz ohne with-Block', async () => {
    const root = await makeRepository({
      '.github/workflows/ci.yml': [
        'jobs:',
        '  build:',
        '    steps:',
        `      - uses: ${SETUP_NODE_SHA}`,
        '      - name: Build',
        '        run: npm run build',
        '',
      ].join('\n'),
    });

    expect(findVersionSourceViolations(listDefinitionFiles(root), root)).toEqual([
      expect.stringContaining('ohne "node-version-file: .nvmrc"'),
    ]);
  });

  // Der nächste Schritt gehört nicht mehr zum Setup; ein dort stehendes
  // node-version-file darf es nicht entlasten.
  it('zählt den folgenden Schritt nicht zum Setup-Schritt', async () => {
    const root = await makeRepository({
      '.github/workflows/ci.yml': [
        'jobs:',
        '  build:',
        '    steps:',
        '      - name: Setup Node.js',
        `        uses: ${SETUP_NODE_SHA}`,
        '      - name: Andere Action',
        '        uses: $/.github/actions/setup-node-env',
        '        with:',
        '          node-version-file: .nvmrc',
        '',
      ].join('\n'),
    });

    expect(findVersionSourceViolations(listDefinitionFiles(root), root)).toHaveLength(1);
  });

  // Kommentarzeilen sprechen über die Version, ohne sie zu setzen.
  it('wertet Kommentarzeilen nicht als Literal', async () => {
    const root = await makeRepository({
      '.github/workflows/ci.yml': CLEAN_WORKFLOW.replace(
        '      - name: Setup Node.js\n',
        '      # Frueher stand hier node-version: 22.\n      - name: Setup Node.js\n',
      ),
    });

    expect(findVersionSourceViolations(listDefinitionFiles(root), root)).toEqual([]);
  });

  it('prüft Composite Actions mit demselben Maßstab', async () => {
    const root = await makeRepository({
      '.github/workflows/ci.yml': CLEAN_WORKFLOW,
      '.github/actions/setup-node-env/action.yml': [
        'runs:',
        '  using: composite',
        '  steps:',
        '    - name: Setup Node.js',
        `      uses: ${SETUP_NODE_SHA}`,
        '      with:',
        '        node-version: 22',
        '',
      ].join('\n'),
    });

    expect(findVersionSourceViolations(listDefinitionFiles(root), root)).toHaveLength(2);
  });
});

describe('verifyNodeVersion', () => {
  it('besteht gegen dieses Repository', () => {
    expect(verifyNodeVersion()).toEqual({
      nvmrc: '22.22.0',
      engines: '>=22.22.0',
      runtime: process.version,
    });
  });

  it('meldet eine Abweichung zwischen .nvmrc und engines.node', async () => {
    const root = await makeRepository({
      '.nvmrc': '24\n',
      'package.json': JSON.stringify({ engines: { node: '>=22.22.0' } }),
      '.github/workflows/ci.yml': CLEAN_WORKFLOW,
    });

    expect(() => verifyNodeVersion(root)).toThrow(/verschiedene Major-Versionen/);
  });

  it('meldet ein Versionsliteral mit der betroffenen Stelle', async () => {
    const root = await makeRepository({
      '.nvmrc': '22\n',
      'package.json': JSON.stringify({ engines: { node: '>=22.22.0' } }),
      '.github/workflows/ci.yml': CLEAN_WORKFLOW.replace(
        '          cache: npm\n',
        '          cache: npm\n          node-version: 22\n',
      ),
    });

    expect(() => verifyNodeVersion(root)).toThrow(/\.github\/workflows\/ci\.yml:9/);
  });
});
