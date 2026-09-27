// @vitest-environment node
// =============================================================================
// Keine Kopien abgeleiteter Namespace-URLs (Greptile-Befund im Release-PR #305)
//
// `vocabularyNamespaces.ts` leitet die Namespace-URLs aus dem Quellregister ab,
// weil die Auflösung exakte URL-Strings vergleicht und bei Abweichung still
// `null` liefert. Ein Test oder eine Fixture, die eine dieser URLs als Literal
// abschreibt, prüft nach einer Pfadmigration weiter gegen den alten Namespace,
// statt die produktive Auflösung abzusichern. Dieser Test sucht deshalb jede
// exportierte URL wörtlich unter `src/`; auch ihre Quelle bildet sie nur aus
// dem Quellregister. Neue Konstanten fallen ohne Nachpflege unter die Prüfung.
// `scripts/` bleibt außen vor: Die Pipeline bildet ihre URLs selbst
// (`vocabulary-utils.mjs`), und ihre Tests reichen URLs als Eingabe an den
// Parser, statt die Auflösung der App gegen sie zu prüfen.
// =============================================================================

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as vocabularyNamespaces from './vocabularyNamespaces';

const REPOSITORY_ROOT = join(import.meta.dirname, '..', '..');
const SEARCHED_ROOT = 'src';
const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]s|tsx|jsx)$/;

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return SOURCE_EXTENSIONS.test(entry.name) ? [path] : [];
  });
}

const derivedUrls = Object.values(vocabularyNamespaces).filter(
  (value): value is string => typeof value === 'string' && value.startsWith('https://'),
);

describe('abgeleitete Namespace-URLs', () => {
  it('umfasst alle exportierten Namespace-Konstanten', () => {
    // Ohne diese Probe bliebe der Test grün, wenn der Filter nichts fände.
    expect(derivedUrls).toEqual(expect.arrayContaining([
      vocabularyNamespaces.SECURITY_TARGETS_NAMESPACE_URL,
      vocabularyNamespaces.SECURITY_TARGET_LEVELS_NAMESPACE_URL,
      vocabularyNamespaces.PRACTICES_NAMESPACE_URL,
      vocabularyNamespaces.TOPICS_NAMESPACE_URL,
    ]));
  });

  it('stehen unter src/ nirgends als Literal', () => {
    const copies = listSourceFiles(join(REPOSITORY_ROOT, SEARCHED_ROOT))
      .map((path) => relative(REPOSITORY_ROOT, path).split('\\').join('/'))
      .flatMap((path) => {
        const content = readFileSync(join(REPOSITORY_ROOT, path), 'utf8');
        return derivedUrls
          .filter((url) => content.includes(url))
          .map((url) => `${path}: ${url}`);
      });

    expect(copies).toEqual([]);
  });
});
