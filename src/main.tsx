import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { CatalogProvider } from '@/state/CatalogContext';
import { AppShell } from '@/app/AppShell';
import { preloadInitialPage } from '@/app/initialPage';
import 'overlayscrollbars/overlayscrollbars.css';
import '@/index.css';

const routerBasename =
  import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '');

// Eine Lazy-Seite als Einstieg wartet begrenzt auf ihren Chunk (`modulepreload`
// holt ihn parallel zum Hauptchunk), damit sie ohne Ladezustand erscheint.
// Bewusst kein Top-Level-Await (Sonar S7785): Mit ihm lagert der Bundler die
// gemeinsam genutzten Module aus dem Einstieg in zusätzliche, beim Start
// geladene Chunks aus (12 statt 2 JS-Anfragen je Einstieg, gemessen GSPP-506).
void preloadInitialPage(globalThis.location.pathname, routerBasename).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter basename={routerBasename}>
        <CatalogProvider>
          <AppShell />
        </CatalogProvider>
      </BrowserRouter>
    </StrictMode>,
  );
});
