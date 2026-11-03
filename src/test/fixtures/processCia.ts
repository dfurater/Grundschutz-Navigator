import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';

// Synthetische Fälle F1 und F4 aus dem Datenvertrag Prozess-CIA und
// Bestandsübergang v0.6 (GSPP-655); F4 ergänzt F1 um eine eigene Kategorie.

const F1: Readonly<Record<string, unknown>> = Object.freeze({
  "system-security-plan": {
    "uuid": "aaaaaaaa-0000-4000-8000-000000000001",
    "metadata": {
      "title": "Synthetischer SSP für Prozess-CIA",
      "last-modified": "2026-10-27T16:00:00Z",
      "version": "1",
      "oscal-version": "1.2.2",
      "roles": [
        {
          "id": "process-owner",
          "title": "Fachliche Prozessverantwortung"
        },
        {
          "id": "institution-management",
          "title": "Institutionsleitung"
        }
      ],
      "parties": [
        {
          "uuid": "aaaaaaaa-0000-4000-8000-000000000004",
          "type": "organization",
          "name": "Synthetischer Fachbereich"
        },
        {
          "uuid": "aaaaaaaa-0000-4000-8000-000000000005",
          "type": "organization",
          "name": "Synthetische Institutionsleitung"
        }
      ],
      "actions": [
        {
          "uuid": "aaaaaaaa-0000-4000-8000-000000000006",
          "type": "approved",
          "system": "https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/process-cia-actions",
          "date": "2026-10-27T16:00:00Z",
          "responsible-parties": [
            {
              "role-id": "institution-management",
              "party-uuids": [
                "aaaaaaaa-0000-4000-8000-000000000005"
              ]
            }
          ],
          "props": [
            {
              "ns": "https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props",
              "name": "process-cia-process-uuid",
              "value": "aaaaaaaa-0000-4000-8000-000000000002"
            },
            {
              "ns": "https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props",
              "name": "process-cia-sequence",
              "value": "1"
            },
            {
              "ns": "https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props",
              "name": "process-cia-content-hash",
              "value": "process-cia/3:sha-256:24dbad90c73d6cdb255e97f7826be3e9e7770ccbdca6b66f8c22cce3bb13f640"
            }
          ],
          "remarks": "Die dokumentierte Beispiel-Leitung bestätigt Prozesskontext und CIA."
        }
      ]
    },
    "import-profile": {
      "href": "#aaaaaaaa-0000-4000-8000-000000000007"
    },
    "system-characteristics": {
      "system-ids": [
        {
          "id": "beispielverbund"
        }
      ],
      "system-name": "Synthetischer Anwendungsbereich",
      "description": "Scope: Bearbeitung synthetischer Beispielanträge.",
      "security-sensitivity-level": "moderate",
      "status": {
        "state": "operational"
      },
      "authorization-boundary": {
        "description": "Lokaler synthetischer Verbund."
      },
      "system-information": {
        "information-types": [
          {
            "uuid": "aaaaaaaa-0000-4000-8000-000000000008",
            "title": "Beispielantragsdaten",
            "description": "Synthetische Informationen zur Entscheidung."
          }
        ]
      }
    },
    "system-implementation": {
      "users": [
        {
          "uuid": "aaaaaaaa-0000-4000-8000-000000000009"
        }
      ],
      "components": [
        {
          "uuid": "aaaaaaaa-0000-4000-8000-000000000002",
          "type": "business-process",
          "title": "Beispielantrag bearbeiten",
          "description": "Ergebnis: fachlich geprüfte Entscheidung. Beitrag zum Institutionsziel: zuverlässige Aufgabenerfüllung.",
          "purpose": "Beispielanträge fachlich prüfen und entscheiden.",
          "status": {
            "state": "operational"
          },
          "responsible-roles": [
            {
              "role-id": "process-owner",
              "party-uuids": [
                "aaaaaaaa-0000-4000-8000-000000000004"
              ]
            }
          ],
          "props": [
            {
              "ns": "https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props",
              "name": "process-id",
              "value": "P-01"
            },
            {
              "ns": "https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props",
              "name": "process-application-uuid",
              "value": "aaaaaaaa-0000-4000-8000-000000000003"
            },
            {
              "ns": "https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props",
              "name": "process-protection-confidentiality",
              "value": "normal",
              "remarks": "Beispielantragsdaten; eine Offenlegung hat begrenzte Auswirkungen."
            },
            {
              "ns": "https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props",
              "name": "process-protection-integrity",
              "value": "hoch",
              "remarks": "Falsche Antragsentscheidungen können beträchtliche fachliche Schäden verursachen."
            },
            {
              "ns": "https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props",
              "name": "process-protection-availability",
              "value": "normal",
              "remarks": "Ein kurzer Ausfall wird durch das dokumentierte manuelle Ersatzverfahren überbrückt."
            },
            {
              "ns": "https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props",
              "name": "process-priority",
              "value": "1"
            }
          ]
        },
        {
          "uuid": "aaaaaaaa-0000-4000-8000-000000000003",
          "type": "software",
          "title": "Synthetische Antragsanwendung",
          "description": "Lokale Beispielanwendung ohne Betriebsdaten.",
          "status": {
            "state": "operational"
          }
        }
      ]
    },
    "control-implementation": {
      "description": "Synthetische Umsetzungsbeschreibung.",
      "implemented-requirements": [
        {
          "uuid": "aaaaaaaa-0000-4000-8000-000000000010",
          "control-id": "GC.1.1"
        }
      ]
    },
    "back-matter": {
      "resources": [
        {
          "uuid": "aaaaaaaa-0000-4000-8000-000000000007",
          "title": "Synthetische Baseline",
          "description": "Passiver Beispielverweis; keine Baseline-Auflösung in diesem Schematest."
        }
      ]
    }
  }
});

const NS = 'https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/props';

export function makeProcessCiaSsp(oscalVersion: PinnedOscalVersion, withOwnCategory = false): Record<string, unknown> {
  const document = structuredClone(F1) as { 'system-security-plan': Record<string, Record<string, unknown>> };
  const ssp = document['system-security-plan'];
  ssp.metadata['oscal-version'] = oscalVersion;
  if (withOwnCategory) {
    ssp.metadata.props = [
      { ns: NS, name: 'process-category-label', value: 'Kritisch', group: 'cat-kritisch' },
      { ns: NS, name: 'process-category-definition', value: 'Erhebliche fachliche Fehlentscheidung.', group: 'cat-kritisch' },
      { ns: NS, name: 'process-category-mapping', value: 'hoch', group: 'cat-kritisch', remarks: 'Die definierte Schadensschwere entspricht hoch.' },
    ];
    const [process] = ssp['system-implementation'].components as Array<{ props: unknown[] }>;
    process.props.push({ ns: NS, name: 'process-protection-category', value: 'cat-kritisch', group: 'integrity' });
  }
  return document;
}
