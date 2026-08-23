// =============================================================================
// Fixture-Korpus — OSCAL Profile (GSPP-240)
//
// Die drei realen BSI-Profile liegen **nicht** im Repository: `npm run
// fetch-catalog` materialisiert ausschließlich `supported`-Artefakte, und alle
// drei Profile sind `preview` (`src/domain/sourceRegistry.mjs`). Der
// verbindliche Korpus ist deshalb fixture-basiert — dieselbe Konvention wie in
// `oscalRootDispatch.corpus.test.ts`, GSPP-286 und GSPP-248.
//
// Eingefroren sind hier die am Snapshot `80694713a7a430d12eb2099893de23ad8bb6f780`
// **gemessenen Strukturen**: Zahl und Form der Imports, die Selektionsvariante
// je Import, `with-child-controls` in beiden Werten, die Merge-Variante, Zahl
// und Verteilung der `alters`, `set-parameters` und `back-matter`-Ressourcen
// sowie die realen relativen `rlinks`. Die Prosa und die Identitäten sind
// erfunden; die Strukturzahlen und die Pfade sind es nicht.
//
// `upstreamPath` und `oscalVersion` kommen aus dem Quellregister und werden
// hier nie zweitgepflegt (ADR-1, GSPP-283): Ein Fixture mit eigenem Pfad bliebe
// grün, obwohl es ein Artefakt nachbildet, das es upstream nicht mehr gibt.
// =============================================================================

import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { listOscalArtifacts } from '@/domain/sourceRegistry';

type JsonObject = Record<string, unknown>;

/**
 * Die am Bestand erhobenen relativen `rlinks`. Sie zeigen mit `../`-Segmenten
 * auf Quellkataloge, die das Register **nicht** führt. Genau so bleiben sie:
 * nicht normalisiert, nicht aufgelöst und nicht als Traversal-Angriff
 * etikettiert (GSPP-286).
 */
export const PROFILE_SOURCE_RLINKS = Object.freeze({
  gsppMethodik: '../catalogs/Methodik-Grundschutz++/BSI-Methodik-Grundschutz++-catalog.json',
  gsppRisiko: '../../../Risikomanagement/BSI-Anforderungen-zum-Risikomanagement-catalog.json',
  gsppKernelG0: '../catalogs/Kernel/BSI-Stand-der-Technik-Kernel-G0-catalog.json',
  lieferketteKernel:
    '../../../Grundschutz++/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-catalog.json',
  wlanKernelG0:
    '../../../Grundschutz++/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-G0-catalog.json',
});

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
  return `${hash.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  Strukturbeschreibung der drei registrierten Profile                */
/* ------------------------------------------------------------------ */

interface SelectorSpec {
  readonly withChildControls?: 'yes' | 'no';
  readonly withIdCount: number;
}

type ImportSelectionSpec =
  | { readonly kind: 'include-all' }
  | { readonly kind: 'include-controls'; readonly selectors: readonly SelectorSpec[] };

interface ImportSpec {
  /** Index der `back-matter`-Ressource, auf die das `#uuid`-Fragment zeigt. */
  readonly resourceIndex: number;
  readonly selection: ImportSelectionSpec;
}

interface BackMatterResourceSpec {
  /** Relativer `rlink`; `undefined` für Ressourcen ohne Zielverweis. */
  readonly rlink?: string;
}

export interface ProfileArtifactSpec {
  readonly artifactKey: string;
  /** Aus dem Quellregister abgeleitet — hier nie zweitgepflegt (ADR-1). */
  readonly upstreamPath: string;
  /** Aus dem Quellregister abgeleitet — hier nie zweitgepflegt (GSPP-283). */
  readonly oscalVersion: PinnedOscalVersion;
  /** Ob das Dokument gegen sein gepinntes Schema valide ist (ADR-7). */
  readonly schemaValid: boolean;
  readonly imports: readonly ImportSpec[];
  readonly merge: 'as-is' | 'custom';
  /** Zahl der eindeutigen `control-id` in `modify.alters`. */
  readonly alterControlIds: number;
  /** `alter`-Einträge je `control-id` — im WLAN-Profil mehr als einer. */
  readonly altersPerControlId: number;
  readonly setParameterCount: number;
  readonly backMatter: readonly BackMatterResourceSpec[];
}

