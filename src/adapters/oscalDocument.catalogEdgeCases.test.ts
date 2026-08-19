// =============================================================================
// Kantenfälle des Catalog-Modells (GSPP-242)
//
// Alle hier geprüften Strukturen sind laut OSCAL 1.1.3 schema-valide, kommen im
// ausgelieferten Bestand aber nicht vor. Sie brauchen deshalb synthetische
// Fixtures — der reale Lieferkettenkatalog deckt sie nicht ab und darf es auch
// nicht müssen (`src/adapters/oscalDocument.lieferkette.node.test.ts`).
//
// Maßgeblich ist das vendorierte, SHA-256-gepinnte 1.1.3-Schema: `catalog`
// verlangt nur `uuid` und `metadata`, `group` nur `title`, `part` nur `name`,
// `property` nur `name` und `value`, `link` nur `href`.
// =============================================================================

import { describe, expect, it, vi } from 'vitest';
import { parseCatalogDocument } from './oscalDocument';
import { projectResolvedControlLinks } from '@/domain/catalogReferenceProjection';
import {
  referenceDocumentFromCatalog,
  resolveCatalogControlReferences,
} from '@/domain/referenceResolution';
import { buildControlUrlForControl, buildGroupUrl } from '@/app/routes';
import type { Catalog } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';

const CATALOG_KEY = 'lieferkette' as const satisfies CatalogKey;

const context = {
  catalogKey: CATALOG_KEY,
  trustClass: 'class-1-verified-public' as const,
};

function makeCatalog(body: Record<string, unknown>) {
  return {
    catalog: {
      uuid: '3f2b1a90-1111-4111-8111-111111111111',
      metadata: {
        title: 'Kantenfall-Katalog',
        'last-modified': '2026-08-19T00:00:00Z',
        version: '2026-08-13T04:11:22.667900+00:00',
        'oscal-version': '1.1.3',
      },
      ...body,
    },
  };
}

