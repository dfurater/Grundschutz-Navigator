import { renderToString } from 'react-dom/server';
import { StaticRouterProvider, createStaticHandler, createStaticRouter } from 'react-router';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { CatalogProvider } from '@/state/CatalogContext';

const PRERENDER_ORIGIN = 'https://prerender.invalid';

/**
 * Markup des ersten Renders der Startseite für `dist/index.html`. Der Build
 * (`vite.config.ts`) lädt dieses Modul serverseitig. Gerendert wird der
 * Zustand vor jeder Katalogantwort mit den Server-Snapshots der Media Queries,
 * also das mobile Layout. `createRoot` in `src/main.tsx` ersetzt das Markup
 * beim App-Start vollständig. `PageTitle` rendert sein `<title>` in den Baum;
 * die Startseite trägt ihren Titel bereits im Kopf, deshalb entfällt es hier.
 */
export async function renderStartPage(basename: string): Promise<string> {
  const routes = createAppRoutes(<CatalogProvider><AppShell /></CatalogProvider>);
  const handler = createStaticHandler(routes, { basename });
  const context = await handler.query(new Request(`${PRERENDER_ORIGIN}${basename}`));
  if (context instanceof Response) throw new Error('Startseite antwortet beim Vorrendern mit einer Weiterleitung');
  const router = createStaticRouter(handler.dataRoutes, context);
  const html = renderToString(<StaticRouterProvider router={router} context={context} hydrate={false} />);
  return html.replaceAll(/<title>[^<]*<\/title>/g, '');
}