const REGISTERED_PROFILE_ARTIFACTS = new Map(
  listOscalArtifacts()
    .filter((entry) => entry.expectedRootType === 'profile')
    .map((entry) => [entry.artifactKey, entry] as const),
);

function compareStringsByCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Die Schlüssel der registrierten Profile, alphabetisch. */
export function listRegisteredProfileArtifactKeys(): readonly string[] {
  return [...REGISTERED_PROFILE_ARTIFACTS.keys()].sort(compareStringsByCodeUnit);
}

function registryFactsFor(artifactKey: string): {
  readonly artifactKey: string;
  readonly upstreamPath: string;
  readonly oscalVersion: PinnedOscalVersion;
} {
  const entry = REGISTERED_PROFILE_ARTIFACTS.get(artifactKey);
  if (!entry) {
    // Fail-loud statt eines Ersatzwerts: Ein Fixture für ein nicht (mehr)
    // registriertes Artefakt bildet nichts Reales nach.
    throw new Error(`Kein registriertes profile-Artefakt mit dem Schlüssel "${artifactKey}"`);
  }
  return {
    artifactKey: entry.artifactKey,
    upstreamPath: entry.upstreamPath,
    oscalVersion: entry.oscalVersion,
  };
}

/**
 * Die drei registrierten Profile mit ihren gemessenen Strukturzahlen.
 *
 * Zum WLAN-Profil: gemessen sind **290** `alters` über **58** eindeutige
 * `control-id` bei einem Maximum von **fünf** Einträgen je Control. Da
 * 290 = 58 × 5 ist, lässt dieses Maximum nur die Gleichverteilung zu — genau
 * die bildet das Fixture ab. Entscheidend für den Adapter ist ohnehin nicht die
 * Verteilung, sondern dass mehrere Einträge auf derselben `control-id` weder
 * verworfen noch überschrieben werden.
 */
export const PROFILE_ARTIFACT_SPECS: readonly ProfileArtifactSpec[] = Object.freeze([
  {
    ...registryFactsFor('profile-gspp'),
    schemaValid: true,
    // 3 Imports: zweimal `include-all`, einmal `include-controls` mit 4 IDs.
    imports: [
      { resourceIndex: 0, selection: { kind: 'include-all' } },
      { resourceIndex: 1, selection: { kind: 'include-all' } },
      {
        resourceIndex: 2,
        selection: {
          kind: 'include-controls',
          selectors: [{ withChildControls: 'no', withIdCount: 4 }],
        },
      },
    ],
    merge: 'as-is',
    alterControlIds: 0,
    altersPerControlId: 0,
    setParameterCount: 2,
    backMatter: [
      { rlink: PROFILE_SOURCE_RLINKS.gsppMethodik },
      { rlink: PROFILE_SOURCE_RLINKS.gsppRisiko },
      { rlink: PROFILE_SOURCE_RLINKS.gsppKernelG0 },
      // Die vierte Ressource trägt keinen `rlink` — sie ist kein Importziel.
      {},
    ],
  },
  {
    ...registryFactsFor('profile-lieferkette'),
    schemaValid: true,
    imports: [
      {
        resourceIndex: 0,
        selection: {
          kind: 'include-controls',
          selectors: [{ withChildControls: 'no', withIdCount: 146 }],
        },
      },
    ],
    merge: 'as-is',
    alterControlIds: 0,
    altersPerControlId: 0,
    setParameterCount: 0,
    backMatter: [{ rlink: PROFILE_SOURCE_RLINKS.lieferketteKernel }],
  },
  {
    ...registryFactsFor('profile-wlan'),
    schemaValid: true,
    // Ein Import mit **zwei** Selektoren — und `with-child-controls` in beiden
    // Werten, was sonst nirgends im Bestand vorkommt.
    imports: [
      {
        resourceIndex: 0,
        selection: {
          kind: 'include-controls',
          selectors: [
            { withChildControls: 'yes', withIdCount: 42 },
            { withChildControls: 'no', withIdCount: 3 },
          ],
        },
      },
    ],
    merge: 'custom',
    alterControlIds: 58,
    altersPerControlId: 5,
    setParameterCount: 4,
    backMatter: [
      { rlink: PROFILE_SOURCE_RLINKS.wlanKernelG0 },
      {}, {}, {}, {}, {}, {}, {}, {},
    ],
  },
]);

