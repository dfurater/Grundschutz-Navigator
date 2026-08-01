// =============================================================================
// Fixture — OSCAL-Katalog mit allen verlustkritischen Strukturen
//
// Positiv- und Negativkorpus für den verlustfreien Dokumentvertrag (ADR-0002).
// Der Katalog ist bewusst als JSON-Text hinterlegt: nur so existiert ein
// unverändertes Original, gegen das die No-op-Serialisierung vergleichen kann.
//
// Enthalten sind genau die Strukturen, die das Domänenmodell heute nicht
// abbildet und die deshalb ausschließlich im `source` überleben können:
//   - prop.remarks, prop.class, prop.group, prop.uuid
//   - herstellerspezifisches prop mit eigenem ns
//   - link.resource-fragment, link.media-type
//   - back-matter-Ressource mit ausschließlich uuid
//   - back-matter-Ressource mit citation und document-ids
//   - metadata.revisions, metadata.document-ids, metadata.locations
//   - control.class und verschachtelte Sub-Controls
//   - im Domänenmodell unbekannte Felder auf Katalog- und Metadatenebene
// =============================================================================

/**
 * Unveränderter Quelltext des Fixtures.
 *
 * Die Schlüsselreihenfolge ist Teil des Vertrags (§0): Sie muss den
 * No-op-Round-Trip überleben.
 */
