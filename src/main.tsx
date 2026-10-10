import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { CatalogProvider } from '@/state/CatalogContext';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { preloadInitialPage } from '@/app/initialPage';
import 'overlayscrollbars/overlayscrollbars.css';
import '@/index.css';

const routerBasename =
  import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '');

// Eine Lazy-Seite als Einstieg wartet begrenzt auf ihren Chunk (`modulepreload`
// holt ihn parallel zum Hauptchunk). Der Router lädt die Route danach ohne
// Netzwerk und ist beim ersten Render fertig: Die Seite erscheint ohne Ladezustand.
// Bewusst kein Top-Level-Await (Sonar S7785): Mit ihm lagert der Bundler die
// gemeinsam genutzten Module aus dem Einstieg in zusätzliche, beim Start
// geladene Chunks aus (12 statt 2 JS-Anfragen je Einstieg, gemessen GSPP-506).
void preloadInitialPage(globalThis.location.pathname, routerBasename).then(() => {
  const router = createBrowserRouter(
    createAppRoutes(<CatalogProvider><AppShell /></CatalogProvider>),
    { basename: routerBasename },
  );
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
});
