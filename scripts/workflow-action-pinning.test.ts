import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listDefinitionFiles, readDefinitions } from './workflowDefinitions.mjs';

// Referenzen auf Actions im selben Repository tragen keinen Commit-SHA und
// bleiben ausgenommen. Zulässig sind beide Formen: das arbeitsbereichsrelative
// `./` und die self-repository-Syntax `$/`, die seit GSPP-419 verwendet wird
// und auf das Repository im gerade ausgeführten Commit auflöst.
const LOCAL_REFERENCE = /^[.$]\//;

// Ein Pre-Release- oder Build-Bezeichner nach SemVer: alphanumerisch und
// Bindestrich, mit mindestens einem alphanumerischen Zeichen. Damit fallen
// leere und rein aus Punkten oder Bindestrichen bestehende Bezeichner heraus.
const VERSION_IDENTIFIER = String.raw`[0-9A-Za-z-]*[0-9A-Za-z][0-9A-Za-z-]*`;

// owner/repo@<40-stelliger-SHA> plus Versionskommentar auf derselben Zeile.
// Der Kommentar muss versionsförmig sein — optionales `v`, mindestens eine
// Zahlenkomponente, optionaler Pre-Release-/Build-Zusatz aus punktgetrennten
// Bezeichnern — damit hinter dem SHA nachvollziehbar ein Tag steht und
// Dependabot ihn fortschreiben kann. Platzhalter wie `# pinned` und
// Scheinversionen wie `# v7-...` erfüllen das nicht. Beim Abstand hinter `#`
// bleibt das Muster tolerant, weil Dependabot die Form `@<commit> #<tag>`
// ohne Leerzeichen dokumentiert.
const PINNED_REFERENCE = new RegExp(
  String.raw`^[^@\s]+@[0-9a-f]{40}\s+#\s*v?\d+(?:\.\d+)*` +
    String.raw`(?:[-+]${VERSION_IDENTIFIER}(?:\.${VERSION_IDENTIFIER})*)?$`,
);

const USES_LINE = /^\s*(?:-\s+)?uses:\s*(\S.*?)\s*$/;

interface ActionReference {
  file: string;
  line: number;
  value: string;
}

// Die Sammlung der zu prüfenden Definitionen liegt seit GSPP-419 in
// scripts/workflowDefinitions.mjs. Sie erfasst Workflows und Composite Actions
// aus einer Quelle — ohne sie müsste jeder Guard jede Verschiebung einzeln
// nachziehen, und ein vergessener prüfte stillschweigend weniger.
function collectActionReferences(): ActionReference[] {
  return readDefinitions().flatMap(({ label, content }) =>
    content
      .split('\n')
      .map((line, index) => ({ label, line: index + 1, match: USES_LINE.exec(line) }))
      .filter((entry) => entry.match !== null)
      .map((entry) => ({ file: entry.label, line: entry.line, value: entry.match![1] })),
  );
}

function findUnpinnedReferences(references: ActionReference[]): string[] {
  return references
    .filter(({ value }) => !LOCAL_REFERENCE.test(value) && !PINNED_REFERENCE.test(value))
    .map(({ file, line, value }) => `${file}:${line} ${value}`);
}

describe('workflow action pinning', () => {
  const definitionFiles = listDefinitionFiles().map((file) => relative(process.cwd(), file));
  const references = collectActionReferences();

  it('finds workflows and action references to check', () => {
    // Ohne diese Zusicherung würde der Guard auch bei einem leeren oder falsch
    // aufgelösten Verzeichnis bestehen.
    expect(definitionFiles.length).toBeGreaterThan(0);
    expect(references.length).toBeGreaterThan(0);
  });

  // Fail-closed gegen die Erweiterung selbst: Löst .github/actions/ nicht auf
  // oder wandert eine Action wieder heraus, ohne dass die Liste es merkt,
  // prüfte der Guard dort stillschweigend nichts mehr.
  it('covers the composite actions alongside the workflows', () => {
    expect(definitionFiles.filter((file) => file.startsWith('.github/actions/'))).not.toHaveLength(0);
    expect(references.some((reference) => reference.file.startsWith('.github/actions/'))).toBe(true);
  });

  it('pins every action to a full-length commit SHA with a version comment', () => {
    expect(findUnpinnedReferences(references)).toEqual([]);
  });
});

