import { useState, type ReactNode } from 'react';
import { matchPath, useLocation } from 'react-router';
import { useCatalog } from '@/hooks/useCatalog';
import { useControlSelection } from '@/hooks/useControlSelection';
import { SearchSelectionContext } from '@/state/SearchSelectionContext';

/** Die Shell hält genau eine Suchauswahl flüchtig über Seitenwechsel. */
export function SearchSelectionProvider({ children }: { children: ReactNode }) {
  const { catalog } = useCatalog();
  const location = useLocation();
  const searchQuery = matchPath('/suche', location.pathname)
    ? new URLSearchParams(location.search).get('q') ?? ''
    : null;
  const catalogKey = catalog?.catalogKey ?? null;
  const [scope, setScope] = useState(() => ({ catalogKey, query: searchQuery ?? '' }));
  const query = searchQuery ?? scope.query;
  const selection = useControlSelection({ scopeId: JSON.stringify([catalogKey, query]) });
  const [mobileSelectMode, setMobileSelectMode] = useState(false);
  // Vor dem Rendern der Kinder verwerfen, ohne die Shell oder ihre Seiten
  // auszuhängen. Zurück zum verworfenen Scope stellt keine Auswahl wieder her.
  if (scope.catalogKey !== catalogKey || scope.query !== query) {
    setScope({ catalogKey, query });
    selection.clear();
    setMobileSelectMode(false);
  }
  return (
    <SearchSelectionContext value={{ ...selection, mobileSelectMode, setMobileSelectMode }}>
      {children}
    </SearchSelectionContext>
  );
}
