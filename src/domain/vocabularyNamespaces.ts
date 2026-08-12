/**
 * Namespace-URLs der offiziellen BSI-Vokabulare.
 *
 * Der Verzeichnispfad wird bewusst NICHT hier hartcodiert, sondern aus dem
 * Quellregister (ADR-1) abgeleitet. Grund: Die `ns`-Werte im Katalog zeigen
 * auf denselben Upstream-Pfad, und die Auflösung in `vocabulary.ts` und
 * `taxonomyVocabulary.ts` vergleicht exakte URL-Strings mit stillem
 * `null`-Fallback. Eine Upstream-Umbenennung — wie die Kleinschreibung des
 * Namespace-Verzeichnisses in BSI-PR #63 — hätte bei doppelter Pflege
 * kommentarlos alle Vokabular-Definitionen aus der UI entfernt, ohne dass
 * Fetch, Build oder Integritätsprüfung anschlagen.
 *
 * Die URL-Bildung muss deckungsgleich mit `buildVocabularyCollectionMembership`
 * in scripts/vocabulary-utils.mjs bleiben; vocabularyNamespaces.test.ts sichert
 * das gegen das Quellregister ab.
 */

import { SOURCE_REGISTRY } from './sourceRegistry';

const BSI_REPOSITORY_URL = 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek';

/** Segmentweises Encoding wie in scripts/vocabulary-utils.mjs. */
function encodeRepositoryPath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

const namespaceCollection = SOURCE_REGISTRY.find(
  (entry) => entry.artifactKey === 'namespaces-bsi',
);

if (namespaceCollection?.kind !== 'vocabulary-collection') {
  throw new Error(
    'Quellregister enthält keine Vokabularsammlung "namespaces-bsi"; Namespace-URLs sind nicht ableitbar.',
  );
}

const BSI_NAMESPACE_ROOT =
  `${BSI_REPOSITORY_URL}/tree/main/${encodeRepositoryPath(namespaceCollection.upstreamDirectory)}`;

export const SECURITY_TARGETS_NAMESPACE_URL =
  `${BSI_NAMESPACE_ROOT}/security_targets.csv`;

export const SECURITY_TARGET_LEVELS_NAMESPACE_URL =
  `${BSI_NAMESPACE_ROOT}/security_targets_levels.csv`;

export const PRACTICES_NAMESPACE_URL =
  `${BSI_NAMESPACE_ROOT}/practices.csv`;

export const TOPICS_NAMESPACE_URL =
  `${BSI_NAMESPACE_ROOT}/topics.csv`;