/* ------------------------------------------------------------------ */
/*  Materialisierung der drei Profile                                  */
/* ------------------------------------------------------------------ */

/** Die im Issue namentlich belegten Änderungsziele des WLAN-Profils. */
export const WLAN_ALTER_CONTROL_IDS = Object.freeze([
  'ASST.2.2',
  'ASST.2.2.1',
  'BES.2.1.4.2',
]);

function makeControlId(seed: string, index: number): string {
  const named = WLAN_ALTER_CONTROL_IDS[index];
  if (named !== undefined) return named;
  return `${seed.toUpperCase().replaceAll('-', '.')}.${index}`;
}

function makeMetadata(artifactKey: string, oscalVersion: PinnedOscalVersion): JsonObject {
  return {
    title: `Fixture ${artifactKey}`,
    'last-modified': '2026-08-17T00:00:00Z',
    version: '2026-08-17',
    'oscal-version': oscalVersion,
  };
}

function makeSelector(seed: string, index: number, specification: SelectorSpec): JsonObject {
  return {
    ...(specification.withChildControls === undefined
      ? {}
      : { 'with-child-controls': specification.withChildControls }),
    'with-ids': Array.from(
      { length: specification.withIdCount },
      (_value, idIndex) => `${seed}.${index}.${idIndex}`,
    ),
  };
}

function makeImport(
  seed: string,
  index: number,
  specification: ImportSpec,
  resourceUuids: readonly string[],
): JsonObject {
  // Im Bestand ist **jedes** `import.href` ein dokumentinternes `#uuid`-
  // Fragment auf eine `back-matter`-Ressource. Der relative Pfad liegt eine
  // Kante weiter, in `rlinks[].href`.
  const href = `#${resourceUuids[specification.resourceIndex]}`;
  if (specification.selection.kind === 'include-all') {
    // Bedeutungstragendes leeres Objekt — kein weglassbares Feld.
    return { href, 'include-all': {} };
  }
  return {
    href,
    'include-controls': specification.selection.selectors.map((selector, selectorIndex) =>
      makeSelector(`${seed}-${index}`, selectorIndex, selector),
    ),
  };
}

function makeMerge(specification: ProfileArtifactSpec): JsonObject {
  if (specification.merge === 'as-is') return { 'as-is': true };
  return {
    custom: {
      groups: [
        {
          id: 'wlan-gruppe',
          title: 'Eigene Gruppierung',
          'insert-controls': [{ order: 'keep', 'include-all': {} }],
        },
      ],
    },
  };
}

function makeAlter(seed: string, controlId: string, index: number): JsonObject {
  return {
    'control-id': controlId,
    removes: [{ 'by-name': `zu-entfernen-${index}` }],
    adds: [
      {
        // Im Bestand tritt `position` ausschließlich mit dem Wert `starting`
        // auf — und daneben `adds` ganz ohne `position`.
        ...(index % 2 === 0 ? { position: 'starting' } : {}),
        props: [{ name: 'taxonomie', value: `${seed}-${index}` }],
        parts: [
          {
            id: `${controlId}_smt.${index}`,
            name: 'item',
            prose: `Ergänzter Textbaustein ${index}.`,
          },
        ],
      },
    ],
  };
}

function makeModify(seed: string, specification: ProfileArtifactSpec): JsonObject | null {
  const alters = Array.from({ length: specification.alterControlIds }, (_value, controlIndex) =>
    Array.from({ length: specification.altersPerControlId }, (_entry, alterIndex) =>
      makeAlter(seed, makeControlId(seed, controlIndex), alterIndex),
    ),
  ).flat();

  const setParameters = Array.from(
    { length: specification.setParameterCount },
    (_value, index) => ({
      'param-id': `${seed}-parameter-${index}`,
      values: [`Wert ${index}`],
    }),
  );

  if (alters.length === 0 && setParameters.length === 0) return null;
  return {
    ...(setParameters.length > 0 ? { 'set-parameters': setParameters } : {}),
    ...(alters.length > 0 ? { alters } : {}),
  };
}

