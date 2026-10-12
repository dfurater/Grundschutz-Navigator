/**
 * Media Queries der Breakpoint-Abos (`useMediaQuery`). Sie stehen in `rem` wie
 * Tailwinds `md` (`48rem`) und `lg` (`64rem`) und die Regeln in `index.css`:
 * `rem` in Media Queries hängt an der Browser-Standardschrift, bei
 * vergrößerter Schrift verschieben sich die Grenzen also gemeinsam. Eine
 * Pixelgrenze bliebe stehen, und gemountete Teilbäume passten nicht mehr zu
 * den sichtbaren Klassen (GSPP-495, GSPP-496).
 */

/**
 * Ab dieser Breite scrollen Seiteninhalt und mobile Trefferlisten selbst
 * (Tailwind `md`). Die Katalog-Navigation ist erst ab `lg` persistent und
 * liegt darunter als Schublade (GSPP-514).
 */
export const OWN_SCROLL_AREA_QUERY = '(width >= 48rem)';

/** Ab dieser Breite sind Katalog- und Suchseite Desktop (Tailwind `lg`). */
export const DESKTOP_QUERY = '(width >= 64rem)';
