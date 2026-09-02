export function createStartupCatalogSource(uuid: string) {
  return {
    catalog: {
      uuid,
      metadata: {
        title: 'Messkatalog',
        'last-modified': '2026-09-02T00:00:00Z',
        version: '1.0.0',
        'oscal-version': '1.1.3',
      },
      groups: [
        {
          id: 'G',
          title: 'Gruppe',
          controls: [
            {
              id: 'G.1',
              title: 'Kontrolle',
              props: [{ name: 'alt-identifier', value: 'control-g-1' }],
              parts: [{ name: 'statement', prose: 'Die Kontrolle MUSS umgesetzt werden.' }],
            },
          ],
        },
      ],
    },
  };
}