/**
 * Materialisiert ein Fixture-Dokument aus seiner Strukturbeschreibung.
 *
 * Das Ergebnis ist bei jedem Aufruf ein **neuer** Objektgraph — Tests, die
 * Mutationsfreiheit prüfen, dürfen keine gemeinsame Quelle teilen.
 */
export function makeProfileSource(specification: ProfileArtifactSpec): JsonObject {
  const seed = specification.artifactKey;
  const resourceUuids = specification.backMatter.map((_resource, index) =>
    makeUuid(`${seed}/resource`, index),
  );

  const modify = makeModify(seed, specification);
  const body: JsonObject = {
    uuid: makeUuid(seed, 0),
    metadata: makeMetadata(specification.artifactKey, specification.oscalVersion),
    imports: specification.imports.map((entry, index) =>
      makeImport(seed, index, entry, resourceUuids),
    ),
    merge: makeMerge(specification),
    ...(modify === null ? {} : { modify }),
    'back-matter': {
      resources: specification.backMatter.map((resource, index) => ({
        uuid: resourceUuids[index],
        title: `Quelle ${index}`,
        ...(resource.rlink === undefined ? {} : { rlinks: [{ href: resource.rlink }] }),
      })),
    },
  };

  return { profile: body };
}

/** Alle drei Fixture-Dokumente, je Aufruf frisch materialisiert. */
export function makeAllProfileSources(): readonly {
  readonly specification: ProfileArtifactSpec;
  readonly source: JsonObject;
}[] {
  return PROFILE_ARTIFACT_SPECS.map((specification) => ({
    specification,
    source: makeProfileSource(specification),
  }));
}

export function profileSpecFor(artifactKey: string): ProfileArtifactSpec {
  const specification = PROFILE_ARTIFACT_SPECS.find(
    (entry) => entry.artifactKey === artifactKey,
  );
  if (!specification) throw new Error(`Unbekanntes Profil-Fixture: ${artifactKey}`);
  return specification;
}

/* ------------------------------------------------------------------ */
/*  Ergänzende synthetische Fixtures                                   */
/* ------------------------------------------------------------------ */

const SYNTHETIC_UUID = '11111111-1111-4111-8111-111111111111';
const SYNTHETIC_RESOURCE_UUID = '22222222-2222-4222-8222-222222222222';

/** `#uuid`-Verweis auf die Ressource des synthetischen Korpus. */
export const SYNTHETIC_RESOURCE_HREF = `#${SYNTHETIC_RESOURCE_UUID}`;

function makeSyntheticBody(oscalVersion: string, extra: JsonObject = {}): JsonObject {
  return {
    uuid: SYNTHETIC_UUID,
    metadata: {
      title: 'Synthetisches Profil',
      'last-modified': '2026-08-17T00:00:00Z',
      version: '1',
      'oscal-version': oscalVersion,
    },
    imports: [{ href: SYNTHETIC_RESOURCE_HREF, 'include-all': {} }],
    'back-matter': {
      resources: [
        {
          uuid: SYNTHETIC_RESOURCE_UUID,
          title: 'Quellkatalog',
          rlinks: [{ href: PROFILE_SOURCE_RLINKS.gsppKernelG0 }],
        },
      ],
    },
    ...extra,
  };
}

/** Ein Profil mit frei gesetztem Körperinhalt, sonst gültigem Rahmen. */
export function makeSyntheticProfile(
  oscalVersion: string,
  extra: JsonObject = {},
): JsonObject {
  return { profile: makeSyntheticBody(oscalVersion, extra) };
}

/**
 * `matching`-Selektoren. Im BSI-Bestand kommen sie **nicht** vor; das Modell
 * kennt sie trotzdem, und ein Adapter ohne sie wäre unvollständig.
 */
export function makeProfileWithMatchingSelectors(
  oscalVersion: PinnedOscalVersion = '1.1.3',
): JsonObject {
  return makeSyntheticProfile(oscalVersion, {
    imports: [
      {
        href: SYNTHETIC_RESOURCE_HREF,
        'include-controls': [
          {
            'with-child-controls': 'yes',
            'with-ids': ['GC.1.1'],
            matching: [{ pattern: 'GC.1.*' }, { pattern: 'GC.2.?' }],
          },
        ],
        'exclude-controls': [{ matching: [{ pattern: 'GC.9.*' }] }],
      },
    ],
  });
}

