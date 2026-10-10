import { preloadStaticPage } from '@/app/staticPageRoutes';

/**
 * Höchstdauer, die der Start auf den Chunk der Einstiegsseite wartet, bevor er
 * den Router anlegt und rendert (GSPP-506). Der statische Einstieg einer
 * Lazy-Route trägt ein `modulepreload`; der Chunk ist deutlich kleiner als der
 * Hauptchunk und trifft deshalb in der Regel vor dessen Ausführung ein. Der
 * Router lädt die Route dann ohne Netzwerk, und die Seite erscheint ohne
 * Ladezustand. Ein Chunk, der später kommt, ist die Ausnahme. Dann ist ein
 * Ladezustand besser als eine weiße Seite: Nach dieser Zeit rendert die
 * Anwendung in jedem Fall, mit Shell und Ladezustand.
 */
export const INITIAL_PAGE_WAIT_MS = 1000;

/**
 * Pfad relativ zur Deployment-Basis, oder `null`, wenn `pathname` außerhalb liegt.
 * Das Präfix fällt nur weg, wenn danach `/` oder das Ende folgt; `/Basis-x`
 * gehört nicht zu `/Basis`.
 */
export function routePathInBase(pathname: string, basename?: string): string | null {
  if (!basename) return pathname;
  if (pathname === basename) return '/';
  return pathname.startsWith(`${basename}/`) ? pathname.slice(basename.length) : null;
}

/** Wie `routePathInBase`, behält einen Pfad außerhalb der Basis aber unverändert. */
export function initialRoutePath(pathname: string, basename?: string): string {
  return routePathInBase(pathname, basename) ?? pathname;
}

/**
 * Wartet höchstens `waitMs` auf den Chunk der Einstiegsseite und erfüllt sich
 * danach immer: auch bei einem Ladefehler, einem hängenden Request oder einem
 * Pfad ohne Chunk. Der Aufrufer rendert im Anschluss, ohne weiter zu prüfen.
 */
export async function preloadInitialPage(
  pathname: string,
  basename?: string,
  waitMs = INITIAL_PAGE_WAIT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); });
  try {
    await Promise.race([preloadStaticPage(initialRoutePath(pathname, basename)), timeout]);
  } catch {
    // Der Router lädt die Route erneut und zeigt einen Fehler an der Seite.
  } finally {
    clearTimeout(timer);
  }
}
