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

/*
 * `.github/zizmor.version` ist die einzige Versionsquelle für das
 * zizmor-Image (GSPP-426): Der Digest steht in einem `run:`-Block, und
 * Dependabot erfasst laut GitHub-Dokumentation nur `uses:`-Referenzen in
 * Repository-Syntax — Container-URLs sind ausdrücklich ausgenommen. `1.30.1`
 * veraltete deshalb lautlos. Die Digest-Erneuerung bleibt ein manueller PR
 * (dokumentiert an der `IMAGE`-Zeile in validate.yml).
 *
 * Dieser Guard fordert für die `IMAGE`-Zeile den Tag aus der Versionsdatei
 * plus Digest-Format — jede Abweichung dazwischen lässt ihn rot werden, statt
 * erst im Docker-Schritt am Ende von `validate` aufzufallen.
 */

const VERSION_PATH = '.github/zizmor.version';
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const IMAGE_PATTERN =
  /^\s*IMAGE="ghcr\.io\/zizmorcore\/zizmor:(?<tag>[^"@]+)@(?<digest>sha256:[0-9a-f]{64})"\s*$/;

function readZizmorVersion(): string {
  return readFileSync(resolve(process.cwd(), VERSION_PATH), 'utf8').trim();
}

function parseZizmorImageReference(line: string): { tag: string; digest: string } | null {
  const match = IMAGE_PATTERN.exec(line);
  if (!match?.groups) return null;
  return { tag: match.groups.tag, digest: match.groups.digest };
}

function findImageReferences(): { line: number; tag: string; digest: string }[] {
  return workflowLines('validate.yml')
    .map((line, index) => ({ line: index + 1, reference: parseZizmorImageReference(line) }))
    .filter((entry) => entry.reference !== null)
    .map((entry) => ({
      line: entry.line,
      tag: entry.reference!.tag,
      digest: entry.reference!.digest,
    }));
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

describe('zizmor image version pin', () => {
  it('führt die Version in .github/zizmor.version als einzige Quelle', () => {
    const version = readZizmorVersion();

    // Ohne diese Zusicherung bestünde der Guard auch bei leerer oder
    // versionsfremder Datei — die `IMAGE`-Zeile liefe dann gegen nichts.
    expect(version, `${VERSION_PATH} ist leer`).not.toHaveLength(0);
    expect(version, `${VERSION_PATH} trägt keine X.Y.Z-Version: ${version}`).toMatch(
      VERSION_PATTERN,
    );
  });

  it('fordert den Tag aus der Versionsdatei plus Digest-Format in der IMAGE-Zeile', () => {
    const version = readZizmorVersion();
    const references = findImageReferences();

    // Genau eine `IMAGE`-Zeile: keine zweite Fundstelle, die stillschweigend
    // eine andere Version zöge, und kein Verschwinden des Gegenstands.
    expect(references, 'validate.yml führt keine genau eine IMAGE-Zeile mehr').toHaveLength(1);

    const [{ line, tag, digest }] = references;
    expect(tag, `validate.yml:${line} Tag ${tag} weicht von ${VERSION_PATH} (${version}) ab`).toBe(
      version,
    );
    expect(digest, `validate.yml:${line} Digest ist kein sha256 mit 64 Hex-Zeichen`).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
  });
});

describe('zizmor image reference rule', () => {
  const digest = 'a2eb396d886c053073405c7a980f2139ba2248ec172243cfa3841e57196e8101';

  it('akzeptiert Tag plus Digest-Format', () => {
    expect(
      parseZizmorImageReference(`  IMAGE="ghcr.io/zizmorcore/zizmor:1.30.1@sha256:${digest}"`),
    ).toEqual({ tag: '1.30.1', digest: `sha256:${digest}` });
  });

  it('lehnt einen fehlenden oder gekürzten Digest ab', () => {
    expect(parseZizmorImageReference('  IMAGE="ghcr.io/zizmorcore/zizmor:1.30.1"')).toBeNull();
    expect(
      parseZizmorImageReference('  IMAGE="ghcr.io/zizmorcore/zizmor:1.30.1@sha256:a2eb396d"'),
    ).toBeNull();
  });

  it('lehnt einen Digest ab, der kein kleingeschriebenes Hex ist', () => {
    const upper = digest.toUpperCase();
    expect(
      parseZizmorImageReference(`  IMAGE="ghcr.io/zizmorcore/zizmor:1.30.1@sha256:${upper}"`),
    ).toBeNull();
  });

  it('lehnt eine fremde Registry oder ein Tag mit Digest-Trennzeichen ab', () => {
    expect(
      parseZizmorImageReference(`  IMAGE="ghcr.io/other/zizmor:1.30.1@sha256:${digest}"`),
    ).toBeNull();
    expect(
      parseZizmorImageReference(`  IMAGE="ghcr.io/zizmorcore/zizmor:1.30.1@extra@sha256:${digest}"`),
    ).toBeNull();
  });
});
