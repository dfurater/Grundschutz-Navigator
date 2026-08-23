// =============================================================================
// Fixture-Korpus — OSCAL Component Definitions (GSPP-248)
//
// Die sechs realen BSI-Definitionen liegen **nicht** im Repository: Weder
// `preview`- noch `blocked-by-upstream`-Artefakte werden von
// `npm run fetch-catalog` materialisiert (`src/domain/sourceRegistry.mjs`
// schreibt nur `supported`-Einträge). Der verbindliche Korpus ist deshalb
// fixture-basiert — dieselbe Konvention wie in
// `oscalRootDispatch.corpus.test.ts` und GSPP-286.
//
// Eingefroren sind hier die am Snapshot `80694713a7a430d12eb2099893de23ad8bb6f780`
// **gemessenen Strukturen**: deklarierte OSCAL-Version, Anzahl Components,
// Capabilities, Control-Implementations und implemented requirements, die
// vorkommenden `component.type`-Werte, die `source`-Muster und die beiden
// realen Schemadefekte aus ADR-7 mit ihrem exakten JSON Pointer. Die Prosa und
// die Identitäten sind erfunden; die Strukturzahlen sind es nicht.
//
// Verteilt wird deterministisch: Gemessen ist die **Summe** je Artefakt, nicht
// ihre Aufteilung über die einzelnen Implementierungen. `distribute()` macht
// daraus eine stabile, reproduzierbare Aufteilung — bis auf die zwei
// Defektstellen, deren Position aus der Messung stammt und deshalb explizit
// gesetzt ist.
// =============================================================================

import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { listOscalArtifacts } from '@/domain/sourceRegistry';

/** Die externe, nicht versionsstabile `source` der AWS-Definition (Branch `main`). */
export const AWS_EXTERNAL_SOURCE =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/blob/main/control_layer/Grundschutz%2B%2B/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-G0-catalog.json';

/** Die am Bestand erhobenen `#uuid`-Quellen, unverändert übernommen. */
export const COMPONENT_SOURCE_UUIDS = Object.freeze({
  keycloak: '#00903e72-6424-4db5-89b6-a48f17fcb8c6',
  lieferkette: '#5f087445-e953-475d-a237-8e671cb8ab9e',
  netzarchitekturPrimary: '#8111d876-6a1c-41de-8a19-4352ab60f8a9',
  netzarchitekturSecondary: '#9d7fe0fa-7fa5-46e7-8f42-6775cbe08368',
  passwortrichtlinie: '#0c1f2cdf-f966-5ec6-b281-a4c577ee4a8a',
});

type JsonObject = Record<string, unknown>;

/**
 * Deterministische, schemagültige UUIDs (Typ 4, Variante 8). Ein Zähler statt
 * `crypto.randomUUID()`: Ein Fixture, das bei jedem Lauf andere Identitäten
 * trägt, taugt nicht als eingefrorener Korpus.
 */
function makeUuid(seed: string, index: number): string {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  const high = hash.toString(16).padStart(8, '0');
  const low = index.toString(16).padStart(12, '0');
  return `${high}-0000-4000-8000-${low}`;
}

/**
 * Verteilt `total` möglichst gleichmäßig auf `buckets` Töpfe. Die vorderen
 * Töpfe bekommen den Rest, damit die Aufteilung eindeutig ist.
 */
function distribute(total: number, buckets: number): readonly number[] {
  const base = Math.floor(total / buckets);
  const remainder = total % buckets;
  return Array.from({ length: buckets }, (_value, index) =>
    index < remainder ? base + 1 : base,
  );
}

interface ImplementationSpec {
  readonly source: string;
  readonly requirementCount: number;
  /**
   * Indizes der implemented requirements, deren `links` als **Einzelobjekt**
   * statt als Array geschrieben werden — der reale Defekt aus
   * `component-lieferkette` (BSI #71).
   */
  readonly singleObjectLinksAt?: readonly number[];
}

interface ComponentSpec {
  readonly type: string;
  readonly implementations: readonly ImplementationSpec[];
}

interface CapabilitySpec {
  readonly implementations: readonly ImplementationSpec[];
}

