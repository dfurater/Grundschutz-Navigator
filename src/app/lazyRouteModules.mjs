/**
 * Seitenmodule der nachgeladenen statischen Routen (GSPP-506).
 *
 * Der Build liest diese Tabelle, um jedem statischen HTML-Einstieg einer Lazy-Route
 * ein `modulepreload` auf den Chunk seiner Seite zu geben: Der Browser holt den
 * Chunk dann parallel zum Hauptchunk statt erst nach dessen Ausführung. Die
 * Tabelle ist reines ESM, weil Node-Build-Skripte sie ohne Alias und ohne JSX
 * laden müssen. `staticPageRoutes.tsx` braucht die Importpfade dagegen als
 * Literale (nur sie sind Chunk-Grenzen); `lazyRouteModules.test.ts` hält beide
 * Seiten deckungsgleich.
 *
 * Schlüssel: Route aus `STATIC_PAGE_ROUTES`. Wert: Quelldatei der Seite relativ
 * zum Projektwurzelverzeichnis. Das Vokabulardetail fehlt bewusst: Es hat keine
 * statischen HTML-Einstiege.
 */
export const LAZY_ROUTE_MODULES = Object.freeze({
  '/suche': 'src/features/search/SearchPage.tsx',
  '/vokabular': 'src/features/vocabularies/VocabularyOverviewPage.tsx',
  '/about': 'src/features/pages/AboutPage.tsx',
  '/datenschutz': 'src/features/pages/DatenschutzPage.tsx',
  '/impressum': 'src/features/pages/ImpressumPage.tsx',
  '/lizenzen': 'src/features/pages/LizenzenPage.tsx',
});
