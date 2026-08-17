// @vitest-environment node
// =============================================================================
// Optionaler Realkorpus — die sechs BSI Component Definitions (GSPP-248)
//
// Die Dateien liegen **nicht** im Repository: `npm run fetch-catalog`
// materialisiert ausschließlich `supported`-Artefakte, und alle sechs
// Component Definitions sind `preview` oder `blocked-by-upstream`
// (`src/domain/sourceRegistry.mjs`). Wer sie prüfen will, holt sie lokal am
// Snapshot aus `upstream-manifest.json` und richtet
// `GSPP_COMPONENT_CORPUS_PATH` auf das Verzeichnis, das die
// `implementation_layer/…`-Pfade enthält.
//
// Fehlen die Dateien, wird übersprungen statt fehlzuschlagen — dasselbe Muster
// wie `oscalDocument.catalog.node.test.ts` (GSPP-337).
//
// Geprüft wird **Erhaltung**, nicht Inhalt: Feste Zahlen stehen ausschließlich
// in den Fixtures (`oscalComponentAdapter.test.ts`). Eine Assertion gegen „genau
// 307 implemented requirements" wäre hier beim nächsten Upstream-Update rot,
// ohne dass etwas kaputt ist. Die Byte-Identität wird über den
// `contentSha256` des Manifests **geprüft**, nicht behauptet.
// =============================================================================

import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseComponentDefinitionDocument } from './oscalComponentDocument';
import type { ComponentDefinitionDocument } from './oscalComponentDocument';
import type { UpstreamManifest } from '@/domain/models';
import {
  arrayOrderSignature,
  contentMultiset,
  countPropRemarks,
  missingFromMultiset,
} from '@/test/oscalStructure';

const corpusRoot = process.env.GSPP_COMPONENT_CORPUS_PATH;

/** Repo-relativ; das Arbeitsverzeichnis des Testlaufs ist die Projektwurzel. */
const manifest = JSON.parse(readFileSync('upstream-manifest.json', 'utf8')) as UpstreamManifest;
const componentFiles = manifest.files.filter((file) => file.rootType === 'component-definition');

const availableFiles = corpusRoot
  ? componentFiles.filter((file) => existsSync(join(corpusRoot, file.path)))
  : [];
const corpusAvailable = availableFiles.length > 0;

interface CorpusEntry {
  readonly artifactKey: string;
  readonly upstreamPath: string;
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly original: unknown;
  readonly document: ComponentDefinitionDocument;
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
      document: parseComponentDefinitionDocument(original, {
        trustClass: 'class-1-verified-public',
        upstreamPath: file.path,
      }),
    };
  });
}

describe('Manifestvertrag der Component Definitions', () => {
  it('führt genau die sechs registrierten Definitionen', () => {
    expect(componentFiles.map((file) => file.artifactKey).sort()).toEqual([
      'component-aws-security-hub',
      'component-ga-lotse-grundmodul',
      'component-keycloak',
      'component-lieferkette',
      'component-netzarchitektur',
      'component-passwortrichtlinie',
    ]);
  });
});

describe.skipIf(!corpusAvailable)('Verlustfreiheit am realen Component-Korpus', () => {
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

  it('bindet jede Definition an die im Register deklarierte Version', () => {
    for (const entry of corpus) {
      expect(entry.document.pin.rootKey, entry.artifactKey).toBe('component-definition');
      expect(entry.document.artifactKey, entry.artifactKey).toBe(entry.artifactKey);
      expect(entry.document.oscalVersion, entry.artifactKey).toBe(
        entry.document.view.metadata.oscalVersion,
      );
    }
  });

  it('parst auch die beiden gesperrten Definitionen, statt sie zu verwerfen', () => {
    const blocked = corpus.filter((entry) =>
      ['component-ga-lotse-grundmodul', 'component-lieferkette'].includes(entry.artifactKey),
    );

    for (const entry of blocked) {
      expect(entry.document.view.components.length, entry.artifactKey).toBeGreaterThan(0);
    }
  });
});
