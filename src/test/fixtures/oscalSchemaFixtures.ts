/**
 * Schemavalide OSCAL-Minimaldokumente je Root-Modell (GSPP-343).
 *
 * Projekteigen und bewusst **nicht** aus
 * [oscal-content](https://github.com/usnistgov/oscal-content) übernommen: Die
 * Tests müssen ohne Netz und ohne Fremdartefakte im Repository laufen, und
 * keines der 64 Korpusdokumente aus [GSPP-282] ist minimal. Der Korpus dient
 * ausschließlich als **Vorlage**; je Fixture ist unten benannt, aus welchem
 * Dokument die Struktur abgeleitet ist. `mapping-collection` fehlt dort
 * vollständig und ist deshalb ein eigener Entwurf gegen
 * `oscal_mapping_schema.json` 1.2.2.
 *
 * `makeOscalEnvelope()` genügt für Stufe 3 nicht: Sein `uuid: "uuid-catalog"`
 * verletzt `UUIDDatatype`. Es bleibt der Fixture-Helfer der Stufe 2.
 *
 * Die Werte sind erfunden; es stehen keine echten Organisationsdaten darin.
 * `oscal-version` wird ohne führendes `v` deklariert — die vier Dokumente in
 * oscal-content v1.5.0, die `"v1.2.2"` schreiben, werden von
 * `resolveSchemaBinding()` als `OSCAL_VERSION_MALFORMED` abgewiesen, und das
 * ist gewolltes Bestandsverhalten.
 */

import type { OscalRootKey, PinnedOscalVersion } from '@/domain/oscalVersionMatrix';

/**
 * `id` = `ac-1` ist kein Zierrat: Der Wert durchläuft OSCALs `TokenDatatype`
 * `^(\p{L}|_)(\p{L}|\p{N}|[.\-_])*$`. Wertet die Engine die Regex ohne
 * `u`-Flag aus, liest sie `\p` als `p` und weist das Dokument ab. Der positive
 * Lauf ist damit das billige Negativorakel gegen eine Ajv-Version ohne
 * `unicodeRegExp` — etwa die transitiv über ESLint vorhandene 6.15.0.
 */
export const TOKEN_DATATYPE_PROBE_CONTROL_ID = 'ac-1';

function makeMetadata(oscalVersion: PinnedOscalVersion): Record<string, unknown> {
  return {
    title: 'Minimalbeispiel',
    'last-modified': '2026-08-16T00:00:00Z',
    version: '1.0.0',
    'oscal-version': oscalVersion,
  };
}

const CATALOG_UUID = '11111111-1111-4111-8111-111111111111';
const PROFILE_UUID = '22222222-2222-4222-8222-222222222222';
const MAPPING_UUID = '33333333-3333-4333-8333-333333333333';
const COMPONENT_UUID = '44444444-4444-4444-8444-444444444444';
const SSP_UUID = '55555555-5555-4555-8555-555555555555';
const ASSESSMENT_PLAN_UUID = '66666666-6666-4666-8666-666666666666';
const ASSESSMENT_RESULTS_UUID = '77777777-7777-4777-8777-777777777777';
const POAM_UUID = '88888888-8888-4888-8888-888888888888';

type FixtureBuilder = (oscalVersion: PinnedOscalVersion) => Record<string, unknown>;

