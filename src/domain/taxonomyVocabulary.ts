import type {
  Practice,
  Topic,
  VocabularyRegistry,
} from './models';
import type { VocabularyResolution } from './vocabulary';
import {
  PRACTICES_NAMESPACE_URL,
  TOPICS_NAMESPACE_URL,
} from './vocabularyNamespaces';

function resolveVocabularyEntryByUniqueColumn(
  registry: VocabularyRegistry | null | undefined,
  namespaceUrl: string,
  column: string,
  value: string | undefined,
): VocabularyResolution | null {
  if (!registry || !value) {
    return null;
  }

  const namespace = registry.namespacesByUrl.get(namespaceUrl);
  if (!namespace) {
    return null;
  }

  const matches = namespace.entries.filter(
    (entry) => entry.columns[column] === value,
  );
  if (matches.length > 1) {
    throw new Error(
      `Duplicate vocabulary value "${value}" in column "${column}" of "${namespaceUrl}".`,
    );
  }

  return matches[0] ? { namespace, entry: matches[0] } : null;
}

export function resolvePracticeVocabulary(
  registry: VocabularyRegistry | null | undefined,
  practice: Practice | null | undefined,
): VocabularyResolution | null {
  return resolveVocabularyEntryByUniqueColumn(
    registry,
    PRACTICES_NAMESPACE_URL,
    'UUID',
    practice?.altIdentifier,
  );
}

export function resolveTopicVocabulary(
  registry: VocabularyRegistry | null | undefined,
  topic: Topic | null | undefined,
): VocabularyResolution | null {
  return resolveVocabularyEntryByUniqueColumn(
    registry,
    TOPICS_NAMESPACE_URL,
    'UUID',
    topic?.altIdentifier,
  );
}
