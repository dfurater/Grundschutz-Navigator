// =============================================================================
// Synthetische SSP-Fixtures (GSPP-293)
//
// Keine realen Organisations-, System- oder Personendaten. Das Vollfixture ist
// gegen das gepinnte `oscal_ssp_schema.json` 1.2.2 gültig und trägt jede
// Struktur, die das Read-Model projiziert: alle sechs Pflichtfelder der
// `system-characteristics` samt optionaler Felder, geleaste Autorisierung,
// Benutzer, zwei Komponenten, Inventar, `set-parameters` auf allen Ebenen,
// zwei `by-components` an einer Anforderung, `export` mit `provided` und
// `responsibilities`, `inherited` und `satisfied` mit Verweis in ein fremdes
// SSP, ein unbekanntes `implementation-status`-Token und eine eingebettete
// `base64`-Ressource.
//
// Die Control-IDs `GC.1.1` und `GC.1.2` stammen aus
// `src/test/fixtures/losslessCatalog.ts`; mit diesem Katalog als
// Baseline-Bindung lösen sie auf.
// =============================================================================

import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import type { RawOscalSystemSecurityPlan } from '@/domain/oscalSystemSecurityPlan';

function id(suffix: string): string {
  return `66666666-0000-4000-8000-0000000000${suffix}`;
}

export const SSP_FIXTURE_IDS = Object.freeze({
  ssp: id('01'),
  baselineResource: id('02'),
  party: id('03'),
  informationType: id('04'),
  diagram: id('05'),
  leveragedAuthorization: id('06'),
  user: id('07'),
  thisSystem: id('08'),
  software: id('09'),
  inventoryItem: id('0a'),
  requirementWithComponents: id('0b'),
  byThisSystem: id('0c'),
  bySoftware: id('0d'),
  provided: id('0e'),
  responsibility: id('0f'),
  requirementWithStatement: id('10'),
  statement: id('11'),
  statementBySoftware: id('12'),
  inherited: id('13'),
  satisfied: id('14'),
  /** Liegt im `export` eines fremden SSP — in diesem Dokument nicht vorhanden. */
  leveragedProvided: id('15'),
  /** Liegt im `export` eines fremden SSP — in diesem Dokument nicht vorhanden. */
  leveragedResponsibility: id('16'),
  embeddedResource: id('17'),
});

export const SSP_FIXTURE_ROLE_ID = 'system-owner';

/** Das kleinste schema-valide SSP der Version; 1.1.x tragen `users`. */
export function makeMinimalSsp(oscalVersion: PinnedOscalVersion): Record<string, unknown> {
  return makeSchemaValidOscalDocument('system-security-plan', oscalVersion);
}

const RESPONSIBLE_ROLE = Object.freeze({
  'role-id': SSP_FIXTURE_ROLE_ID,
  'party-uuids': [SSP_FIXTURE_IDS.party],
});

