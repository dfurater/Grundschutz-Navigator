/*
 * Gemeinsame Lesehilfen für Workflow- und Action-Definitionen (GSPP-419).
 *
 * Bis GSPP-419 lagen alle Setup-Schritte in `.github/workflows/`, und jeder
 * Guard sammelte sein Prüfgut mit einem eigenen `readdirSync` über genau dieses
 * Verzeichnis. Mit den Composite Actions unter `.github/actions/` müssten das
 * nun vier Stellen gleichzeitig nachziehen — `scripts/verify-node-version.mjs`,
 * `scripts/workflow-action-pinning.test.ts`,
 * `scripts/ci-supply-chain-hardening.test.ts` und
 * `scripts/ci-failure-contract.test.ts`. Eine vergessene Stelle prüfte dann
 * stillschweigend weniger, statt fehlzuschlagen. Die Sammlung steht deshalb
 * hier, und die Guards lesen aus derselben Quelle, deren Duplikate sie
 * verhindern sollen.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const WORKFLOW_DIR = '.github/workflows';
export const ACTION_DIR = '.github/actions';

export class WorkflowDefinitionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkflowDefinitionError';
  }
}

/**
 * Listet jede Workflow-Datei und jede Composite-Action-Definition als
 * absoluten Pfad, Workflows zuerst und je Gruppe alphabetisch.
 *
 * Ein fehlendes `.github/actions` ist zulässig — das Verzeichnis entsteht erst
 * mit der ersten Action. Ein Workflow-Verzeichnis ohne Definition ist es nicht:
 * Ein Guard, der nichts findet, bestünde sonst auf einem falsch aufgelösten
 * Arbeitsverzeichnis, statt fehlzuschlagen.
 */
export function listDefinitionFiles(root = process.cwd()) {
  const workflowDir = resolve(root, WORKFLOW_DIR);
  const files = readdirSync(workflowDir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map((name) => join(workflowDir, name));

  if (files.length === 0) {
    throw new WorkflowDefinitionError(`${WORKFLOW_DIR} enthält keine Workflow-Definition.`);
  }

  const walk = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry === 'action.yml' || entry === 'action.yaml') files.push(path);
    }
  };
  try {
    walk(resolve(root, ACTION_DIR));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return files;
}

/**
 * Liest jede Definition als `{ label, content }`; `label` ist der Pfad relativ
 * zur Repository-Wurzel und taugt damit als Fundstellenangabe in einer
 * Fehlermeldung.
 */
export function readDefinitions(root = process.cwd()) {
  return listDefinitionFiles(root).map((file) => ({
    label: relative(root, file),
    content: readFileSync(file, 'utf8'),
  }));
}

/**
 * Gibt die Zeilenspanne `[start, end)` des Schritts zurück, zu dem die Zeile
 * `index` gehört.
 *
 * Ein Schritt reicht bis zum nächsten Listeneintrag derselben oder einer
 * flacheren Ebene, oder bis der Block verlassen wird. Die Einrückung wird aus
 * der Fundstelle gelesen statt festgeschrieben: In einem Workflow steht ein
 * Schritt sechs Leerzeichen tief, in einer Composite Action vier. Ein `uses:`
 * ohne eigenen `with:`-Block ergibt eine Spanne von einer Zeile — genau die
 * Aussage, die ein Guard dort braucht.
 */
export function stepRange(lines, index) {
  const indent = lines[index].search(/\S/);
  let end = index + 1;

  while (end < lines.length) {
    const line = lines[end];
    const lineIndent = line.search(/\S/);
    if (lineIndent < 0) {
      end += 1;
      continue;
    }
    if (lineIndent < indent) break;
    if (lineIndent <= indent && line.trimStart().startsWith('- ')) break;
    end += 1;
  }

  return [index, end];
}

/**
 * Gibt den Schritt, zu dem die Zeile `index` gehört, als Text zurück.
 */
export function stepText(lines, index) {
  const [start, end] = stepRange(lines, index);
  return lines.slice(start, end).join('\n');
}

/**
 * Gibt den Schritt mit dem angegebenen `name:` als Text zurück. Wirft, wenn er
 * fehlt — ein Guard, dessen Gegenstand verschwunden ist, darf nicht bestehen.
 */
export function namedStep(content, name) {
  const lines = content.split('\n');
  const index = lines.findIndex(
    (line) => line.trimStart().replace(/^-\s+/, '') === `name: ${name}`,
  );
  if (index < 0) {
    throw new WorkflowDefinitionError(`Schritt nicht gefunden: ${name}`);
  }

  // Trägt die Zeile den Listenstrich nicht selbst, beginnt der Schritt eine
  // Zeile darüber beim `- uses:`; `name:` steht dort als Folgezeile.
  const start = lines[index].trimStart().startsWith('- ') ? index : findItemStart(lines, index);
  return stepText(lines, start);
}

function findItemStart(lines, index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (lines[cursor].trimStart().startsWith('- ')) return cursor;
  }
  return index;
}

/**
 * Löst den `run: |`-Block eines Schritts in ein ausführbares Skript auf.
 */
export function runScript(step) {
  const lines = step.split('\n');
  const index = lines.findIndex((line) => line.trimStart() === 'run: |');
  if (index < 0) {
    throw new WorkflowDefinitionError('Multiline run block not found');
  }

  const indent = ' '.repeat(lines[index].search(/\S/) + 2);
  return lines
    .slice(index + 1)
    .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
    .join('\n');
}
