// @vitest-environment node
// =============================================================================
// Modulgrenzen des Component-Adapters (GSPP-248)
//
// Zwei Zusagen dieses Slices sind Aussagen über den Quelltext, nicht über sein
// Laufzeitverhalten:
//
//  1. Es gibt **keine** Component-Definition-Versionskonstante. Welche
//     Schemazelle gilt, entscheidet allein `metadata.oscal-version`.
//  2. Referenzen werden **ausschließlich** über
//     `src/domain/referenceResolution.ts` klassifiziert. Der Adapter verzweigt
//     nirgends selbst auf die Form eines `href`.
//
// Beide wären als „greppbares Review-Kriterium" nur so lange wahr, wie jemand
// gerade greppt. Hier hängen sie an einem Test.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';

/** Repo-relativ; das Arbeitsverzeichnis des Testlaufs ist die Projektwurzel. */
const RUNTIME_SOURCES = [
  'src/adapters/oscalComponentAdapter.ts',
  'src/adapters/oscalComponentReaders.ts',
  'src/adapters/oscalComponentDocument.ts',
  'src/domain/componentDefinitionModel.ts',
] as const;

const RAW_TYPES_SOURCE = 'src/domain/oscalComponentDefinition.ts';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Zeilen ohne Kommentare — ein Versionsliteral in Prosa ist kein Code. */
function codeLines(source: string): readonly string[] {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

describe('Keine Component-Definition-Versionskonstante', () => {
  it.each(RUNTIME_SOURCES)('%s nennt keine gepinnte OSCAL-Version', (path) => {
    const lines = codeLines(read(path));

    for (const version of PINNED_OSCAL_VERSIONS) {
      const offending = lines.filter((line) => line.includes(`'${version}'`));
      expect(offending, `${path} → ${version}`).toEqual([]);
    }
  });

  it('führt Versionsliterale ausschließlich als Feldprädikate der Raw-Typen', () => {
    const lines = codeLines(read(RAW_TYPES_SOURCE));
    const withVersion = lines.filter((line) =>
      PINNED_OSCAL_VERSIONS.some((version) => line.includes(`'${version}'`)),
    );

    expect(withVersion.length).toBeGreaterThan(0);
    for (const line of withVersion) {
      // Erlaubt ist genau eine Form: ein benanntes, am Schema geprüftes
      // Feldprädikat (siehe oscalComponentDefinition.versionDrift.test.ts).
      expect(line.trim()).toMatch(/^export type OscalVersionsWith\w+ = .+;$/);
    }
  });
});

describe('Einziger Klassifikationsweg für Referenzen', () => {
  it('importiert resolveOscalReference an genau einer Stelle', () => {
    const importing = [...RUNTIME_SOURCES, RAW_TYPES_SOURCE].filter((path) =>
      read(path).includes('resolveOscalReference'),
    );

    expect(importing).toEqual(['src/adapters/oscalComponentAdapter.ts']);
  });

  it.each([...RUNTIME_SOURCES, RAW_TYPES_SOURCE])(
    '%s verzweigt nicht selbst auf die Form eines href',
    (path) => {
      const code = codeLines(read(path)).join('\n');

      // Fragmentprüfung, URL-Parsing und Protokollprüfung sind die drei
      // Formen, in denen eine zweite Klassifikation entstehen würde.
      expect(code, 'Fragmentliteral').not.toMatch(/['"]#['"]/);
      expect(code, 'URL-Konstruktion').not.toMatch(/new URL\(|URL\.(parse|canParse)/);
      expect(code, 'Protokollliteral').not.toMatch(/:\/\//);
      expect(code, 'Protokollprüfung').not.toMatch(/\.protocol\b/);
      expect(code, 'href-Zerlegung').not.toMatch(
        /\bhref\.(startsWith|endsWith|includes|indexOf|slice|split|match|replace)\b/,
      );
    },
  );
});
