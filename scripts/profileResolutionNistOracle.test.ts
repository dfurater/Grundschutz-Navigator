// @vitest-environment node
// =============================================================================
// Zweigeteilter Referenznachweis, Seite 2: NIST-Baseline-Orakel (GSPP-291)
//
// Die vier SP 800-53 rev5 Baseline-Profile werden gegen die von NIST selbst
// aufgelösten Vergleichskataloge aus usnistgov/oscal-content v1.5.0
// (commit 78650f02ad9321bb7b817846f8fbd4f2bcd620de) semantisch verglichen —
// nach Entfernung ausschließlich dokumentierter volatiler Felder. Die
// Dateien liegen committed unter src/test/fixtures/oscal-content-v1.5.0/
// (SHA-256-pinned in ORACLE_MANIFEST.json); der Lauf ist offline und
// scheitert hart bei Hashabweichung. Eingangssemantik laut NIST-Korpus:
// ausschließlich include-controls — die übrige Semantik wird separat durch
// hergeleitete Spezifikationstests belegt.
//
// Dieser Teil IST ein unabhängiges Orakel (anderer Hersteller, anderes
// Werkzeug, gleiche Draft-Spezifikation); er beansprucht keine vollständige
// Konformität — die Spezifikation bleibt Draft.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildProfileResolutionPlan } from '../src/domain/profileResolutionImportGraph';
import type { ProfileResolutionEdge } from '../src/domain/profileResolutionImportGraph';
import { resolveProfile } from '../src/domain/profileResolutionEngine';
import { parseProfileDocument } from '../src/adapters/oscalProfileDocument';
import {
  canonicalJson,
  firstDivergence,
  normalizeProseLeadingSpace,
  stripVolatileFields,
} from './profileResolutionCorpusOracle';

const FIXTURE_DIRECTORY = resolve(process.cwd(), 'src/test/fixtures/oscal-content-v1.5.0');

interface OracleManifestFile {
  artifactKey: string;
  role: 'input' | 'expected';
  fileName: string;
  remotePath: string;
  sizeBytes: number;
  sha256: string;
}

interface OracleManifest {
  schemaVersion: number;
  source: { repository: string; tag: string; commit: string; variant: string };
  files: OracleManifestFile[];
}

const manifest = JSON.parse(
  readFileSync(join(FIXTURE_DIRECTORY, 'ORACLE_MANIFEST.json'), 'utf8'),
) as OracleManifest;

const documentsByArtifactKey = new Map<string, unknown>();
const NIST_BASELINE_INTEGRITY = Object.freeze({
  LOW: { resourceCount: 135, unresolvedFragments: 125 },
  MODERATE: { resourceCount: 147, unresolvedFragments: 90 },
  HIGH: { resourceCount: 147, unresolvedFragments: 81 },
  PRIVACY: { resourceCount: 82, unresolvedFragments: 117 },
});

type BaselineLabel = keyof typeof NIST_BASELINE_INTEGRITY;

const baselineKeys: Array<{
  input: string;
  expected: string;
  label: BaselineLabel;
}> = [];

function isBaselineLabel(value: string): value is BaselineLabel {
  return Object.hasOwn(NIST_BASELINE_INTEGRITY, value);
}

function verifyFixtureIntegrity(
  file: OracleManifestFile,
  bytes: Buffer,
  sha256: string,
): void {
  if (sha256 !== file.sha256) {
    throw new Error(`Hashabweichung bei ${file.artifactKey}`);
  }
  if (bytes.length !== file.sizeBytes) {
    throw new Error(
      `Größenabweichung bei ${file.artifactKey}: ${bytes.length} statt ${file.sizeBytes} Bytes`,
    );
  }
}

// Synchron auf Modulebene: Die Testschleife braucht die Baseline-Liste zur
// Sammelzeit, und die committeten Fixtures machen den Lauf ohnehin offline.
for (const file of manifest.files) {
  const bytes = readFileSync(join(FIXTURE_DIRECTORY, file.fileName));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  verifyFixtureIntegrity(file, bytes, sha256);
  documentsByArtifactKey.set(file.artifactKey, JSON.parse(bytes.toString('utf8')));
  if (file.role === 'input') {
    const baseline = file.artifactKey.replace('nist-sp800-53-rev5-', '').replace('-profile', '');
    const label = baseline.toUpperCase();
    if (!isBaselineLabel(label)) throw new Error(`Unbekannte NIST-Baseline: ${label}`);
    baselineKeys.push({
      input: file.artifactKey,
      expected: `nist-sp800-53-rev5-${baseline}-resolved`,
      label,
    });
  }
}

function catalogBody(document: unknown): Record<string, unknown> {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('NIST-resolved-Baseline erwartet ein Dokumentobjekt');
  }
  const catalog = (document as Record<string, unknown>)['catalog'];
  if (catalog === null || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error('NIST-resolved-Baseline erwartet catalog');
  }
  return catalog as Record<string, unknown>;
}

function resourceUuids(document: unknown): Set<string> {
  const backMatter = catalogBody(document)['back-matter'] as Record<string, unknown> | undefined;
  const resources = backMatter?.['resources'];
  if (!Array.isArray(resources)) return new Set();
  return new Set(
    resources.flatMap((resource) => {
      if (resource === null || typeof resource !== 'object' || Array.isArray(resource)) return [];
      const uuid = (resource as Record<string, unknown>)['uuid'];
      return typeof uuid === 'string' ? [uuid.toLowerCase()] : [];
    }),
  );
}

