import { describe, expect, it } from 'vitest';
import {
  CATALOG_ROUTE_PATTERN,
  CONTROL_ROUTE_PATTERN,
  GROUP_ROUTE_PATTERN,
  buildCatalogUrl,
  buildControlUrl,
  buildGroupUrl,
} from '@/app/routes';
import type { CatalogKey } from '@/domain/sourceRegistry';

describe('routes (Navigationsvertrag ADR-0001)', () => {
  it('declares the canonical route patterns', () => {
    expect(CATALOG_ROUTE_PATTERN).toBe('/katalog/:catalogKey');
    expect(GROUP_ROUTE_PATTERN).toBe('/katalog/:catalogKey/:groupId');
    expect(CONTROL_ROUTE_PATTERN).toBe('/katalog/:catalogKey/kontrolle/:altIdentifier');
  });

  it('builds catalog urls', () => {
    expect(buildCatalogUrl('gspp')).toBe('/katalog/gspp');
    expect(buildCatalogUrl('iso27001-annex-a')).toBe('/katalog/iso27001-annex-a');
  });

  it('builds group urls with encoding', () => {
    expect(buildGroupUrl('gspp', 'GC.1')).toBe('/katalog/gspp/GC.1');
    expect(buildGroupUrl('gspp', 'GC 1/x')).toBe('/katalog/gspp/GC%201%2Fx');
  });

  it('builds canonical control urls from catalogKey and altIdentifier', () => {
    expect(buildControlUrl('gspp', '80351189-6ffc-495e-a995-6219b9704724')).toBe(
      '/katalog/gspp/kontrolle/80351189-6ffc-495e-a995-6219b9704724',
    );
  });

  it('rejects unregistered catalog keys', () => {
    expect(() => buildCatalogUrl('grundschutzpp' as CatalogKey)).toThrow('catalogKey');
    expect(() => buildControlUrl('GSPP' as CatalogKey, 'uuid-1')).toThrow('catalogKey');
  });

  it('rejects empty identifiers', () => {
    expect(() => buildGroupUrl('gspp', '')).toThrow('groupId');
    expect(() => buildControlUrl('gspp', '')).toThrow('altIdentifier');
    expect(() => buildControlUrl('gspp', '   ')).toThrow('altIdentifier');
  });
});