export interface ComponentArtifactSpec {
  readonly artifactKey: string;
  /** Aus dem Quellregister abgeleitet — hier nie zweitgepflegt (ADR-1). */
  readonly upstreamPath: string;
  /** Aus dem Quellregister abgeleitet — hier nie zweitgepflegt (GSPP-283). */
  readonly oscalVersion: PinnedOscalVersion;
  /** Ob das Dokument gegen sein gepinntes Schema valide ist (ADR-7). */
  readonly schemaValid: boolean;
  readonly components: readonly ComponentSpec[];
  readonly capabilities: readonly CapabilitySpec[];
  /**
   * `import-component-definitions[0].remarks` — ab 1.2.1 zulässig, in 1.1.2
   * schemawidrig. Der reale Defekt aus `component-ga-lotse-grundmodul`
   * (BSI #70).
   */
  readonly importRemarks: boolean;
  /** back-matter-Ressourcen, gegen die `#uuid`-Quellen auflösen. */
  readonly backMatterUuids: readonly string[];
}

function componentsFrom(
  types: readonly string[],
  implementationsPerComponent: readonly number[],
  source: (componentIndex: number, implementationIndex: number) => string,
  requirementsPerImplementation: readonly number[],
  singleObjectLinks?: { component: number; implementation: number; requirements: readonly number[] },
): readonly ComponentSpec[] {
  let flatIndex = 0;
  return implementationsPerComponent.map((implementationCount, componentIndex) => ({
    type: types[componentIndex % types.length]!,
    implementations: Array.from({ length: implementationCount }, (_value, implementationIndex) => {
      const requirementCount = requirementsPerImplementation[flatIndex] ?? 0;
      flatIndex += 1;
      return {
        source: source(componentIndex, implementationIndex),
        requirementCount,
        singleObjectLinksAt:
          singleObjectLinks?.component === componentIndex
          && singleObjectLinks.implementation === implementationIndex
            ? singleObjectLinks.requirements
            : undefined,
      };
    }),
  }));
}

/**
 * Die registrierten Component Definitions, adressiert über ihren
 * Artefaktschlüssel.
 *
 * `upstreamPath` und `oscalVersion` sind **Registerfakten**, keine Messwerte:
 * Das Quellregister ist ihre einzige Quelle der Wahrheit (ADR-1, GSPP-283).
 * Sie hier zweitzupflegen hätte genau den Fehler ermöglicht, den dieses
 * Projekt schon zweimal hatte — die WLAN-Definition wurde upstream durch
 * Keycloak ersetzt (GSPP-319), die AWS-Definitionen durch die
 * Security-Hub-V2-Datei (GSPP-308). Ein Fixture mit eigenem Pfad und eigener
 * Version wäre danach grün geblieben, obwohl es ein Artefakt nachbildet, das
 * es nicht mehr gibt.
 *
 * Eingefroren sind hier ausschließlich die **gemessenen Strukturzahlen**.
 */
const REGISTERED_COMPONENT_ARTIFACTS = new Map(
  listOscalArtifacts()
    .filter((entry) => entry.expectedRootType === 'component-definition')
    .map((entry) => [entry.artifactKey, entry] as const),
);

function compareStringsByCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Die Schlüssel der registrierten Component Definitions, alphabetisch. */
export function listRegisteredComponentArtifactKeys(): readonly string[] {
  return [...REGISTERED_COMPONENT_ARTIFACTS.keys()].sort(compareStringsByCodeUnit);
}

function registryFactsFor(artifactKey: string): {
  readonly artifactKey: string;
  readonly upstreamPath: string;
  readonly oscalVersion: PinnedOscalVersion;
} {
  const entry = REGISTERED_COMPONENT_ARTIFACTS.get(artifactKey);
  if (!entry) {
    // Fail-loud statt eines Ersatzwerts: Ein Fixture für ein nicht (mehr)
    // registriertes Artefakt bildet nichts Reales nach.
    throw new Error(
      `Kein registriertes component-definition-Artefakt mit dem Schlüssel "${artifactKey}"`,
    );
  }
  return {
    artifactKey: entry.artifactKey,
    upstreamPath: entry.upstreamPath,
    oscalVersion: entry.oscalVersion,
  };
}

/**
 * Die sechs registrierten Definitionen mit ihren gemessenen Strukturzahlen.
 *
 * Summen über alle sechs: **35 Components, 10 Capabilities, 35
 * Control-Implementations, 307 implemented requirements.** Genau eine
 * Capability trägt eine eigene `control-implementation`
 * (`component-aws-security-hub`).
 */
