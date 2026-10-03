import { describe, expect, it } from 'vitest';
import type { Catalog } from '@/domain/models';
import { describeCatalogScope } from './catalogScopeTitle';

const catalog = {
  practices: [
    {
      id: 'NOT',
      label: 'NOT',
      title: 'Notfallmanagement',
      topics: [{ id: 'NOT.3', title: 'Notfallvorsorge' }],
    },
  ],
} as unknown as Pick<Catalog, 'practices'>;

describe('describeCatalogScope', () => {
  it('zeigt bei einem Thema nur den Namen, der Dokumenttitel behält die Kennung', () => {
    expect(describeCatalogScope(catalog, 'NOT.3')).toEqual({
      documentTitle: 'NOT.3: Notfallvorsorge',
      heading: 'Notfallvorsorge',
    });
  });

  it('zeigt bei einer Praktik nur den Namen', () => {
    expect(describeCatalogScope(catalog, 'NOT')).toEqual({
      documentTitle: 'NOT: Notfallmanagement',
      heading: 'Notfallmanagement',
    });
  });

  it('nennt ohne Bereich alle Kontrollen und behält eine unbekannte Kennung', () => {
    expect(describeCatalogScope(catalog, undefined).heading).toBe('Alle Kontrollen');
    expect(describeCatalogScope(null, 'NOT.3').heading).toBe('Alle Kontrollen');
    expect(describeCatalogScope(catalog, 'XYZ.9')).toEqual({ documentTitle: 'XYZ.9', heading: 'XYZ.9' });
  });
});