describe('workflow action pinning rule', () => {
  const check = (value: string) => findUnpinnedReferences([{ file: 'ci.yml', line: 1, value }]);

  it('accepts a full-length SHA followed by a version comment', () => {
    expect(check('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1')).toEqual([]);
    expect(check('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 #v7.0.1')).toEqual([]);
    expect(check('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7')).toEqual([]);
    expect(check('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # 3.2.0')).toEqual([]);
    expect(check('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v4.2.2-beta.1')).toEqual([]);
  });

  it('exempts actions referenced from within this repository', () => {
    expect(check('./.github/actions/setup')).toEqual([]);
    expect(check('$/.github/actions/setup')).toEqual([]);
  });

  it('rejects a tag pin', () => {
    expect(check('actions/checkout@v7')).toEqual(['ci.yml:1 actions/checkout@v7']);
  });

  it('rejects a full-length SHA without a version comment', () => {
    expect(check('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1')).toHaveLength(1);
  });

  it('rejects a comment that names no version', () => {
    const sha = '3d3c42e5aac5ba805825da76410c181273ba90b1';

    expect(check(`actions/checkout@${sha} # pinned`)).toHaveLength(1);
    expect(check(`actions/checkout@${sha} # TODO`)).toHaveLength(1);
    expect(check(`actions/checkout@${sha} # latest`)).toHaveLength(1);
    expect(check(`actions/checkout@${sha} # v7.0.1 vorerst`)).toHaveLength(1);
  });

  it('rejects a version suffix without a usable identifier', () => {
    const sha = '3d3c42e5aac5ba805825da76410c181273ba90b1';

    expect(check(`actions/checkout@${sha} # v7-...`)).toHaveLength(1);
    expect(check(`actions/checkout@${sha} # v7+.`)).toHaveLength(1);
    expect(check(`actions/checkout@${sha} # v7-`)).toHaveLength(1);
    expect(check(`actions/checkout@${sha} # v7+`)).toHaveLength(1);
    expect(check(`actions/checkout@${sha} # v7---`)).toHaveLength(1);
    expect(check(`actions/checkout@${sha} # v7-beta.`)).toHaveLength(1);
  });

  it('accepts well-formed pre-release and build identifiers', () => {
    const sha = '3d3c42e5aac5ba805825da76410c181273ba90b1';

    expect(check(`actions/checkout@${sha} # v4.2.2-beta.1`)).toEqual([]);
    expect(check(`actions/checkout@${sha} # v1.0.0-rc-1`)).toEqual([]);
    expect(check(`actions/checkout@${sha} # v1.0.0+build.5`)).toEqual([]);
  });

  it('rejects a shortened SHA', () => {
    expect(check('actions/checkout@3d3c42e # v7.0.1')).toHaveLength(1);
  });

  it('rejects a SHA that is not lowercase hexadecimal', () => {
    expect(check('actions/checkout@3D3C42E5AAC5BA805825DA76410C181273BA90B1 # v7.0.1')).toHaveLength(1);
  });

  it('reads uses entries whether or not they open a list item', () => {
    const workflow = [
      'jobs:',
      '  build:',
      '    steps:',
      '      - uses: actions/checkout@v7',
      '      - name: Setup',
      '        uses: actions/setup-node@v7',
    ].join('\n');
    const values = workflow
      .split('\n')
      .map((line) => USES_LINE.exec(line))
      .filter((match) => match !== null)
      .map((match) => match![1]);

    expect(values).toEqual(['actions/checkout@v7', 'actions/setup-node@v7']);
  });
});
