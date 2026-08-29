import { useLayoutEffect } from 'react';
import { PRODUCT_TITLE } from './pageTitles';
import { removeStaticTitleFallback } from './staticTitleFallback';

/**
 * Deklarativer Routentitel (GSPP-202). React hebt das `<title>` in den `<head>`.
 *
 * Der statische Fallback aus `index.html` weicht erst hier — nicht schon im
 * Bootstrap: So bleibt er stehen, falls React nie committet (die App hat keine
 * ErrorBoundary), und weil der Layout-Effekt vor dem Paint läuft, wird weder
 * ein doppelter noch ein fehlender Titel je sichtbar.
 */
export function PageTitle({ title }: Readonly<{ title?: string }>) {
  useLayoutEffect(() => {
    removeStaticTitleFallback();
  }, []);

  return <title>{title ? `${title} — ${PRODUCT_TITLE}` : PRODUCT_TITLE}</title>;
}
