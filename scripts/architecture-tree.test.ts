import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Der Verzeichnisbaum in docs/ARCHITECTURE.md ist verbindlich vollständig
// (GSPP-260): Jedes Verzeichnis, unter dem Einträge stehen, führt alle seine
// Dateien und Unterverzeichnisse auf. Ohne diese Prüfung driftet er — vor
// GSPP-260 fehlten allein unter src/domain/ zwei Drittel der Dateien.

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCHITECTURE_PATH = join(REPO_ROOT, 'docs/ARCHITECTURE.md');
const SECTION_HEADING = '## Verzeichnisstruktur';

// Kolokierte Tests sind aus dem Baum ausgenommen; .DS_Store ist gitignorierter
// Finder-Zustand und existiert nur auf macOS-Arbeitsplätzen.
const COLOCATED_TEST = /\.test\.[cm]?[jt]sx?$/;
const IGNORED_NAMES = new Set(['.DS_Store']);

// Wurzeleinträge stehen ohne Präfix; darunter trägt jede Ebene genau vier
// Zeichen Einrückung („│   " oder „    ") vor dem Verbinder.
const TREE_LINE = /^((?:│ {3}| {4})*)(?:[├└]── )?(\S+)(?:\s+#\s*(.*))?$/;

interface TreeEntry {
  readonly path: string;
  readonly isDirectory: boolean;
  readonly description: string;
  readonly line: number;
  readonly children: TreeEntry[];
}

function readTreeBlock(markdown: string): { lines: string[]; firstLine: number } {
  const lines = markdown.split('\n');
  const headingIndex = lines.indexOf(SECTION_HEADING);
  if (headingIndex === -1) throw new Error(`Überschrift „${SECTION_HEADING}" fehlt`);
  const openIndex = lines.indexOf('```', headingIndex);
  const closeIndex = lines.indexOf('```', openIndex + 1);
  if (openIndex === -1 || closeIndex === -1) throw new Error('Codeblock des Verzeichnisbaums fehlt');
  return { lines: lines.slice(openIndex + 1, closeIndex), firstLine: openIndex + 2 };
}

function parseTree(markdown: string): TreeEntry[] {
  const { lines, firstLine } = readTreeBlock(markdown);
  const roots: TreeEntry[] = [];
  const stack: TreeEntry[] = [];
  lines.forEach((text, index) => {
    if (text.trim() === '') return;
    const line = firstLine + index;
    const match = TREE_LINE.exec(text);
    if (!match) throw new Error(`Zeile ${line} ist keine Baumzeile: ${text}`);
    const [, indent, name, description = ''] = match;
    const hasConnector = /[├└]── /.test(text);
    const depth = hasConnector ? indent.length / 4 + 1 : 0;
    if (depth > stack.length) throw new Error(`Zeile ${line} springt eine Ebene: ${text}`);
    stack.length = depth;
    const parent = stack.at(-1);
    const entry: TreeEntry = {
      path: parent ? `${parent.path}${name}` : name,
      isDirectory: name.endsWith('/'),
      description: description.trim(),
      line,
      children: [],
    };
    if (parent) {
      if (!parent.isDirectory) throw new Error(`Zeile ${line} hängt unter der Datei ${parent.path}`);
      parent.children.push(entry);
    } else {
      roots.push(entry);
    }
    stack.push(entry);
  });
  return roots;
}

function flatten(entries: readonly TreeEntry[]): TreeEntry[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.children)]);
}

function listDirectory(relativePath: string): string[] {
  return readdirSync(join(REPO_ROOT, relativePath), { withFileTypes: true })
    .filter((dirent) => !IGNORED_NAMES.has(dirent.name) && !COLOCATED_TEST.test(dirent.name))
    .map((dirent) => (dirent.isDirectory() ? `${dirent.name}/` : dirent.name))
    .sort();
}

function childName(entry: TreeEntry, parent: TreeEntry): string {
  return entry.path.slice(parent.path.length);
}

const entries = flatten(parseTree(readFileSync(ARCHITECTURE_PATH, 'utf8')));

describe('Verzeichnisbaum in docs/ARCHITECTURE.md', () => {
  it('beschreibt jeden Eintrag', () => {
    const undescribed = entries.filter((entry) => entry.description === '');
    expect(undescribed.map((entry) => `Zeile ${entry.line}: ${entry.path}`)).toEqual([]);
  });

  it('führt nur existierende Pfade mit passendem Typ', () => {
    const mismatched = entries.filter((entry) => {
      let isDirectory: boolean;
      try {
        isDirectory = statSync(join(REPO_ROOT, entry.path)).isDirectory();
      } catch {
        return true;
      }
      return isDirectory !== entry.isDirectory;
    });
    expect(mismatched.map((entry) => `Zeile ${entry.line}: ${entry.path}`)).toEqual([]);
  });

  it('zählt jedes Verzeichnis mit Einträgen vollständig auf', () => {
    const drift = entries
      .filter((entry) => entry.isDirectory && entry.children.length > 0)
      .flatMap((directory) => {
        const listed = directory.children.map((child) => childName(child, directory));
        const actual = listDirectory(directory.path);
        const missing = actual.filter((name) => !listed.includes(name));
        const surplus = listed.filter((name) => !actual.includes(name));
        const duplicated = listed.filter((name, index) => listed.indexOf(name) !== index);
        return [
          ...missing.map((name) => `fehlt: ${directory.path}${name}`),
          ...surplus.map((name) => `existiert nicht: ${directory.path}${name}`),
          ...duplicated.map((name) => `doppelt: ${directory.path}${name}`),
        ];
      });
    expect(drift).toEqual([]);
  });
});
