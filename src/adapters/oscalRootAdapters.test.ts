import { describe, expect, it } from 'vitest';
import {
  catalogRootAdapter,
  componentDefinitionRootAdapter,
  getOscalRootAdapter,
  listAdaptedOscalRootTypes,
  parseOscalDocument,
} from './oscalRootAdapters';
import { ROOT_DISPATCH_DIAGNOSTIC_CODES } from './oscalRootDispatch';
import type { Catalog, OscalDocumentContext } from '@/domain/models';
import { OSCAL_ROOT_KEYS, VERSION_MATRIX_DIAGNOSTIC_CODES } from '@/domain/oscalVersionMatrix';
import { listOscalArtifacts } from '@/domain/sourceRegistry';

const context: OscalDocumentContext = {
  trustClass: 'class-1-verified-public',
  catalogKey: 'gspp',
};

function makeCatalogDocument() {
  return {
    catalog: {
      uuid: 'uuid-catalog',
      metadata: {
        title: 'Testkatalog',
        'last-modified': '2026-08-06T00:00:00Z',
        version: '1',
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
                  title: 'Control',
                  props: [{ name: 'alt-identifier', value: 'alt-1' }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('Adapter-Registrierung', () => {
  it('führt heute den Katalog- und den Component-Definition-Adapter', () => {
    expect(listAdaptedOscalRootTypes()).toEqual(['catalog', 'component-definition']);
    expect(getOscalRootAdapter('catalog')).toBe(catalogRootAdapter);
    expect(getOscalRootAdapter('component-definition')).toBe(componentDefinitionRootAdapter);
  });

  it('benennt für jeden registrierten Root-Typ einen Modul-Einstiegspunkt', () => {
    for (const rootType of listAdaptedOscalRootTypes()) {
      const adapter = getOscalRootAdapter(rootType);
      expect(adapter?.moduleEntryPoint).toMatch(/^src\/adapters\/.+\.ts$/);
    }
  });

  it('meldet für die sechs noch nicht adaptierten Root-Typen keinen Adapter', () => {
    const unadapted = OSCAL_ROOT_KEYS.filter(
      (rootKey) => !listAdaptedOscalRootTypes().includes(rootKey),
    );

    // Die Zahl steht bewusst ausgeschrieben: Ein neuer Modelladapter soll
    // diesen Test rot machen und bewusst nachgezogen werden.
    expect(unadapted).toHaveLength(6);
    for (const rootKey of unadapted) {
      expect(getOscalRootAdapter(rootKey)).toBeNull();
    }
  });
});

describe('parseOscalDocument', () => {
  it('leitet über den registrierten Adapter ab', () => {
    const result = parseOscalDocument(makeCatalogDocument(), context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dispatch.rootType).toBe('catalog');
    expect((result.view as Catalog).catalogKey).toBe('gspp');
    expect((result.view as Catalog).totalControls).toBe(1);
  });

  it('unterscheidet „bekannt, aber nicht unterstützt" von „unbekannt"', () => {
    const known = parseOscalDocument(
      {
        profile: {
          uuid: 'uuid-profile',
          metadata: {
            title: 'Profil',
            'last-modified': '2026-08-06T00:00:00Z',
            version: '1',
            'oscal-version': '1.1.3',
          },
        },
      },
      { trustClass: 'class-1-verified-public' },
    );
    const unknown = parseOscalDocument(
      { 'geheimes-modell': { metadata: { 'oscal-version': '1.1.3' } } },
      { trustClass: 'class-1-verified-public' },
    );

    expect(known.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (known.ok || unknown.ok) return;

    expect(known.diagnostic.code).toBe(ROOT_DISPATCH_DIAGNOSTIC_CODES.ROOT_TYPE_UNSUPPORTED);
    expect(known.diagnostic.artifact.rootType).toBe('profile');
    expect(known.diagnostic.artifact.oscalVersion).toBe('1.1.3');
    expect(known.diagnostic.path).toBe('/profile');

    expect(unknown.diagnostic.code).toBe(VERSION_MATRIX_DIAGNOSTIC_CODES.ROOT_TYPE_UNKNOWN);
    expect(unknown.diagnostic.code).not.toBe(known.diagnostic.code);
  });

  it('löst die Katalogidentität aus dem Quellregister auf, wenn der Kontext sie nicht trägt', () => {
    const wlan = listOscalArtifacts().find((entry) => entry.catalogKey === 'wlan');
    expect(wlan).toBeDefined();
    if (!wlan) return;

    const result = parseOscalDocument(makeCatalogDocument(), {
      trustClass: 'class-1-verified-public',
      upstreamPath: wlan.upstreamPath,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Ohne diese Auflösung fiele die Ableitung still auf "gspp" zurück und der
    // WLAN-Katalog wäre unter der falschen Identität adressierbar.
    expect((result.view as Catalog).catalogKey).toBe('wlan');
  });

  it('weist eine Identität ab, die der Registry-Erwartung widerspricht', () => {
    const wlan = listOscalArtifacts().find((entry) => entry.catalogKey === 'wlan');
    expect(wlan).toBeDefined();
    if (!wlan) return;

    // Sonst gewönne der Kontext, und das registrierte WLAN-Artefakt wäre unter
    // der Katalogidentität "gspp" adressierbar.
    expect(() =>
      parseOscalDocument(makeCatalogDocument(), {
        trustClass: 'class-1-verified-public',
        upstreamPath: wlan.upstreamPath,
        catalogKey: 'gspp',
      }),
    ).toThrow('Conflicting catalog identity');
  });

  it('akzeptiert eine Identität, die der Registry-Erwartung entspricht', () => {
    const wlan = listOscalArtifacts().find((entry) => entry.catalogKey === 'wlan');
    expect(wlan).toBeDefined();
    if (!wlan) return;

    const result = parseOscalDocument(makeCatalogDocument(), {
      trustClass: 'class-1-verified-public',
      upstreamPath: wlan.upstreamPath,
      catalogKey: 'wlan',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && (result.view as Catalog).catalogKey).toBe('wlan');
  });

  it('bricht ab, statt eine Katalogidentität zu erfinden', () => {
    expect(() =>
      parseOscalDocument(makeCatalogDocument(), {
        trustClass: 'class-1-verified-public',
      }),
    ).toThrow('Missing catalog identity');

    expect(() =>
      parseOscalDocument(makeCatalogDocument(), {
        trustClass: 'class-1-verified-public',
        upstreamPath: 'control_layer/Nicht/Registriert.json',
      }),
    ).toThrow('Missing catalog identity');
  });

  it('reicht eine Dispatch-Diagnose unverändert nach außen', () => {
    const result = parseOscalDocument([], context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe(ROOT_DISPATCH_DIAGNOSTIC_CODES.DOCUMENT_NOT_OBJECT);
  });
});