/** Das Vollfixture, schema-valide gegen OSCAL 1.2.2. */
export function makeFullSsp(): Record<string, unknown> {
  const ids = SSP_FIXTURE_IDS;
  return {
    'system-security-plan': {
      uuid: ids.ssp,
      metadata: {
        title: 'Synthetischer Sicherheitsplan',
        'last-modified': '2026-10-16T00:00:00Z',
        version: '1.0.0',
        'oscal-version': '1.2.2',
        roles: [{ id: SSP_FIXTURE_ROLE_ID, title: 'Systemverantwortung' }],
        parties: [{ uuid: ids.party, type: 'organization', name: 'Beispielorganisation' }],
      },
      'import-profile': { href: `#${ids.baselineResource}`, remarks: 'Baseline als Back-matter-Ressource.' },
      'system-characteristics': {
        'system-ids': [{ 'identifier-type': 'https://ietf.org/rfc/rfc4122', id: ids.ssp }],
        'system-name': 'Beispielsystem',
        'system-name-short': 'BSP',
        description: 'Ein **synthetisches** System ohne Betriebsdaten.',
        'date-authorized': '2026-10-01',
        'security-sensitivity-level': 'fips-199-moderate',
        'system-information': {
          'information-types': [{
            uuid: ids.informationType,
            title: 'Betriebsdaten',
            description: 'Synthetische Informationsart.',
            categorizations: [{
              system: 'https://doi.org/10.6028/NIST.SP.800-60v2r1',
              'information-type-ids': ['C.2.4.1'],
            }],
            'confidentiality-impact': { base: 'fips-199-moderate' },
            'integrity-impact': {
              base: 'fips-199-moderate',
              selected: 'fips-199-high',
              'adjustment-justification': 'Synthetische Anhebung.',
            },
            'availability-impact': { base: 'fips-199-low' },
          }],
        },
        'security-impact-level': {
          'security-objective-confidentiality': 'fips-199-moderate',
          'security-objective-integrity': 'fips-199-high',
          'security-objective-availability': 'fips-199-low',
        },
        status: { state: 'operational', remarks: 'Synthetischer Betrieb.' },
        'authorization-boundary': {
          description: 'Synthetische Systemgrenze.',
          diagrams: [{
            uuid: ids.diagram,
            description: 'Grenzdiagramm.',
            caption: 'Abbildung 1',
            links: [{ href: `#${ids.embeddedResource}`, rel: 'diagram' }],
          }],
        },
        'network-architecture': { description: 'Synthetische Netzarchitektur.' },
        'data-flow': { description: 'Synthetischer Datenfluss.' },
        'responsible-parties': [RESPONSIBLE_ROLE],
        props: [
          { name: 'cloud-deployment-model', value: 'private-cloud' },
          {
            name: 'vendor-classification',
            value: 'nur-intern',
            ns: 'https://example.vendor.invalid/ns/oscal',
          },
        ],
      },
      'system-implementation': {
        'leveraged-authorizations': [{
          uuid: ids.leveragedAuthorization,
          title: 'Geleaste Plattform',
          'party-uuid': ids.party,
          'date-authorized': '2026-09-01',
        }],
        users: [{
          uuid: ids.user,
          title: 'Administration',
          'short-name': 'admin',
          'role-ids': [SSP_FIXTURE_ROLE_ID],
          'authorized-privileges': [{
            title: 'Vollzugriff',
            'functions-performed': ['konfigurieren', 'protokolle-lesen'],
          }],
        }],
        components: [
          {
            uuid: ids.thisSystem,
            type: 'this-system',
            title: 'Gesamtsystem',
            description: 'Das System selbst.',
            status: { state: 'operational' },
            'responsible-roles': [RESPONSIBLE_ROLE],
          },
          {
            uuid: ids.software,
            type: 'software',
            title: 'Fachanwendung',
            description: 'Synthetische Fachanwendung.',
            purpose: 'Verarbeitung der Betriebsdaten.',
            status: { state: 'under-development' },
          },
        ],
        'inventory-items': [{
          uuid: ids.inventoryItem,
          description: 'Synthetischer Server.',
          'responsible-parties': [RESPONSIBLE_ROLE],
          'implemented-components': [{ 'component-uuid': ids.software }],
        }],
      },
      'control-implementation': {
        description: 'Synthetische Umsetzungsbeschreibung.',
        'set-parameters': [{ 'param-id': 'gc.1.1_prm_1', values: ['Systemebene'] }],
        'implemented-requirements': [
          {
            uuid: ids.requirementWithComponents,
            'control-id': 'GC.1.1',
            'set-parameters': [{ 'param-id': 'gc.1.1_prm_1', values: ['Anforderungsebene'] }],
            'responsible-roles': [RESPONSIBLE_ROLE],
            'by-components': [
              {
                'component-uuid': ids.thisSystem,
                uuid: ids.byThisSystem,
                description: 'Das System setzt die Anforderung um.',
                'implementation-status': { state: 'implemented' },
                'set-parameters': [{ 'param-id': 'gc.1.1_prm_1', values: ['Komponentenebene'] }],
                export: {
                  description: 'Angebot an nutzende Systeme.',
                  provided: [{
                    uuid: ids.provided,
                    description: 'Bereitgestellte Umsetzung.',
                    'responsible-roles': [RESPONSIBLE_ROLE],
                  }],
                  responsibilities: [{
                    uuid: ids.responsibility,
                    'provided-uuid': ids.provided,
                    description: 'Verantwortung des nutzenden Systems.',
                  }],
                },
                'responsible-roles': [RESPONSIBLE_ROLE],
              },
              {
                'component-uuid': ids.software,
                uuid: ids.bySoftware,
                description: 'Die Fachanwendung setzt sie teilweise um.',
                'implementation-status': {
                  state: 'gspp-teilweise-geprueft',
                  remarks: 'Unbekanntes Token des offenen Vokabulars.',
                },
              },
            ],
          },
          {
            uuid: ids.requirementWithStatement,
            'control-id': 'GC.1.2',
            statements: [{
              'statement-id': 'gc.1.2_smt',
              uuid: ids.statement,
              'by-components': [{
                'component-uuid': ids.software,
                uuid: ids.statementBySoftware,
                description: 'Umsetzung über die geleaste Plattform.',
                'implementation-status': { state: 'partial' },
                inherited: [{
                  uuid: ids.inherited,
                  'provided-uuid': ids.leveragedProvided,
                  description: 'Von der Plattform geerbt.',
                }],
                satisfied: [{
                  uuid: ids.satisfied,
                  'responsibility-uuid': ids.leveragedResponsibility,
                  description: 'Verantwortung gegenüber der Plattform erfüllt.',
                }],
              }],
            }],
          },
        ],
      },
      'back-matter': {
        resources: [
          {
            uuid: ids.baselineResource,
            title: 'Baseline-Profil',
            rlinks: [{ href: './baseline-profile.json', 'media-type': 'application/oscal.profile+json' }],
          },
          {
            uuid: ids.embeddedResource,
            title: 'Grenzdiagramm',
            base64: { filename: 'grenze.png', 'media-type': 'image/png', value: 'iVBORw0KGgo=' },
          },
        ],
      },
    },
  };
}

/**
 * Tiefe Kopie mit gezielter Änderung am SSP-Körper. Pflichtfelder entfernt ein
 * Test mit `Reflect.deleteProperty`, weil der Raw-Typ sie als Pflicht führt.
 */
export function withSspBody(
  document: Record<string, unknown>,
  mutate: (body: RawOscalSystemSecurityPlan) => void,
): Record<string, unknown> {
  const copy = structuredClone(document);
  mutate(copy['system-security-plan'] as RawOscalSystemSecurityPlan);
  return copy;
}
