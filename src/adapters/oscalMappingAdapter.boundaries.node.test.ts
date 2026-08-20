// @vitest-environment node
// =============================================================================
// Modulgrenzen des Mapping-Adapters (GSPP-245)
//
// Drei Zusagen dieses Slices sind Aussagen über den Quelltext, nicht über sein
// Laufzeitverhalten:
//
//  1. Es gibt **keine** Mapping-Versionskonstante. Welche Schemazelle gilt,
//     entscheidet allein `metadata.oscal-version`.
//  2. Referenzen werden **ausschließlich** über
//     `src/domain/referenceResolution.ts` klassifiziert. Der Adapter verzweigt
//     nirgends selbst auf die Form eines `href` — insbesondere gibt es keine
//     Pfadnormalisierung und keine Traversal-Sonderbehandlung (GSPP-286).
//  3. Der Adapter registriert sich mit **genau einer** Zeile in
//     `OSCAL_ROOT_ADAPTERS` und fasst den Katalogpfad nicht an.
//
// Als „greppbares Review-Kriterium" wären sie nur so lange wahr, wie jemand
// gerade greppt. Hier hängen sie an einem Test.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { OSCAL_NAMESPACE } from '@/domain/mappingModel';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';

/** Repo-relativ; das Arbeitsverzeichnis des Testlaufs ist die Projektwurzel. */
const RUNTIME_SOURCES = [
  'src/adapters/oscalMappingAdapter.ts',
  'src/adapters/oscalMappingReaders.ts',
  'src/adapters/oscalMappingDocument.ts',
  'src/domain/mappingModel.ts',
] as const;

const RAW_TYPES_SOURCE = 'src/domain/oscalMapping.ts';
const REGISTRY_SOURCE = 'src/adapters/oscalRootAdapters.ts';

/**
 * Die einzige Quelltextzeile, die einen absoluten URI tragen darf: der
 * OSCAL-Namensraum als **Naming-System-Identifier**. Er wird ausschließlich mit
 * einem `ns`-Wert verglichen und erreicht die Referenzschicht nie — die
 * Zerlegungs- und Normalisierungsverbote unten gelten für ihn genauso.
 */
const NAMESPACE_DECLARATION = /^export const OSCAL_NAMESPACE = '[^']+';$/;

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Zeilen ohne Kommentare — ein Versionsliteral in Prosa ist kein Code. */
function codeLines(source: string): readonly string[] {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*|\|)/.test(line));
}

function codeWithoutNamespaceDeclaration(path: string): string {
  return codeLines(read(path))
    .filter((line) => !NAMESPACE_DECLARATION.test(line.trim()))
    .join('\n');
}

describe('Keine Mapping-Versionskonstante', () => {
  it.each([...RUNTIME_SOURCES, RAW_TYPES_SOURCE])(
    '%s nennt keine gepinnte OSCAL-Version',
    (path) => {
      const lines = codeLines(read(path));

      // Anders als beim Profile gibt es hier **kein** erlaubtes Feldprädikat:
      // Die beiden gepinnten Mapping-Zellen sind definitionsgleich (siehe
      // `oscalMapping.versionDrift.test.ts`), es gibt also keine Partition zu
      // beschreiben.
      for (const version of PINNED_OSCAL_VERSIONS) {
        const offending = lines.filter((line) => line.includes(`'${version}'`));
        expect(offending, `${path} → ${version}`).toEqual([]);
      }
    },
  );

  it('nennt auch die Einführungsversion des Modells nur in der Versionsmatrix', () => {
    for (const path of [...RUNTIME_SOURCES, RAW_TYPES_SOURCE]) {
      const lines = codeLines(read(path));

      expect(lines.filter((line) => line.includes("'1.2.0'")), path).toEqual([]);
    }
  });
});

describe('Einziger Klassifikationsweg für Referenzen', () => {
  it('importiert resolveOscalReference an genau einer Stelle', () => {
    const importing = [...RUNTIME_SOURCES, RAW_TYPES_SOURCE].filter((path) =>
      read(path).includes('resolveOscalReference'),
    );

    expect(importing).toEqual(['src/adapters/oscalMappingAdapter.ts']);
  });

  it.each([...RUNTIME_SOURCES, RAW_TYPES_SOURCE])(
    '%s verzweigt nicht selbst auf die Form eines href',
    (path) => {
      const code = codeWithoutNamespaceDeclaration(path);

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

  it.each([...RUNTIME_SOURCES, RAW_TYPES_SOURCE])(
    '%s zerlegt auch den Namensraum nicht, sondern vergleicht ihn',
    (path) => {
      const code = codeLines(read(path)).join('\n');

      // Der Namensraum ist ein Bezeichner, kein Ort: Er wird verglichen und
      // nie zerlegt, aufgelöst oder als Basis für eine Referenz benutzt.
      expect(code, 'ns-Zerlegung').not.toMatch(
        /\bns\.(startsWith|endsWith|includes|indexOf|slice|split|match|replace)\b/,
      );
      expect(code, 'Namensraum als Referenz').not.toMatch(
        /resolveOscalReference\(\s*\{\s*href:\s*ns\b/,
      );
    },
  );

  it.each([...RUNTIME_SOURCES, RAW_TYPES_SOURCE])(
    '%s normalisiert keinen Pfad und kennt keine Traversal-Sonderbehandlung',
    (path) => {
      const code = codeLines(read(path)).join('\n');

      // GSPP-286: `target-catalogs/…`, `foo.json` und `../../etc/passwd`
      // erhalten dasselbe Ergebnis. Ein Segmentliteral hier wäre der Anfang
      // einer zweiten, abweichenden Klassifikation.
      expect(code, 'Segmentliteral').not.toMatch(/['"]\.\.\//);
      expect(code, 'Pfadmodul').not.toMatch(/from '(node:)?path'/);
      expect(code, 'Traversal-Begriff').not.toMatch(/\btraversal\b/i);
    },
  );

  it('deklariert den OSCAL-Namensraum genau einmal', () => {
    const declaring = [...RUNTIME_SOURCES, RAW_TYPES_SOURCE].filter((path) =>
      codeLines(read(path)).some((line) => NAMESPACE_DECLARATION.test(line.trim())),
    );

    expect(declaring).toEqual(['src/domain/mappingModel.ts']);
    expect(OSCAL_NAMESPACE.length).toBeGreaterThan(0);
  });
});

describe('Registrierung als genau eine Zeile', () => {
  it('trägt mapping-collection mit einem einzigen Map-Eintrag ein', () => {
    const registry = read(REGISTRY_SOURCE);
    const entries = registry
      .split('\n')
      .filter((line) => /^\s*\[\w+RootAdapter\.rootType, \w+RootAdapter\],\s*$/.test(line));

    expect(entries).toHaveLength(4);
    expect(entries.some((line) => line.includes('mappingCollectionRootAdapter'))).toBe(true);
  });

  it('lässt den Katalogadapter und oscalAdapter.ts unberührt', () => {
    const registry = read(REGISTRY_SOURCE);

    // Der Katalogadapter bezieht sein Parsing weiterhin ausschließlich aus
    // `oscalAdapter.ts`; der Mappingeintrag ändert daran nichts.
    expect(registry).toContain("moduleEntryPoint: 'src/adapters/oscalAdapter.ts'");
    expect(registry).toContain('parseCatalog(body, { catalogKey: resolveCatalogKey(context) })');
  });
});