const FIXTURE_BUILDERS: Readonly<Record<OscalRootKey, FixtureBuilder>> = Object.freeze({
  // Abgeleitet von `examples/catalog/json/basic-catalog.json`.
  catalog: (oscalVersion) => ({
    catalog: {
      uuid: CATALOG_UUID,
      metadata: makeMetadata(oscalVersion),
      groups: [{
        id: 'ac',
        title: 'Zugriffssteuerung',
        controls: [{ id: TOKEN_DATATYPE_PROBE_CONTROL_ID, title: 'Richtlinie und Verfahren' }],
      }],
    },
  }),

  // Abgeleitet von `examples/profile/json/basic-profile.json`.
  profile: (oscalVersion) => ({
    profile: {
      uuid: PROFILE_UUID,
      metadata: makeMetadata(oscalVersion),
      imports: [{
        href: `#${CATALOG_UUID}`,
        'include-controls': [{ 'with-ids': [TOKEN_DATATYPE_PROBE_CONTROL_ID] }],
      }],
    },
  }),

  // Ohne Vorlage: oscal-content führt kein Mapping-Dokument. Entworfen gegen
  // die Pflichtfelder von `oscal_mapping_schema.json` 1.2.2.
  'mapping-collection': (oscalVersion) => ({
    'mapping-collection': {
      uuid: MAPPING_UUID,
      metadata: makeMetadata(oscalVersion),
      provenance: {
        method: 'human',
        'matching-rationale': 'semantic',
        'mapping-description': 'Minimale Zuordnung zweier Beispielkataloge.',
        status: 'draft',
      },
      mappings: [{
        uuid: '33333333-3333-4333-8333-3333333300a1',
        'source-resource': { type: 'catalog', href: `#${CATALOG_UUID}` },
        'target-resource': { type: 'catalog', href: `#${COMPONENT_UUID}` },
        maps: [{
          uuid: '33333333-3333-4333-8333-3333333300b2',
          relationship: 'equivalent-to',
          sources: [{ type: 'control', 'id-ref': TOKEN_DATATYPE_PROBE_CONTROL_ID }],
          targets: [{ type: 'control', 'id-ref': TOKEN_DATATYPE_PROBE_CONTROL_ID }],
        }],
      }],
    },
  }),

  // Abgeleitet von `examples/component-definition/json/example-component-definition.json`.
  'component-definition': (oscalVersion) => ({
    'component-definition': {
      uuid: COMPONENT_UUID,
      metadata: makeMetadata(oscalVersion),
      components: [{
        uuid: '44444444-4444-4444-8444-4444444400a1',
        type: 'software',
        title: 'Beispielkomponente',
        description: 'Minimale Komponente ohne echte Betriebsdaten.',
      }],
    },
  }),

  // Abgeleitet von `examples/ssp/json/ssp-example.json`.
  'system-security-plan': (oscalVersion) => ({
    'system-security-plan': {
      uuid: SSP_UUID,
      metadata: makeMetadata(oscalVersion),
      'import-profile': { href: `#${PROFILE_UUID}` },
      'system-characteristics': {
        'system-ids': [{ id: 'beispielsystem' }],
        'system-name': 'Beispielsystem',
        description: 'Minimales System ohne echte Betriebsdaten.',
        'security-sensitivity-level': 'moderate',
        'system-information': {
          'information-types': [{
            uuid: '55555555-5555-4555-8555-5555555500a1',
            title: 'Betriebsdaten',
            description: 'Minimale Informationsart.',
          }],
        },
        status: { state: 'operational' },
        'authorization-boundary': { description: 'Minimale Systemgrenze.' },
      },
      'system-implementation': {
        users: [{ uuid: '55555555-5555-4555-8555-5555555500b2' }],
        components: [{
          uuid: '55555555-5555-4555-8555-5555555500c3',
          type: 'software',
          title: 'Beispielkomponente',
          description: 'Minimale Komponente.',
          status: { state: 'operational' },
        }],
      },
      'control-implementation': {
        description: 'Minimale Umsetzungsbeschreibung.',
        'implemented-requirements': [{
          uuid: '55555555-5555-4555-8555-5555555500d4',
          'control-id': TOKEN_DATATYPE_PROBE_CONTROL_ID,
        }],
      },
    },
  }),

  // Abgeleitet von `examples/ap/json/ifa_assessment-plan-example.json`.
  'assessment-plan': (oscalVersion) => ({
    'assessment-plan': {
      uuid: ASSESSMENT_PLAN_UUID,
      metadata: makeMetadata(oscalVersion),
      'import-ssp': { href: `#${SSP_UUID}` },
      'reviewed-controls': { 'control-selections': [{ 'include-all': {} }] },
    },
  }),

  // Abgeleitet von `examples/ar/json/ifa_assessment-results-example.json`.
  'assessment-results': (oscalVersion) => ({
    'assessment-results': {
      uuid: ASSESSMENT_RESULTS_UUID,
      metadata: makeMetadata(oscalVersion),
      'import-ap': { href: `#${ASSESSMENT_PLAN_UUID}` },
      results: [{
        uuid: '77777777-7777-4777-8777-7777777700a1',
        title: 'Minimalergebnis',
        description: 'Minimales Ergebnis ohne echte Evidenz.',
        start: '2026-08-16T00:00:00Z',
        'reviewed-controls': { 'control-selections': [{ 'include-all': {} }] },
      }],
    },
  }),

  // Abgeleitet von `examples/poam/json/ifa_plan-of-action-and-milestones.json`.
  'plan-of-action-and-milestones': (oscalVersion) => ({
    'plan-of-action-and-milestones': {
      uuid: POAM_UUID,
      metadata: makeMetadata(oscalVersion),
      'poam-items': [{
        uuid: '88888888-8888-4888-8888-8888888800a1',
        title: 'Minimaleintrag',
        description: 'Minimaler POA&M-Eintrag ohne echte Befunde.',
      }],
    },
  }),
});

/** Ein gegen die gepinnte Zelle schemavalides Minimaldokument. */
export function makeSchemaValidOscalDocument(
  rootKey: OscalRootKey,
  oscalVersion: PinnedOscalVersion,
): Record<string, unknown> {
  return FIXTURE_BUILDERS[rootKey](oscalVersion);
}

/**
 * Dasselbe Dokument ohne das Pflichtfeld `metadata.title`. Der Verstoß sitzt
 * bewusst in `metadata`, also in jedem Root-Modell an derselben Stelle: So
 * belegt der Negativtest die Stufe und nicht die Eigenheit eines Modells.
 */
export function makeSchemaInvalidOscalDocument(
  rootKey: OscalRootKey,
  oscalVersion: PinnedOscalVersion,
): Record<string, unknown> {
  const document = makeSchemaValidOscalDocument(rootKey, oscalVersion);
  const body = document[rootKey] as Record<string, unknown>;
  const metadata = { ...(body.metadata as Record<string, unknown>) };
  delete metadata.title;

  return { [rootKey]: { ...body, metadata } };
}

/**
 * Ein Katalog, der eine charakteristische Zeichenkette **zugleich** als Wert
 * und als unbekannten Property-Namen trägt. Ajv meldet dafür
 * `additionalProperties` und legt den Namen in `params.additionalProperty` ab;
 * genau dieser Weg darf keine Diagnose erreichen.
 */
export function makeSchemaLeakProbeDocument(
  marker: string,
  oscalVersion: PinnedOscalVersion,
): Record<string, unknown> {
  const document = makeSchemaValidOscalDocument('catalog', oscalVersion);
  const body = document.catalog as Record<string, unknown>;

  return {
    catalog: {
      ...body,
      metadata: { ...(body.metadata as Record<string, unknown>), [marker]: marker },
    },
  };
}
