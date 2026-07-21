import { describe, expect, it } from 'vitest';
import { parseCatalog } from '@/adapters/oscalAdapter';
import {
  controlRefEquals,
  formatControlRef,
  makeControlRef,
  resolveControlRef,
} from '@/domain/controlRef';
import type { Catalog } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';

function makeRawDoc(title: string, altIdentifier: string) {
  return {
    catalog: {
      uuid: `uuid-${altIdentifier}`,
      metadata: {
        title,
        'last-modified': '2026-03-05T08:08:21Z',
        version: '2026-03-05',
        'oscal-version': '1.1.3',
      },
      groups: [
        {
          id: 'GC',
          title: 'Practice',
          groups: [
            {
              id: 'GC.1',
              title: 'Topic',
              controls: [
                {
                  id: 'GC.1.1',
                  title,
                  props: [{ name: 'alt-identifier', value: altIdentifier }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/** Zwei Kataloge mit identischer Control-ID GC.1.1 — Kernbeweis für AC3. */
function makeCatalogsByKey(): ReadonlyMap<CatalogKey, Catalog> {
  const gspp = parseCatalog(makeRawDoc('Control in gspp', 'uuid-gspp-1'), {
    catalogKey: 'gspp',
  });
  const wlan = parseCatalog(makeRawDoc('Control in wlan', 'uuid-wlan-1'), {
    catalogKey: 'wlan',
  });
  return new Map([
    [gspp.catalogKey, gspp],
    [wlan.catalogKey, wlan],
  ]);
}

describe('controlRef', () => {
  it('resolves the same control id per catalog without collisions', () => {
    const catalogsByKey = makeCatalogsByKey();

    expect(resolveControlRef(catalogsByKey, makeControlRef('gspp', 'GC.1.1'))?.title).toBe(
      'Control in gspp',
    );
    expect(resolveControlRef(catalogsByKey, makeControlRef('wlan', 'GC.1.1'))?.title).toBe(
      'Control in wlan',
    );
  });

  it('returns null for unknown catalogs or control ids', () => {
    const catalogsByKey = makeCatalogsByKey();

    expect(resolveControlRef(catalogsByKey, makeControlRef('lieferkette', 'GC.1.1'))).toBeNull();
    expect(resolveControlRef(catalogsByKey, makeControlRef('gspp', 'GC.9.9'))).toBeNull();
  });

  it('compares refs by catalogKey and controlId', () => {
    expect(
      controlRefEquals(makeControlRef('gspp', 'GC.1.1'), makeControlRef('gspp', 'GC.1.1')),
    ).toBe(true);
    expect(
      controlRefEquals(makeControlRef('gspp', 'GC.1.1'), makeControlRef('wlan', 'GC.1.1')),
    ).toBe(false);
    expect(
      controlRefEquals(makeControlRef('gspp', 'GC.1.1'), makeControlRef('gspp', 'GC.1.2')),
    ).toBe(false);
  });

  it('formats refs as catalogKey:controlId', () => {
    expect(formatControlRef(makeControlRef('gspp', 'GC.1.1'))).toBe('gspp:GC.1.1');
  });
});