export const COMPONENT_ARTIFACT_SPECS: readonly ComponentArtifactSpec[] = Object.freeze([
  {
    ...registryFactsFor('component-aws-security-hub'),
    schemaValid: true,
    // 2 Components mit je einer Implementierung, 1 Capability mit **eigener**
    // Implementierung; 17 implemented requirements über drei Implementierungen.
    components: componentsFrom(
      ['software'],
      [1, 1],
      () => AWS_EXTERNAL_SOURCE,
      distribute(17, 3).slice(0, 2),
    ),
    capabilities: [
      {
        implementations: [
          { source: AWS_EXTERNAL_SOURCE, requirementCount: distribute(17, 3)[2]! },
        ],
      },
    ],
    importRemarks: false,
    backMatterUuids: [],
  },
  {
    ...registryFactsFor('component-ga-lotse-grundmodul'),
    schemaValid: false,
    // 3 Components, 1 Capability, **keine** Control-Implementation und damit
    // keine implemented requirements — schemaseitig gültig.
    components: componentsFrom(['software'], [0, 0, 0], () => '', []),
    capabilities: [{ implementations: [] }],
    importRemarks: true,
    backMatterUuids: [],
  },
  {
    ...registryFactsFor('component-keycloak'),
    schemaValid: true,
    // 3 Components, **keine** Capability, 43 implemented requirements.
    components: componentsFrom(
      ['software', 'service'],
      [1, 1, 1],
      () => COMPONENT_SOURCE_UUIDS.keycloak,
      distribute(43, 3),
    ),
    capabilities: [],
    importRemarks: false,
    backMatterUuids: [COMPONENT_SOURCE_UUIDS.keycloak.slice(1)],
  },
  {
    ...registryFactsFor('component-lieferkette'),
    schemaValid: false,
    // 11 Components mit je einer Implementierung, 3 Capabilities ohne eigene;
    // 145 implemented requirements. Der Defekt sitzt an
    // components/1/control-implementations/0/implemented-requirements/0..2.
    components: componentsFrom(
      ['policy', 'process-procedure', 'service', 'plan', 'software'],
      Array.from({ length: 11 }, () => 1),
      () => COMPONENT_SOURCE_UUIDS.lieferkette,
      distribute(145, 11),
      { component: 1, implementation: 0, requirements: [0, 1, 2] },
    ),
    capabilities: [{ implementations: [] }, { implementations: [] }, { implementations: [] }],
    importRemarks: false,
    backMatterUuids: [COMPONENT_SOURCE_UUIDS.lieferkette.slice(1)],
  },
  {
    ...registryFactsFor('component-netzarchitektur'),
    schemaValid: true,
    // 9 Components, 4 Capabilities ohne eigene Implementierung, 11
    // Control-Implementations und 85 implemented requirements — und **zwei**
    // verschiedene `#uuid`-Quellen in einem Dokument.
    components: componentsFrom(
      ['policy', 'plan', 'service', 'software', 'process-procedure'],
      [2, 2, 1, 1, 1, 1, 1, 1, 1],
      (componentIndex) =>
        componentIndex % 2 === 0
          ? COMPONENT_SOURCE_UUIDS.netzarchitekturPrimary
          : COMPONENT_SOURCE_UUIDS.netzarchitekturSecondary,
      distribute(85, 11),
    ),
    capabilities: [
      { implementations: [] },
      { implementations: [] },
      { implementations: [] },
      { implementations: [] },
    ],
    importRemarks: false,
    backMatterUuids: [
      COMPONENT_SOURCE_UUIDS.netzarchitekturPrimary.slice(1),
      COMPONENT_SOURCE_UUIDS.netzarchitekturSecondary.slice(1),
    ],
  },
  {
    ...registryFactsFor('component-passwortrichtlinie'),
    schemaValid: true,
    // 7 Components mit je einer Implementierung, 1 Capability ohne eigene;
    // 17 implemented requirements.
    components: componentsFrom(
      ['software', 'policy'],
      Array.from({ length: 7 }, () => 1),
      () => COMPONENT_SOURCE_UUIDS.passwortrichtlinie,
      distribute(17, 7),
    ),
    capabilities: [{ implementations: [] }],
    importRemarks: false,
    backMatterUuids: [COMPONENT_SOURCE_UUIDS.passwortrichtlinie.slice(1)],
  },
]);

function makeMetadata(artifactKey: string, oscalVersion: PinnedOscalVersion): JsonObject {
  return {
    title: `Fixture ${artifactKey}`,
    'last-modified': '2026-08-17T00:00:00Z',
    version: '2026-08-17',
    'oscal-version': oscalVersion,
  };
}

