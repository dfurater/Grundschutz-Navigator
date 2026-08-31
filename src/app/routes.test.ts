import { describe, expect, it } from 'vitest';
import {
  CATALOG_ROUTE_PATTERN,
  CONTROL_ROUTE_PATTERN,
  GROUP_ROUTE_PATTERN,
  buildCatalogUrl,
  buildControlUrl,
  buildControlUrlForControl,
  buildGroupUrl,
  resolveControlRoute,
} from '@/app/routes';
import type { Control } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';

describe('routes (Navigationsvertrag ADR-1)', () => {
  it('declares the canonical route patterns', () => {
    expect(CATALOG_ROUTE_PATTERN).toBe('/katalog/:catalogKey');
    expect(GROUP_ROUTE_PATTERN).toBe('/katalog/:catalogKey/:groupId');
    expect(CONTROL_ROUTE_PATTERN).toBe('/katalog/:catalogKey/kontrolle/:altIdentifier');
  });

  it('builds catalog urls', () => {
    expect(buildCatalogUrl('gspp')).toBe('/katalog/gspp');
    expect(buildCatalogUrl('mindeststandard-tls')).toBe('/katalog/mindeststandard-tls');
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

  it('never substitutes the mutable control ID for a missing alt-identifier', () => {
    expect(() =>
      buildControlUrlForControl('gspp', {
        id: 'NEW.9.9',
      }),
    ).toThrow('without an alt-identifier');
  });

  it('resolves an identical alt-identifier independently in two catalogs', () => {
    const gsppControl = {
      id: 'GSPP.NEW.1',
      altIdentifier: 'shared-alt-id',
    } as Control;
    const wlanControl = {
      id: 'WLAN.1',
      altIdentifier: 'shared-alt-id',
    } as Control;
    const gspp = {
      catalogKey: 'gspp' as const,
      controlsByAltIdentifier: new Map([['shared-alt-id', gsppControl]]),
    };
    const wlan = {
      catalogKey: 'wlan' as const,
      controlsByAltIdentifier: new Map([['shared-alt-id', wlanControl]]),
    };

    expect(resolveControlRoute(gspp, 'gspp', 'shared-alt-id')).toBe(gsppControl);
    expect(resolveControlRoute(wlan, 'wlan', 'shared-alt-id')).toBe(wlanControl);
    expect(resolveControlRoute(gspp, 'wlan', 'shared-alt-id')).toBeNull();
    expect(resolveControlRoute(wlan, 'gspp', 'shared-alt-id')).toBeNull();
  });

  it('keeps resolving a stable alt-identifier after the control ID moves', () => {
    const movedControl = {
      id: 'NEW.9.9',
      altIdentifier: 'stable-alt-id',
    } as Control;
    const catalog = {
      catalogKey: 'gspp' as const,
      controlsByAltIdentifier: new Map([['stable-alt-id', movedControl]]),
    };

    expect(resolveControlRoute(catalog, 'gspp', 'stable-alt-id')).toBe(movedControl);
    expect(resolveControlRoute(catalog, 'gspp', movedControl.id)).toBeNull();
    expect(resolveControlRoute(catalog, 'unknown', 'stable-alt-id')).toBeNull();
  });
});
