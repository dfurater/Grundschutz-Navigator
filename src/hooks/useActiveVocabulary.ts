import { useCallback, useState } from 'react';

export interface UseActiveVocabularyOptions {
  scopeId: string;
}

export interface UseActiveVocabularyResult {
  activeKey: string | null;
  isActive: (key: string) => boolean;
  toggle: (key: string) => void;
}

export function useActiveVocabulary({
  scopeId,
}: UseActiveVocabularyOptions): UseActiveVocabularyResult {
  const [vocabularyState, setVocabularyState] = useState(() => ({
    scopeId,
    activeKey: null as string | null,
  }));
  if (vocabularyState.scopeId !== scopeId) {
    setVocabularyState({ scopeId, activeKey: null });
  }

  const activeKey =
    vocabularyState.scopeId === scopeId
      ? vocabularyState.activeKey
      : null;

  const toggle = useCallback((key: string) => {
    setVocabularyState((current) => ({
      scopeId,
      activeKey:
        current.scopeId === scopeId && current.activeKey === key
          ? null
          : key,
    }));
  }, [scopeId]);

  const isActive = useCallback(
    (key: string) => activeKey === key,
    [activeKey],
  );

  return { activeKey, isActive, toggle };
}