function makeImplementedRequirement(
  seed: string,
  index: number,
  singleObjectLinks: boolean,
): JsonObject {
  const links = [{ href: `#anhang-${index}`, rel: 'reference', text: `Anhang ${index}` }];
  return {
    uuid: makeUuid(`${seed}/requirement`, index),
    'control-id': `GC.${(index % 19) + 1}.${(index % 7) + 1}`,
    description: `Umsetzungsbehauptung ${index}.`,
    props: [{ name: 'implementation-status', value: 'implemented', remarks: 'Feld ohne Projektion.' }],
    // Nicht normalisieren: Ein Einzelobjekt bleibt ein Einzelobjekt.
    links: singleObjectLinks ? links[0]! : links,
  };
}

function makeControlImplementation(
  seed: string,
  index: number,
  specification: ImplementationSpec,
): JsonObject {
  const singleObjectLinks = new Set(specification.singleObjectLinksAt ?? []);
  return {
    uuid: makeUuid(`${seed}/implementation`, index),
    source: specification.source,
    description: `Implementierung ${index} gegen die deklarierte Quelle.`,
    'implemented-requirements': Array.from(
      { length: specification.requirementCount },
      (_value, requirementIndex) =>
        makeImplementedRequirement(
          `${seed}/implementation/${index}`,
          requirementIndex,
          singleObjectLinks.has(requirementIndex),
        ),
    ),
  };
}

/**
 * Materialisiert ein Fixture-Dokument aus seiner Strukturbeschreibung.
 *
 * Das Ergebnis ist bei jedem Aufruf ein **neuer** Objektgraph — Tests, die
 * Mutationsfreiheit prüfen, dürfen keine gemeinsame Quelle teilen.
 */
export function makeComponentDefinitionSource(specification: ComponentArtifactSpec): JsonObject {
  const seed = specification.artifactKey;
  const body: JsonObject = {
    uuid: makeUuid(seed, 0),
    metadata: makeMetadata(specification.artifactKey, specification.oscalVersion),
  };

  if (specification.importRemarks) {
    body['import-component-definitions'] = [
      {
        href: 'https://example.invalid/basis-component_definition.json',
        // In 1.1.2 verletzt genau dieses Feld `additionalProperties: false`.
        remarks: 'Basisdefinition des Grundmoduls.',
      },
    ];
  }

  if (specification.components.length > 0) {
    body.components = specification.components.map((component, componentIndex) => ({
      uuid: makeUuid(`${seed}/component`, componentIndex),
      type: component.type,
      title: `Komponente ${componentIndex}`,
      description: `Beschreibung der Komponente ${componentIndex}.`,
      ...(component.implementations.length > 0
        ? {
          'control-implementations': component.implementations.map(
            (implementation, implementationIndex) =>
              makeControlImplementation(
                `${seed}/component/${componentIndex}`,
                implementationIndex,
                implementation,
              ),
          ),
        }
        : {}),
    }));
  }

  if (specification.capabilities.length > 0) {
    body.capabilities = specification.capabilities.map((capability, capabilityIndex) => ({
      uuid: makeUuid(`${seed}/capability`, capabilityIndex),
      name: `capability-${capabilityIndex}`,
      description: `Beschreibung der Capability ${capabilityIndex}.`,
      ...(capability.implementations.length > 0
        ? {
          'control-implementations': capability.implementations.map(
            (implementation, implementationIndex) =>
              makeControlImplementation(
                `${seed}/capability/${capabilityIndex}`,
                implementationIndex,
                implementation,
              ),
          ),
        }
        : {}),
    }));
  }

  if (specification.backMatterUuids.length > 0) {
    body['back-matter'] = {
      resources: specification.backMatterUuids.map((uuid, index) => ({
        uuid,
        title: `Zielkatalog ${index}`,
        rlinks: [{ href: `https://example.invalid/katalog-${index}.json` }],
      })),
    };
  }

  return { 'component-definition': body };
}

/** Alle sechs Fixture-Dokumente, je Aufruf frisch materialisiert. */
export function makeAllComponentDefinitionSources(): readonly {
  readonly specification: ComponentArtifactSpec;
  readonly source: JsonObject;
}[] {
  return COMPONENT_ARTIFACT_SPECS.map((specification) => ({
    specification,
    source: makeComponentDefinitionSource(specification),
  }));
}