function unresolvedFragmentCount(document: unknown): number {
  const identifiers = new Set<string>();
  const body = catalogBody(document);
  const identifierStack: unknown[] = [body];
  while (identifierStack.length > 0) {
    const value = identifierStack.pop();
    if (Array.isArray(value)) {
      identifierStack.push(...value);
    } else if (value !== null && typeof value === 'object') {
      for (const [key, member] of Object.entries(value)) {
        if ((key === 'id' || key === 'uuid') && typeof member === 'string') {
          identifiers.add(member);
        }
        identifierStack.push(member);
      }
    }
  }

  const unresolved = new Set<string>();
  const stack: unknown[] = [body];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      stack.push(...value);
    } else if (value !== null && typeof value === 'object') {
      for (const [key, member] of Object.entries(value)) {
        if (key === 'href' && typeof member === 'string' && member.startsWith('#')) {
          const target = member.slice(1);
          if (!identifiers.has(target)) unresolved.add(target);
        }
        stack.push(member);
      }
    }
  }
  return unresolved.size;
}

function importFragmentOf(profileDocument: unknown): string {
  const body = Object.values(profileDocument as Record<string, unknown>)[0] as Record<string, unknown>;
  const imports = body['imports'] as Array<Record<string, unknown>>;
  if (!Array.isArray(imports) || imports.length !== 1) {
    throw new Error('NIST-Baseline erwartet genau einen Import');
  }
  const href = imports[0]!['href'];
  if (typeof href !== 'string' || !href.startsWith('#')) {
    throw new Error('NIST-Baseline-Import erwartet Fragment-href');
  }
  return href;
}

describe('NIST-Orakelvergleich der vier Baselines', () => {
  for (const baseline of baselineKeys) {
    // Semantikfragen (Back-matter-Provenienz, Link-Anreicherung) sind mit
    // dem jetzt vendierten Quellkatalog empirisch gegen das NIST-Orakel
    // entschieden; verbleibende Werkzeugdifferenzen wären als bekannte
    // Differenzen zu registrieren.
    it(`löst ${baseline.label} deterministisch auf und stimmt mit dem NIST-resolved_catalog überein`, async () => {
      const profileDocument = documentsByArtifactKey.get(baseline.input)!;
      const fragment = importFragmentOf(profileDocument);

      const edgesByArtifactKey = new Map<string, readonly ProfileResolutionEdge[]>([
        [
          baseline.input,
          [{ href: fragment, artifactKey: 'nist-sp800-53-rev5-catalog' }],
        ],
      ]);

      const buildOutcome = () => {
        const plan = buildProfileResolutionPlan({
          topProfileArtifactKey: baseline.input,
          documents: documentsByArtifactKey,
          edgesByArtifactKey,
        });
        if (!plan.ok) throw new Error(`Plan scheiterte: ${plan.diagnostic.code}`);
        const profileViews = new Map(
          plan.order
            .filter((key) => key.startsWith('nist-') && key.endsWith('-profile'))
            .map((key) => [
              key,
              parseProfileDocument(documentsByArtifactKey.get(key), {
                trustClass: 'class-1-verified-public',
              }),
            ]),
        );
        return resolveProfile({ plan, edgesByArtifactKey, profileViews });
      };

      const firstRun = await buildOutcome();
      const secondRun = await buildOutcome();
      expect(firstRun.ok, firstRun.ok ? '' : JSON.stringify(!firstRun.ok ? firstRun.diagnostic : null)).toBe(true);
      expect(secondRun.ok).toBe(true);
      if (!firstRun.ok || !secondRun.ok) return;

      // Determinismus des Doppel-Laufs.
      expect(JSON.stringify(firstRun.output.tree)).toBe(JSON.stringify(secondRun.output.tree));
      expect(firstRun.output.trustClass).toBe('class-2-local-user');
      const tree = firstRun.output.tree as Record<string, unknown>;
      expect(Object.keys(tree)).toEqual(['catalog']);
      expect(firstRun.output.oscalVersion).toBe('1.2.2');

      const integrity = NIST_BASELINE_INTEGRITY[baseline.label];
      expect(resourceUuids(tree).size).toBe(integrity.resourceCount);
      expect(unresolvedFragmentCount(tree)).toBe(
        integrity.unresolvedFragments,
      );

      // NIST-Werkzeug-Artefakte symmetrisch normalisiert.
      // - Prose-Leerzeichen (XML-Rest, siehe Oracle-Funktion)
      // Fachliche Struktur, Reihenfolge und Back-matter bleiben vollständig
      // im Gleichheitsvergleich; nur das benannte Prose-Werkzeugartefakt und
      // die dokumentierten Volatilen werden symmetrisch normalisiert.
      const actualNormalized = normalizeProseLeadingSpace(stripVolatileFields(tree));
      const expectedNormalized = normalizeProseLeadingSpace(
        stripVolatileFields(documentsByArtifactKey.get(baseline.expected)),
      );
      const actualCanonical = canonicalJson(actualNormalized);
      const expectedCanonical = canonicalJson(expectedNormalized);
      if (actualCanonical !== expectedCanonical) {
        const divergence = firstDivergence(actualNormalized, expectedNormalized);
        throw new Error(
          `Resolver-Ergebnis weicht für NIST ${baseline.label} ab (erste Divergenz: ${divergence ?? 'unbekannt'})`,
        );
      }
    });
  }
});
