import { createElement, lazy, useState } from 'react';
import type { ComponentType, ReactElement } from 'react';

export interface LazyPage {
  (): ReactElement;
  /** Lädt den Seitenchunk vor; ein Fehlschlag bleibt still, der erste Render versucht es erneut. */
  readonly preload: () => Promise<void>;
}

/**
 * `React.lazy` mit Sofortpfad für bereits geladene Seiten (GSPP-506), für Seiten
 * ohne Props.
 *
 * Ein `lazy()`-Aufruf suspendiert beim ersten Render immer, auch wenn der Chunk
 * schon im Speicher liegt, und der gezeigte Fallback bleibt mindestens 300 ms
 * stehen. Ist der Chunk per `preload()` vor dem ersten Render eingetroffen,
 * rendert die Seite deshalb direkt. Die Wahl trifft jede Instanz einmal beim
 * Mounten: Ein späteres Umschalten vom `lazy`- auf den Seitentyp würde die
 * Seite samt ihrem Zustand neu mounten.
 */
export function lazyPage(load: () => Promise<{ default: ComponentType }>): LazyPage {
  let loaded: ComponentType | undefined;
  const Lazy = lazy(() => load().then((module) => {
    loaded = module.default;
    return module;
  }));

  function Page(): ReactElement {
    const [Component] = useState<ComponentType>(() => loaded ?? Lazy);
    return createElement(Component);
  }
  Page.preload = (): Promise<void> => load().then(
    (module) => { loaded = module.default; },
    () => undefined,
  );
  return Page;
}
