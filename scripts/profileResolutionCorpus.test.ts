// @vitest-environment node
// =============================================================================
// Verpflichtender Bauzeitlauf der Profile Resolution (GSPP-291, Commit B)
//
// Läuft in CI und Deploy fest nach `npm run fetch-catalog` und scheitert
// hart — niemals skippend — wenn der Korpus-Cache fehlt oder ein Hash
// abweicht. Kein Env-Variablen-Pfad, kein zweiter Fetch: Die Dokumente sind
// genau die Bytes, deren Größe und Git-Blob-SHA fetch-catalog soeben gegen
// den gepinnten Snapshot geprüft hat.
//
// Zweigeteilter Referenznachweis:
// 1. BSI-Seite (dieser Harniss): Vergleich gegen die drei ausgelieferten
//    resolved_catalogs nach Entfernung dokumentierter volatiler Felder.
// 2. NIST-Seite + synthetische Fixtures: eigene Suite (hergeleitete
//    Spezifikationstests, kein unabhängiges Orakel).
// =============================================================================

import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildProfileResolutionPlan } from '../src/domain/profileResolutionImportGraph';
import type { ProfileResolutionEdge } from '../src/domain/profileResolutionImportGraph';
import { resolveProfile } from '../src/domain/profileResolutionEngine';
import { parseProfileDocument } from '../src/adapters/oscalProfileDocument';
import { projectCatalogLineage } from '../src/domain/catalogLineage.mjs';
import { CATALOG_LINEAGES } from '../src/domain/sourceRegistry.mjs';
import {
  canonicalJson,
  firstDivergence,
  nodesAtDivergence,
  reconcileBsiInternalLinks,
  stripVolatileFields,
} from './profileResolutionCorpusOracle';

const CORPUS_DIRECTORY = resolve(process.cwd(), '.cache/upstream-corpus');
const TRACKED_MANIFEST_PATH = resolve(process.cwd(), 'upstream-manifest.json');

interface CorpusManifestFile {
  artifactKey: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  gitBlobSha: string;
}

interface CorpusManifest {
  schemaVersion: number;
  snapshotCommitSha: string;
  files: CorpusManifestFile[];
}

const corpusAvailable = existsSync(join(CORPUS_DIRECTORY, 'corpus-manifest.json'));

function requireCorpus(): void {
  if (corpusAvailable) return;
  throw new Error(
    `Der Korpus-Cache fehlt unter ${CORPUS_DIRECTORY}. Der verpflichtende Bauzeitlauf ` +
      'überspringt nicht — führe zuerst `npm run fetch-catalog` aus.',
  );
}

let documentsByArtifactKey: Map<string, unknown>;
let corpusSnapshotSha: string;

beforeAll(() => {
  requireCorpus();
  const manifest = JSON.parse(
    readFileSync(join(CORPUS_DIRECTORY, 'corpus-manifest.json'), 'utf8'),
  ) as CorpusManifest;

  // Der Cache bindet an denselben Snapshot wie das getrackte Manifest.
  const tracked = JSON.parse(readFileSync(TRACKED_MANIFEST_PATH, 'utf8')) as {
    snapshotCommitSha: string;
  };
  if (manifest.snapshotCommitSha !== tracked.snapshotCommitSha) {
    throw new Error(
      `Korpus-Cache (${manifest.snapshotCommitSha.slice(0, 12)}) und getracktes Manifest ` +
        `(${tracked.snapshotCommitSha.slice(0, 12)}) tragen unterschiedliche Snapshots — ` +
        'führe `npm run fetch-catalog` aus.',
    );
  }

  documentsByArtifactKey = new Map();
  for (const file of manifest.files) {
    const bytes = readFileSync(join(CORPUS_DIRECTORY, `${file.artifactKey}.json`));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(sha256, `Hashabweichung bei ${file.artifactKey}`).toBe(file.sha256);
    documentsByArtifactKey.set(file.artifactKey, JSON.parse(bytes.toString('utf8')));
  }
  corpusSnapshotSha = manifest.snapshotCommitSha;
});

