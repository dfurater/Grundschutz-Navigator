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
