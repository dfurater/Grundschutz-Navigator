/**
 * Maximaldokumente des No-op-Round-trip-Korpus (GSPP-298).
 *
 * Je Root-Modell ein Dokument mit den im Issue als verlustkritisch
 * nachgewiesenen Strukturen (Befund 5): optionale Nebenfelder, fremde
 * Namespaces, inhaltsleere Ressourcen, ungebundene anyOf-Token und leere
 * Bemerkungen — alles Stellen, an denen ein naiver Export Verlust erlitte.
 *
 * Provenienz: Die Grundstruktur je Modell ist von offiziellen
 * NIST-Beispieldokumenten abgeleitet (`oscal-content`), die Ergänzungen sind
 * synthetisch und fachlich BSI-nah, aber ohne reale Organisationsdaten. Der
 * BSI-Upstream liefert keine produktiven SSP-, Assessment- oder POA&M-
 * Artefakte; die entsprechenden Modelle sind ausdrücklich als synthetisch
 * gekennzeichnet. Je Eintrag ist benannt, was gilt — fehlende
 * BSI-Assessment-Artefakte werden nicht als reale BSI-Fälle ausgegeben.
 *
 * Alle Werte sind erfunden. Die Dokumente müssen gegen jede gepinnte Zelle
 * ihres Roots schemavalid sein; die Korpusläufe beweisen das je Version.
 */

