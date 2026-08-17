// @vitest-environment node
// =============================================================================
// Optionaler Realkorpus — die beiden BSI-Mappings (GSPP-245)
//
// Die Dateien liegen **nicht** im Repository: `npm run fetch-catalog`
// materialisiert ausschließlich `supported`-Artefakte, und die beiden Mappings
// sind `preview` beziehungsweise `blocked-by-upstream`
// (`src/domain/sourceRegistry.mjs`). Wer sie prüfen will, holt sie lokal am
// Snapshot aus `upstream-manifest.json` und richtet `GSPP_MAPPING_CORPUS_PATH`
// auf das Verzeichnis, das die `control_layer/…`-Pfade enthält.
//
// Fehlen die Dateien, wird übersprungen statt fehlzuschlagen — dasselbe Muster
// wie `oscalDocument.catalog.node.test.ts` (GSPP-337),
// `oscalComponentDocument.node.test.ts` (GSPP-248) und
// `oscalProfileDocument.node.test.ts` (GSPP-240).
//
// Geprüft wird **Erhaltung**, nicht Inhalt: Feste Zahlen stehen ausschließlich
// in den Fixtures (`oscalMappingAdapter.test.ts`). Eine Assertion gegen „genau
// 1185 maps" wäre hier beim nächsten Upstream-Update rot, ohne dass etwas
// kaputt ist. Die Byte-Identität wird über den `contentSha256` des Manifests
// **geprüft**, nicht behauptet.
// =============================================================================

import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMappingDocument } from './oscalMappingDocument';
import type { MappingDocument } from './oscalMappingDocument';
import { MAPPING_ADAPTER_DIAGNOSTIC_CODES } from './oscalMappingAdapter';
import type { UpstreamManifest } from '@/domain/models';
import {
  arrayOrderSignature,
  contentMultiset,
  countPropRemarks,
  missingFromMultiset,
} from '@/test/oscalStructure';

const corpusRoot = process.env.GSPP_MAPPING_CORPUS_PATH;
const codes = MAPPING_ADAPTER_DIAGNOSTIC_CODES;

/** Repo-relativ; das Arbeitsverzeichnis des Testlaufs ist die Projektwurzel. */
const manifest = JSON.parse(readFileSync('upstream-manifest.json', 'utf8')) as UpstreamManifest;
const mappingFiles = manifest.files.filter((file) => file.rootType === 'mapping-collection');

const availableFiles = corpusRoot
  ? mappingFiles.filter((file) => existsSync(join(corpusRoot, file.path)))
  : [];
const corpusAvailable = availableFiles.length > 0;

interface CorpusEntry {
  readonly artifactKey: string;
  readonly upstreamPath: string;
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly original: unknown;
  readonly document: MappingDocument;
}

function loadCorpus(root: string): readonly CorpusEntry[] {
  return availableFiles.map((file) => {
    const bytes = readFileSync(join(root, file.path));
    const original: unknown = JSON.parse(bytes.toString('utf8'));

    return {
      artifactKey: file.artifactKey,
      upstreamPath: file.path,
      expectedSha256: file.contentSha256,
      actualSha256: createHash('sha256').update(bytes).digest('hex'),
      original,
      document: parseMappingDocument(original, {
        trustClass: 'class-1-verified-public',
        upstreamPath: file.path,
      }),
    };
  });
}

describe('Manifestvertrag der Mappings', () => {
  it('führt genau die beiden registrierten Mapping Collections', () => {
    expect(mappingFiles.map((file) => file.artifactKey).sort()).toEqual([
      'mapping-iso27001-annex-a-zu-gspp',
      'mapping-itgs2023-zu-gspp',
    ]);
  });

  it('führt das ISO-Mapping als gesperrt und das ITGS-Mapping als preview', () => {
    // ADR-7: Die Sperrung betrifft die Auslieferung, nicht das Parsen.
    const lifecycles = new Map(mappingFiles.map((file) => [file.artifactKey, file.lifecycle]));

    expect(lifecycles.get('mapping-iso27001-annex-a-zu-gspp')).toBe('blocked-by-upstream');
    expect(lifecycles.get('mapping-itgs2023-zu-gspp')).toBe('preview');
  });
});

