// @vitest-environment node
// =============================================================================
// Modulgrenzen des SSP-Adapters (GSPP-293)
//
// Drei Zusagen dieses Slices sind Aussagen über den Quelltext:
//
//  1. Es gibt keine SSP-Versionskonstante. Welche Schemazelle gilt,
//     entscheidet allein `metadata.oscal-version`.
//  2. Referenzen werden ausschließlich über `src/domain/referenceResolution.ts`
//     klassifiziert; der Adapter verzweigt nirgends selbst auf die Form eines
//     `href`.
//  3. Kein Modul des Slices greift auf Netzwerk oder Browser-Speicher zu.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';

/** Repo-relativ; das Arbeitsverzeichnis des Testlaufs ist die Projektwurzel. */
const RUNTIME_SOURCES = [
  'src/adapters/oscalSspAdapter.ts',
  'src/adapters/oscalSspSystem.ts',
  'src/adapters/oscalSspControl.ts',
  'src/adapters/oscalSspReaders.ts',
  'src/adapters/oscalSspDocument.ts',
  'src/domain/systemSecurityPlanModel.ts',
  'src/domain/systemSecurityPlanSystemModel.ts',
] as const;

const RAW_TYPES_SOURCE = 'src/domain/oscalSystemSecurityPlan.ts';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Zeilen ohne Kommentare — ein Versionsliteral in Prosa ist kein Code. */
function codeLines(source: string): readonly string[] {
  return source.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
}

describe('Keine SSP-Versionskonstante', () => {
  it.each(RUNTIME_SOURCES)('%s nennt keine gepinnte OSCAL-Version', (path) => {
    const lines = codeLines(read(path));
    for (const version of PINNED_OSCAL_VERSIONS) {
      expect(lines.filter((line) => line.includes(`'${version}'`)), `${path} → ${version}`).toEqual([]);
    }
  });

  it('führt Versionsliterale ausschließlich als Feldprädikat der Raw-Typen', () => {
    const withVersion = codeLines(read(RAW_TYPES_SOURCE)).filter((line) =>
      PINNED_OSCAL_VERSIONS.some((version) => line.includes(`'${version}'`)),
    );

    expect(withVersion).toEqual(["export type OscalVersionsWithRequiredSystemUsers = '1.1.2' | '1.1.3';"]);
  });
});

describe('Einziger Klassifikationsweg für Referenzen', () => {
  it('ruft resolveOscalReference ausschließlich im Adapter auf', () => {
    const importing = [...RUNTIME_SOURCES, RAW_TYPES_SOURCE].filter((path) =>
      read(path).includes('resolveOscalReference'),
    );
    expect(importing).toEqual(['src/adapters/oscalSspAdapter.ts']);
  });

  it.each([...RUNTIME_SOURCES, RAW_TYPES_SOURCE])('%s verzweigt nicht selbst auf die Form eines href', (path) => {
    const code = codeLines(read(path)).join('\n');

    expect(code, 'Fragmentliteral').not.toMatch(/['"]#['"]/);
    expect(code, 'URL-Konstruktion').not.toMatch(/new URL\(|URL\.(parse|canParse)/);
    expect(code, 'Protokollliteral').not.toMatch(/:\/\//);
    expect(code, 'href-Zerlegung').not.toMatch(
      /\bhref\.(startsWith|endsWith|includes|indexOf|slice|split|match|replace)\b/,
    );
  });
});

describe('Kein Netzwerk- oder Speicherzugriff', () => {
  it.each([...RUNTIME_SOURCES, RAW_TYPES_SOURCE])('%s greift weder auf Netzwerk noch auf Browser-Speicher zu', (path) => {
    const code = codeLines(read(path)).join('\n');

    expect(code).not.toMatch(/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/);
    expect(code).not.toMatch(/\b(localStorage|sessionStorage|indexedDB|caches)\b/);
  });
});
