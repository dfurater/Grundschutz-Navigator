const VOCABULARY_INDEX_PATH = '/vokabular';

export function buildVocabularyIndexPath(): string {
  return VOCABULARY_INDEX_PATH;
}

export function buildVocabularyNamespacePath(routeId: string): string {
  return `${VOCABULARY_INDEX_PATH}/${routeId}`;
}

export function buildVocabularyEntryPath(
  routeId: string,
  value?: string,
): string {
  const namespacePath = buildVocabularyNamespacePath(routeId);

  if (!value) {
    return namespacePath;
  }

  const searchParams = new URLSearchParams({ wert: value });
  return `${namespacePath}?${searchParams.toString()}`;
}