describe.skipIf(!corpusAvailable)('Verlustfreiheit am realen Mapping-Korpus', () => {
  let corpus: readonly CorpusEntry[] = [];

  beforeAll(() => {
    corpus = loadCorpus(corpusRoot!);
  });

  it('stimmt byteweise mit dem Snapshot des Manifests überein', () => {
    for (const entry of corpus) {
      expect(entry.actualSha256, entry.artifactKey).toBe(entry.expectedSha256);
    }
  });

  it('verliert nach der Inhalts-Multiset-Regel kein Element', () => {
    for (const entry of corpus) {
      const expected = contentMultiset(entry.original);
      const actual = contentMultiset(entry.document.source);

      expect(missingFromMultiset(expected, actual), entry.artifactKey).toEqual([]);
      expect(missingFromMultiset(actual, expected), entry.artifactKey).toEqual([]);
    }
  });

  it('erhält alle Array-Reihenfolgen und serialisiert zeichengleich', () => {
    for (const entry of corpus) {
      expect(arrayOrderSignature(entry.document.source), entry.artifactKey).toEqual(
        arrayOrderSignature(entry.original),
      );
      expect(JSON.stringify(entry.document.source), entry.artifactKey).toBe(
        JSON.stringify(entry.original),
      );
    }
  });

  it('erhält jedes prop.remarks des Originals', () => {
    for (const entry of corpus) {
      expect(countPropRemarks(entry.document.source), entry.artifactKey).toBe(
        countPropRemarks(entry.original),
      );
    }
  });

  it('bindet jedes Mapping an die im Register deklarierte Version', () => {
    for (const entry of corpus) {
      expect(entry.document.pin.rootKey, entry.artifactKey).toBe('mapping-collection');
      expect(entry.document.artifactKey, entry.artifactKey).toBe(entry.artifactKey);
      expect(entry.document.oscalVersion, entry.artifactKey).toBe(
        entry.document.view.metadata.oscalVersion,
      );
    }
  });

  it('erhält jedes Mapping Set, jeden Eintrag und jede Beziehung', () => {
    for (const entry of corpus) {
      const envelope = entry.original as Record<string, Record<string, unknown>>;
      const declared = envelope['mapping-collection']!.mappings;
      const sets = Array.isArray(declared) ? declared : [declared];

      // Relativ, nicht absolut: Die Projektion muss so viele Sets und Einträge
      // führen wie das Original — welche Zahl das ist, sagt der Upstream.
      expect(entry.document.view.mappings, entry.artifactKey).toHaveLength(sets.length);

      entry.document.view.mappings.forEach((mapping, index) => {
        const source = sets[index] as Record<string, unknown[]>;
        expect(mapping.maps.length, `${entry.artifactKey}/${index}`)
          .toBe(source.maps!.length);
        for (const map of mapping.maps) {
          // Kein Zusammenfassen zu einem generischen `related`: Jede Beziehung
          // bleibt lesbar oder wird als Befund ausgewiesen.
          expect(map.relationship.kind, `${entry.artifactKey}/${index}`)
            .not.toBe('unknown');
        }
      });
    }
  });

  it('lässt keine id-ref ohne Ressourcenkontext gedeutet werden', () => {
    for (const entry of corpus) {
      const items = entry.document.view.mappings.flatMap((mapping) =>
        mapping.maps.flatMap((map) => [...map.sources, ...map.targets]),
      );

      expect(items.length, entry.artifactKey).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.resolution.status, entry.artifactKey).toBe('unresolved');
      }
      expect(
        entry.document.view.diagnostics.filter(
          (diagnostic) => diagnostic.code === codes.ID_REF_CONTEXT_UNRESOLVED,
        ).length,
        entry.artifactKey,
      ).toBe(entry.document.view.mappings.length * 2);
    }
  });

  it('klassifiziert jedes Ressourcen-href, ohne es aufzulösen', () => {
    for (const entry of corpus) {
      for (const mapping of entry.document.view.mappings) {
        for (const resource of [mapping.sourceResource, mapping.targetResource]) {
          // Klassifiziert ist jede Referenz; **aufgelöst** wird eine relative
          // Referenz ausdrücklich nie (GSPP-286).
          expect(resource?.reference, `${entry.artifactKey} ${resource?.path}`).not.toBeNull();
        }
      }
    }
  });
});
