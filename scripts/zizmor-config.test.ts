import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDefinitions } from './workflowDefinitions.mjs';

/*
 * `.github/zizmor.yml` ignoriert `secrets-outside-env` zeilengenau statt
 * dateiweit (GSPP-418, Greptile-P1 auf PR #256): Eine neue Secret-Referenz auf
 * einer anderen Zeile soll unter der Gate-Persona auditor wieder feuern.
 *
 * Der Preis dieser Schärfe ist eine von Hand gepflegte Zuordnung, die jede
 * Zeilenverschiebung ungültig macht. Bis GSPP-419 fiel das erst im
 * Docker-Schritt am Ende des Jobs `validate` auf — nach Lint, Tests,
 * Browser-Tests und Build, und lokal überhaupt nur mit laufendem Docker-Daemon.
 * Die Zusammenführung der Setup-Schichten verkürzte fünf der sechs betroffenen
 * Dateien und hätte genau diesen Weg genommen.
 *
 * Dieser Guard prüft nicht, ob eine Stelle zu Recht ignoriert wird — das bleibt
 * Sache des Audits und des Cross-Reviews auf diesem Review-Policy-Pfad. Er
 * prüft, dass jeder Anker noch auf eine reale Secret-Referenz zeigt, und dass
 * die Liste keine Fundstelle verschweigt, die es nicht gibt.
 */

const CONFIG_PATH = '.github/zizmor.yml';
const ANCHOR_PATTERN = /^\s+- (?<file>[\w.-]+\.ya?ml):(?<line>\d+):(?<column>\d+)$/;

interface Anchor {
  file: string;
  line: number;
  column: number;
}

function readSecretAnchors(): Anchor[] {
  const lines = readFileSync(resolve(process.cwd(), CONFIG_PATH), 'utf8').split('\n');
  const start = lines.findIndex((line) => line.trim() === 'secrets-outside-env:');
  expect(start, `${CONFIG_PATH} führt keine secrets-outside-env-Regel mehr`).toBeGreaterThan(-1);

  const anchors: Anchor[] = [];
  for (let index = start + 2; index < lines.length; index += 1) {
    const match = ANCHOR_PATTERN.exec(lines[index]);
    if (!match) break;

    anchors.push({
      file: match.groups!.file,
      line: Number(match.groups!.line),
      column: Number(match.groups!.column),
    });
  }

  return anchors;
}

function workflowLines(file: string): string[] {
  return readFileSync(resolve(process.cwd(), '.github/workflows', file), 'utf8').split('\n');
}

describe('zizmor secrets-outside-env anchors', () => {
  const anchors = readSecretAnchors();

  it('reads the anchors from the configuration', () => {
    // Ohne diese Zusicherung bestünde der Guard, sobald sich das Format der
    // Konfiguration ändert und das Muster nichts mehr trifft.
    expect(anchors).toHaveLength(7);
  });

  it.each(anchors)('points at a real secret reference in $file:$line:$column', (anchor) => {
    const line = workflowLines(anchor.file)[anchor.line - 1];

    expect(line, `${anchor.file}:${anchor.line} existiert nicht`).toBeDefined();
    expect(
      line.slice(anchor.column - 1),
      `${anchor.file}:${anchor.line}:${anchor.column} zeigt nicht auf "secrets."`,
    ).toMatch(/^secrets\./);
  });

  // Eine Secret-Referenz, die in keinem `env:`-Block steht und keinen Anker
  // trägt, lässt den Audit rot werden. Dieser Guard nennt sie hier, statt die
  // Fundstelle erst im Docker-Schritt sichtbar werden zu lassen.
  it('anchors every secret reference that is not a plain env assignment', () => {
    const anchored = new Set(anchors.map(({ file, line }) => `${file}:${line}`));
    const unanchored: string[] = [];

    for (const { label, content } of readDefinitions()) {
      const file = label.split('/').pop()!;
      content.split('\n').forEach((line, index) => {
        if (line.trimStart().startsWith('#')) return;
        if (!/\$\{\{\s*secrets\./.test(line)) return;
        if (anchored.has(`${file}:${index + 1}`)) return;

        // Eine schlichte Zuweisung `NAME: ${{ secrets.X }}` innerhalb eines
        // `env:`-Blocks ist die Form, die die Regel gerade verlangt.
        if (/^\s+[A-Z_][A-Z0-9_]*:\s*\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}\s*$/.test(line)) return;

        unanchored.push(`${label}:${index + 1} ${line.trim()}`);
      });
    }

    expect(unanchored).toEqual([]);
  });
});
