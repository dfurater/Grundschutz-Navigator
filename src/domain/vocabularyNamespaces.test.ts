import { describe, expect, it } from 'vitest';

import type { Practice, Topic, VocabularyNamespaceData } from '@/domain/models';
import { SOURCE_REGISTRY } from '@/domain/sourceRegistry';
import { buildVocabularyRegistry, resolveVocabularyEntry } from '@/domain/vocabulary';
import {
  resolvePracticeVocabulary,
  resolveTopicVocabulary,
} from '@/domain/taxonomyVocabulary';
import {
  PRACTICES_NAMESPACE_URL,
  SECURITY_TARGETS_NAMESPACE_URL,
  SECURITY_TARGET_LEVELS_NAMESPACE_URL,
  TOPICS_NAMESPACE_URL,
} from '@/domain/vocabularyNamespaces';

/**
 * Regressionsschutz gegen den stillen Namespace-Ausfall aus GSPP-304.
 *
 * Die Auflösung in vocabulary.ts und taxonomyVocabulary.ts vergleicht exakte
 * URL-Strings und liefert bei Fehlschlag `null` statt zu werfen. Als das BSI in
 * PR #63 `Dokumentation/namespaces` zu `documentation/namespaces` umbenannte,
 * blieben Fetch, Build und Integritätsprüfung deshalb grün, während sämtliche
 * Vokabular-Definitionen kommentarlos aus der UI verschwanden.
 *
 * Die Namespace-Daten unten werden bewusst NICHT aus den exportierten
 * Konstanten gebaut, sondern — wie `buildVocabularyCollectionMembership` in
 * scripts/vocabulary-utils.mjs — aus dem Upstream-Pfad des Quellregisters.
 * Damit prüft der Test die tatsächliche Kopplung und nicht eine Konstante
 * gegen ihre eigene Kopie: Fällt vocabularyNamespaces.ts hinter eine
 * Registry-Umbenennung zurück, laufen die URLs auseinander und die
 * Auflösung schlägt fehl.
 */

const REPOSITORY_URL = 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek';

function registeredNamespaceDirectory(): string {
  const entry = SOURCE_REGISTRY.find((candidate) => candidate.artifactKey === 'namespaces-bsi');
  if (entry?.kind !== 'vocabulary-collection') {
    throw new Error('Quellregister enthält keine Vokabularsammlung "namespaces-bsi".');
  }
  return entry.upstreamDirectory;
}

/** Bildet die Namespace-URL so, wie die Fetch-Pipeline sie in vocabularies.json schreibt. */
function pipelineNamespaceUrl(fileName: string, directory = registeredNamespaceDirectory()): string {
  const encodedPath = `${directory}/${fileName}`
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${REPOSITORY_URL}/tree/main/${encodedPath}`;
}

function createNamespace(
  fileName: string,
  valueColumn: string,
  entries: VocabularyNamespaceData['entries'],
  directory?: string,
): VocabularyNamespaceData {
  const path = `${directory ?? registeredNamespaceDirectory()}/${fileName}`;
  return {
    source: {
      namespace: pipelineNamespaceUrl(fileName, directory),
      repository: REPOSITORY_URL,
      path,
      fileName,
      routeId: path.replace(/\.csv$/, '').replace(/[/_]/g, '-'),
      gitBlobSha: `blob-${fileName}`,
    },
    columnOrder: [valueColumn, 'Definition', 'UUID'],
    valueColumn,
    definitionColumn: 'Definition',
    entries,
  };
}

function createRegistry(directory?: string) {
  return buildVocabularyRegistry({
    sourceCommitSha: 'cea4589c2b8337207772a88dd82d808cba5e1d89',
    namespaces: [
      createNamespace('practices.csv', 'Kürzel', [{
        value: 'GC',
        definition: 'Offizielle Praktik-Definition.',
        columns: { 'Kürzel': 'GC', Definition: 'Offizielle Praktik-Definition.', UUID: 'uuid-practice-1' },
      }], directory),
      createNamespace('topics.csv', 'Begriff', [{
        value: 'Organisation',
        definition: 'Offizielle Themen-Definition.',
        columns: { Begriff: 'Organisation', Definition: 'Offizielle Themen-Definition.', UUID: 'uuid-topic-1' },
      }], directory),
      createNamespace('security_targets.csv', 'Kürzel', [{
        value: 'C',
        definition: 'Vertraulichkeit.',
        columns: { 'Kürzel': 'C', Definition: 'Vertraulichkeit.', UUID: 'uuid-target-1' },
      }], directory),
      createNamespace('security_targets_levels.csv', 'Kürzel', [{
        value: 'hoch',
        definition: 'Hoher Schutzbedarf.',
        columns: { 'Kürzel': 'hoch', Definition: 'Hoher Schutzbedarf.', UUID: 'uuid-level-1' },
      }], directory),
    ],
  });
}

const practice: Practice = {
  id: 'GC',
  title: 'Governance und Compliance',
  label: 'GC',
  altIdentifier: 'uuid-practice-1',
  topics: [],
  controlCount: 0,
};

const topic: Topic = {
  id: 'GC.1',
  title: 'Organisation',
  label: '1',
  altIdentifier: 'uuid-topic-1',
  practiceId: 'GC',
  controlCount: 0,
  controlIds: [],
};

describe('vocabularyNamespaces', () => {
  it('leitet alle Namespace-URLs aus dem registrierten Upstream-Verzeichnis ab', () => {
    const directory = registeredNamespaceDirectory();

    for (const url of [
      SECURITY_TARGETS_NAMESPACE_URL,
      SECURITY_TARGET_LEVELS_NAMESPACE_URL,
      PRACTICES_NAMESPACE_URL,
      TOPICS_NAMESPACE_URL,
    ]) {
      expect(url.startsWith(`${REPOSITORY_URL}/tree/main/${directory}/`)).toBe(true);
    }
  });

  it('löst gegen die von der Fetch-Pipeline erzeugten Namespace-URLs auf', () => {
    const registry = createRegistry();

    expect(resolvePracticeVocabulary(registry, practice)?.entry.value).toBe('GC');
    expect(resolveTopicVocabulary(registry, topic)?.entry.value).toBe('Organisation');
    expect(
      resolveVocabularyEntry(registry, SECURITY_TARGETS_NAMESPACE_URL, 'C')?.entry.definition,
    ).toBe('Vertraulichkeit.');
    expect(
      resolveVocabularyEntry(registry, SECURITY_TARGET_LEVELS_NAMESPACE_URL, 'hoch')?.entry
        .definition,
    ).toBe('Hoher Schutzbedarf.');
  });

  it('schlägt fehl, sobald die Registry auf ein anderes Namespace-Verzeichnis zeigt', () => {
    // Negativkontrolle: belegt, dass der Test oben echtes Signal hat und nicht
    // unabhängig vom Upstream-Pfad immer grün ist. Entspricht exakt dem
    // Zustand vor GSPP-304, als der Hardcode auf "Dokumentation/namespaces"
    // stehen blieb, während Upstream und Registry weitergezogen waren.
    const staleRegistry = createRegistry('Dokumentation/namespaces');

    expect(resolvePracticeVocabulary(staleRegistry, practice)).toBeNull();
    expect(resolveTopicVocabulary(staleRegistry, topic)).toBeNull();
    expect(resolveVocabularyEntry(staleRegistry, SECURITY_TARGETS_NAMESPACE_URL, 'C')).toBeNull();
    expect(
      resolveVocabularyEntry(staleRegistry, SECURITY_TARGET_LEVELS_NAMESPACE_URL, 'hoch'),
    ).toBeNull();
  });
});
