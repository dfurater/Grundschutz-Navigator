import { createContext, useContext } from 'react';
import type { UseControlSelectionResult } from '@/hooks/useControlSelection';

interface SearchSelection extends UseControlSelectionResult {
  mobileSelectMode: boolean;
  setMobileSelectMode: (next: boolean) => void;
}

export const SearchSelectionContext = createContext<SearchSelection | null>(null);

export function useSearchSelection(): SearchSelection {
  const selection = useContext(SearchSelectionContext);
  if (!selection) throw new Error('SearchSelectionProvider fehlt');
  return selection;
}