function makeControl(id: string, altIdentifier: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Titel von ${id}`,
    props: [{ name: 'alt-identifier', value: altIdentifier }],
    ...extra,
  };
}

function parse(body: Record<string, unknown>) {
  return parseCatalogDocument(makeCatalog(body), context);
}

/* ------------------------------------------------------------------ */
/*  Leerer Katalog                                                     */
/* ------------------------------------------------------------------ */

describe('Katalog ohne groups und ohne controls', () => {
  it('erzeugt einen Empty State statt eines Fehlers', () => {
    const document = parse({});

    expect(document.view.practices).toEqual([]);
    expect(document.view.controls).toEqual([]);
    expect(document.view.totalControls).toBe(0);
    expect(document.view.controlsById.size).toBe(0);
    expect(document.view.backMatter).toEqual([]);
    // Der Katalog bleibt identifizierbar — leer ist nicht kaputt.
    expect(document.view.catalogKey).toBe(CATALOG_KEY);
    expect(document.view.metadata.title).toBe('Kantenfall-Katalog');
  });

  it('bleibt bei leeren groups und controls ebenso fehlerfrei', () => {
    const document = parse({ groups: [], controls: [] });

    expect(document.view.totalControls).toBe(0);
    expect(document.view.practices).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Gruppe ohne id                                                     */
/* ------------------------------------------------------------------ */

describe('Gruppe ohne id', () => {
  const body = {
    groups: [
      {
        // `id` fehlt: laut 1.1.3 zulässig, `title` ist die einzige Pflicht.
        title: 'Bereich ohne Kennung',
        groups: [
          {
            title: 'Thema ohne Kennung',
            controls: [makeControl('X.1', 'aaaaaaaa-1111-4111-8111-111111111111')],
          },
        ],
      },
      {
        id: 'MIT',
        title: 'Bereich mit Kennung',
        groups: [
          {
            id: 'MIT.1',
            title: 'Thema mit Kennung',
            controls: [makeControl('MIT.1.1', 'bbbbbbbb-1111-4111-8111-111111111111')],
          },
        ],
      },
    ],
  };

  it('stellt Gruppe und Untergruppe vollständig dar', () => {
    const { view } = parse(body);
    const [ohneId, mitId] = view.practices;

    expect(view.practices).toHaveLength(2);
    expect(ohneId.title).toBe('Bereich ohne Kennung');
    expect(ohneId.topics).toHaveLength(1);
    expect(ohneId.topics[0].title).toBe('Thema ohne Kennung');
    expect(mitId.id).toBe('MIT');
  });

  it('erfindet keinen Ersatzbezeichner und fällt beim Label auf den Titel zurück', () => {
    const { view } = parse(body);
    const [ohneId] = view.practices;

    expect(ohneId.id).toBeUndefined();
    expect(ohneId.topics[0].id).toBeUndefined();
    expect(ohneId.label).toBe('Bereich ohne Kennung');
    expect(ohneId.topics[0].label).toBe('Thema ohne Kennung');
  });

  it('verliert die Controls der Gruppe nicht', () => {
    const { view } = parse(body);

    expect(view.totalControls).toBe(2);
    expect(view.controlsById.has('X.1')).toBe(true);
    // Das Control bleibt über seinen kanonischen alt-identifier adressierbar,
    // obwohl seine Gruppe es nicht ist.
    expect(buildControlUrlForControl(CATALOG_KEY, view.controlsById.get('X.1')!)).toBe(
      '/katalog/lieferkette/kontrolle/aaaaaaaa-1111-4111-8111-111111111111',
    );
  });

  it('erzeugt für die Gruppe ohne id kein Routing- und kein Ankerziel', () => {
    const { view } = parse(body);
    const [ohneId, mitId] = view.practices;
    const controlOhneGruppe = view.controlsById.get('X.1')!;

    expect(ohneId.id).toBeUndefined();
    expect(ohneId.topics[0].id).toBeUndefined();
    expect(controlOhneGruppe.groupId).toBeUndefined();
    expect(controlOhneGruppe.practiceId).toBeUndefined();
    // Routing setzt die Gruppen-`id` nicht voraus: Es gibt schlicht keine Route
    // dorthin — der Builder wird für diese Gruppe nie aufgerufen.
    expect(mitId.id).toBeDefined();
    expect(buildGroupUrl(CATALOG_KEY, mitId.id!)).toBe('/katalog/lieferkette/MIT');
    // Und er bleibt fail-closed, statt eine leere Route zu bauen.
    expect(() => buildGroupUrl(CATALOG_KEY, '')).toThrow('groupId must not be empty');
  });
});

/* ------------------------------------------------------------------ */
/*  part ohne id                                                       */
/* ------------------------------------------------------------------ */

describe('part ohne id', () => {
  it('verarbeitet den Inhalt, erzeugt aber kein Anker- oder Deep-Link-Ziel', () => {
    const { view } = parse({
      groups: [
        {
          id: 'G',
          title: 'Gruppe',
          controls: [
            makeControl('G.1', 'cccccccc-1111-4111-8111-111111111111', {
              parts: [
                { name: 'statement', prose: 'Anforderung ohne part-id' },
                { name: 'guidance', id: 'G.1_gdn', prose: 'Hinweis mit part-id' },
              ],
            }),
          ],
        },
      ],
    });
    const control = view.controlsById.get('G.1')!;

    // Der Inhalt geht nicht verloren.
    expect(control.statement).toBe('Anforderung ohne part-id');
    expect(control.guidance).toBe('Hinweis mit part-id');

    // Parts werden ausschließlich über `name` gefunden. Keine part-`id` — auch
    // nicht die vorhandene — wird zu einem Anker oder Navigationsziel.
    expect(JSON.stringify(control)).not.toContain('G.1_gdn');
  });
});

/* ------------------------------------------------------------------ */
/*  prop.ns                                                            */
/* ------------------------------------------------------------------ */

describe('prop.ns', () => {
  const NS = 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_level.csv';

  it('übernimmt den vorgefundenen ns unverändert und vergibt bei Abwesenheit keinen', () => {
    const { view } = parse({
      groups: [
        {
          id: 'G',
          title: 'Gruppe',
          controls: [
            makeControl('G.1', 'dddddddd-1111-4111-8111-111111111111', {
              props: [
                { name: 'alt-identifier', value: 'dddddddd-1111-4111-8111-111111111111' },
                { name: 'sec_level', value: 'normal-SdT', ns: NS },
                { name: 'tags', value: 'Ohne Namensraum' },
              ],
            }),
          ],
        },
      ],
    });
    const control = view.controlsById.get('G.1')!;

    expect(control.securityLevelProp?.ns).toBe(NS);
    // Kein projekteigener Namensraum als Ersatz für den fehlenden.
    expect(control.tagsProp?.ns).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Fragment-Auflösung ohne back-matter                                */
/* ------------------------------------------------------------------ */

describe('Fragment-Links ohne back-matter', () => {
  function resolveLinks(body: Record<string, unknown>) {
    const document = parse(body);
    return resolveCatalogControlReferences({
      document: referenceDocumentFromCatalog(document),
      catalogsByKey: new Map<CatalogKey, Catalog>([[CATALOG_KEY, document.view]]),
    });
  }

  const withTargets = {
    groups: [
      {
        id: 'G',
        title: 'Gruppe',
        controls: [
          makeControl('G.1', 'eeeeeeee-1111-4111-8111-111111111111', {
            links: [
              { href: '#G.2', rel: 'related' },
              { href: '#G.3', rel: 'required' },
            ],
          }),
          makeControl('G.2', 'ffffffff-1111-4111-8111-111111111111'),
          makeControl('G.3', 'aaaaaaaa-2222-4222-8222-222222222222'),
        ],
      },
    ],
  };

  it('löst gegen control/@id auf, obwohl es kein back-matter gibt', () => {
    const resolved = [...resolveLinks(withTargets).values()].flat();

    expect(resolved).toHaveLength(2);
    expect(resolved.map((reference) => reference.kind)).toEqual(['control', 'control']);
  });

  it('leitet die Zielart aus dem Fragment ab, nicht aus dem rel-Wert', () => {
    const resolved = [...resolveLinks(withTargets).values()].flat();
    const [related, required] = resolved;

    // Beide rel-Werte sind Nicht-OSCAL-Werte aus einem offenen Vokabular; sie
    // bleiben erhalten und steuern die Klassifikation nicht.
    expect(related).toMatchObject({ kind: 'control', rel: 'related' });
    expect(required).toMatchObject({ kind: 'control', rel: 'required' });
  });

  it('führt ein Fragment ohne Ziel fail-closed als unauflösbar', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network access is forbidden');
    });
    vi.stubGlobal('fetch', fetchSpy);

    try {
      const resolved = [
        ...resolveLinks({
          groups: [
            {
              id: 'G',
              title: 'Gruppe',
              controls: [
                makeControl('G.1', 'bbbbbbbb-2222-4222-8222-222222222222', {
                  // Trifft weder eine back-matter-uuid noch eine control/@id.
                  links: [{ href: '#nicht-vorhanden', rel: 'related' }],
                }),
              ],
            },
          ],
        }).values(),
      ].flat();

      expect(resolved).toHaveLength(1);
      expect(resolved[0]).toMatchObject({
        kind: 'unresolved',
        reason: 'fragment-not-found',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('erzeugt aus dem unauflösbaren Fragment kein Navigationsziel im Katalog-View', () => {
    const document = projectResolvedControlLinks(
      parse({
        groups: [
          {
            id: 'G',
            title: 'Gruppe',
            controls: [
              makeControl('G.1', 'cccccccc-2222-4222-8222-222222222222', {
                links: [{ href: '#nicht-vorhanden', rel: 'related' }],
              }),
            ],
          },
        ],
      }),
    );

    expect(document.view.controlsById.get('G.1')!.links).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Control ohne label-Prop                                            */
/* ------------------------------------------------------------------ */

describe('Control ohne label-Prop', () => {
  it('stellt den Titel dar und meldet keinen Datenfehler', () => {
    const { view } = parse({
      groups: [
        {
          id: 'G',
          title: 'Gruppe',
          controls: [makeControl('G.1', 'dddddddd-2222-4222-8222-222222222222')],
        },
      ],
    });
    const control = view.controlsById.get('G.1')!;

    expect(control.title).toBe('Titel von G.1');
    // Das Domänenmodell führt für Controls überhaupt kein `label`; die Anzeige
    // stützt sich ausschließlich auf `control.title`.
    expect('label' in control).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Versions-Allowlist                                                 */
/* ------------------------------------------------------------------ */

describe('oscal-version', () => {
  it('weist eine unbekannte Version fail-closed ab', () => {
    const source = makeCatalog({}) as { catalog: { metadata: Record<string, unknown> } };
    source.catalog.metadata['oscal-version'] = '9.9.9';

    expect(() => parseCatalogDocument(source, context)).toThrow(
      'OSCAL_ROOT_VERSION_UNSUPPORTED',
    );
  });

  it('nimmt die deklarierte Version 1.1.3 an', () => {
    expect(parse({}).view.metadata.oscalVersion).toBe('1.1.3');
  });
});
