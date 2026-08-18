// =============================================================================
// Stufe 3 für Mapping Collections (GSPP-245)
//
// Der Adapter bringt keine eigene Schemaprüfung mit — er reicht die in Stufe 2
// gebundene Matrixzelle an `validateAgainstPinnedSchema()` weiter (GSPP-343).
// Der Nachweis hier ist deshalb ein Versionsnachweis, kein Validatornachweis.
//
// Zwei Dinge sind beim Mapping-Modell besonders und werden hier belegt:
//
//  1. **Vor OSCAL 1.2.0 existiert der Root nicht.** Ein Mapping mit
//     `oscal-version: "1.1.3"` ist nicht „schwer zu prüfen", sondern in sich
//     widersprüchlich — und bekommt die Diagnose „unmöglich", nicht „nicht
//     freigegeben".
//  2. **Das JSON-Schema prüft weniger, als das Modell festlegt.** Ein
//     erfundener `relationship` und ein fremder `mapping-resource-reference`-
//     Typ sind schemavalide; ohne die eigene Vokabularprüfung liefe beides
//     durch. Genau diese Lücke wird hier gezeigt, nicht behauptet.
// =============================================================================

import { beforeEach, describe, expect, it } from 'vitest';
import { parseMappingDocument, validateMappingSchema } from './oscalMappingDocument';
import { OscalRootDispatchError } from './oscalRootDispatch';
import { MAPPING_ADAPTER_DIAGNOSTIC_CODES } from './oscalMappingAdapter';
import { resetCompiledSchemaCache } from '@/domain/oscalSchemaValidation';
import type { OscalDocumentContext } from '@/domain/models';
import {
  getSchemaPin,
  isImpossibleCombination,
  PINNED_OSCAL_VERSIONS,
} from '@/domain/oscalVersionMatrix';
import type { OscalSchemaPin, PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import {
  makeMappingSource,
  makeMappingWithDuplicateUuid,
  makeMappingWithImpossibleVersion,
  makeMappingWithoutProvenance,
  makeMappingWithoutVersion,
  makeMappingWithSchemaDirective,
  makeMappingWithSingleMappingObject,
  makeMappingWithUnknownItemType,
  makeMappingWithUnknownRelationship,
  makeMappingWithUnknownResourceType,
  makeMappingWithUnpinnedVersion,
  MAPPING_ARTIFACT_SPECS,
  MAPPING_PINNED_VERSIONS,
  mappingSpecFor,
} from '@/test/fixtures/mappings';

const context: OscalDocumentContext = { trustClass: 'class-1-verified-public' };
const codes = MAPPING_ADAPTER_DIAGNOSTIC_CODES;

beforeEach(() => {
  resetCompiledSchemaCache();
});

/**
 * Die Matrixzelle für `mapping-collection` × Version.
 *
 * Erwartungswerte werden **abgeleitet**, nicht zweitgepflegt: Eine hier
 * hartkodierte Schema-`$id` würde bei einer legitimen Pin-Aktualisierung
 * fälschlich rot — oder, schlimmer, eine falsche Bindung verdecken. Geprüft
 * wird die **Bindung**: dass das Dokument genau die Zelle seiner deklarierten
 * Version bekommt.
 */
function pinFor(version: PinnedOscalVersion): OscalSchemaPin {
  const pin = getSchemaPin('mapping-collection', version);
  if (!pin) throw new Error(`Die Versionsmatrix pinnt mapping-collection@${version} nicht`);
  return pin;
}

function dispatchErrorOf(makeSource: () => unknown): OscalRootDispatchError {
  let thrown: unknown;
  try {
    parseMappingDocument(makeSource(), context);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(OscalRootDispatchError);
  return thrown as OscalRootDispatchError;
}

describe('Versionsbindung der Schemaprüfung', () => {
  it('prüft jedes Mapping gegen seine eigene deklarierte Version', async () => {
    // Die beiden Artefakte deklarieren **verschiedene** Versionen: 1.2.2 und
    // 1.2.1. Eine globale Mapping-Versionskonstante könnte hier nur eines von
    // beiden richtig prüfen.
    expect(new Set(MAPPING_ARTIFACT_SPECS.map((entry) => entry.oscalVersion)).size).toBe(2);

    for (const specification of MAPPING_ARTIFACT_SPECS) {
      const document = parseMappingDocument(makeMappingSource(specification), {
        ...context,
        upstreamPath: specification.upstreamPath,
      });

      expect(document.pin.rootKey).toBe('mapping-collection');
      expect(document.pin.oscalVersion).toBe(specification.oscalVersion);
      expect(document.pin).toEqual(pinFor(specification.oscalVersion));

      const result = await validateMappingSchema(document);
      expect(result.ok, specification.artifactKey).toBe(specification.schemaValid);
    }
  });

  it('pinnt mapping-collection über genau die beiden existierenden Zellen', () => {
    for (const version of MAPPING_PINNED_VERSIONS) {
      const document = parseMappingDocument(
        makeMappingWithSchemaDirective(version, pinFor(version).schemaId),
        context,
      );

      expect(document.pin, version).toEqual(pinFor(version));
    }

    // Gegenprobe: Die übrigen gepinnten Versionen sind für dieses Modell
    // unmöglich — und die Aussage stammt aus der Matrix, nicht von hier.
    const impossible = PINNED_OSCAL_VERSIONS.filter(
      (version) => !MAPPING_PINNED_VERSIONS.includes(version),
    );
    expect(impossible.length).toBeGreaterThan(0);
    for (const version of impossible) {
      expect(isImpossibleCombination('mapping-collection', version), version).toBe(true);
    }
  });

  it('weist oscal-version 1.1.3 als unmöglich aus, nicht als nicht freigegeben', () => {
    const { diagnostic } = dispatchErrorOf(() => makeMappingWithImpossibleVersion('1.1.3'));

    expect(diagnostic.code).toBe('OSCAL_ROOT_VERSION_IMPOSSIBLE');
    // Die Entscheidung kommt aus `isImpossibleCombination()`; die Mindestversion
    // ist projekteigene Konstante und darf deshalb in der Diagnose stehen.
    expect(diagnostic.params.expected).toBe('>= 1.2.0');
    expect(diagnostic.path).toBe('/mapping-collection/metadata/oscal-version');
  });

  it('unterscheidet die Unmöglichkeit von einer bloß nicht gepinnten Version', () => {
    const unsupported = dispatchErrorOf(() => makeMappingWithUnpinnedVersion('1.3.0'));

    expect(unsupported.diagnostic.code).toBe('OSCAL_ROOT_VERSION_UNSUPPORTED');
    expect(unsupported.diagnostic.code).not.toBe('OSCAL_ROOT_VERSION_IMPOSSIBLE');
    // Kein Rückfall auf eine Nachbarversion: Der Dokumentwert erscheint nicht
    // als gepinnte Version im Artefaktkontext.
    expect(unsupported.diagnostic.artifact.oscalVersion).toBeNull();
  });

  it('weist eine fehlende oscal-version fail-closed ab', () => {
    const { diagnostic } = dispatchErrorOf(() => makeMappingWithoutVersion());

    expect(diagnostic.code).toBe('OSCAL_VERSION_MISSING');
    expect(diagnostic.path).toBe('/mapping-collection/metadata/oscal-version');
  });

  it('wählt die Zelle nach metadata.oscal-version und nie nach $schema', () => {
    const [declared, foreign] = MAPPING_PINNED_VERSIONS;
    expect(foreign).not.toBe(declared);

    const matching = parseMappingDocument(
      makeMappingWithSchemaDirective(declared, pinFor(declared).schemaId),
      context,
    );
    expect(matching.oscalVersion).toBe(declared);
    expect(matching.pin).toEqual(pinFor(declared));

    const { diagnostic } = dispatchErrorOf(() =>
      makeMappingWithSchemaDirective(declared, pinFor(foreign).schemaId),
    );

    expect(diagnostic.code).toBe('OSCAL_SCHEMA_DIRECTIVE_CONFLICT');
    expect(diagnostic.path).toBe('/$schema');
    // Ausgewählt wurde die Zelle aus metadata.oscal-version — die Direktive
    // hat den Konflikt ausgelöst, aber nichts ausgewählt.
    expect(diagnostic.artifact.oscalVersion).toBe(declared);
    expect(diagnostic.params.expected).toBe(pinFor(declared).schemaId);
  });

  it('erhält ein vorhandenes $schema und ergänzt nie eines', () => {
    const withDirective = mappingSpecFor('mapping-itgs2023-zu-gspp');
    const withoutDirective = mappingSpecFor('mapping-iso27001-annex-a-zu-gspp');

    const present = parseMappingDocument(makeMappingSource(withDirective), context);
    const absent = parseMappingDocument(makeMappingSource(withoutDirective), context);

    expect(Object.hasOwn(present.source as object, '$schema')).toBe(true);
    expect(Object.hasOwn(absent.source as object, '$schema')).toBe(false);
  });
});

describe('Pflichtstruktur der Sammlung', () => {
  it('weist ein Dokument ohne provenance auf beiden Stufen ab', async () => {
    const document = parseMappingDocument(makeMappingWithoutProvenance(), context);

    // Stufe 3: `provenance` ist Pflichtfeld der `mapping-collection`.
    expect((await validateMappingSchema(document)).ok).toBe(false);
    // Stufe „domain": derselbe Befund, aber als Modellaussage und ohne das
    // Dokument zu verwerfen.
    expect(document.view.provenance).toBeNull();
    expect(document.view.diagnostics.map((entry) => entry.code)).toContain(
      codes.PROVENANCE_MISSING,
    );
  });

  it('akzeptiert die Einzelform von mappings als schemavalide', async () => {
    const document = parseMappingDocument(makeMappingWithSingleMappingObject(), context);

    await expect(validateMappingSchema(document)).resolves.toEqual({ ok: true });
    // Ein Adapter, der nur `Array.isArray` prüft, liefe hier leer durch.
    expect(document.view.declaredMappingsForm).toBe('single');
    expect(document.view.mappings).toHaveLength(1);
  });
});

describe('Was das JSON-Schema nicht prüft', () => {
  it('lässt einen erfundenen relationship durch — der Adapter nicht', async () => {
    const document = parseMappingDocument(makeMappingWithUnknownRelationship(), context);

    // Das ist die zentrale Validierungsfalle des Modells: `relationship` ist im
    // JSON-Schema nur `TokenDatatype`, das Vokabular hängt allein am
    // Metaschema-Constraint mit `has-oscal-namespace(…)`.
    await expect(validateMappingSchema(document)).resolves.toEqual({ ok: true });

    expect(document.view.mappings[0]?.maps[0]?.relationship.kind).toBe('unknown');
    expect(document.view.diagnostics.map((entry) => entry.code)).toContain(
      codes.RELATIONSHIP_INVALID,
    );
  });

  it('lässt einen fremden Ressourcentyp durch — der Adapter nicht', async () => {
    const document = parseMappingDocument(makeMappingWithUnknownResourceType(), context);

    // `mapping-resource-reference/type` trägt `anyOf: [TokenDatatype, enum]` —
    // das Muster für `allow-other="yes"`. Die Aufzählung bindet dort nicht.
    await expect(validateMappingSchema(document)).resolves.toEqual({ ok: true });

    expect(document.view.mappings[0]?.targetResource?.type.kind).toBe('unknown');
    expect(document.view.diagnostics.map((entry) => entry.code)).toContain(
      codes.RESOURCE_TYPE_INVALID,
    );
  });

  it('prüft mapping-item.type dagegen auf beiden Stufen', async () => {
    const document = parseMappingDocument(makeMappingWithUnknownItemType(), context);

    // Hier bindet das Schema selbst (`allOf` mit Enum) — die Prüftiefe ist
    // feldweise verschieden, und genau das ist dokumentationspflichtig.
    expect((await validateMappingSchema(document)).ok).toBe(false);
    expect(document.view.diagnostics.map((entry) => entry.code)).toContain(
      codes.ITEM_TYPE_INVALID,
    );
  });

  it('lässt eine doppelte map-uuid durch — der Adapter nicht', async () => {
    const document = parseMappingDocument(makeMappingWithDuplicateUuid(), context);

    // Das Schema kennt keine dokumentweite Eindeutigkeit von `uuid`.
    await expect(validateMappingSchema(document)).resolves.toEqual({ ok: true });
    expect(document.view.diagnostics.map((entry) => entry.code)).toContain(
      codes.UUID_DUPLICATE,
    );
  });
});

describe('ADR-7 — schemainvalides Bestandsartefakt', () => {
  it('parst das ISO-Mapping verlustfrei und diagnostiziert die Schemaverletzung', async () => {
    const specification = mappingSpecFor('mapping-iso27001-annex-a-zu-gspp');
    const source = makeMappingSource(specification);
    const document = parseMappingDocument(source, {
      ...context,
      upstreamPath: specification.upstreamPath,
    });

    const result = await validateMappingSchema(document);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Der beanstandete Schlüssel ist Dokumentinhalt und bleibt redigiert.
    expect(result.diagnostic.code).toBe('OSCAL_SCHEMA_ADDITIONAL_PROPERTY');
    expect(result.diagnostic.path).toBe('/mapping-collection/provenance/*');
    expect(result.diagnostic.artifact.key).toBe(specification.artifactKey);

    // Das Dokument wird trotzdem nicht verworfen: `source` ist unverändert,
    // und die beiden schemafremden Felder sind noch da.
    expect(document.source).toBe(source);
    const body = (document.source as Record<string, Record<string, unknown>>);
    const provenance = body['mapping-collection']!.provenance as Record<string, unknown>;
    expect(provenance['qa-reviewed']).toBeDefined();
    expect(provenance['qa-note']).toBeDefined();
    expect(document.view.mappings.length).toBeGreaterThan(0);
  });
});
