// =============================================================================
// Modelladapter `profile` — Testvertrag (GSPP-240)
//
// Der verbindliche Korpus ist fixture-basiert: Die drei realen BSI-Profile
// liegen nicht im Repository, weil `preview`-Einträge nie materialisiert
// werden. Feste Inhaltszahlen stehen deshalb ausschließlich hier und in den
// Fixtures — nie in einer Assertion gegen den Realkorpus
// (`oscalProfileDocument.node.test.ts`).
// =============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deriveProfile,
  PROFILE_ADAPTER_DIAGNOSTIC_CODES,
  PROFILE_ADAPTER_VALIDATOR,
  PROFILE_RESOLUTION_STATE,
  PROFILE_ROOT_TYPE,
} from './oscalProfileAdapter';
import { parseProfileDocument } from './oscalProfileDocument';
import type { ProfileDocument } from './oscalProfileDocument';
import {
  getOscalRootAdapter,
  listAdaptedOscalRootTypes,
  parseOscalDocument,
  profileRootAdapter,
} from './oscalRootAdapters';
import { OscalRootDispatchError } from './oscalRootDispatch';
import { parseCatalogDocument } from './oscalDocument';
import type { OscalDocumentContext } from '@/domain/models';
import {
  listRegisteredProfileArtifactKeys,
  makeAllProfileSources,
  makeMalformedProfile,
  makeProfileSource,
  makeProfileWithAllAddPositions,
  makeProfileWithBothSelections,
  makeProfileWithCustomMerge,
  makeProfileWithExternalImport,
  makeProfileWithFlatMerge,
  makeProfileWithMatchingSelectors,
  makeProfileWithRelativeRlink,
  makeProfileWithRepeatedAlters,
  makeProfileWithScalarCustomMerge,
  makeProfileWithScalarSections,
  makeProfileWithoutImportHref,
  makeProfileWithoutImports,
  makeProfileWithoutMergeStructure,
  makeProfileWithoutSelection,
  makeRichProfileSource,
  makeSyntheticProfile,
  PROFILE_ARTIFACT_SPECS,
  PROFILE_SOURCE_RLINKS,
  profileSpecFor,
  SYNTHETIC_RESOURCE_HREF,
} from '@/test/fixtures/profiles';
import { makeLosslessCatalogSource } from '@/test/fixtures/losslessCatalog';
import {
  arrayOrderSignature,
  containerIdentities,
  contentMultiset,
  deepFreeze,
  missingFromMultiset,
  sharedContainerPaths,
} from '@/test/oscalStructure';

const context: OscalDocumentContext = { trustClass: 'class-1-verified-public' };
const codes = PROFILE_ADAPTER_DIAGNOSTIC_CODES;

function parseArtifact(artifactKey: string): ProfileDocument {
  const specification = profileSpecFor(artifactKey);
  return parseProfileDocument(makeProfileSource(specification), {
    ...context,
    upstreamPath: specification.upstreamPath,
  });
}