export const LOSSLESS_CATALOG_JSON = `{
  "catalog": {
    "uuid": "11111111-2222-3333-4444-555555555555",
    "metadata": {
      "title": "Fixture-Katalog mit verlustkritischen Strukturen",
      "last-modified": "2026-07-29T06:42:34.226285+00:00",
      "version": "2026-07-29",
      "oscal-version": "1.1.3",
      "revisions": [
        {
          "title": "Erstfassung",
          "published": "2026-01-15T00:00:00Z",
          "version": "2026-01-15",
          "oscal-version": "1.1.3",
          "remarks": "Revisionshistorie ist Teil des Dokuments."
        },
        {
          "title": "Zweitfassung",
          "last-modified": "2026-07-29T06:42:34.226285+00:00",
          "version": "2026-07-29",
          "oscal-version": "1.1.3"
        }
      ],
      "document-ids": [
        { "scheme": "https://www.doi.org/", "identifier": "10.1000/fixture" }
      ],
      "props": [
        {
          "name": "keywords",
          "value": "Grundschutz, Fixture",
          "class": "informational",
          "group": "publication",
          "uuid": "aaaaaaaa-0000-0000-0000-000000000001",
          "remarks": "Diese Bemerkung existiert nur im Quellgraphen."
        },
        {
          "name": "vendor-classification",
          "ns": "https://example.vendor.invalid/ns/oscal",
          "value": "internal-only",
          "remarks": "Herstellerspezifische Extension mit eigenem ns."
        }
      ],
      "links": [
        {
          "href": "#99999999-8888-7777-6666-555555555555",
          "rel": "canonical",
          "media-type": "application/oscal+json",
          "resource-fragment": "kapitel-3",
          "text": "Kanonische Fassung"
        }
      ],
      "roles": [
        { "id": "publisher", "title": "Herausgeber" },
        { "id": "contact", "title": "Ansprechpartner" }
      ],
      "locations": [
        {
          "uuid": "bbbbbbbb-0000-0000-0000-000000000001",
          "title": "Bonn",
          "address": { "city": "Bonn", "country": "DE" }
        }
      ],
      "parties": [
        {
          "uuid": "cccccccc-0000-0000-0000-000000000001",
          "type": "organization",
          "name": "Fixture-Herausgeber",
          "email-addresses": ["kontakt@example.invalid"]
        }
      ],
      "responsible-parties": [
        {
          "role-id": "publisher",
          "party-uuids": ["cccccccc-0000-0000-0000-000000000001"]
        }
      ],
      "remarks": "Metadaten-Bemerkung.",
      "x-fixture-unknown-metadata-field": {
        "nested": ["a", "b"],
        "leerobjekt": {},
        "leerarray": []
      }
    },
    "params": [
      {
        "id": "catalog-prm-1",
        "label": "Organisation",
        "values": ["Beispielorganisation"]
      }
    ],
    "groups": [
      {
        "id": "GC",
        "class": "praktik",
        "title": "Governance und Compliance",
        "props": [
          { "name": "alt-identifier", "value": "alt-gc" },
          { "name": "label", "value": "GC" }
        ],
        "groups": [
          {
            "id": "GC.1",
            "title": "Strategie",
            "props": [
              { "name": "alt-identifier", "value": "alt-gc-1" },
              { "name": "label", "value": "1" }
            ],
            "controls": [
              {
                "id": "GC.1.1",
                "class": "BSI-Methodik-Grundschutz-plus-plus",
                "title": "Erste Anforderung",
                "params": [
                  {
                    "id": "gc.1.1-prm1",
                    "label": "Zielobjekt",
                    "values": ["Server"]
                  }
                ],
                "props": [
                  { "name": "alt-identifier", "value": "alt-gc-1-1" },
                  {
                    "name": "sec_level",
                    "ns": "https://example.invalid/ns/sicherheitsniveau.csv",
                    "value": "normal-SdT"
                  },
                  {
                    "name": "effort_level",
                    "ns": "https://example.invalid/ns/aufwand.csv",
                    "value": "2",
                    "remarks": "Aufwandsbegründung, heute nicht im view."
                  }
                ],
                "links": [
                  {
                    "href": "#dddddddd-0000-0000-0000-000000000001",
                    "rel": "reference",
                    "media-type": "application/pdf",
                    "resource-fragment": "abschnitt-2.4",
                    "text": "Vertiefende Quelle"
                  },
                  { "href": "#GC.1.2", "rel": "related" }
                ],
                "parts": [
                  {
                    "id": "gc.1.1-stm",
                    "name": "statement",
                    "prose": "Das Zielobjekt {{ insert: param, gc.1.1-prm1 }} MUSS gehärtet werden.",
                    "props": [
                      { "name": "modal_verb", "value": "MUSS" },
                      {
                        "name": "target_object_categories",
                        "value": "Server, Client"
                      }
                    ]
                  },
                  { "name": "guidance", "prose": "Erläuternder Text." }
                ],
                "controls": [
                  {
                    "id": "GC.1.1.1",
                    "class": "verstaerkung",
                    "title": "Verschachtelte Anforderung",
                    "props": [
                      { "name": "alt-identifier", "value": "alt-gc-1-1-1" }
                    ],
                    "parts": [
                      { "name": "statement", "prose": "Ergänzende Anforderung." }
                    ]
                  }
                ]
              },
              {
                "id": "GC.1.2",
                "title": "Zweite Anforderung",
                "props": [
                  { "name": "alt-identifier", "value": "alt-gc-1-2" }
                ],
                "parts": [
                  { "name": "statement", "prose": "Zweiter Statement-Text." }
                ],
                "x-fixture-unknown-control-field": "nur im source"
              }
            ]
          }
        ]
      },
      {
        "id": "ORP",
        "title": "Organisation und Personal",
        "props": [
          { "name": "alt-identifier", "value": "alt-orp" },
          { "name": "label", "value": "ORP" }
        ],
        "controls": [
          {
            "id": "ORP.1",
            "title": "Direkte Praktik-Anforderung",
            "props": [{ "name": "alt-identifier", "value": "alt-orp-1" }],
            "parts": [{ "name": "statement", "prose": "Direkter Text." }]
          }
        ]
      }
    ],
    "back-matter": {
      "resources": [
        { "uuid": "dddddddd-0000-0000-0000-000000000001" },
        {
          "uuid": "eeeeeeee-0000-0000-0000-000000000001",
          "title": "Zitierte Quelle",
          "citation": { "text": "BSI, Grundschutz++, 2026" },
          "document-ids": [
            { "scheme": "https://www.doi.org/", "identifier": "10.1000/quelle" }
          ]
        },
        {
          "uuid": "ffffffff-0000-0000-0000-000000000001",
          "title": "Verlinkte Quelle",
          "rlinks": [
            {
              "href": "https://example.invalid/quelle.pdf",
              "media-type": "application/pdf",
              "hashes": [
                { "algorithm": "SHA-256", "value": "0badc0de" },
                { "algorithm": "MD5", "value": "0badc0de" }
              ]
            }
          ]
        }
      ]
    },
    "x-fixture-unknown-catalog-field": ["erhalten", "bleiben"]
  }
}`;

/**
 * Frisches, unabhängiges Quellgraph-Exemplar.
 *
 * Jeder Aufruf liefert einen eigenen Objektgraphen, damit Tests einander nicht
 * über geteilten Zustand beeinflussen.
 */
export function makeLosslessCatalogSource(): unknown {
  return JSON.parse(LOSSLESS_CATALOG_JSON);
}
