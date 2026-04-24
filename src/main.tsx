import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CatalogProvider } from '@/state/CatalogContext';
import { AppShell } from '@/app/AppShell';
import '@/index.css';

const routerBasename =
  import.meta.env.BASE_URL === '/' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename}>
      <CatalogProvider>
        <AppShell />
      </CatalogProvider>
    </BrowserRouter>
  </StrictMode>,
);