function codesOf(document: ProfileDocument): readonly string[] {
  return document.view.diagnostics.map((diagnostic) => diagnostic.code);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/*  Registrierung                                                      */
/* ------------------------------------------------------------------ */

describe('Adapter-Registrierung', () => {
  it('führt profile als adaptierten Root-Typ', () => {
    expect(listAdaptedOscalRootTypes()).toContain(PROFILE_ROOT_TYPE);
    expect(getOscalRootAdapter(PROFILE_ROOT_TYPE)).toBe(profileRootAdapter);
    expect(profileRootAdapter.moduleEntryPoint).toBe('src/adapters/oscalProfileAdapter.ts');
  });

  it('deckt mit catalog und profile beide Control-Layer-Roots ab', () => {
    expect(listAdaptedOscalRootTypes()).toEqual(
      expect.arrayContaining(['catalog', PROFILE_ROOT_TYPE]),
    );
  });

  it('lässt den Katalogpfad unberührt', () => {
    // Der Katalogadapter darf durch die neue Registrierung nicht anders
    // arbeiten — der Erweiterungsvertrag verspricht genau das.
    const document = parseCatalogDocument(makeLosslessCatalogSource(), {
      catalogKey: 'gspp',
      trustClass: 'class-1-verified-public',
    });

    expect(document.view.totalControls).toBe(4);
  });

  it('leitet über den root-generischen Einstieg ab, statt OSCAL_ROOT_TYPE_UNSUPPORTED zu liefern', () => {
    const specification = profileSpecFor('profile-wlan');
    const result = parseOscalDocument(makeProfileSource(specification), {
      ...context,
      upstreamPath: specification.upstreamPath,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dispatch.rootType).toBe(PROFILE_ROOT_TYPE);
  });

  it('bildet genau die drei registrierten Profile ab', () => {
    expect(PROFILE_ARTIFACT_SPECS.map((entry) => entry.artifactKey).sort()).toEqual(
      listRegisteredProfileArtifactKeys(),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Imports und Selektionen                                            */
/* ------------------------------------------------------------------ */

describe('Imports', () => {
  it('erhält jeden Import des Bestands in Quellreihenfolge', () => {
    for (const specification of PROFILE_ARTIFACT_SPECS) {
      const { view } = parseArtifact(specification.artifactKey);

      expect(view.imports, specification.artifactKey).toHaveLength(
        specification.imports.length,
      );
      expect(
        view.imports.map((entry) => entry.selection.kind),
        specification.artifactKey,
      ).toEqual(specification.imports.map((entry) => entry.selection.kind));
    }
  });

  it('unterscheidet include-all von include-controls', () => {
    const { view } = parseArtifact('profile-gspp');

    expect(view.imports.map((entry) => entry.selection.kind)).toEqual([
      'include-all',
      'include-all',
      'include-controls',
    ]);

    const selection = view.imports[2]?.selection;
    expect(selection?.kind).toBe('include-controls');
    if (selection?.kind !== 'include-controls') return;
    expect(selection.includeControls).toHaveLength(1);
    expect(selection.includeControls[0]?.withIds).toHaveLength(4);
  });

  it('erhält with-child-controls in beiden Werten', () => {
    const { view } = parseArtifact('profile-wlan');
    const selection = view.imports[0]?.selection;

    expect(selection?.kind).toBe('include-controls');
    if (selection?.kind !== 'include-controls') return;
    expect(selection.includeControls.map((selector) => selector.withChildControls)).toEqual([
      'yes',
      'no',
    ]);
    expect(selection.includeControls.map((selector) => selector.withIds.length)).toEqual([
      42,
      3,
    ]);
  });

  it('erhält matching-Selektoren getrennt von with-ids', () => {
    const { view } = parseProfileDocument(makeProfileWithMatchingSelectors(), context);
    const selection = view.imports[0]?.selection;

    expect(selection?.kind).toBe('include-controls');
    if (selection?.kind !== 'include-controls') return;
    const selector = selection.includeControls[0];
    expect(selector?.withIds).toEqual(['GC.1.1']);
    expect(selector?.matching.map((matcher) => matcher.pattern)).toEqual([
      'GC.1.*',
      'GC.2.?',
    ]);
  });

  it('erhält exclude-controls, auch wenn der Bestand sie nicht führt', () => {
    const { view } = parseProfileDocument(makeProfileWithMatchingSelectors(), context);

    expect(view.imports[0]?.excludeControls).toHaveLength(1);
    expect(view.imports[0]?.excludeControls[0]?.matching[0]?.pattern).toBe('GC.9.*');

    // Gegenprobe am Bestand: dort gibt es keine.
    for (const specification of PROFILE_ARTIFACT_SPECS) {
      const document = parseArtifact(specification.artifactKey);
      for (const entry of document.view.imports) {
        expect(entry.excludeControls, specification.artifactKey).toEqual([]);
      }
    }
  });

  it('weist einen Import mit beiden Selektionsformen als mehrdeutig aus', () => {
    const document = parseProfileDocument(makeProfileWithBothSelections(), context);
    const selection = document.view.imports[0]?.selection;

    expect(selection?.kind).toBe('ambiguous');
    if (selection?.kind !== 'ambiguous') return;
    // Verlustfrei trotz Befund: Die Selektoren bleiben in der Projektion.
    expect(selection.includeControls[0]?.withIds).toEqual(['GC.1.1']);
    expect(selection.diagnostic.code).toBe(codes.SELECTION_AMBIGUOUS);
    expect(codesOf(document)).toContain(codes.SELECTION_AMBIGUOUS);
  });

  it('weist einen Import ohne jede Selektionsform aus', () => {
    const document = parseProfileDocument(makeProfileWithoutSelection(), context);
    const selection = document.view.imports[0]?.selection;

    expect(selection?.kind).toBe('none');
    if (selection?.kind !== 'none') return;
    expect(selection.diagnostic.code).toBe(codes.SELECTION_MISSING);
  });

  it('erhält einen Import ohne href und diagnostiziert ihn, statt still zu scheitern', () => {
    const document = parseProfileDocument(makeProfileWithoutImportHref(), context);

    expect(document.view.imports).toHaveLength(1);
    expect(document.view.imports[0]?.href).toBeUndefined();
    // Nichts wird geraten: ohne href gibt es keine Referenzklassifikation.
    expect(document.view.imports[0]?.reference).toBeNull();
    expect(document.view.imports[0]?.selection.kind).toBe('include-all');
    expect(codesOf(document)).toContain(codes.IMPORT_HREF_MISSING);
  });

  it('diagnostiziert ein Profil ganz ohne imports', () => {
    const document = parseProfileDocument(makeProfileWithoutImports(), context);

    expect(document.view.imports).toEqual([]);
    expect(codesOf(document)).toContain(codes.IMPORTS_MISSING);
  });

  it.each([
    ['leeres Array', []],
    ['null', null],
    ['Objekt statt Array', { href: '#irgendwas' }],
  ])('diagnostiziert imports als %s, statt still durchzulaufen', (_name, imports) => {
    const document = parseProfileDocument(
      makeSyntheticProfile('1.1.3', { imports }),
      context,
    );

    expect(document.view.imports).toEqual([]);
    expect(codesOf(document)).toContain(codes.IMPORTS_MISSING);
  });
});

/* ------------------------------------------------------------------ */
/*  Referenzen                                                         */
/* ------------------------------------------------------------------ */

describe('Referenzen', () => {
  it('löst jedes #uuid-Import-href gegen back-matter desselben Dokuments auf', () => {
    for (const specification of PROFILE_ARTIFACT_SPECS) {
      const { view } = parseArtifact(specification.artifactKey);

      for (const entry of view.imports) {
        expect(entry.reference?.kind, `${specification.artifactKey} ${entry.path}`).toBe(
          'resource',
        );
      }
    }
  });

  it('klassifiziert einen relativen rlink als relative, ohne ihn aufzulösen', () => {
    const { view } = parseArtifact('profile-wlan');
    const reference = view.imports[0]?.reference;

    expect(reference?.kind).toBe('resource');
    if (reference?.kind !== 'resource') return;
    const rlink = reference.resource.rlinks[0];
    expect(rlink?.href).toBe(PROFILE_SOURCE_RLINKS.wlanKernelG0);
    expect(rlink?.target.kind).toBe('unresolved');
    expect(rlink?.target.reason).toBe('relative');
  });

  it('behandelt ../-Segmente, einen einfachen Dateinamen und ../../etc/passwd gleich', () => {
    // GSPP-286: Clientseitig gibt es keinen Verzeichniskontext. Eine relative
    // Referenz wird nie aufgelöst, nicht normalisiert und **nicht** als
    // Traversal-Angriff etikettiert.
    const relativeHrefs = [
      PROFILE_SOURCE_RLINKS.gsppMethodik,
      'foo.json',
      '../../etc/passwd',
    ];
    const results = relativeHrefs.map((href) => {
      const { view } = parseProfileDocument(makeProfileWithRelativeRlink(href), context);
      const reference = view.imports[0]?.reference;
      if (reference?.kind !== 'resource') throw new Error('Ressource erwartet');
      const rlink = reference.resource.rlinks[0];
      return { href: rlink?.href, kind: rlink?.target.kind, reason: rlink?.target.reason };
    });

    expect(results.map((entry) => entry.kind)).toEqual([
      'unresolved',
      'unresolved',
      'unresolved',
    ]);
    expect(results.map((entry) => entry.reason)).toEqual(['relative', 'relative', 'relative']);
    // Unverändert: keine Normalisierung der `../`-Segmente.
    expect(results.map((entry) => entry.href)).toEqual(relativeHrefs);
  });

  it('klassifiziert einen externen https-Import als external', () => {
    const { view } = parseProfileDocument(makeProfileWithExternalImport(), context);

    expect(view.imports[0]?.reference?.kind).toBe('external');
  });

  it('nennt in keiner Adapterdiagnose einen href-Wert', () => {
    const document = parseProfileDocument(makeProfileWithoutImportHref(), context);
    const serialized = JSON.stringify(document.view.diagnostics);

    expect(serialized).not.toContain(SYNTHETIC_RESOURCE_HREF);
    expect(serialized).not.toContain('catalogs/');
    for (const diagnostic of document.view.diagnostics) {
      expect(diagnostic.validator).toEqual(PROFILE_ADAPTER_VALIDATOR);
      expect(diagnostic.artifact.rootType).toBe(PROFILE_ROOT_TYPE);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Merge                                                              */
/* ------------------------------------------------------------------ */

describe('Merge', () => {
  it('bildet as-is und custom am Bestand ab', () => {
    expect(parseArtifact('profile-gspp').view.merge?.structure.kind).toBe('as-is');
    expect(parseArtifact('profile-lieferkette').view.merge?.structure.kind).toBe('as-is');
    expect(parseArtifact('profile-wlan').view.merge?.structure.kind).toBe('custom');
  });

  it('trägt den Booleschen Wert von as-is mit', () => {
    const structure = parseArtifact('profile-gspp').view.merge?.structure;

    expect(structure?.kind).toBe('as-is');
    if (structure?.kind !== 'as-is') return;
    expect(structure.asIs).toBe(true);
  });

  it('bildet flat und combine über ein synthetisches Fixture ab', () => {
    const { view } = parseProfileDocument(makeProfileWithFlatMerge(), context);

    expect(view.merge?.structure.kind).toBe('flat');
    expect(view.merge?.combine?.method).toBe('merge');
  });

  it('erhält custom-Gruppen, verschachtelte Gruppen und insert-controls.order', () => {
    const { view } = parseProfileDocument(makeProfileWithCustomMerge('ascending'), context);
    const structure = view.merge?.structure;

    expect(structure?.kind).toBe('custom');
    if (structure?.kind !== 'custom') return;
    expect(structure.custom.groups[0]?.id).toBe('gruppe-a');
    const nested = structure.custom.groups[0]?.groups[0];
    expect(nested?.title).toBe('Untergruppe');
    expect(nested?.insertControls[0]?.order).toBe('ascending');
    expect(nested?.insertControls[0]?.selection.kind).toBe('include-controls');
    expect(structure.custom.insertControls[0]?.order).toBe('keep');
    expect(structure.custom.insertControls[0]?.selection.kind).toBe('include-all');
  });

  it('führt alle drei Ordnungen von insert-controls', () => {
    for (const order of ['keep', 'ascending', 'descending'] as const) {
      const { view } = parseProfileDocument(makeProfileWithCustomMerge(order), context);
      const structure = view.merge?.structure;
      if (structure?.kind !== 'custom') throw new Error('custom erwartet');

      expect(structure.custom.groups[0]?.groups[0]?.insertControls[0]?.order).toBe(order);
    }
  });

  it('weist mehr als eine Strukturdirektive als mehrdeutig aus', () => {
    const document = parseProfileDocument(
      { profile: {
        uuid: '11111111-1111-4111-8111-111111111111',
        metadata: {
          title: 'Mehrdeutig',
          'last-modified': '2026-08-17T00:00:00Z',
          version: '1',
          'oscal-version': '1.1.3',
        },
        imports: [{ href: 'https://example.invalid/basis.json', 'include-all': {} }],
        merge: { flat: {}, 'as-is': true },
      } },
      context,
    );
    const structure = document.view.merge?.structure;

    expect(structure?.kind).toBe('ambiguous');
    if (structure?.kind !== 'ambiguous') return;
    expect(structure.declared).toEqual(['flat', 'as-is']);
    expect(codesOf(document)).toContain(codes.MERGE_STRUCTURE_AMBIGUOUS);
  });

  it('erhält die custom-Gruppierung auch bei mehrdeutigem merge', () => {
    const document = parseProfileDocument(
      makeSyntheticProfile('1.1.3', {
        merge: {
          'as-is': true,
          custom: { groups: [{ id: 'gruppe', title: 'Gruppe' }] },
        },
      }),
      context,
    );
    const structure = document.view.merge?.structure;

    expect(structure?.kind).toBe('ambiguous');
    if (structure?.kind !== 'ambiguous') return;
    expect(structure.declared).toEqual(['as-is', 'custom']);
    // Verlustfrei trotz Befund: Die Gruppierung bleibt in der Projektion.
    expect(structure.custom?.groups[0]?.title).toBe('Gruppe');
  });

  it('markiert merge ausdrücklich als nicht aufgelöst', () => {
    const { view } = parseArtifact('profile-wlan');

    expect(view.merge?.resolution).toBe(PROFILE_RESOLUTION_STATE);
    expect(view.merge?.resolution.status).toBe('not-resolved');
  });

  it('liefert null, wenn das Dokument kein merge trägt', () => {
    const { view } = parseProfileDocument(makeProfileWithoutSelection(), context);

    expect(view.merge).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Modify                                                             */
/* ------------------------------------------------------------------ */

describe('Modify', () => {
  it('erhält alle 290 alter-Einträge des WLAN-Profils über 58 control-id', () => {
    const specification = profileSpecFor('profile-wlan');
    const { view } = parseArtifact('profile-wlan');

    expect(view.modify?.alters).toHaveLength(
      specification.alterControlIds * specification.altersPerControlId,
    );
    expect(view.modify?.altersByControlId.size).toBe(specification.alterControlIds);
  });

  it('verwirft mehrfache alter-Einträge auf derselben control-id weder noch überschreibt sie', () => {
    const { view } = parseProfileDocument(
      makeProfileWithRepeatedAlters('ASST.2.2', 5),
      context,
    );
    const grouped = view.modify?.altersByControlId.get('ASST.2.2');

    expect(view.modify?.alters).toHaveLength(5);
    expect(grouped).toHaveLength(5);
    // Reihenfolge und kombinierte Wirkung bleiben erhalten: fünf verschiedene
    // Zusätze, nicht einer.
    expect(grouped?.map((alter) => alter.adds[0]?.props[0]?.value)).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(grouped?.map((alter) => alter.path)).toEqual([
      '/profile/modify/alters/0',
      '/profile/modify/alters/1',
      '/profile/modify/alters/2',
      '/profile/modify/alters/3',
      '/profile/modify/alters/4',
    ]);
  });

  it('bildet alle vier Positionsangaben ab', () => {
    const { view } = parseProfileDocument(makeProfileWithAllAddPositions(), context);
    const alter = view.modify?.alters[0];

    expect(alter?.adds.map((addition) => addition.position)).toEqual([
      'before',
      'after',
      'starting',
      'ending',
      // Ein `adds` ohne `position` — im Bestand belegt.
      undefined,
    ]);
  });

  it('erhält removes mit by-name', () => {
    const { view } = parseProfileDocument(makeProfileWithAllAddPositions(), context);
    const removes = view.modify?.alters[0]?.removes;

    expect(removes?.[0]?.byName).toBe('veraltet');
    expect(removes?.[1]?.byClass).toBe('entwurf');
    expect(removes?.[1]?.byItemName).toBe('part');
  });

  it('erhält set-parameters', () => {
    const wlan = profileSpecFor('profile-wlan');
    const { view } = parseArtifact('profile-wlan');

    expect(view.modify?.setParameters).toHaveLength(wlan.setParameterCount);
    expect(parseArtifact('profile-gspp').view.modify?.setParameters).toHaveLength(
      profileSpecFor('profile-gspp').setParameterCount,
    );

    const synthetic = parseProfileDocument(makeProfileWithAllAddPositions(), context);
    expect(synthetic.view.modify?.setParameters[0]?.paramId).toBe('schluessellaenge');
    expect(synthetic.view.modify?.setParameters[0]?.values).toEqual(['256']);
    expect(synthetic.view.modify?.setParameters[0]?.label).toBe('Länge');
  });

  it('erhält verschachtelte parts in adds', () => {
    const { view } = parseProfileDocument(makeRichProfileSource(), context);
    const parts = view.modify?.alters[1]?.adds[0]?.parts;

    expect(parts?.[0]?.name).toBe('item');
    expect(parts?.[0]?.prose).toBe('Zweiter Zusatz.');
  });

  it('diagnostiziert ein alter ohne control-id, ohne es zu verwerfen', () => {
    const document = parseProfileDocument(
      { profile: {
        uuid: '11111111-1111-4111-8111-111111111111',
        metadata: {
          title: 'Ohne Ziel',
          'last-modified': '2026-08-17T00:00:00Z',
          version: '1',
          'oscal-version': '1.1.3',
        },
        imports: [{ href: 'https://example.invalid/basis.json', 'include-all': {} }],
        modify: { alters: [{ adds: [{ title: 'Zusatz' }] }] },
      } },
      context,
    );

    expect(document.view.modify?.alters).toHaveLength(1);
    expect(document.view.modify?.alters[0]?.controlId).toBeUndefined();
    expect(document.view.modify?.altersByControlId.size).toBe(0);
    expect(codesOf(document)).toContain(codes.ALTER_CONTROL_ID_MISSING);
  });

  it('markiert modify ausdrücklich als nicht aufgelöst', () => {
    const { view } = parseArtifact('profile-wlan');

    expect(view.modify?.resolution.status).toBe('not-resolved');
    expect(view.resolution.status).toBe('not-resolved');
    expect(view.resolution.reason).toBe('profile-resolution-out-of-scope');
  });

  it('kennt kein Feld, das ein aufgelöstes Control-Set behaupten würde', () => {
    const { view } = parseArtifact('profile-wlan');

    // Greppbares Gegenstück zur Zusage „keine Profile Resolution": Weder das
    // Dokument noch merge oder modify tragen ein Ergebnisfeld.
    expect(Object.keys(view).sort()).toEqual([
      'diagnostics',
      'imports',
      'merge',
      'metadata',
      'modify',
      'resolution',
      'uuid',
    ]);
  });
});

/* ------------------------------------------------------------------ */
/*  Identität und Provenienz                                           */
/* ------------------------------------------------------------------ */

describe('Identität und Provenienz', () => {
  it('führt uuid, version, last-modified und den Artefaktschlüssel', () => {
    for (const specification of PROFILE_ARTIFACT_SPECS) {
      const document = parseArtifact(specification.artifactKey);

      expect(document.view.uuid, specification.artifactKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(document.view.metadata.version).toBe('2026-08-17');
      expect(document.view.metadata.lastModified).toBe('2026-08-17T00:00:00Z');
      expect(document.view.metadata.oscalVersion).toBe(specification.oscalVersion);
      expect(document.artifactKey).toBe(specification.artifactKey);
      expect(document.oscalVersion).toBe(specification.oscalVersion);
    }
  });

  it('nennt keinen Artefaktschlüssel für einen nicht registrierten Upstream-Pfad', () => {
    const document = parseProfileDocument(makeProfileWithoutImportHref(), {
      ...context,
      upstreamPath: 'control_layer/Nicht/Registriert-profile.json',
    });

    // Diagnosen tragen nur Werte aus geschlossenen Mengen: Ein unbekannter
    // Pfad wird nicht als Schlüssel durchgereicht.
    expect(document.artifactKey).toBeNull();
    for (const diagnostic of document.view.diagnostics) {
      expect(diagnostic.artifact.key).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Fail-closed                                                        */
/* ------------------------------------------------------------------ */

describe('Fail-closed am Dokumenteinstieg', () => {
  it('weist einen fremden Root mit OSCAL_ROOT_TYPE_MISMATCH ab', () => {
    let caught: unknown;
    try {
      parseProfileDocument(makeLosslessCatalogSource(), context);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(OscalRootDispatchError);
    expect((caught as OscalRootDispatchError).diagnostic.code).toBe('OSCAL_ROOT_TYPE_MISMATCH');
  });

  it('weist zwei Root-Keys ab, ohne einen davon zu wählen', () => {
    const specification = profileSpecFor('profile-gspp');
    const source = makeProfileSource(specification) as Record<string, unknown>;
    source.catalog = { metadata: { 'oscal-version': '1.1.3' } };

    let caught: unknown;
    try {
      parseProfileDocument(source, context);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(OscalRootDispatchError);
    expect((caught as OscalRootDispatchError).diagnostic.code).toBe('OSCAL_ROOT_KEY_AMBIGUOUS');
  });

  it('diagnostiziert einen Root-Körper, der kein Objekt ist, statt zu werfen', () => {
    const view = deriveProfile('kein Objekt', context);

    expect(view.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      codes.STRUCTURE_UNEXPECTED,
    );
    expect(view.imports).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Strukturbefunde statt stiller Auslassung                           */
/* ------------------------------------------------------------------ */

describe('Knoten der falschen Form', () => {
  it('diagnostiziert jeden Formfehler, statt ihn zu `[]` zu machen', () => {
    const document = parseProfileDocument(makeMalformedProfile(), context);
    const paths = document.view.diagnostics
      .filter((diagnostic) => diagnostic.code === codes.STRUCTURE_UNEXPECTED)
      .map((diagnostic) => diagnostic.path);

    expect(paths).toEqual([
      // Nicht-Objekt in `imports`
      '/profile/imports/0',
      // Zahl in einer Stringliste
      '/profile/imports/1/include-controls/0/with-ids/1',
      // Einzelobjekt statt Array
      '/profile/imports/1/include-controls/0/matching',
      '/profile/imports/1/exclude-controls',
      // `as-is` ist weder Boolescher noch Objekt
      '/profile/merge/as-is',
      // `set-parameters`-Eintrag ohne `param-id`
      '/profile/modify/set-parameters/0',
      // `props` ohne `value`, `links` ohne `href`
      '/profile/modify/alters/0/adds/0/props/0',
      '/profile/modify/alters/0/adds/0/links/0',
    ]);
  });

  it('erhält den gültigen Teil eines fehlerhaften Dokuments', () => {
    const { view } = parseProfileDocument(makeMalformedProfile(), context);

    // Der Nicht-Objekt-Eintrag verschwindet aus der Projektion, der gültige
    // Import bleibt — und der Quellgraph trägt beide unverändert weiter.
    expect(view.imports).toHaveLength(1);
    const selection = view.imports[0]?.selection;
    expect(selection?.kind).toBe('include-controls');
    if (selection?.kind !== 'include-controls') return;
    expect(selection.includeControls[0]?.withIds).toEqual(['GC.1.1']);
    expect(view.modify?.alters).toHaveLength(1);
  });

  it('führt as-is ohne Booleschen Wert als undefined statt als false', () => {
    const structure = parseProfileDocument(makeMalformedProfile(), context).view.merge
      ?.structure;

    expect(structure?.kind).toBe('as-is');
    if (structure?.kind !== 'as-is') return;
    // `false` wäre eine Aussage, die im Dokument nicht steht.
    expect(structure.asIs).toBeUndefined();
  });

  it('weist ein merge ohne jede Strukturdirektive aus', () => {
    const document = parseProfileDocument(makeProfileWithoutMergeStructure(), context);

    expect(document.view.merge?.structure.kind).toBe('none');
    expect(document.view.merge?.combine?.method).toBe('keep');
    expect(codesOf(document)).toContain(codes.MERGE_STRUCTURE_MISSING);
  });

  it('diagnostiziert merge und modify als Skalar, statt sie zu deuten', () => {
    const document = parseProfileDocument(makeProfileWithScalarSections(), context);

    expect(document.view.merge).toBeNull();
    expect(document.view.modify).toBeNull();
    expect(
      document.view.diagnostics
        .filter((diagnostic) => diagnostic.code === codes.STRUCTURE_UNEXPECTED)
        .map((diagnostic) => diagnostic.path),
    ).toEqual(['/profile/merge', '/profile/modify']);
  });

  it('diagnostiziert eine custom-Gruppierung, die kein Objekt ist', () => {
    const document = parseProfileDocument(makeProfileWithScalarCustomMerge(), context);
    const structure = document.view.merge?.structure;

    expect(structure?.kind).toBe('custom');
    if (structure?.kind !== 'custom') return;
    expect(structure.custom).toEqual({ groups: [], insertControls: [] });
    expect(
      document.view.diagnostics.map((diagnostic) => diagnostic.path),
    ).toContain('/profile/merge/custom');
  });

  it('diagnostiziert ein combine, das kein Objekt ist, und hält es sichtbar', () => {
    const document = parseProfileDocument(
      makeSyntheticProfile('1.1.3', { merge: { flat: {}, combine: 'zusammenfuehren' } }),
      context,
    );

    expect(document.view.merge?.structure.kind).toBe('flat');
    // Der Knoten war da; das muss der Projektion anzusehen sein.
    expect(document.view.merge?.combine).toEqual({});
    expect(
      document.view.diagnostics.map((diagnostic) => diagnostic.path),
    ).toContain('/profile/merge/combine');
  });

  it('erhält params in Gruppen und in adds', () => {
    const custom = parseProfileDocument(makeProfileWithCustomMerge(), context).view.merge
      ?.structure;
    expect(custom?.kind).toBe('custom');
    if (custom?.kind !== 'custom') return;
    expect(custom.custom.groups[0]?.params[0]?.id).toBe('gruppen-parameter');
    expect(custom.custom.groups[0]?.params[0]?.values).toEqual(['A']);

    const { view } = parseProfileDocument(makeProfileWithAllAddPositions(), context);
    const addition = view.modify?.alters[0]?.adds[2];
    expect(addition?.params[0]?.id).toBe('zusatz-parameter');
    expect(addition?.params[0]?.values).toEqual(['1', '2']);
    expect(addition?.links[0]?.rel).toBe('reference');
  });
});

/* ------------------------------------------------------------------ */
/*  No-op-Verlustfreiheit                                              */
/* ------------------------------------------------------------------ */

describe('No-op-Verlustfreiheit', () => {
  const probes = [
    ['reichhaltiges Profil', makeRichProfileSource],
    ['matching-Selektoren', () => makeProfileWithMatchingSelectors()],
    ['flat-Merge mit combine', () => makeProfileWithFlatMerge()],
    ['alle Positionsangaben', () => makeProfileWithAllAddPositions()],
    ...PROFILE_ARTIFACT_SPECS.map(
      (specification) =>
        [specification.artifactKey, () => makeProfileSource(specification)] as const,
    ),
  ] as const;

  it.each(probes)('%s bleibt referenzidentisch und zeichengleich', (_name, makeSource) => {
    const source = makeSource();
    const serialized = JSON.stringify(source);

    const document = parseProfileDocument(source, context);

    expect(document.source).toBe(source);
    expect(JSON.stringify(document.source)).toBe(serialized);
  });

  it.each(probes)('%s verliert nach der Inhalts-Multiset-Regel kein Element', (_name, makeSource) => {
    const source = makeSource();
    const expected = contentMultiset(source);
    const actual = contentMultiset(parseProfileDocument(source, context).source);

    expect(missingFromMultiset(expected, actual)).toEqual([]);
    expect(missingFromMultiset(actual, expected)).toEqual([]);
  });

  it.each(probes)('%s behält jede Array-Reihenfolge', (_name, makeSource) => {
    const source = makeSource();
    const expected = arrayOrderSignature(source);

    expect(arrayOrderSignature(parseProfileDocument(source, context).source)).toEqual(expected);
  });

  it('parst einen tiefgefrorenen Quellgraphen ohne Schreibzugriff', () => {
    const source = deepFreeze(makeRichProfileSource());

    expect(() => parseProfileDocument(source, context)).not.toThrow();
  });

  it('teilt keinen Container zwischen view und Quellgraph', () => {
    const source = makeRichProfileSource();

    const document = parseProfileDocument(source, context);

    expect(sharedContainerPaths(document.view, containerIdentities(source))).toEqual([]);
  });

  it('erhält Felder, die die Projektion nicht kennt', () => {
    const source = makeRichProfileSource();

    const document = parseProfileDocument(source, context);
    const body = (document.source as Record<string, Record<string, unknown>>).profile!;
    const metadata = body.metadata as Record<string, unknown>;

    expect(metadata['x-bsi-erweiterung']).toEqual({ hinweis: 'Unbekanntes Feld.' });
    // Das leere Objekt in einer custom-Gruppe ist ebenfalls noch da.
    const merge = body.merge as Record<string, Record<string, Record<string, unknown>[]>>;
    expect(merge.custom!.groups![0]!['x-bsi-leeres-objekt']).toEqual({});
  });
});

/* ------------------------------------------------------------------ */
/*  Netzwerkorakel                                                     */
/* ------------------------------------------------------------------ */

describe('Kein Netzzugriff auf irgendeinem Parse- oder Auflösungspfad', () => {
  it('parst den gesamten Korpus, während fetch, XMLHttpRequest und sendBeacon werfen', () => {
    const fetch = vi.fn(() => {
      throw new Error('network access is forbidden');
    });
    const XMLHttpRequest = vi.fn(() => {
      throw new Error('network access is forbidden');
    });
    const sendBeacon = vi.fn(() => {
      throw new Error('network access is forbidden');
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('XMLHttpRequest', XMLHttpRequest);
    vi.stubGlobal('navigator', { sendBeacon });

    const documents = [
      ...makeAllProfileSources().map(({ specification, source }) =>
        parseProfileDocument(source, { ...context, upstreamPath: specification.upstreamPath }),
      ),
      parseProfileDocument(makeRichProfileSource(), context),
      parseProfileDocument(makeProfileWithExternalImport(), context),
      parseProfileDocument(makeProfileWithMatchingSelectors(), context),
    ];

    expect(documents).toHaveLength(6);
    expect(fetch).not.toHaveBeenCalled();
    expect(XMLHttpRequest).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