/** `merge: flat` samt `combine` — beides im Bestand nicht belegt. */
export function makeProfileWithFlatMerge(
  oscalVersion: PinnedOscalVersion = '1.1.3',
): JsonObject {
  return makeSyntheticProfile(oscalVersion, {
    merge: { combine: { method: 'merge' }, flat: {} },
  });
}

/** `merge: custom` mit `insert-controls.order` in allen drei Ausprägungen. */
export function makeProfileWithCustomMerge(
  order: 'keep' | 'ascending' | 'descending' = 'ascending',
  oscalVersion: PinnedOscalVersion = '1.1.3',
): JsonObject {
  return makeSyntheticProfile(oscalVersion, {
    merge: {
      combine: { method: 'use-first' },
      custom: {
        groups: [
          {
            id: 'gruppe-a',
            title: 'Gruppe A',
            params: [
              { id: 'gruppen-parameter', label: 'Parameter', usage: 'Zweck', values: ['A'] },
            ],
            groups: [
              {
                id: 'gruppe-a-1',
                title: 'Untergruppe',
                'insert-controls': [
                  { order, 'include-controls': [{ 'with-ids': ['GC.1.1'] }] },
                ],
              },
            ],
          },
        ],
        'insert-controls': [{ order: 'keep', 'include-all': {} }],
      },
    },
  });
}

/** Alle vier Positionsangaben in `alters[].adds`, plus `removes.by-name`. */
export function makeProfileWithAllAddPositions(
  oscalVersion: PinnedOscalVersion = '1.1.3',
): JsonObject {
  return makeSyntheticProfile(oscalVersion, {
    modify: {
      'set-parameters': [
        { 'param-id': 'schluessellaenge', class: 'krypto', label: 'Länge', values: ['256'] },
      ],
      alters: [
        {
          'control-id': 'GC.1.1',
          adds: [
            { position: 'before', title: 'Vorher' },
            { position: 'after', title: 'Nachher' },
            {
              position: 'starting',
              title: 'Am Anfang',
              params: [{ id: 'zusatz-parameter', label: 'Zusatz', values: ['1', '2'] }],
              links: [{ href: SYNTHETIC_RESOURCE_HREF, rel: 'reference', text: 'Anhang' }],
            },
            { position: 'ending', title: 'Am Ende' },
            // Ohne `position` — im Bestand ebenfalls belegt.
            { props: [{ name: 'taxonomie', value: 'ohne-position' }] },
          ],
          removes: [
            { 'by-name': 'veraltet' },
            { 'by-class': 'entwurf', 'by-item-name': 'part' },
          ],
        },
      ],
    },
  });
}

/**
 * Mehrere `alter`-Einträge auf **derselben** `control-id` — der reale Fall aus
 * dem WLAN-Profil, hier isoliert und klein.
 */
export function makeProfileWithRepeatedAlters(
  controlId = 'ASST.2.2',
  count = 5,
  oscalVersion: PinnedOscalVersion = '1.1.3',
): JsonObject {
  return makeSyntheticProfile(oscalVersion, {
    modify: {
      alters: Array.from({ length: count }, (_value, index) => ({
        'control-id': controlId,
        adds: [{ position: 'starting', props: [{ name: 'schritt', value: String(index) }] }],
      })),
    },
  });
}

/** Ein `import` mit **beiden** Selektionsformen — ab 1.2.1 schemawidrig. */
export function makeProfileWithBothSelections(
  oscalVersion: PinnedOscalVersion = '1.1.3',
): JsonObject {
  return makeSyntheticProfile(oscalVersion, {
    imports: [
      {
        href: SYNTHETIC_RESOURCE_HREF,
        'include-all': {},
        'include-controls': [{ 'with-ids': ['GC.1.1'] }],
      },
    ],
  });
}

/** Ein `import` **ohne** Selektionsform — ab 1.2.1 schemawidrig. */
export function makeProfileWithoutSelection(
  oscalVersion: PinnedOscalVersion = '1.1.3',
): JsonObject {
  return makeSyntheticProfile(oscalVersion, {
    imports: [{ href: SYNTHETIC_RESOURCE_HREF }],
  });
}

