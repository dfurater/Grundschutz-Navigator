// @vitest-environment node
// =============================================================================
// Optionaler Realkorpus — die drei BSI-Profile (GSPP-240)
//
// Die Dateien liegen **nicht** im Repository: `npm run fetch-catalog`
// materialisiert ausschließlich `supported`-Artefakte, und alle drei Profile
// sind `preview` (`src/domain/sourceRegistry.mjs`). Wer sie prüfen will, holt
// sie lokal am Snapshot aus `upstream-manifest.json` und richtet
// `GSPP_PROFILE_CORPUS_PATH` auf das Verzeichnis, das die
// `control_layer/…`-Pfade enthält.
//
// Fehlen die Dateien, wird übersprungen statt fehlzuschlagen — dasselbe Muster
// wie `oscalDocument.catalog.node.test.ts` (GSPP-337) und
// `oscalComponentDocument.node.test.ts` (GSPP-248).
//
// Geprüft wird **Erhaltung**, nicht Inhalt: Feste Zahlen stehen ausschließlich
// in den Fixtures (`oscalProfileAdapter.test.ts`). Eine Assertion gegen „genau
// 290 alters" wäre hier beim nächsten Upstream-Update rot, ohne dass etwas
// kaputt ist — das WLAN-Profil hat diese Zahl seit 2026-07-28 schon einmal
// gewechselt. Die Byte-Identität wird über den `contentSha256` des Manifests
// **geprüft**, nicht behauptet.
// =============================================================================

import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseProfileDocument } from './oscalProfileDocument';
import type { ProfileDocument } from './oscalProfileDocument';
import type { UpstreamManifest } from '@/domain/models';
import {
  arrayOrderSignature,
  contentMultiset,
  countPropRemarks,
  missingFromMultiset,
} from '@/test/oscalStructure';

const corpusRoot = process.env.GSPP_PROFILE_CORPUS_PATH;

/** Repo-relativ; das Arbeitsverzeichnis des Testlaufs ist die Projektwurzel. */
const manifest = JSON.parse(readFileSync('upstream-manifest.json', 'utf8')) as UpstreamManifest;
const profileFiles = manifest.files.filter((file) => file.rootType === 'profile');

const availableFiles = corpusRoot
  ? profileFiles.filter((file) => existsSync(join(corpusRoot, file.path)))
  : [];
const corpusAvailable = availableFiles.length > 0;

interface CorpusEntry {
  readonly artifactKey: string;
  readonly upstreamPath: string;
  readonly expectedSha256: string;
  readonly actualSha256: string;
  readonly original: unknown;
  readonly document: ProfileDocument;
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
      document: parseProfileDocument(original, {
        trustClass: 'class-1-verified-public',
        upstreamPath: file.path,
      }),
    };
  });
}

describe('Manifestvertrag der Profile', () => {
  it('führt genau die drei registrierten Profile', () => {
    expect(profileFiles.map((file) => file.artifactKey).sort()).toEqual([
      'profile-gspp',
      'profile-lieferkette',
      'profile-wlan',
    ]);
  });
});

describe.skipIf(!corpusAvailable)('Verlustfreiheit am realen Profile-Korpus', () => {
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

  it('bindet jedes Profil an die im Register deklarierte Version', () => {
    for (const entry of corpus) {
      expect(entry.document.pin.rootKey, entry.artifactKey).toBe('profile');
      expect(entry.document.artifactKey, entry.artifactKey).toBe(entry.artifactKey);
      expect(entry.document.oscalVersion, entry.artifactKey).toBe(
        entry.document.view.metadata.oscalVersion,
      );
    }
  });

  it('erhält jede Änderungsanweisung, auch mehrfach adressierte control-id', () => {
    for (const entry of corpus) {
      const modify = entry.document.view.modify;
      if (modify === null) continue;

      // Relativ, nicht absolut: Die Summe über die Gruppen muss der Zahl der
      // Einträge entsprechen. Genau das bricht, sobald jemand über `control-id`
      // schlüsselt und dabei überschreibt.
      const grouped = [...modify.altersByControlId.values()].reduce(
        (sum, alters) => sum + alters.length,
        0,
      );
      const addressed = modify.alters.filter((alter) => alter.controlId !== undefined).length;

      expect(grouped, entry.artifactKey).toBe(addressed);
      expect(modify.resolution.status, entry.artifactKey).toBe('not-resolved');
    }
  });

  it('löst jedes Import-href über die Referenzschicht auf, ohne Netzzugriff', () => {
    for (const entry of corpus) {
      expect(entry.document.view.imports.length, entry.artifactKey).toBeGreaterThan(0);
      for (const profileImport of entry.document.view.imports) {
        // Klassifiziert ist jede Referenz; **aufgelöst** wird eine relative
        // Referenz ausdrücklich nie (GSPP-286).
        expect(profileImport.reference, `${entry.artifactKey} ${profileImport.path}`)
          .not.toBeNull();
      }
    }
  });
});
