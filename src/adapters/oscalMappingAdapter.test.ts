// =============================================================================
// Modelladapter `mapping-collection` — Testvertrag (GSPP-245)
//
// Der verbindliche Korpus ist fixture-basiert: Die beiden realen BSI-Mappings
// liegen nicht im Repository, weil weder `preview`- noch
// `blocked-by-upstream`-Einträge materialisiert werden. Feste Inhaltszahlen
// stehen deshalb ausschließlich hier und in den Fixtures — nie in einer
// Assertion gegen den Realkorpus (`oscalMappingDocument.node.test.ts`).
// =============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  coverageForSourceIdRef,
  coverageForTargetIdRef,
  deriveMappingCollection,
  MAPPING_ADAPTER_DIAGNOSTIC_CODES,
  MAPPING_ADAPTER_VALIDATOR,
  MAPPING_COLLECTION_ROOT_TYPE,
  MAPPING_RELATIONSHIP_GAP,
} from './oscalMappingAdapter';
import { parseMappingDocument } from './oscalMappingDocument';
import type { MappingDocument } from './oscalMappingDocument';
import {
  getOscalRootAdapter,
  listAdaptedOscalRootTypes,
  mappingCollectionRootAdapter,
  parseOscalDocument,
} from './oscalRootAdapters';
import { OscalRootDispatchError } from './oscalRootDispatch';
import { parseCatalogDocument } from './oscalDocument';
import { MAPPING_RELATIONSHIPS, OSCAL_NAMESPACE } from '@/domain/mappingModel';
import type { MappingCollection } from '@/domain/mappingModel';
import type { OscalDocumentContext } from '@/domain/models';
import {
  makeAllMappingSources,
  makeCatalogSourceForMappingEntry,
  makeMalformedMappingSource,
  makeMappingSource,
  makeMappingWithMalformedDetails,
  makeMappingWithNamespacedResourceType,
  makeMappingWithOscalNamespacedRelationship,
  makeMappingWithDuplicateUuid,
  makeMappingWithExplicitGap,
  makeMappingWithExternalHref,
  makeMappingWithGapSummaryIds,
  makeMappingWithManyToMany,
  makeMappingWithNamespacedRelationship,
  makeMappingWithoutItemIdRef,
  makeMappingWithoutMappings,
  makeMappingWithoutRelationship,
  makeMappingWithoutResourceHref,
  makeMappingWithoutResources,
  makeMappingWithoutResourceType,
  makeMappingWithoutSources,
  makeMappingWithRepeatedSourceIdRef,
  makeMappingWithQualityAnnotations,
  makeMappingWithSingleMappingObject,
  makeMappingWithTwoRootKeys,
  makeMappingWithUnknownRelationship,
  makeMappingWithUnknownStatus,
  makeMinimalMappingSource,
  makeRichMappingSource,
  MAPPING_ARTIFACT_SPECS,
  MAPPING_RESOURCE_HREFS,
  listRegisteredMappingArtifactKeys,
  mappingSpecFor,
} from '@/test/fixtures/mappings';
import { makeLosslessCatalogSource } from '@/test/fixtures/losslessCatalog';
import {
  arrayOrderSignature,
  containerIdentities,
  contentMultiset,
  countPropRemarks,
  deepFreeze,
  missingFromMultiset,
  sharedContainerPaths,
} from '@/test/oscalStructure';

const context: OscalDocumentContext = { trustClass: 'class-1-verified-public' };
const codes = MAPPING_ADAPTER_DIAGNOSTIC_CODES;

function parseArtifact(artifactKey: string): MappingDocument {
  const specification = mappingSpecFor(artifactKey);
  return parseMappingDocument(makeMappingSource(specification), {
    ...context,
    upstreamPath: specification.upstreamPath,
  });
}

function codesOf(view: MappingCollection): readonly string[] {
  return view.diagnostics.map((diagnostic) => diagnostic.code);
}