/** Ein `import` **ohne** `href` — unter 1.1.2/1.1.3 schemawidrig, ab 1.2.1 gültig. */
export function makeProfileWithoutImportHref(
  oscalVersion: PinnedOscalVersion = '1.1.3',
): JsonObject {
  return makeSyntheticProfile(oscalVersion, {
    imports: [{ 'include-all': {} }],
  });
}

/** Ein Profil ganz ohne `imports` — über alle vier Versionen schemawidrig. */
export function makeProfileWithoutImports(
  oscalVersion: PinnedOscalVersion = '1.1.3',
): JsonObject {
  const body = makeSyntheticBody(oscalVersion);
  delete body.imports;
  return { profile: body };
}

/** Ein `import` auf eine externe `https`-Quelle statt auf `back-matter`. */
export function makeProfileWithExternalImport(
  href = 'https://example.invalid/basis-catalog.json',
  oscalVersion: PinnedOscalVersion = '1.1.3',
): JsonObject {
  return makeSyntheticProfile(oscalVersion, {
    imports: [{ href, 'include-all': {} }],
  });
}

/** Eine Ressource, deren `rlink` genau den übergebenen relativen Pfad trägt. */
export function makeProfileWithRelativeRlink(
  rlink: string,
  oscalVersion: PinnedOscalVersion = '1.1.3',
): JsonObject {
  return makeSyntheticProfile(oscalVersion, {
    'back-matter': {
      resources: [
        { uuid: SYNTHETIC_RESOURCE_UUID, title: 'Quellkatalog', rlinks: [{ href: rlink }] },
      ],
    },
  });
}

/** Eine `oscal-version`, die die Matrix nicht pinnt — fail-closed erwartet. */
export function makeProfileWithUnpinnedVersion(version = '1.0.4'): JsonObject {
  return makeSyntheticProfile(version);
}

/** Ein Profil ohne jede `oscal-version` — ebenfalls fail-closed erwartet. */
export function makeProfileWithoutVersion(): JsonObject {
  const body = makeSyntheticBody('1.1.3');
  const metadata = body.metadata as JsonObject;
  delete metadata['oscal-version'];
  return { profile: body };
}

/**
 * Ein Dokument mit Top-Level-`$schema`. Die Zelle wählt allein
 * `metadata.oscal-version`; `$schema` ist nur Kreuzprobe.
 */
export function makeProfileWithSchemaDirective(
  oscalVersion: PinnedOscalVersion,
  schemaDirective: string,
): JsonObject {
  return { $schema: schemaDirective, ...makeSyntheticProfile(oscalVersion) };
}

/**
 * Ein Profil, dessen Knoten durchgehend die **falsche Form** haben.
 *
 * Kein Konstruktionsfall, sondern die Gegenprobe zur Lesezusage: Ein
 * vorhandener Wert der falschen Form muss diagnostiziert werden, statt still
 * zu verschwinden. Ein Leser, der daraus wortlos `[]` macht, erfüllt zwar die
 * Verlustfreiheit am Quellgraphen, verliert den Befund aber aus der Projektion
 * und damit aus der Sicht des Nutzers.
 */
export function makeMalformedProfile(oscalVersion: PinnedOscalVersion = '1.1.3'): JsonObject {
  return {
    profile: {
      uuid: SYNTHETIC_UUID,
      metadata: {
        title: 'Formfehler',
        'last-modified': '2026-08-17T00:00:00Z',
        version: '1',
        'oscal-version': oscalVersion,
      },
      imports: [
        // Kein Objekt — der Eintrag ist kein Import.
        'kein Import',
        {
          href: SYNTHETIC_RESOURCE_HREF,
          'include-controls': [
            {
              // Zahl statt Token in einer Stringliste.
              'with-ids': ['GC.1.1', 42],
              // Einzelobjekt statt Array.
              matching: { pattern: 'GC.*' },
            },
          ],
          // Einzelobjekt statt Array.
          'exclude-controls': { 'with-ids': ['GC.9.9'] },
        },
      ],
      merge: {
        // Weder Boolescher noch Objekt.
        'as-is': 'ja',
      },
      modify: {
        'set-parameters': [
          // Ohne `param-id` ist der Eintrag nicht adressierbar.
          { values: ['1'] },
        ],
        alters: [
          {
            'control-id': 'GC.1.1',
            adds: [
              {
                // `props` ohne `value`, `links` ohne `href`.
                props: [{ name: 'ohne-wert' }],
                links: [{ rel: 'reference' }],
              },
            ],
          },
        ],
      },
    },
  };
}

