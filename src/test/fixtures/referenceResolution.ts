// =============================================================================
// Fixture — zentrale OSCAL-Referenzauflösung (GSPP-286)
//
// Der Korpus ergänzt gezielt die Referenzformen, die nicht in den ausgelieferten
// BSI-Artefakten vorkommen. Jede Funktion liefert einen neuen Objektgraphen,
// damit die Tests keine veränderliche Quelle teilen.
// =============================================================================

/** Neutrale HTTPS-Adresse: die Klassifikation darf keine Registry kennen müssen. */
export const EXTERNAL_HTTPS_SOURCE = 'https://example.invalid/reference/catalog.json';

export function makeReferenceResolutionCatalogSource() {
  return {
    catalog: {
      uuid: 'catalog-gspp',
      metadata: {
        title: 'Referenzauflösungs-Fixture',
        'last-modified': '2026-08-08T00:00:00Z',
        version: '2026-08-08',
        'oscal-version': '1.1.3',
        links: [
          {
            href: '#resource-empty',
            rel: 'reference',
            'resource-fragment': 'metadaten-abschnitt',
            text: 'Metadatenquelle',
          },
          { href: 'basic_profile.xml', rel: 'source-profile' },
          { href: 'opaque-source-profile-uuid', rel: 'source-profile-uuid' },
        ],
      },
      groups: [
        {
          id: 'GC',
          title: 'Praktik',
          groups: [
            {
              id: 'GC.1',
              title: 'Thema',
              controls: [
                {
                  id: 'GC.1.1',
                  title: 'Kontrolle mit Quellen',
                  props: [{ name: 'alt-identifier', value: 'alt-gc-1-1' }],
                  links: [
                    {
                      href: '#resource-empty',
                      rel: 'reference',
                      'resource-fragment': 'abschnitt-2.4',
                      text: 'Leere Quelle',
                    },
                    { href: '#GC.1.2', rel: 'required' },
                    { href: '#missing-resource', rel: 'reference' },
                    { href: EXTERNAL_HTTPS_SOURCE, rel: 'reference' },
                    { href: '../catalogs/Kernel/catalog.json', rel: 'reference' },
                    { href: 'foo.json', rel: 'reference' },
                    { href: '../../etc/passwd', rel: 'reference' },
                    { href: 'javascript:alert(1)', rel: 'reference' },
                    { href: 'data:text/plain,unsafe', rel: 'reference' },
                    { href: 'file:///etc/passwd', rel: 'reference' },
                    { href: 'http://example.invalid/untrusted', rel: 'reference' },
                    { href: 'mailto:unsafe@example.invalid', rel: 'reference' },
                  ],
                },
                {
                  id: 'GC.1.2',
                  title: 'Zielkontrolle',
                  props: [{ name: 'alt-identifier', value: 'alt-gc-1-2' }],
                },
              ],
            },
          ],
        },
      ],
      'back-matter': {
        resources: [
          { uuid: 'resource-empty' },
          {
            uuid: 'resource-rich',
            title: 'Mehrfach verlinkte Quelle',
            description: 'Beschreibender <em>Text</em>.',
            citation: { text: 'BSI, Quelle, 2026' },
            rlinks: [
              {
                href: 'https://example.invalid/first.pdf',
                'media-type': 'application/pdf',
              },
              {
                href: 'https://example.invalid/second.pdf',
                hashes: [{ algorithm: 'MD5', value: 'foreign-upstream-metadata' }],
              },
            ],
          },
          {
            uuid: 'resource-embedded',
            base64: {
              filename: 'evidence.pdf',
              'media-type': 'application/pdf',
              value: 'DO-NOT-COPY-OR-DECODE-THIS-PAYLOAD',
            },
          },
        ],
      },
    },
  };
}
