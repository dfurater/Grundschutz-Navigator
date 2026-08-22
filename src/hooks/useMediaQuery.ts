import { useCallback, useSyncExternalStore } from 'react';

function subscribeToMediaQuery(
  query: string,
  onStoreChange: () => void,
) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const mediaQuery = window.matchMedia(query);
  const handleChange = () => onStoreChange();

  // addEventListener('change') ist seit 2019 in allen unterstützten Browsern
  // verfügbar; der Legacy-Fallback über addListener/removeListener (S1874)
  // ist entfernt.
  mediaQuery.addEventListener('change', handleChange);
  return () => mediaQuery.removeEventListener('change', handleChange);
}

function getMediaQuerySnapshot(query: string) {
  return typeof window !== 'undefined' && window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeToMediaQuery(query, onStoreChange),
    [query],
  );
  const getSnapshot = useCallback(() => getMediaQuerySnapshot(query), [query]);

  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => false,
  );
}
