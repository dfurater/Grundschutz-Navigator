import type { ReactNode } from 'react';
import { lazyPage } from '@/app/lazyPage';
import type { LazyPage } from '@/app/lazyPage';
import { HomePage } from '@/features/home/HomePage';
import { PAGE_TITLES } from '@/app/pageTitles';

/*
 * Nebenrouten laden als eigene Chunks (GSPP-506). Die Named-Export-Adapter und
 * die Literalpfade sind Absicht: Der Bundler erkennt nur statische
 * `import()`-Pfade als Chunk-Grenze, und die Seiten exportieren benannt.
 */
const SearchPage = lazyPage(() =>
  import('@/features/search/SearchPage').then((m) => ({ default: m.SearchPage })));
const VocabularyOverviewPage = lazyPage(() =>
  import('@/features/vocabularies/VocabularyOverviewPage').then((m) => ({ default: m.VocabularyOverviewPage })));
const AboutPage = lazyPage(() =>
  import('@/features/pages/AboutPage').then((m) => ({ default: m.AboutPage })));
const DatenschutzPage = lazyPage(() =>
  import('@/features/pages/DatenschutzPage').then((m) => ({ default: m.DatenschutzPage })));
const ImpressumPage = lazyPage(() =>
  import('@/features/pages/ImpressumPage').then((m) => ({ default: m.ImpressumPage })));
const LizenzenPage = lazyPage(() =>
  import('@/features/pages/LizenzenPage').then((m) => ({ default: m.LizenzenPage })));

/**
 * Statische Seitenrouten mit ihrem Titel (GSPP-202).
 *
 * Der Titel gehört zur Routendefinition, nicht in die Seitenkomponente: Weil
 * `appRoutes.tsx` diese Liste rendert, kann keine statische Route ohne deklarierten
 * Titel existieren, und ein Test iteriert über genau dieselbe Quelle. Routen mit
 * datenabhängigem Titel — Katalog und Vokabulardetail — stehen bewusst nicht
 * hier, weil ihr Titel erst aus aufgelöstem Katalogzustand entsteht.
 *
 * Chunk-Vertrag (GSPP-506): Die Startseite bleibt im Hauptchunk, weil sie der
 * erste Einstieg ist; alle übrigen Seiten tragen ein `page`-Modul, das der
 * Router erst beim ersten Aufruf lädt (Routenfeld `lazy`, `appRoutes.tsx`). Der
 * Titel bleibt trotzdem Teil der Routendefinition: `appRoutes.tsx` rendert ihn
 * mit der Route und im Ladezustand des Direktaufrufs; bei Client-Navigation
 * bleibt die vorige Seite samt Titel stehen, bis der Chunk da ist. Jede Lazy-Route braucht einen Eintrag in `lazyRouteModules.mjs`, damit
 * der Build ihrem statischen Einstieg ein `modulepreload` mitgibt.
 */
export interface StaticPageRoute {
  readonly path: string;
  /** Ohne Titel trägt die Route den reinen Produktnamen. */
  readonly title?: string;
  /** Seite im Hauptchunk; nur, wo kein `page` steht. */
  readonly element?: ReactNode;
  /** Seitenmodul einer Lazy-Route; der Router lädt es beim ersten Aufruf. */
  readonly page?: LazyPage;
  /** Seiten mit eigenem Scrollcontainer (z. B. die Suche) setzen `false`. */
  readonly scroll?: boolean;
}

export const STATIC_PAGE_ROUTES: readonly StaticPageRoute[] = [
  { path: '/', element: <HomePage /> },
  { path: '/suche', title: PAGE_TITLES.search, page: SearchPage, scroll: false },
  { path: '/vokabular', title: PAGE_TITLES.vocabularies, page: VocabularyOverviewPage },
  { path: '/about', title: PAGE_TITLES.about, page: AboutPage },
  { path: '/datenschutz', title: PAGE_TITLES.privacy, page: DatenschutzPage },
  { path: '/impressum', title: PAGE_TITLES.imprint, page: ImpressumPage },
  { path: '/lizenzen', title: PAGE_TITLES.licenses, page: LizenzenPage },
];

/** Die statische Lazy-Route zu `pathname` (relativ zur Deployment-Basis), sonst `undefined`. */
export function findLazyStaticRoute(pathname: string): StaticPageRoute | undefined {
  // Schrägstriche am Ende ohne Regex abschneiden: `/\/+$/` gilt unter Sonar S8786 als superlinear.
  let path = pathname;
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return STATIC_PAGE_ROUTES.find((route) => route.path === path && route.page !== undefined);
}

/**
 * Lädt den Chunk der statischen Lazy-Route zu `pathname` (relativ zur
 * Deployment-Basis) vor. Routen ohne Chunk sind sofort erledigt; ein Ladefehler
 * wird nicht gemeldet, der Router versucht es beim Laden der Route erneut.
 */
export function preloadStaticPage(pathname: string): Promise<void> {
  return findLazyStaticRoute(pathname)?.page?.preload() ?? Promise.resolve();
}
