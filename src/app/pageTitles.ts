/**
 * Einzige Quelle der Wahrheit für feste Seitentitel (GSPP-202).
 *
 * Dynamische Titel — Katalogname, Gruppen- und Kontrolltitel, Vokabularname —
 * entstehen in den Seitenkomponenten aus aufgelösten Domain-Daten. Feste Titel
 * dagegen stehen genau hier, damit Routendefinition und Seitenkomponente
 * denselben String verwenden statt ihn parallel zu pflegen.
 */
export const PRODUCT_TITLE = 'Grundschutz++ Navigator';

export const PAGE_TITLES = {
  search: 'Suche',
  vocabularies: 'Vokabulare',
  vocabularyUnavailable: 'Vokabular nicht verfügbar',
  catalog: 'Katalog',
  catalogTargetNotFound: 'Katalogziel nicht gefunden',
  about: 'Über das Projekt',
  privacy: 'Datenschutz',
  imprint: 'Impressum',
  licenses: 'Lizenzen',
  notFound: 'Seite nicht gefunden',
} as const;
