import type { CatalogKey } from '@/domain/sourceRegistry';

/** Wörtliche Ausschnitte der Originaltitel (Originalschreibung-Regel). */
const SHORT_TITLES: Partial<Record<CatalogKey, string>> = {
  gspp: 'Grundschutz++',
  diva: 'DIVA',
  'wlan-gastnetze': 'WLAN-Personal- und Gastnetze',
};

/** Kurztitel eines Katalogs für Seitenleistenkopf und Werkzeugleiste; ohne Eintrag der Originaltitel. */
export function catalogShortTitle(catalogKey: CatalogKey, title: string): string {
  return SHORT_TITLES[catalogKey] ?? title;
}
