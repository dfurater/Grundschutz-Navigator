import { HomePage } from '@/features/home/HomePage';
import { SearchPage } from '@/features/search/SearchPage';
import { AboutPage } from '@/features/pages/AboutPage';
import { DatenschutzPage } from '@/features/pages/DatenschutzPage';
import { ImpressumPage } from '@/features/pages/ImpressumPage';
import { LizenzenPage } from '@/features/pages/LizenzenPage';
import { VocabularyOverviewPage } from '@/features/vocabularies/VocabularyOverviewPage';
import { PAGE_TITLES } from '@/app/pageTitles';

/**
 * Statische Seitenrouten mit ihrem Titel (GSPP-202).
 *
 * Der Titel gehört zur Routendefinition, nicht in die Seitenkomponente: Weil
 * `AppShell` diese Liste rendert, kann keine statische Route ohne deklarierten
 * Titel existieren, und ein Test iteriert über genau dieselbe Quelle. Routen mit
 * datenabhängigem Titel — Katalog und Vokabulardetail — stehen bewusst nicht
 * hier, weil ihr Titel erst aus aufgelöstem Katalogzustand entsteht.
 */
export interface StaticPageRoute {
  readonly path: string;
  /** Ohne Titel trägt die Route den reinen Produktnamen. */
  readonly title?: string;
  readonly element: React.ReactNode;
  /** Seiten mit eigenem Scrollcontainer (z. B. die Suche) setzen `false`. */
  readonly scroll?: boolean;
}

export const STATIC_PAGE_ROUTES: readonly StaticPageRoute[] = [
  { path: '/', element: <HomePage /> },
  { path: '/suche', title: PAGE_TITLES.search, element: <SearchPage />, scroll: false },
  { path: '/vokabular', title: PAGE_TITLES.vocabularies, element: <VocabularyOverviewPage /> },
  { path: '/about', title: PAGE_TITLES.about, element: <AboutPage /> },
  { path: '/datenschutz', title: PAGE_TITLES.privacy, element: <DatenschutzPage /> },
  { path: '/impressum', title: PAGE_TITLES.imprint, element: <ImpressumPage /> },
  { path: '/lizenzen', title: PAGE_TITLES.licenses, element: <LizenzenPage /> },
];
