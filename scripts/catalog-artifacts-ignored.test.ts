// @vitest-environment node
// =============================================================================
// Auslieferungsartefakte bleiben ungetrackt (GSPP-242)
//
// Die Katalogdaten werden bei jedem Build frisch von BSI geholt und nie
// committet. Diese Invariante stand bisher nur als gepflegte Dateinamenliste in
// `.gitignore` — und lief bei der Lifecycle-Promotion von `catalog-lieferkette`
// auseinander: `catalog-lieferkette.json` war von keiner Regel erfasst und
// damit committierbar.
//
// Der Test misst die Invariante, statt sie erneut zu formulieren: Er leitet die
// erwartete Ausgabemenge aus dem Quellregister ab und fragt Git, ob jede Datei
// tatsächlich ignoriert wird. Jede künftige Promotion ist damit automatisch
// mitgeprüft.
// =============================================================================

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { listCatalogArtifactFileNames } from '../src/domain/sourceRegistry.mjs';

const GENERATED_ARTIFACT_FILE_NAMES = [
  'vocabularies.json',
  'vocabularies-metadata.json',
  'upstream-sources-metadata.json',
];

const outputPaths = [
  ...listCatalogArtifactFileNames(),
  ...GENERATED_ARTIFACT_FILE_NAMES,
].map((fileName) => `public/data/${fileName}`);

/**
 * `git check-ignore` beantwortet die Frage direkt an der echten Regelmenge,
 * statt `.gitignore` nachzuparsen. Exit-Code 0 = ignoriert, 1 = nicht
 * ignoriert; beides sind gültige Antworten, kein Werkzeugfehler.
 */
function isIgnored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--quiet', '--no-index', path], {
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    if ((error as { status?: number }).status === 1) return false;
    throw error;
  }
}

describe('Katalog-Ausgabeartefakte', () => {
  it('deckt jedes abgeleitete Artefakt mit einer .gitignore-Regel ab', () => {
    // Untergrenze: ohne Einträge liefe der Nachweis leer durch.
    expect(outputPaths.length).toBeGreaterThan(GENERATED_ARTIFACT_FILE_NAMES.length);

    const notIgnored = outputPaths.filter((path) => !isIgnored(path));
    expect(notIgnored).toEqual([]);
  });

  it('hält keine Katalogdaten im Index', () => {
    const tracked = execFileSync('git', ['ls-files', 'public/data/'], {
      encoding: 'utf8',
    }).trim();

    expect(tracked).toBe('');
  });
});
