import type { ComponentType } from 'react';

export interface LazyPage {
  /** Lädt den Seitenchunk; ein Fehlschlag wird an den Router weitergegeben. */
  readonly load: () => Promise<ComponentType>;
  /** Lädt den Seitenchunk vor; ein Fehlschlag bleibt still, die Navigation versucht es erneut. */
  readonly preload: () => Promise<void>;
}

/**
 * Seitenmodul einer Lazy-Route (GSPP-506), für Seiten ohne Props.
 *
 * Den Chunk lädt der Router über das Routenfeld `lazy` (`appRoutes.tsx`), bevor
 * er die Navigation festschreibt: Bis dahin bleibt die vorige Seite stehen, und
 * `useNavigation()` meldet `loading`. `preload()` holt denselben Chunk vorab
 * (Einstieg, Navigationsabsicht). Vorladen und Router teilen sich einen
 * laufenden Ladevorgang; nach einem Fehlschlag versucht der nächste Aufruf es neu.
 */
export function lazyPage(load: () => Promise<{ default: ComponentType }>): LazyPage {
  let pending: Promise<ComponentType> | undefined;
  const loadComponent = (): Promise<ComponentType> => {
    pending ??= load().then(
      (module) => module.default,
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
  return {
    load: loadComponent,
    preload: () => loadComponent().then(() => undefined, () => undefined),
  };
}
