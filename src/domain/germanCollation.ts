/**
 * Deutsche Sortierkomparatoren auf einmal erzeugten `Intl.Collator`-Instanzen.
 *
 * `a.localeCompare(b, 'de', options)` löst Locale und Optionen bei jedem
 * Vergleich neu auf. Beim initialen Sortieren der ~1.000 Katalog-Controls war
 * das in der Profilierung (GSPP-262) rund 22-mal langsamer als ein
 * wiederverwendeter Collator — bei identischer Reihenfolge. `compare` ist laut
 * ECMA-402 an seine Instanz gebunden und kann direkt an `sort` gehen.
 */

const controlIdCollator = new Intl.Collator('de', { numeric: true });
const germanTextCollator = new Intl.Collator('de');

/** Control-IDs mit numerischen Segmenten: `GC.1.2` vor `GC.1.10`. */
export const compareControlIds: (left: string, right: string) => number = controlIdCollator.compare;

/** Deutscher Fließtext (Titel, Anzeigenamen, Facettenwerte). */
export const compareGermanText: (left: string, right: string) => number = germanTextCollator.compare;