describe('Korpus-Cache', () => {
  it('trägt genau die zehn Lineages-Dokumente am getrackten Snapshot', () => {
    requireCorpus();
    expect(documentsByArtifactKey.size).toBe(10);
    expect(corpusSnapshotSha).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('verpflichtende Auflösung aller drei BSI-Profile', () => {
  for (const lineage of CATALOG_LINEAGES) {
    it(`löst ${lineage.profileArtifactKey} deterministisch auf und vergleicht gegen den BSI-Katalog`, () => {
      requireCorpus();

      // Kanten über die registrierte Lineage-Projektion: Der Import-Fragment-href
      // des echten Profils wird exakt dem registrierten Zielartefakt zugeordnet.
      const artifactsByKey = new Map(
        [...documentsByArtifactKey.entries()].map(([artifactKey, document]) => [
          artifactKey,
          {
            document,
            manifestFile: {
              path: artifactKey,
              gitBlobSha: 'corpus-cache',
              contentSha256: 'corpus-cache',
            },
          },
        ]),
      );
      const projection = projectCatalogLineage({
        lineage,
        artifactsByKey,
      });
      const resolvedImports = projection.imports.filter(
        (entry) => entry.state === 'complete' && entry.source !== null,
      );
      expect(resolvedImports.length).toBeGreaterThan(0);

      const edgesByArtifactKey = new Map<string, readonly ProfileResolutionEdge[]>([
        [
          lineage.profileArtifactKey,
          resolvedImports.map((entry) => ({
            href: entry.importHref ?? '',
            artifactKey: entry.source!.artifactKey,
          })),
        ],
      ]);

      const buildOutcome = () => {
        const plan = buildProfileResolutionPlan({
          topProfileArtifactKey: lineage.profileArtifactKey,
          documents: documentsByArtifactKey,
          edgesByArtifactKey,
        });
        if (!plan.ok) throw new Error(`Plan scheiterte: ${plan.diagnostic.code}`);

        const profileViews = new Map(
          plan.order
            .filter((key) => key.startsWith('profile-'))
            .map((key) => [
              key,
              parseProfileDocument(documentsByArtifactKey.get(key), {
                trustClass: 'class-1-verified-public',
              }),
            ]),
        );
        return resolveProfile({ plan, edgesByArtifactKey, profileViews });
      };

      const firstRun = buildOutcome();
      const secondRun = buildOutcome();

      expect(firstRun.ok, firstRun.ok ? '' : `Auflösung scheiterte: ${JSON.stringify(!firstRun.ok ? firstRun.diagnostic : null)}`).toBe(true);
      expect(secondRun.ok).toBe(true);
      if (!firstRun.ok || !secondRun.ok) return;

      // Determinismus: byte-identisches Doppel-Ergebnis.
      const firstSerialized = JSON.stringify(firstRun.output.tree);
      expect(firstSerialized).toBe(JSON.stringify(secondRun.output.tree));
      expect(firstRun.output.trustClass).toBe('class-2-local-user');

      // Ergebnisvertrag: Root-Key catalog, Version des steuernden Profils.
      const tree = firstRun.output.tree as Record<string, unknown>;
      expect(Object.keys(tree)).toEqual(['catalog']);
      expect(firstRun.output.oscalVersion).toBe('1.1.3');

      // Provenienzträger (getrennt vom Orakelvergleich geprüft).
      const body = tree['catalog'] as Record<string, unknown>;
      const metadata = body['metadata'] as Record<string, unknown>;
      const props = metadata['props'] as Array<Record<string, unknown>>;
      expect(props).toContainEqual(
        expect.objectContaining({ name: 'resolution-tool' }),
      );
      const links = metadata['links'] as Array<Record<string, unknown>>;
      const topProfile = documentsByArtifactKey.get(lineage.profileArtifactKey) as {
        profile: { uuid: string };
      };
      expect(links).toContainEqual({
        rel: 'source-profile',
        href: `urn:uuid:${topProfile.profile.uuid}`,
      });
      const serialized = firstSerialized;
      expect(serialized).not.toContain('source-profile-uuid');

      // BSI-Orakelseite: semantische Gleichheit nach Volatil-Strip und
      // Anwendung der laut registrierten bekannten Differenzen.
      const strippedActual = stripVolatileFields(tree);
      const expectedCatalog = documentsByArtifactKey.get(`catalog-${lineage.catalogKey}`);
      expect(expectedCatalog, `BSI-Katalog für ${lineage.catalogKey} fehlt im Korpus`).toBeDefined();

      // Korpus-Politik (siehe Oracle-Kopf): die BSI-Werkzeugbeschneidung
      // interner Links wird gegen das erwartete Dokument rekonstruiert und
      // laut mitgezählt.
      const { cleaned, removed } = reconcileBsiInternalLinks(
        strippedActual,
        stripVolatileFields(expectedCatalog),
      );
      if (removed.length > 0) {
        console.error(`Korpus ${lineage.catalogKey}: ${removed.length} interne Links gemäß BSI-Werkzeugpolitik rekonstruiert — ${removed.join(', ')}`);
      }

      const actualCanonical = canonicalJson(cleaned);
      const expectedCanonical = canonicalJson(stripVolatileFields(expectedCatalog));
      if (actualCanonical !== expectedCanonical) {
        const divergence = firstDivergence(cleaned, stripVolatileFields(expectedCatalog));
        const nodes = divergence !== null ? nodesAtDivergence(cleaned, stripVolatileFields(expectedCatalog), divergence) : null;
        // Vorschlagszeilen für unregistrierte Link-Differenzen ausgeben,
        // damit die Registrierung exakt nachgeführt werden kann.
        if (divergence?.endsWith('/links')) {
          const parentPath = divergence.slice(0, -'/links'.length);
          const parentNode = nodesAtDivergence(cleaned, stripVolatileFields(expectedCatalog), parentPath).actual;
          const links = (parentNode as Record<string, unknown> | undefined)?.['links'];
          if (Array.isArray(links)) {
            const controlId = (parentNode as Record<string, unknown>)['id'];
            for (const link of links as Array<Record<string, unknown>>) {
              console.error(
                `VORSCHLAG: { corpusKey: '${lineage.catalogKey}', controlId: '${controlId}', href: '${link['href']}', reason: 'BSI entfernt internen Fragment-Link; NIST-Orakel bewahrt ihn (Werkzeugwiderspruch).' },`,
              );
            }
          }
        }
        throw new Error(
          `Resolver-Ergebnis weicht für ${lineage.catalogKey} ab (erste Divergenz: ${divergence ?? 'unbekannt'})\n` +
            `ACTUAL  : ${JSON.stringify(nodes?.actual)?.slice(0, 400)}\n` +
            `EXPECTED: ${JSON.stringify(nodes?.expected)?.slice(0, 400)}`,
        );
      }
    });
  }
});