/* ------------------------------------------------------------------ */
/*  Ergänzende synthetische Fixtures                                   */
/* ------------------------------------------------------------------ */

const SYNTHETIC_UUID = '11111111-1111-4111-8111-111111111111';

function makeSyntheticBody(oscalVersion: string, extra: JsonObject = {}): JsonObject {
  return {
    uuid: SYNTHETIC_UUID,
    metadata: {
      title: 'Synthetisches Fixture',
      'last-modified': '2026-08-17T00:00:00Z',
      version: '1',
      'oscal-version': oscalVersion,
    },
    ...extra,
  };
}

/** Gültige Definition **ohne** `components` — schemaseitig zulässig. */
export function makeComponentDefinitionWithoutComponents(
  oscalVersion: PinnedOscalVersion = '1.2.2',
): JsonObject {
  return { 'component-definition': makeSyntheticBody(oscalVersion) };
}

/**
 * Derselbe Feldinhalt, zwei Versionen: `import-component-definitions[0].remarks`
 * ist ab 1.2.1 gültig und darunter schemawidrig.
 */
export function makeComponentDefinitionWithImportRemarks(
  oscalVersion: PinnedOscalVersion,
): JsonObject {
  return {
    'component-definition': makeSyntheticBody(oscalVersion, {
      'import-component-definitions': [
        { href: 'https://example.invalid/basis.json', remarks: 'Nachnutzung des Grundmoduls.' },
      ],
    }),
  };
}

/** Eine `oscal-version`, die die Matrix nicht pinnt — fail-closed erwartet. */
export function makeComponentDefinitionWithUnpinnedVersion(version = '1.0.4'): JsonObject {
  return { 'component-definition': makeSyntheticBody(version) };
}

/**
 * Ein Dokument mit Top-Level-`$schema`. Die Zelle wählt allein
 * `metadata.oscal-version`; `$schema` ist nur Kreuzprobe.
 */
export function makeComponentDefinitionWithSchemaDirective(
  oscalVersion: PinnedOscalVersion,
  schemaDirective: string,
): JsonObject {
  return {
    $schema: schemaDirective,
    'component-definition': makeSyntheticBody(oscalVersion),
  };
}

/** Dokumentweit doppelte UUID über Component-, Capability- und Requirement-Grenzen. */
export function makeComponentDefinitionWithDuplicateUuids(): JsonObject {
  return {
    'component-definition': makeSyntheticBody('1.2.2', {
      components: [
        {
          uuid: SYNTHETIC_UUID,
          type: 'software',
          title: 'Erste Komponente',
          description: 'Erste.',
        },
        {
          // Dieselbe UUID ein zweites Mal — hier muss die Diagnose entstehen.
          uuid: SYNTHETIC_UUID,
          type: 'software',
          title: 'Zweite Komponente',
          description: 'Zweite.',
        },
      ],
    }),
  };
}

/**
 * Strukturprobe für den No-op-Round-trip: leere Container, unbekannte Felder
 * und eine schemawidrige Kardinalität.
 *
 * Dieses Dokument ist **absichtlich nicht schemavalide**. Genau das ist der
 * Punkt: Verlustfreiheit nach ADR-2 gilt unabhängig von der Schemavalidität,
 * und `contentMultiset()` führt leere Arrays und leere Objekte als eigene
 * Marker — ohne sie liefe der Erhaltungsnachweis an dieser Stelle leer durch.
 */
export function makeStructureProbeComponentDefinition(): JsonObject {
  return {
    'component-definition': {
      uuid: SYNTHETIC_UUID,
      metadata: {
        title: 'Strukturprobe',
        'last-modified': '2026-08-17T00:00:00Z',
        version: '1',
        'oscal-version': '1.2.2',
        'x-bsi-erweiterung': { hinweis: 'Unbekanntes Feld.' },
      },
      components: [
        {
          uuid: '22222222-2222-4222-8222-222222222222',
          type: 'software',
          title: 'Probe',
          description: 'Probe.',
          props: [],
          'x-bsi-leeres-objekt': {},
          'control-implementations': [
            {
              uuid: '44444444-4444-4444-8444-444444444444',
              source: '#55555555-5555-4555-8555-555555555555',
              description: 'Probe.',
              'implemented-requirements': [
                {
                  uuid: '66666666-6666-4666-8666-666666666666',
                  'control-id': 'GC.1.1',
                  description: 'Probe.',
                  // Einzelobjekt statt Array — die Kardinalitätsverletzung aus
                  // `component-lieferkette`, hier isoliert.
                  links: { href: '#anhang', rel: 'reference' },
                },
              ],
            },
          ],
        },
      ],
      capabilities: [],
    },
  };
}