/** `merge` ganz ohne Strukturdirektive — nur `combine`. */
export function makeProfileWithoutMergeStructure(
  oscalVersion: PinnedOscalVersion = '1.1.3',
): JsonObject {
  return makeSyntheticProfile(oscalVersion, { merge: { combine: { method: 'keep' } } });
}

/** `merge`, `modify` und `custom` als Skalar statt als Objekt. */
export function makeProfileWithScalarSections(
  oscalVersion: PinnedOscalVersion = '1.1.3',
): JsonObject {
  return makeSyntheticProfile(oscalVersion, { merge: 'flach', modify: 'nichts' });
}

/** `merge.custom` als Skalar statt als Gruppierungsobjekt. */
export function makeProfileWithScalarCustomMerge(
  oscalVersion: PinnedOscalVersion = '1.1.3',
): JsonObject {
  return makeSyntheticProfile(oscalVersion, { merge: { custom: 'keine Gruppierung' } });
}

/**
 * Inhaltsreiches Dokument für den No-op-Round-trip: beide Selektionsformen,
 * `matching`, `exclude-controls`, `merge: custom` mit `combine`, mehrfache
 * `alters` auf derselben `control-id`, alle vier Positionen, verschachtelte
 * `parts`, unbekannte Felder, leere Container und relative `rlinks`.
 *
 * Das Dokument ist **absichtlich nicht schemavalide** (unbekannte Felder).
 * Genau das ist der Punkt: Verlustfreiheit nach ADR-2 gilt unabhängig von der
 * Schemavalidität, und `contentMultiset()` führt leere Arrays und leere Objekte
 * als eigene Marker — ohne sie liefe der Erhaltungsnachweis leer durch.
 */
export function makeRichProfileSource(): JsonObject {
  return {
    profile: {
      uuid: SYNTHETIC_UUID,
      metadata: {
        title: 'Reichhaltiges Profil',
        'last-modified': '2026-08-17T00:00:00Z',
        version: '1',
        'oscal-version': '1.1.3',
        props: [{ name: 'marking', value: 'oeffentlich', remarks: 'Feld ohne Projektion.' }],
        'x-bsi-erweiterung': { hinweis: 'Unbekanntes Feld.' },
      },
      imports: [
        { href: SYNTHETIC_RESOURCE_HREF, 'include-all': {} },
        {
          href: SYNTHETIC_RESOURCE_HREF,
          'include-controls': [
            {
              'with-child-controls': 'yes',
              'with-ids': ['GC.1.1', 'GC.1.2'],
              matching: [{ pattern: 'GC.2.*' }],
            },
            { 'with-child-controls': 'no', 'with-ids': [] },
          ],
          'exclude-controls': [{ 'with-ids': ['GC.9.9'] }],
        },
      ],
      merge: {
        combine: { method: 'keep' },
        custom: {
          groups: [
            {
              id: 'gruppe',
              title: 'Gruppe',
              props: [],
              parts: [
                {
                  name: 'overview',
                  prose: 'Übersicht.',
                  parts: [{ name: 'item', prose: 'Unterpunkt.' }],
                },
              ],
              'x-bsi-leeres-objekt': {},
              'insert-controls': [{ order: 'descending', 'include-all': {} }],
            },
          ],
        },
      },
      modify: {
        'set-parameters': [
          { 'param-id': 'frist', values: ['30', '90'], label: 'Frist', usage: 'Tage' },
        ],
        alters: [
          {
            'control-id': 'ASST.2.2',
            adds: [{ position: 'starting', props: [{ name: 'schritt', value: '0' }] }],
          },
          {
            'control-id': 'ASST.2.2',
            adds: [
              { position: 'ending', parts: [{ name: 'item', prose: 'Zweiter Zusatz.' }] },
            ],
            removes: [{ 'by-name': 'veraltet' }],
          },
        ],
      },
      'back-matter': {
        resources: [
          {
            uuid: SYNTHETIC_RESOURCE_UUID,
            title: 'Quellkatalog',
            rlinks: [{ href: PROFILE_SOURCE_RLINKS.wlanKernelG0 }],
          },
        ],
      },
    },
  };
}
