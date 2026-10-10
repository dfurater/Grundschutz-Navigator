import { lazyPage } from '@/app/lazyPage';
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
 * `AppShell` diese Liste rendert, kann keine statische Route ohne deklarierten
 * Titel existieren, und ein Test iteriert über genau dieselbe Quelle. Routen mit
 * datenabhängigem Titel — Katalog und Vokabulardetail — stehen bewusst nicht
 * hier, weil ihr Titel erst aus aufgelöstem Katalogzustand entsteht.
 *
 * Chunk-Vertrag (GSPP-506): Die Startseite bleibt im Hauptchunk, weil sie der
 * erste Einstieg ist; alle übrigen Seiten sind `lazy` und werden erst beim
 * ersten Aufruf geladen. Der Titel bleibt trotzdem Teil der Routendefinition:
 * `AppShell` rendert ihn mit der Route. Solange eine Seite beim Direktaufruf
 * noch lädt, liefert die Grenze um die Routen den Titel selbst (aus dieser
 * Tabelle); bei Client-Navigation hält die Transition die vorige Seite samt
 * Titel. Jede Lazy-Route braucht einen Eintrag in `lazyRouteModules.mjs`, damit
 * der Build ihrem statischen Einstieg ein `modulepreload` mitgibt.
 */
export interface StaticPageRoute {
  readonly path: string;
  /** Ohne Titel trägt die Route den reinen Produktnamen. */
  readonly title?: string;
  readonly element: React.ReactNode;
  /** Seiten mit eigenem Scrollcontainer (z. B. die Suche) setzen `false`. */
  readonly scroll?: boolean;
  /** Nur Lazy-Routen: lädt den Seitenchunk vor (siehe `preloadStaticPage`). */
  readonly preload?: () => Promise<void>;
}

export const STATIC_PAGE_ROUTES: readonly StaticPageRoute[] = [
  { path: '/', element: <HomePage /> },
  { path: '/suche', title: PAGE_TITLES.search, element: <SearchPage />, scroll: false, preload: SearchPage.preload },
  { path: '/vokabular', title: PAGE_TITLES.vocabularies, element: <VocabularyOverviewPage />, preload: VocabularyOverviewPage.preload },
  { path: '/about', title: PAGE_TITLES.about, element: <AboutPage />, preload: AboutPage.preload },
  { path: '/datenschutz', title: PAGE_TITLES.privacy, element: <DatenschutzPage />, preload: DatenschutzPage.preload },
  { path: '/impressum', title: PAGE_TITLES.imprint, element: <ImpressumPage />, preload: ImpressumPage.preload },
  { path: '/lizenzen', title: PAGE_TITLES.licenses, element: <LizenzenPage />, preload: LizenzenPage.preload },
];

/** Die statische Lazy-Route zu `pathname` (relativ zur Deployment-Basis), sonst `undefined`. */
export function findLazyStaticRoute(pathname: string): StaticPageRoute | undefined {
  // Schrägstriche am Ende ohne Regex abschneiden: `/\/+$/` gilt unter Sonar S8786 als superlinear.
  let path = pathname;
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return STATIC_PAGE_ROUTES.find((route) => route.path === path && route.preload !== undefined);
}

/**
 * Lädt den Chunk der statischen Lazy-Route zu `pathname` (relativ zur
 * Deployment-Basis) vor. Routen ohne Chunk sind sofort erledigt; ein Ladefehler
 * wird nicht gemeldet, der erste Render der Seite versucht es erneut.
 */
export function preloadStaticPage(pathname: string): Promise<void> {
  return findLazyStaticRoute(pathname)?.preload?.() ?? Promise.resolve();
}