import type { OscalRootKey, PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';

export interface CorpusProvenanceEntry {
  /** `nist-template`: Struktur aus einem offiziellen NIST-Beispiel abgeleitet. */
  readonly origin: 'nist-template' | 'synthetic-bsi-nah';
  readonly note: string;
}

export const MAXIMAL_CORPUS_PROVENANCE: Readonly<
  Record<OscalRootKey, CorpusProvenanceEntry>
> = Object.freeze({
  catalog: {
    origin: 'nist-template',
    note: 'Struktur von basic-catalog.json abgeleitet; Zusätze synthetisch BSI-nah.',
  },
  profile: {
    origin: 'nist-template',
    note: 'Struktur von basic-profile.json abgeleitet; Zusätze synthetisch BSI-nah.',
  },
  'mapping-collection': {
    origin: 'synthetic-bsi-nah',
    note: 'oscal-content führt kein Mapping-Dokument; entworfen gegen oscal_mapping_schema.json.',
  },
  'component-definition': {
    origin: 'nist-template',
    note: 'Struktur von example-component-definition.json abgeleitet; Zusätze synthetisch.',
  },
  'system-security-plan': {
    origin: 'synthetic-bsi-nah',
    note: 'BSI-Upstream liefert kein produktives SSP-Artefakt; gegen oscal_ssp_schema.json entworfen.',
  },
  'assessment-plan': {
    origin: 'synthetic-bsi-nah',
    note: 'Kein BSI-Assessment-Plan-Artefakt im Upstream; gegen oscal_assessment-plan_schema.json entworfen.',
  },
  'assessment-results': {
    origin: 'synthetic-bsi-nah',
    note: 'Kein BSI-Assessment-Results-Artefakt im Upstream; gegen das Schema von v1.2.2 entworfen.',
  },
  'plan-of-action-and-milestones': {
    origin: 'synthetic-bsi-nah',
    note: 'Kein BSI-POA&M-Artefakt im Upstream; gegen oscal_poam_schema.json entworfen.',
  },
});

function makeMetadata(oscalVersion: PinnedOscalVersion): Record<string, unknown> {
  return {
    title: 'Maximalkorpus ohne reale Organisationsdaten',
    'last-modified': '2026-08-16T00:00:00Z',
    version: '1.0.0',
    'oscal-version': oscalVersion,
  };
}

/** Props mit allen optionalen Nebenfeldern inklusive fremdem Namespace. */
const LOSS_CRITICAL_PROPS = [
  {
    name: 'keywords',
    value: 'Grundschutz, Korpus',
    uuid: 'aaaaaaaa-0000-4000-8000-000000000001',
    class: 'informational',
    group: 'publication',
    ns: 'http://csrc.nist.gov/ns/oscal',
    remarks: 'Nebenfelder dürfen nicht verworfen werden.',
  },
  {
    name: 'vendor-classification',
    value: 'internal-only',
    ns: 'https://example.vendor.invalid/ns/oscal',
    remarks: 'Fremder Namespace bleibt unverändert.',
  },
];

/** Link mit allen optionalen Nebenfeldern außer `href`. */
const LOSS_CRITICAL_LINK = {
  href: '#dddddddd-0000-4000-8000-000000000001',
  rel: 'reference',
  'media-type': 'application/pdf',
  'resource-fragment': 'abschnitt-2.4',
  text: 'Vertiefende Quelle',
};

/** Back-matter mit jeder inhaltsleeren beziehungsweise Minimalressource. */
function lossCriticalBackMatter(): Record<string, unknown> {
  return {
    resources: [
      // ausschließlich uuid — schema-valide und wegoptimierbar
      { uuid: 'dddddddd-0000-4000-8000-000000000001' },
      // citation in der Minimalform
      {
        uuid: 'eeeeeeee-0000-4000-8000-000000000001',
        title: 'Zitierte Quelle',
        citation: { text: 'Korpus, Minimale Zitation' },
        'document-ids': [{ identifier: 'urn:korpus:quelle' }],
      },
      // rlinks ohne hashes und ohne media-type
      {
        uuid: 'ffffffff-0000-4000-8000-000000000001',
        title: 'Verlinkte Quelle',
        rlinks: [{ href: 'https://beispiel.invalid/quelle.pdf' }],
      },
      // base64 ohne filename und ohne media-type
      {
        uuid: 'aaaa0000-0000-4000-8000-000000000002',
        description: 'Eingebetteter Inhalt in der Minimalform.',
        base64: { value: 'S29ycHVz' },
      },
    ],
  };
}

/** Revisionshistorie bewusst in NICHT absteigend-chronologischer Ordnung. */
function unorderedRevisions(oscalVersion: PinnedOscalVersion): Record<string, unknown>[] {
  return [
    {
      title: 'Erstfassung',
      published: '2026-01-15T00:00:00Z',
      version: '2026-01-15',
      'oscal-version': oscalVersion,
    },
    {
      title: 'Zweitfassung',
      published: '2026-07-29T00:00:00Z',
      'last-modified': '2026-07-29T00:00:00Z',
      version: '2026-07-29',
      remarks: '',
    },
  ];
}

function maximalCatalog(oscalVersion: PinnedOscalVersion): Record<string, unknown> {
  return {
    catalog: {
      uuid: '11111111-1111-4111-8111-111111111111',
      metadata: {
        ...makeMetadata(oscalVersion),
        revisions: unorderedRevisions(oscalVersion),
        'document-ids': [{ identifier: 'urn:korpus:katalog' }],
        props: LOSS_CRITICAL_PROPS,
        links: [LOSS_CRITICAL_LINK],
        roles: [{ id: 'publisher', title: 'Herausgeber' }],
        parties: [{
          uuid: 'cccccccc-0000-4000-8000-000000000001',
          type: 'organization',
          name: 'Korpus-Herausgeber',
        }],
        'responsible-parties': [{
          'role-id': 'publisher',
          'party-uuids': ['cccccccc-0000-4000-8000-000000000001'],
        }],
        remarks: '',
      },
      params: [{ id: 'catalog-prm-1', label: 'Zielobjekt', values: ['Beispiel'] }],
      groups: [{
        id: 'ac',
        class: 'praktik',
        title: 'Zugriffssteuerung',
        props: [{ name: 'alt-identifier', value: 'alt-ac' }],
        controls: [{
          id: 'ac-1',
          class: 'Korpus-Methode',
          title: 'Richtlinie und Verfahren',
          params: [{ id: 'ac-1_prm_1', label: 'Ausschluss', values: ['Beispielausschluss'] }],
          props: [
            { name: 'alt-identifier', value: 'alt-ac-1' },
            // StringDatatype lässt den leeren String NICHT zu — leere Werte
            // sind nur in remarks schema-valide (dort unten bewusst gesetzt).
            { name: 'status', value: 'offen', ns: 'https://beispiel.invalid/ns/status', remarks: '' },
          ],
          links: [LOSS_CRITICAL_LINK],
          parts: [{
            id: 'ac-1_stm',
            name: 'statement',
            prose: 'Der Zielobjekt-Zugriff {{ insert: param, ac-1_prm_1 }} MUSS geschützt bleiben.',
            props: [{ name: 'modal_verb', value: 'MUSS' }],
          }],
          controls: [{
            id: 'ac-1.1',
            class: 'verstärkung',
            title: 'Verschachtelte Anforderung',
            props: [{ name: 'alt-identifier', value: 'alt-ac-1-1', remarks: '' }],
          }],
        }],
      }],
      'back-matter': lossCriticalBackMatter(),
    },
  };
}

function maximalProfile(oscalVersion: PinnedOscalVersion): Record<string, unknown> {
  const base = makeSchemaValidOscalDocument('profile', oscalVersion);
  const body = structuredClone(base.profile as Record<string, unknown>);
  const metadata = body.metadata as Record<string, unknown>;

  return {
    profile: {
      ...body,
      metadata: {
        ...metadata,
        revisions: unorderedRevisions(oscalVersion),
        props: LOSS_CRITICAL_PROPS,
        links: [LOSS_CRITICAL_LINK],
        remarks: '',
      },
      imports: [{
        href: '#11111111-1111-4111-8111-111111111111',
        'include-controls': [{ 'with-ids': ['ac-1'] }],
      }],
      // modify.set-parameters ist die versionsstabile Parameterbelegung des
      // Profils; merge/alters sind anyOf-armiert und hier nicht nötig.
      modify: {
        'set-parameters': [{
          'param-id': 'ac-1_prm_1',
          values: ['Durchsetzung auf dem Beispielzielobjekt'],
        }],
      },
      'back-matter': lossCriticalBackMatter(),
    },
  };
}

function maximalMappingCollection(oscalVersion: PinnedOscalVersion): Record<string, unknown> {
  const base = makeSchemaValidOscalDocument('mapping-collection', oscalVersion);
  const body = structuredClone(base['mapping-collection'] as Record<string, unknown>);
  const metadata = body.metadata as Record<string, unknown>;

  return {
    'mapping-collection': {
      ...body,
      metadata: {
        ...metadata,
        revisions: unorderedRevisions(oscalVersion),
        props: LOSS_CRITICAL_PROPS,
        remarks: '',
      },
      mappings: [{
        uuid: '33333333-3333-4333-8333-3333333300a1',
        'source-resource': { type: 'catalog', href: '#11111111-1111-4111-8111-111111111111' },
        'target-resource': { type: 'catalog', href: '#44444444-4444-4444-8444-444444444444' },
        maps: [{
          uuid: '33333333-3333-4333-8333-3333333300b2',
          relationship: 'subset-of',
          sources: [
            { type: 'control', 'id-ref': 'ac-1' },
            { type: 'statement', 'id-ref': 'ac-1_smt' },
          ],
          targets: [{ type: 'control', 'id-ref': 'ac-1' }],
        }],
      }],
      'back-matter': lossCriticalBackMatter(),
    },
  };
}

function maximalComponentDefinition(oscalVersion: PinnedOscalVersion): Record<string, unknown> {
  return {
    'component-definition': {
      uuid: '44444444-4444-4444-8444-444444444444',
      metadata: {
        ...makeMetadata(oscalVersion),
        revisions: unorderedRevisions(oscalVersion),
        props: LOSS_CRITICAL_PROPS,
        links: [LOSS_CRITICAL_LINK],
        remarks: '',
      },
      components: [{
        uuid: '44444444-4444-4444-8444-4444444400a1',
        type: 'software',
        title: 'Korpuskomponente',
        description: 'Synthetische Komponente mit allen Nebenfeldern.',
        purpose: 'Nachweis der Verlustfreiheit.',
        props: LOSS_CRITICAL_PROPS,
        links: [LOSS_CRITICAL_LINK],
        'responsible-roles': [{
          'role-id': 'publisher',
          'party-uuids': ['cccccccc-0000-4000-8000-000000000001'],
        }],
        'control-implementations': [{
          uuid: '44444444-4444-4444-8444-4444444400b2',
          source: '#11111111-1111-4111-8111-111111111111',
          description: 'Umsetzungsaussage mit Parameterbelegung.',
          'set-parameters': [{
            'param-id': 'ac-1_prm_1',
            values: ['Komponentenweite Belegung'],
            remarks: 'Set-parameters ist Teil der Umsetzungsaussage.',
          }],
          'implemented-requirements': [{
            uuid: '44444444-4444-4444-8444-4444444400c3',
            'control-id': 'ac-1',
            description: 'Anforderung wird durch die Komponente erfüllt.',
            props: LOSS_CRITICAL_PROPS,
            'set-parameters': [{
              'param-id': 'ac-1_prm_1',
              values: ['Anforderungsweite Belegung'],
            }],
            statements: [{
              'statement-id': 'ac-1_smt',
              uuid: '44444444-4444-4444-8444-4444444400d4',
              description: 'Statement-Level-Umsetzung.',
              remarks: '',
            }],
          }],
        }],
      }],
      'back-matter': lossCriticalBackMatter(),
    },
  };
}

/**
 * SSP-Maximaldokument: set-parameters auf drei Ebenen, export/inherited/
 * satisfied in ihren Minimalformen und ein unbekannter anyOf-Token bei
 * `implementation-status.state` — nach Schema valide, nur Stufe 4 könnte ihn
 * beanstanden.
 */
function maximalSystemSecurityPlan(oscalVersion: PinnedOscalVersion): Record<string, unknown> {
  const base = makeSchemaValidOscalDocument('system-security-plan', oscalVersion);
  const body = structuredClone(base['system-security-plan'] as Record<string, unknown>);
  const metadata = body.metadata as Record<string, unknown>;

  return {
    'system-security-plan': {
      ...body,
      metadata: {
        ...metadata,
        revisions: unorderedRevisions(oscalVersion),
        props: LOSS_CRITICAL_PROPS,
        links: [LOSS_CRITICAL_LINK],
        remarks: '',
      },
      'system-characteristics': {
        ...((body['system-characteristics'] ?? {}) as Record<string, unknown>),
        // Gebundenes Enum: nur Standardzustände — die ungebundene anyOf-Stelle
        // ist implementation-status.state weiter unten (Befund 4).
        status: { state: 'operational' },
      },
      'system-implementation': {
        ...((body['system-implementation'] ?? {}) as Record<string, unknown>),
        users: [{ uuid: '55555555-5555-4555-8555-5555555500b2', title: 'Betreuer' }],
        components: [
          {
            uuid: '55555555-5555-4555-8555-5555555500c3',
            type: 'software',
            title: 'Korpuskomponente',
            description: 'Leverage-Komponente mit Export-und-Verkettungsformen.',
            status: { state: 'operational' },
            props: LOSS_CRITICAL_PROPS,
          },
        ],
        'inventory-items': [{
          uuid: '55555555-5555-4555-8555-5555555500e5',
          description: 'Bestandsaufnahme in der Minimalform.',
          'implemented-components': [{
            'component-uuid': '55555555-5555-4555-8555-5555555500c3',
          }],
        }],
      },
      'control-implementation': {
        description: 'Dreistufige Parameterbelegung im Korpus.',
        'set-parameters': [{
          'param-id': 'ac-1_prm_1',
          values: ['Implementierungsebene'],
        }],
        'implemented-requirements': [{
          uuid: '55555555-5555-4555-8555-5555555500d4',
          'control-id': 'ac-1',
          remarks: '',
          'set-parameters': [{
            'param-id': 'ac-1_prm_1',
            values: ['Anforderungsebene'],
          }],
          statements: [{
            'statement-id': 'ac-1_smt',
            uuid: '55555555-5555-4555-8555-5555555500f6',
            'by-components': [{
              'component-uuid': '55555555-5555-4555-8555-5555555500c3',
              uuid: '55555555-5555-4555-8555-555555550107',
              description: 'Verkettungsformen in der Minimalform.',
              'set-parameters': [{
                'param-id': 'ac-1_prm_1',
                values: ['By-component-Ebene'],
              }],
              'implementation-status': { state: 'teilumgesetzt-korpus' },
              // export ohne provided/responsibilities
              export: {},
              // inherited ohne provided-uuid
              inherited: [{
                uuid: '55555555-5555-4555-8555-555555550208',
                description: 'Geerbte Umsetzung ohne Herkunftsreferenz.',
              }],
              // satisfied ohne responsibility-uuid
              satisfied: [{
                uuid: '55555555-5555-4555-8555-555555550309',
                description: 'Erfüllte Verantwortung ohne Verantwortlichkeitsreferenz.',
              }],
            }],
          }],
        }],
      },
      'back-matter': lossCriticalBackMatter(),
    },
  };
}

function maximalAssessmentPlan(oscalVersion: PinnedOscalVersion): Record<string, unknown> {
  const base = makeSchemaValidOscalDocument('assessment-plan', oscalVersion);
  const body = structuredClone(base['assessment-plan'] as Record<string, unknown>);
  const metadata = body.metadata as Record<string, unknown>;

  return {
    'assessment-plan': {
      ...body,
      metadata: {
        ...metadata,
        revisions: unorderedRevisions(oscalVersion),
        props: LOSS_CRITICAL_PROPS,
        links: [LOSS_CRITICAL_LINK],
        remarks: '',
      },
      'back-matter': lossCriticalBackMatter(),
    },
  };
}

function maximalAssessmentResults(oscalVersion: PinnedOscalVersion): Record<string, unknown> {
  const base = makeSchemaValidOscalDocument('assessment-results', oscalVersion);
  const body = structuredClone(base['assessment-results'] as Record<string, unknown>);
  const metadata = body.metadata as Record<string, unknown>;
  const results = body.results as Record<string, unknown>[];

  results[0]!.observations = [{
    uuid: '77777777-7777-4777-8777-7777777700b2',
    description: 'Beobachtung mit geschlossener Ausnahme am Akteurtyp.',
    methods: ['EXAMINE'],
    collected: '2026-08-16T00:00:00Z',
    origins: [{
      actors: [{
        type: 'tool',
        'actor-uuid': '44444444-4444-4444-8444-4444444400a1',
        'role-id': 'assessor',
      }],
    }],
  }];

  return {
    'assessment-results': {
      ...body,
      metadata: {
        ...metadata,
        revisions: unorderedRevisions(oscalVersion),
        props: LOSS_CRITICAL_PROPS,
        links: [LOSS_CRITICAL_LINK],
        remarks: '',
      },
      results,
      'back-matter': lossCriticalBackMatter(),
    },
  };
}

function maximalPoam(oscalVersion: PinnedOscalVersion): Record<string, unknown> {
  const base = makeSchemaValidOscalDocument('plan-of-action-and-milestones', oscalVersion);
  const body = structuredClone(base['plan-of-action-and-milestones'] as Record<string, unknown>);
  const metadata = body.metadata as Record<string, unknown>;

  return {
    'plan-of-action-and-milestones': {
      ...body,
      metadata: {
        ...metadata,
        revisions: unorderedRevisions(oscalVersion),
        props: LOSS_CRITICAL_PROPS,
        links: [LOSS_CRITICAL_LINK],
        remarks: '',
      },
      'poam-items': [{
        uuid: '88888888-8888-4888-8888-8888888800a1',
        title: 'Minimaleintrag mit Nebenfeldern',
        description: 'Synthetischer POA&M-Eintrag ohne echte Befunde.',
        props: LOSS_CRITICAL_PROPS,
        links: [LOSS_CRITICAL_LINK],
        remarks: '',
      }],
      'back-matter': lossCriticalBackMatter(),
    },
  };
}

const MAXIMAL_BUILDERS: Readonly<Record<OscalRootKey, (version: PinnedOscalVersion) => Record<string, unknown>>> =
  Object.freeze({
    catalog: maximalCatalog,
    profile: maximalProfile,
    'mapping-collection': maximalMappingCollection,
    'component-definition': maximalComponentDefinition,
    'system-security-plan': maximalSystemSecurityPlan,
    'assessment-plan': maximalAssessmentPlan,
    'assessment-results': maximalAssessmentResults,
    'plan-of-action-and-milestones': maximalPoam,
  });

/** Ein gegen die gepinnte Zelle schemavalides Maximaldokument (Befund 5). */
export function makeMaximalOscalDocument(
  rootKey: OscalRootKey,
  oscalVersion: PinnedOscalVersion,
): Record<string, unknown> {
  return MAXIMAL_BUILDERS[rootKey](oscalVersion);
}

/**
 * Katalog mit `$schema` als erster Top-Level-Property. Der Wert muss exakt
 * der `$id` der gewählten Zelle entsprechen — `$schema` wählt nie aus.
 */
export function makeCatalogTextWithSchemaDirective(schemaId: string): Record<string, unknown> {
  const document = makeSchemaValidOscalDocument('catalog', '1.2.2');
  const body = document.catalog as Record<string, unknown>;
  return { $schema: schemaId, catalog: body };
}

export function makeCatalogRevisionsFixture(revisionDatesInOrder: readonly string[]): {
  document: Record<string, unknown>;
  revisionDatesInOrder: readonly string[];
} {
  const document = makeMaximalOscalDocument('catalog', '1.2.2');
  const body = document.catalog as Record<string, unknown>;
  const metadata = body.metadata as Record<string, unknown>;

  metadata.revisions = revisionDatesInOrder.map((published, index) => ({
    title: `Fassung ${index + 1}`,
    published,
    version: `${index + 1}`,
  }));

  return Object.freeze({ document, revisionDatesInOrder });
}