/**
 * Inhaltsreiches Dokument für den No-op-Round-trip: `set-parameters`,
 * `statements`, `responsible-roles`, `props.remarks`, ein `mapping` von
 * `control-id` auf eine Profile-Quelle, unbekannte Felder, leere Container und
 * eine relative Referenz.
 */
export function makeRichComponentDefinitionSource(): JsonObject {
  return {
    // Die `$id` der Zelle `component-definition@1.2.2`. Weicht sie ab, weist
    // schon Stufe 2 mit `OSCAL_SCHEMA_DIRECTIVE_CONFLICT` ab — genau die
    // Kreuzprobe, die `$schema` leisten soll.
    $schema: 'http://csrc.nist.gov/ns/oscal/1.2.2/oscal-component-definition-schema.json',
    'component-definition': {
      uuid: SYNTHETIC_UUID,
      metadata: {
        title: 'Reichhaltiges Fixture',
        'last-modified': '2026-08-17T00:00:00Z',
        version: '1',
        'oscal-version': '1.2.2',
        'document-ids': [{ scheme: 'https://example.invalid/ns', identifier: 'doc-1' }],
        props: [{ name: 'marking', value: 'oeffentlich', remarks: 'Feld ohne Projektion.' }],
      },
      'import-component-definitions': [
        { href: '../Basis/basis-component_definition.json', remarks: 'Relative Referenz.' },
      ],
      components: [
        {
          uuid: '22222222-2222-4222-8222-222222222222',
          type: 'service',
          title: 'Dienst',
          description: 'Ein Dienst.',
          purpose: 'Bereitstellung.',
          props: [{ name: 'version', value: '1.0', ns: 'https://example.invalid/ns' }],
          links: [{ href: '#22222222-2222-4222-8222-222222222222', rel: 'reference' }],
          'responsible-roles': [
            {
              'role-id': 'betrieb',
              'party-uuids': ['99999999-9999-4999-8999-999999999999'],
              remarks: 'Rolle ohne Projektion im Katalogmodell.',
            },
          ],
          protocols: [
            {
              uuid: '33333333-3333-4333-8333-333333333333',
              name: 'https',
              'port-ranges': [{ start: 443, end: 443, transport: 'TCP' }],
            },
          ],
          'control-implementations': [
            {
              uuid: '44444444-4444-4444-8444-444444444444',
              // Eine Profile-Quelle: `control-id` ist dann im Kontext des
              // Profils zu lesen, nicht im Kontext eines Katalogs.
              source: '#55555555-5555-4555-8555-555555555555',
              description: 'Umsetzung gegen ein Profil.',
              'set-parameters': [
                { 'param-id': 'schluessellaenge', values: ['256'], remarks: 'Vorgabe.' },
              ],
              'implemented-requirements': [
                {
                  uuid: '66666666-6666-4666-8666-666666666666',
                  'control-id': 'GC.1.1',
                  description: 'Erfüllt.',
                  'set-parameters': [{ 'param-id': 'frist', values: ['30', '90'] }],
                  'responsible-roles': [{ 'role-id': 'betrieb' }],
                  statements: [
                    {
                      'statement-id': 'GC.1.1_smt',
                      uuid: '77777777-7777-4777-8777-777777777777',
                      description: 'Teilaussage.',
                      'responsible-roles': [{ 'role-id': 'betrieb' }],
                      remarks: 'Bemerkung zur Teilaussage.',
                    },
                  ],
                  remarks: 'Bemerkung zur Anforderung.',
                },
              ],
            },
          ],
        },
      ],
      capabilities: [
        {
          uuid: '88888888-8888-4888-8888-888888888888',
          name: 'verbund',
          description: 'Verbund aus Komponenten.',
          'incorporates-components': [
            {
              'component-uuid': '22222222-2222-4222-8222-222222222222',
              description: 'Bindet den Dienst ein.',
            },
          ],
        },
      ],
      'back-matter': {
        resources: [
          {
            uuid: '55555555-5555-4555-8555-555555555555',
            title: 'Zielprofil',
            rlinks: [{ href: 'https://example.invalid/profil.json' }],
          },
        ],
      },
    },
  };
}