function viewOf(source: unknown): MappingCollection {
  return parseMappingDocument(source, context).view;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/*  Registrierung                                                      */
/* ------------------------------------------------------------------ */

describe('Adapter-Registrierung', () => {
  it('führt mapping-collection als adaptierten Root-Typ', () => {
    expect(listAdaptedOscalRootTypes()).toContain(MAPPING_COLLECTION_ROOT_TYPE);
    expect(getOscalRootAdapter(MAPPING_COLLECTION_ROOT_TYPE))
      .toBe(mappingCollectionRootAdapter);
    expect(mappingCollectionRootAdapter.moduleEntryPoint)
      .toBe('src/adapters/oscalMappingAdapter.ts');
  });

  it('deckt mit catalog, profile und mapping-collection alle drei Control-Layer-Roots ab', () => {
    expect(listAdaptedOscalRootTypes()).toEqual(
      expect.arrayContaining(['catalog', 'profile', MAPPING_COLLECTION_ROOT_TYPE]),
    );
  });

  it('lässt den Katalogpfad unberührt', () => {
    // Der Erweiterungsvertrag verspricht genau das: Ein neues Modell ist eine
    // neue Datei plus ein Registrierungseintrag.
    const document = parseCatalogDocument(makeLosslessCatalogSource(), {
      catalogKey: 'gspp',
      trustClass: 'class-1-verified-public',
    });

    expect(document.view.totalControls).toBe(4);
  });

  it('leitet über den root-generischen Einstieg ab, statt OSCAL_ROOT_TYPE_UNSUPPORTED zu liefern', () => {
    const specification = mappingSpecFor('mapping-itgs2023-zu-gspp');
    const result = parseOscalDocument(makeMappingSource(specification), {
      ...context,
      upstreamPath: specification.upstreamPath,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dispatch.rootType).toBe(MAPPING_COLLECTION_ROOT_TYPE);
    expect((result.view as MappingCollection).mappings).toHaveLength(2);
  });

  it('bildet genau die registrierten Mapping-Artefakte ab', () => {
    expect(MAPPING_ARTIFACT_SPECS.map((entry) => entry.artifactKey).sort())
      .toEqual([...listRegisteredMappingArtifactKeys()]);
  });
});

/* ------------------------------------------------------------------ */
/*  Struktur des Bestands                                              */
/* ------------------------------------------------------------------ */

describe('Mapping Sets und Einträge des Bestands', () => {
  it('erhält Mapping-Set-Grenzen, Eintragszahlen und Identitäten', () => {
    for (const specification of MAPPING_ARTIFACT_SPECS) {
      const { view } = parseArtifact(specification.artifactKey);

      expect(view.declaredMappingsForm, specification.artifactKey).toBe('array');
      expect(view.mappings, specification.artifactKey)
        .toHaveLength(specification.sets.length);

      view.mappings.forEach((mapping, index) => {
        const set = specification.sets[index]!;
        const expectedMaps = Object.values(set.relationships)
          .reduce((sum, count) => sum + count, 0);

        expect(mapping.maps.length, `${specification.artifactKey}/${index}`)
          .toBe(expectedMaps);
        expect(mapping.uuid).toBeDefined();
        // Die Grenze zwischen den Sets bleibt erhalten: Jeder Eintrag gehört
        // genau einem Set, und die Einträge werden nicht zusammengeschüttet.
        expect(new Set(mapping.maps.map((entry) => entry.uuid)).size).toBe(expectedMaps);
      });
    }
  });

  it('erhält Methode, Rationale und den tatsächlichen Dokumentstatus', () => {
    const iso = parseArtifact('mapping-iso27001-annex-a-zu-gspp').view;
    const itgs = parseArtifact('mapping-itgs2023-zu-gspp').view;

    // Beide Statuswerte des Bestands — und beide aus dem echten Enum, nicht aus
    // einem erfundenen Draft/Published-Paar.
    expect(iso.mappings[0]?.status).toEqual({
      kind: 'known',
      value: 'complete',
      declared: 'complete',
    });
    expect(itgs.mappings[0]?.status).toEqual({
      kind: 'known',
      value: 'draft',
      declared: 'draft',
    });
    expect(iso.mappings[0]?.method?.kind).toBe('known');
    expect(iso.mappings[0]?.matchingRationale).toEqual({
      kind: 'known',
      value: 'semantic',
      declared: 'semantic',
    });
    expect(iso.provenance?.status?.kind).toBe('known');
    expect(iso.provenance?.mappingDescription).toBeDefined();
  });

  it('unterscheidet alle fünf im Bestand vorkommenden Beziehungstypen', () => {
    const relationships = new Set<string>();

    for (const specification of MAPPING_ARTIFACT_SPECS) {
      const { view } = parseArtifact(specification.artifactKey);
      for (const mapping of view.mappings) {
        for (const entry of mapping.maps) {
          expect(entry.relationship.kind).toBe('known');
          if (entry.relationship.kind !== 'known') continue;
          relationships.add(entry.relationship.value);
        }
      }
    }

    // Kein Zusammenfassen zu einem generischen `related`: Die fünf am Bestand
    // belegten Werte bleiben fünf.
    expect([...relationships].sort()).toEqual([
      'equal-to',
      'equivalent-to',
      'intersects-with',
      'subset-of',
      'superset-of',
    ]);
    // Der sechste ist am Bestand nicht belegt — deshalb das synthetische
    // Fixture in „Abdeckungssemantik".
    expect(relationships.has(MAPPING_RELATIONSHIP_GAP)).toBe(false);
    expect(MAPPING_RELATIONSHIPS).toHaveLength(6);
  });

  it('erhält mehrere Targets je Eintrag', () => {
    const { view } = parseArtifact('mapping-iso27001-annex-a-zu-gspp');
    const targetCounts = view.mappings.flatMap((mapping) =>
      mapping.maps.map((entry) => entry.targets.length),
    );

    // Am Bestand gemessen: bis zu zehn Ziele auf einer Quelle.
    expect(Math.max(...targetCounts)).toBe(10);
    expect(targetCounts.every((count) => count >= 1)).toBe(true);
  });

  it('erhält props an map und mapping-item', () => {
    const { view } = parseArtifact('mapping-itgs2023-zu-gspp');
    const entry = view.mappings[0]?.maps[0];

    expect(entry?.props.length).toBeGreaterThan(0);
    expect(entry?.sources[0]?.props.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Abdeckungssemantik                                                 */
/* ------------------------------------------------------------------ */

describe('Dreistufige Abdeckungsaussage', () => {
  it('unterscheidet explizite Lücke, Abbildung und Unbekanntes', () => {
    const view = viewOf(makeMappingWithExplicitGap());
    const mapping = view.mappings[0]!;

    // Die explizite Lücke ist eine Aussage: `no-relationship` steht da.
    expect(coverageForSourceIdRef(mapping, 'SRC-GAP')).toBe('explicit-gap');
    expect(coverageForSourceIdRef(mapping, 'SRC-MAPPED')).toBe('mapped');
    // Das Fehlen eines Eintrags ist **keine** Aussage über Abdeckung.
    expect(coverageForSourceIdRef(mapping, 'SRC-NIE-ERWAEHNT')).toBe('unknown');
    expect(coverageForTargetIdRef(mapping, 'TGT-GAP')).toBe('explicit-gap');
    expect(coverageForTargetIdRef(mapping, 'TGT-NIE-ERWAEHNT')).toBe('unknown');
  });

  it('modelliert no-relationship als eigenen Beziehungstyp', () => {
    const view = viewOf(makeMappingWithExplicitGap());
    const gap = view.mappings[0]?.maps[0]?.relationship;

    expect(gap).toEqual({
      kind: 'known',
      value: MAPPING_RELATIONSHIP_GAP,
      declared: MAPPING_RELATIONSHIP_GAP,
    });
    expect(view.diagnostics).toHaveLength(2);
    // Die beiden Befunde betreffen den unauflösbaren Ressourcenkontext, nicht
    // die Lücke selbst — sie ist ein regulärer Modellzustand.
    expect(new Set(codesOf(view))).toEqual(new Set([codes.ID_REF_CONTEXT_UNRESOLVED]));
  });

  it('lässt eine Abbildung eine erklärte Lücke auf derselben id-ref überwiegen', () => {
    const view = viewOf(makeMappingWithRepeatedSourceIdRef());
    const mapping = view.mappings[0]!;

    // Beide Einträge stehen unter derselben ID — die Aussage „es gibt eine
    // Beziehung" ist die stärkere.
    expect(mapping.mapsBySourceIdRef.get('SRC-DOPPELT')).toHaveLength(2);
    expect(coverageForSourceIdRef(mapping, 'SRC-DOPPELT')).toBe('mapped');
    // Dieselbe ID zweimal an einem Eintrag zählt trotzdem einmal, sonst
    // zählte eine Wiederholung als zusätzliche Aussage.
    expect(mapping.maps[1]?.sources).toHaveLength(2);
  });

  it('leitet aus einem unlesbaren Beziehungstyp keine Abdeckung ab', () => {
    const view = viewOf(makeMappingWithUnknownRelationship());
    const mapping = view.mappings[0]!;

    // Weder „abgebildet" noch „erklärte Lücke": Ein Beziehungstyp, den niemand
    // deuten kann, darf keine Abdeckung behaupten.
    expect(coverageForSourceIdRef(mapping, 'SRC-X')).toBe('unknown');
  });

  it('zählt eine Beziehung aus fremdem Namensraum als Abbildung', () => {
    const view = viewOf(
      makeMappingWithNamespacedRelationship('https://beispiel.invalid/ns/mapping'),
    );
    const mapping = view.mappings[0]!;
    const relationship = mapping.maps[0]?.relationship;

    expect(relationship?.kind).toBe('extension');
    expect(coverageForSourceIdRef(mapping, 'SRC-NS')).toBe('mapped');
    // Ein fremder `ns` hebt die Vokabularbindung auf — das ist im Metaschema so
    // vorgesehen und deshalb kein Befund.
    expect(codesOf(view)).not.toContain(codes.RELATIONSHIP_INVALID);
  });

  it('gibt dem ausdrücklich deklarierten OSCAL-Namensraum keinen Freibrief', () => {
    const view = viewOf(makeMappingWithOscalNamespacedRelationship(OSCAL_NAMESPACE));

    // Genau hier gilt die Vokabularbindung — ein `ns`, der den OSCAL-Namensraum
    // benennt, hebt sie nicht auf, sondern bestätigt sie.
    expect(view.mappings[0]?.maps[0]?.relationship.kind).toBe('unknown');
    expect(codesOf(view)).toContain(codes.RELATIONSHIP_INVALID);
  });

  it('erkennt auch einen Ressourcentyp aus fremdem Namensraum als Erweiterung', () => {
    const view = viewOf(
      makeMappingWithNamespacedResourceType('https://beispiel.invalid/ns/ressourcen'),
    );

    expect(view.mappings[0]?.targetResource?.type.kind).toBe('extension');
    expect(codesOf(view)).not.toContain(codes.RESOURCE_TYPE_INVALID);
  });

  it('wertet die Gap-Summary als zweite Ausdrucksform der Lücke aus', () => {
    const view = viewOf(makeMappingWithGapSummaryIds());
    const mapping = view.mappings[0]!;

    // Beide Seiten: Eine ID, die ausschließlich in der Gap-Summary steht, ist
    // ausdrücklich als ungemappt bezeichnet — das ist eine Aussage, kein
    // Schweigen.
    expect(coverageForSourceIdRef(mapping, 'SRC-NUR-SUMMARY')).toBe('explicit-gap');
    expect(coverageForTargetIdRef(mapping, 'TGT-NUR-SUMMARY')).toBe('explicit-gap');
    // Gegenprobe: Eine nirgends genannte ID bleibt unbekannt.
    expect(coverageForSourceIdRef(mapping, 'SRC-NIE-ERWAEHNT')).toBe('unknown');
  });

  it('lässt die konkrete Beziehung einen Widerspruch zur Gap-Summary entscheiden', () => {
    const view = viewOf(makeMappingWithGapSummaryIds());
    const mapping = view.mappings[0]!;

    // Das Dokument widerspricht sich: dieselbe ID ist abgebildet **und** als
    // ungemappt aufgezählt. Die konkrete Beziehung benennt Quelle und Ziel und
    // gewinnt deshalb; ein vierter Zustand entstünde allein aus einem
    // Dokumentfehler.
    expect(mapping.sourceGapIdRefs.has('SRC-WIDERSPRUCH')).toBe(true);
    expect(coverageForSourceIdRef(mapping, 'SRC-WIDERSPRUCH')).toBe('mapped');
  });

  it('wertet ein Muster in der Gap-Summary nicht aus', () => {
    const view = viewOf(makeMappingWithGapSummaryIds());
    const mapping = view.mappings[0]!;

    // Das Muster bleibt erhalten …
    expect(mapping.sourceGapSummary?.unmappedControls[1]?.matching[0]?.pattern)
      .toBe('SRC-MUSTER-*');
    // … verändert aber keine Abdeckungsaussage: Dieser Slice hat keinen
    // Glob-Matcher, und einen zu erfinden hieße raten.
    expect(mapping.sourceGapIdRefs.has('SRC-MUSTER-1')).toBe(false);
    expect(coverageForSourceIdRef(mapping, 'SRC-MUSTER-1')).toBe('unknown');
  });

  it('erhält die Gap-Summary als Selektorliste', () => {
    const view = viewOf(makeMappingWithQualityAnnotations());
    const mapping = view.mappings[0]!;

    expect(mapping.sourceGapSummary?.unmappedControls[0]?.withIds).toEqual(['SRC-UNMAPPED']);
    expect(mapping.targetGapSummary?.unmappedControls[0]?.matching[0]?.pattern).toBe('TGT-*');
    // Das Muster wird erhalten, nicht ausgewertet.
    expect(mapping.targetGapSummary?.unmappedControls[0]?.withIds).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Kardinalität und Granularität                                      */
/* ------------------------------------------------------------------ */

describe('n:m und Granularität', () => {
  it('modelliert mehrere Quellen und mehrere Ziele an einem Eintrag', () => {
    const view = viewOf(makeMappingWithManyToMany());
    const entry = view.mappings[0]?.maps[0];

    expect(entry?.sources).toHaveLength(2);
    expect(entry?.targets).toHaveLength(3);
    // Der Index führt denselben Eintrag unter jeder seiner IDs.
    expect(view.mappings[0]?.mapsBySourceIdRef.get('SRC-A')).toHaveLength(1);
    expect(view.mappings[0]?.mapsBySourceIdRef.get('SRC-B_smt.1')).toHaveLength(1);
    expect(view.mappings[0]?.mapsByTargetIdRef.size).toBe(3);
  });

  it('unterscheidet control und statement als Subjekttyp', () => {
    const view = viewOf(makeMappingWithManyToMany());
    const entry = view.mappings[0]?.maps[0];

    expect(entry?.sources.map((item) => item.type)).toEqual([
      { kind: 'known', value: 'control', declared: 'control' },
      { kind: 'known', value: 'statement', declared: 'statement' },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/*  Qualitätsangaben                                                   */
/* ------------------------------------------------------------------ */

describe('Maschinenlesbare Qualitätsangaben', () => {
  it('erhält qualifiers, confidence-score, coverage und die lokale Rationale', () => {
    const view = viewOf(makeMappingWithQualityAnnotations());
    const mapping = view.mappings[0]!;
    const entry = mapping.maps[0]!;

    expect(entry.qualifiers[0]?.subject).toEqual({
      kind: 'known',
      value: 'both',
      declared: 'both',
    });
    expect(entry.qualifiers[0]?.predicate.kind).toBe('known');
    expect(entry.qualifiers[0]?.category.kind).toBe('known');
    expect(entry.qualifiers[0]?.description).toBeDefined();

    expect(entry.confidenceScore?.category).toBe('high');
    expect(entry.coverage).toMatchObject({ generationMethod: 'arbitrary', targetCoverage: 0.5 });
    // Die lokale Rationale überschreibt die globale, ohne sie zu löschen.
    expect(entry.matchingRationale).toEqual({
      kind: 'known',
      value: 'functional',
      declared: 'functional',
    });
    expect(view.provenance?.matchingRationale).toEqual({
      kind: 'known',
      value: 'semantic',
      declared: 'semantic',
    });

    expect(mapping.confidenceScore?.percentage).toBe(0.75);
    expect(mapping.coverage?.targetCoverage).toBe(0.25);
  });

  it('erhält profile als zulässigen Ressourcentyp', () => {
    const view = viewOf(makeMappingWithQualityAnnotations());

    expect(view.mappings[0]?.targetResource?.type).toEqual({
      kind: 'known',
      value: 'profile',
      declared: 'profile',
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Vokabularprüfung                                                   */
/* ------------------------------------------------------------------ */

describe('Eigene Vokabularprüfung', () => {
  it('weist einen erfundenen Beziehungstyp aus, ohne ihn zu verwerfen', () => {
    const view = viewOf(makeMappingWithUnknownRelationship());
    const relationship = view.mappings[0]?.maps[0]?.relationship;

    expect(relationship?.kind).toBe('unknown');
    if (relationship?.kind !== 'unknown') return;
    // Der Rohwert bleibt in der Projektion …
    expect(relationship.declared).toBe('maps-to');
    // … und **nicht** in der Diagnose (Redaction-Regel).
    expect(relationship.diagnostic.code).toBe(codes.RELATIONSHIP_INVALID);
    expect(relationship.diagnostic.path).toBe('/mapping-collection/mappings/0/maps/0/relationship');
    expect(JSON.stringify(relationship.diagnostic)).not.toContain('maps-to');
  });

  it('unterscheidet einen fehlenden von einem unbekannten Beziehungstyp', () => {
    const view = viewOf(makeMappingWithoutRelationship());

    expect(codesOf(view)).toContain(codes.RELATIONSHIP_MISSING);
    expect(codesOf(view)).not.toContain(codes.RELATIONSHIP_INVALID);
  });

  it('weist einen erfundenen status aus', () => {
    const view = viewOf(makeMappingWithUnknownStatus());

    expect(view.mappings[0]?.status?.kind).toBe('unknown');
    expect(codesOf(view)).toContain(codes.STATUS_INVALID);
  });

  it('weist ein fehlendes id-ref und eine leere Quellseite aus', () => {
    expect(codesOf(viewOf(makeMappingWithoutItemIdRef())))
      .toContain(codes.ITEM_ID_REF_MISSING);

    const empty = viewOf(makeMappingWithoutSources());
    expect(codesOf(empty)).toContain(codes.ITEM_SET_EMPTY);
    expect(empty.mappings[0]?.maps[0]?.sources).toEqual([]);
  });

  it('meldet eine doppelte uuid am zweiten Fundort', () => {
    const view = viewOf(makeMappingWithDuplicateUuid());
    const duplicate = view.diagnostics.find((entry) => entry.code === codes.UUID_DUPLICATE);

    expect(duplicate?.path).toBe('/mapping-collection/mappings/0/maps/1/uuid');
    // Der erste Fundort ist für sich unauffällig und erzeugt keinen Befund.
    expect(view.diagnostics.filter((entry) => entry.code === codes.UUID_DUPLICATE))
      .toHaveLength(1);
  });

  it('trägt Stufe und Validatorpin in jeder Diagnose', () => {
    const view = viewOf(makeMappingWithUnknownRelationship());

    for (const diagnostic of view.diagnostics) {
      expect(diagnostic.stage).toBe('domain');
      expect(diagnostic.validator).toEqual(MAPPING_ADAPTER_VALIDATOR);
      expect(diagnostic.artifact.rootType).toBe(MAPPING_COLLECTION_ROOT_TYPE);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Referenzen                                                         */
/* ------------------------------------------------------------------ */

describe('Referenzklassifikation über die zentrale Schicht', () => {
  it('klassifiziert alle sechs Bestands-href als relative und löst keine auf', () => {
    const classified = new Map<string, string>();

    for (const specification of MAPPING_ARTIFACT_SPECS) {
      const { view } = parseArtifact(specification.artifactKey);
      for (const mapping of view.mappings) {
        for (const resource of [mapping.sourceResource, mapping.targetResource]) {
          expect(resource?.reference).not.toBeNull();
          if (!resource?.href || !resource.reference) continue;
          classified.set(resource.href, resource.reference.kind);
        }
      }
    }

    expect([...classified.keys()].sort()).toEqual(
      [...Object.values(MAPPING_RESOURCE_HREFS)].sort(),
    );
    for (const [href, kind] of classified) {
      // `../`-Segmente, Unterverzeichnisse und blanke Dateinamen erhalten
      // dasselbe Ergebnis; es gibt clientseitig keinen Verzeichniskontext.
      expect(kind, href).toBe('unresolved');
    }
  });

  it('erzeugt für jede unaufgelöste Ressource eine Diagnose mit dem Grund relative', () => {
    const { view } = parseArtifact('mapping-itgs2023-zu-gspp');
    const resource = view.mappings[0]?.sourceResource;

    expect(resource?.reference?.kind).toBe('unresolved');
    if (resource?.reference?.kind !== 'unresolved') return;
    expect(resource.reference.reason).toBe('relative');
    // Kein Traversal-Etikett und keine Normalisierung: Der Grund ist die
    // Relativität selbst.
    expect(resource.reference.diagnostic.code).toBe('OSCAL_REFERENCE_RELATIVE');
    expect(resource.reference.diagnostic.stage).toBe('reference');
  });

  it('klassifiziert einen externen href, ohne ihn zu laden', () => {
    const view = viewOf(makeMappingWithExternalHref('https://beispiel.invalid/katalog.json'));

    expect(view.mappings[0]?.targetResource?.reference?.kind).toBe('external');
  });

  it('meldet eine unbenannte Seite und einen formfremden maps-Eintrag', () => {
    const view = viewOf(makeMappingWithoutResources());
    const mapping = view.mappings[0]!;

    expect(mapping.sourceResource).toBeNull();
    expect(mapping.targetResource).toBeNull();
    expect(codesOf(view).filter((code) => code === codes.RESOURCE_MISSING)).toHaveLength(2);
    // Ohne benannte Seiten wird auch kein Ressourcenkontext behauptet.
    expect(codesOf(view)).not.toContain(codes.ID_REF_CONTEXT_UNRESOLVED);
    expect(mapping.maps).toEqual([]);
    expect(codesOf(view)).toContain(codes.STRUCTURE_UNEXPECTED);
  });

  it('meldet eine Ressource ohne type, ohne einen zu erfinden', () => {
    const view = viewOf(makeMappingWithoutResourceType());

    expect(view.mappings[0]?.sourceResource?.type.kind).toBe('unknown');
    expect(codesOf(view)).toContain(codes.RESOURCE_TYPE_INVALID);
    // Der `href` bleibt trotzdem klassifiziert.
    expect(view.mappings[0]?.sourceResource?.reference?.kind).toBe('unresolved');
  });

  it('erzeugt ohne href keine geratene Referenz', () => {
    const view = viewOf(makeMappingWithoutResourceHref());

    expect(view.mappings[0]?.sourceResource?.reference).toBeNull();
    expect(codesOf(view)).toContain(codes.RESOURCE_HREF_MISSING);
  });

  it('interpretiert keine id-ref ohne aufgelösten Ressourcenkontext', () => {
    const { view } = parseArtifact('mapping-iso27001-annex-a-zu-gspp');
    const items = view.mappings.flatMap((mapping) =>
      mapping.maps.flatMap((entry) => [...entry.sources, ...entry.targets]),
    );

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.resolution).toEqual({
        status: 'unresolved',
        reason: 'resource-context-unresolved',
      });
    }
    // Je Seite eines Mapping Sets benennt genau eine Diagnose den Grund; eine
    // Diagnose je `id-ref` wäre bei 96 Einträgen dieselbe Aussage 192-mal.
    expect(
      view.diagnostics.filter((entry) => entry.code === codes.ID_REF_CONTEXT_UNRESOLVED),
    ).toHaveLength(view.mappings.length * 2);
  });
});

/* ------------------------------------------------------------------ */
/*  Formfremde Knoten                                                  */
/* ------------------------------------------------------------------ */

describe('Formfremde und fehlende Knoten', () => {
  it('diagnostiziert formfremde Knoten, statt sie still zu verschlucken', () => {
    const view = viewOf(makeMalformedMappingSource());

    expect(codesOf(view)).toContain(codes.STRUCTURE_UNEXPECTED);
    expect(codesOf(view)).toContain(codes.MAPS_MISSING);
    expect(view.provenance).toBeNull();
    expect(view.mappings[0]?.maps).toEqual([]);
  });

  it('diagnostiziert formfremde Detailwerte, statt sie zu verschlucken', () => {
    const view = viewOf(makeMappingWithMalformedDetails());
    const mapping = view.mappings[0]!;
    const entry = mapping.maps[0]!;

    // Ein nicht-textueller Beziehungswert ist unbekannt — und trägt keinen
    // Rohwert, weil es keinen textuellen gibt.
    expect(entry.relationship.kind).toBe('unknown');
    if (entry.relationship.kind === 'unknown') {
      expect(entry.relationship.declared).toBeUndefined();
    }
    // Die Ressource verschwindet, ihr Befund nicht.
    expect(mapping.sourceResource).toBeNull();
    // Vorhandene, aber formfremde Knoten bleiben als leere Knoten sichtbar.
    expect(entry.confidenceScore).toEqual({ path: entry.path + '/confidence-score' });
    expect(entry.coverage?.targetCoverage).toBeUndefined();
    expect(mapping.confidenceScore).toEqual({
      category: undefined,
      percentage: undefined,
      path: `${mapping.path}/confidence-score`,
    });
    expect(mapping.sourceGapSummary?.unmappedControls).toEqual([]);
    // Der String bleibt, die Zahl fällt mit Befund heraus.
    expect(mapping.targetGapSummary?.unmappedControls[0]?.withIds).toEqual(['TGT-1']);
    expect(entry.props).toEqual([]);
    expect(entry.sources[0]?.props).toEqual([]);
    expect(entry.sources[0]?.links).toEqual([]);

    expect(codesOf(view).filter((code) => code === codes.STRUCTURE_UNEXPECTED).length)
      .toBeGreaterThanOrEqual(6);
  });

  it('meldet ein leeres mappings-Array als fehlend', () => {
    const view = viewOf(makeMappingWithoutMappings());

    expect(view.declaredMappingsForm).toBe('array');
    expect(codesOf(view)).toContain(codes.MAPPINGS_MISSING);
  });

  it('meldet ein formfremdes mappings als fehlend', () => {
    const view = deriveMappingCollection(
      { metadata: { 'oscal-version': '1.2.2' }, mappings: 'kein Objekt' },
      context,
    );

    expect(view.declaredMappingsForm).toBe('missing');
    expect(codesOf(view)).toContain(codes.MAPPINGS_MISSING);
  });

  it('verkraftet einen Root-Körper, der gar kein Objekt ist', () => {
    const view = deriveMappingCollection('kein Objekt', context);

    expect(view.mappings).toEqual([]);
    expect(codesOf(view)).toContain(codes.STRUCTURE_UNEXPECTED);
  });
});

/* ------------------------------------------------------------------ */
/*  Dispatch-Schranken                                                 */
/* ------------------------------------------------------------------ */

describe('Fail-closed vor der Ableitung', () => {
  it('weist einen fremden Root im Mapping-Einstieg ab', () => {
    expect(() => parseMappingDocument(makeCatalogSourceForMappingEntry(), context))
      .toThrow(OscalRootDispatchError);
  });

  it('weist zwei Root-Keys ab, statt einen auszuwählen', () => {
    let thrown: unknown;
    try {
      parseMappingDocument(makeMappingWithTwoRootKeys(), context);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(OscalRootDispatchError);
    expect((thrown as OscalRootDispatchError).diagnostic.code)
      .toBe('OSCAL_ROOT_KEY_AMBIGUOUS');
  });

  it('weist ein Mapping unter einem fremden registrierten Pfad ab', () => {
    let thrown: unknown;
    try {
      parseMappingDocument(makeMinimalMappingSource(), {
        ...context,
        // Der Pfad gehört einem Profil; der Registry-Abgleich muss greifen.
        upstreamPath: 'control_layer/WLAN/sources/profiles/WLAN-profile.json',
      });
    } catch (error) {
      thrown = error;
    }

    expect((thrown as OscalRootDispatchError).diagnostic.code)
      .toBe('OSCAL_ROOT_TYPE_MISMATCH');
  });
});

/* ------------------------------------------------------------------ */
/*  Verlustfreiheit                                                    */
/* ------------------------------------------------------------------ */

describe('No-op-Verlustfreiheit über die eingefrorenen Fixtures', () => {
  it('gibt denselben Quellgraphen zurück, den es bekommen hat', () => {
    for (const { specification, source } of makeAllMappingSources()) {
      const document = parseMappingDocument(source, {
        ...context,
        upstreamPath: specification.upstreamPath,
      });

      expect(document.source, specification.artifactKey).toBe(source);
      expect(JSON.stringify(document.source), specification.artifactKey)
        .toBe(JSON.stringify(source));
    }
  });

  it('verliert nach der Inhalts-Multiset-Regel kein Element', () => {
    const source = makeRichMappingSource();
    const expected = contentMultiset(structuredClone(source));
    const document = parseMappingDocument(source, context);

    expect(missingFromMultiset(expected, contentMultiset(document.source))).toEqual([]);
    expect(missingFromMultiset(contentMultiset(document.source), expected)).toEqual([]);
    expect(arrayOrderSignature(document.source)).toEqual(arrayOrderSignature(source));
    // `prop.remarks` ist ein reguläres OSCAL-Feld, das das Domänenmodell nicht
    // kennt — der Zähler belegt, dass der Korpus es überhaupt enthält.
    expect(countPropRemarks(document.source)).toBeGreaterThan(0);
  });

  it('erhält unbekannte Felder, leere Objekte und leere Listen', () => {
    const document = parseMappingDocument(makeRichMappingSource(), context);
    const envelope = document.source as Record<string, Record<string, unknown>>;
    const body = envelope['mapping-collection']!;
    const metadata = body.metadata as Record<string, unknown>;
    const provenance = body.provenance as Record<string, unknown>;
    const mapping = (body.mappings as Record<string, unknown>[])[0]!;
    const entry = (mapping.maps as Record<string, unknown>[])[0]!;

    expect(metadata['x-bsi-metadatenfeld']).toEqual(['a', 'b']);
    // Die beiden schemafremden Felder des ISO-Bestands, hier synthetisch: Ein
    // Adapter, der `provenance` auf die bekannten Felder projiziert, verlöre sie.
    expect(provenance['qa-reviewed']).toBe('2026-05-27');
    expect(provenance['qa-note']).toBeDefined();
    expect(mapping['x-bsi-erweiterung']).toEqual({ hinweis: 'Unbekanntes Feld.' });
    expect(entry['x-bsi-leeres-objekt']).toEqual({});
    expect(entry['x-bsi-leere-liste']).toEqual([]);
  });

  it('verändert den Quellgraphen nicht und teilt keinen Container mit ihm', () => {
    const source = deepFreeze(makeMappingSource(mappingSpecFor('mapping-itgs2023-zu-gspp')));
    const document = parseMappingDocument(source, context);
    const foreign = containerIdentities(document.source);

    // Geteilte Strings sind erwünscht; geteilte Objekte und Arrays wären eine
    // Mutationsbrücke zwischen Projektion und Quellgraph.
    expect(sharedContainerPaths(document.view, foreign)).toEqual([]);
  });

  it('erhält die Einzelform von mappings als solche', () => {
    const source = makeMappingWithSingleMappingObject();
    const document = parseMappingDocument(source, context);

    expect(document.view.declaredMappingsForm).toBe('single');
    // Vereinheitlicht wird nur die Projektion; der Quellgraph bleibt einzeln.
    expect(Array.isArray(
      (document.source as Record<string, Record<string, unknown>>)['mapping-collection']!.mappings,
    )).toBe(false);
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
      ...makeAllMappingSources().map(({ specification, source }) =>
        parseMappingDocument(source, { ...context, upstreamPath: specification.upstreamPath }),
      ),
      parseMappingDocument(makeRichMappingSource(), context),
      parseMappingDocument(makeMappingWithQualityAnnotations(), context),
      parseMappingDocument(
        makeMappingWithExternalHref('https://beispiel.invalid/katalog.json'),
        context,
      ),
    ];

    expect(documents).toHaveLength(5);
    expect(fetch).not.toHaveBeenCalled();
    expect(XMLHttpRequest).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
