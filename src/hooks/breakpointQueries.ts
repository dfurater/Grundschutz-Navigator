/**
 * Media Queries der Breakpoint-Abos (`useMediaQuery`). Sie stehen in `rem` wie
 * Tailwinds `md` (`46.5rem`, in `index.css` gesetzt), `lg` (`64rem`) und die
 * Regeln in `index.css`:
 * `rem` in Media Queries hängt an der Browser-Standardschrift, bei
 * vergrößerter Schrift verschieben sich die Grenzen also gemeinsam. Eine
 * Pixelgrenze bliebe stehen, und gemountete Teilbäume passten nicht mehr zu
 * den sichtbaren Klassen (GSPP-495, GSPP-496).
 */

/**
 * Ab dieser Breite scrollen Seiteninhalt und mobile Trefferlisten selbst
 * (Tailwind `md`, 744 px bei 16 px Standardschrift: iPad mini im Hochformat).
 * Die Katalog-Navigation ist erst auf dem Desktop persistent und liegt sonst
 * als Schublade (GSPP-514).
 */
export const OWN_SCROLL_AREA_QUERY = '(width >= 46.5rem)';

/**
 * Desktop: Tabelle und persistente Navigation. Dafür genügt die Breite allein
 * nicht; ein Gerät mit Touch als Eingabemöglichkeit (`any-pointer: coarse`)
 * zeigt auch ab `64rem` die Tablet-Ansicht — große Tablets erreichen im
 * Hochformat (iPad Pro 13": 1032 px) und im Querformat (bis 1376 px)
 * Desktop-Breiten. Zwischen `md` und `64rem` gilt die Tablet-Ansicht
 * unabhängig von der Eingabe (`isTablet` in `CatalogBrowser`).
 *
 * Die Tailwind-Variante `desktop` in `index.css` trägt dieselbe Bedingung;
 * `breakpointQueries.test.ts` hält beide gleich.
 */
export const DESKTOP_QUERY = '(width >= 64rem) and (not (any-pointer: coarse))';

/**
 * Gegenstück zu {@link DESKTOP_QUERY} für CSS: Tailwind-Variante `compact` und
 * der Block der Navigationsschublade in `index.css`. Die Komponenten werten
 * sie nicht aus, sie verwenden `!isDesktop`.
 */
export const COMPACT_QUERY = `not (${DESKTOP_QUERY})`;

/**
 * Reduzierte Bewegung. `index.css` schaltet Übergänge und Animationen dafür
 * ohne `!important` ab und gewinnt nur gegen Stylesheet-Regeln; wer eine
 * Transition als Inline-Stil setzt, prüft diese Query selbst.
 */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
