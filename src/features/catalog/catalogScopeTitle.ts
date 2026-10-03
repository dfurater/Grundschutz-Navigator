import { TITLE_ID_SEPARATOR } from '@/app/pageTitles';
import type { Catalog } from '@/domain/models';

export interface CatalogScopeTitle {
  /** Kennung und Name, z. B. „NOT.3: Notfallvorsorge“ (Dokumenttitel). */
  readonly documentTitle: string;
  /** Nur der Name, z. B. „Notfallvorsorge“ (sichtbare Bereichsüberschrift, GSPP-447). */
  readonly heading: string;
}

const ALL_CONTROLS: CatalogScopeTitle = { documentTitle: 'Alle Kontrollen', heading: 'Alle Kontrollen' };

/**
 * Titel des gewählten Katalogbereichs (Praktik oder Thema). Ein nicht
 * auflösbarer Bereich behält seine Kennung in beiden Titeln.
 */
export function describeCatalogScope(
  catalog: Pick<Catalog, 'practices'> | null | undefined,
  scopeId: string | undefined,
): CatalogScopeTitle {
  if (!catalog || !scopeId) return ALL_CONTROLS;
  const practice = catalog.practices.find((item) => item.id === scopeId);
  if (practice) {
    return { documentTitle: `${practice.label}${TITLE_ID_SEPARATOR}${practice.title}`, heading: practice.title };
  }
  for (const item of catalog.practices) {
    const topic = item.topics.find((candidate) => candidate.id === scopeId);
    if (topic) return { documentTitle: `${scopeId}${TITLE_ID_SEPARATOR}${topic.title}`, heading: topic.title };
  }
  return { documentTitle: scopeId, heading: scopeId };
}
