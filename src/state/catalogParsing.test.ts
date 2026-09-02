import { describe, expect, it } from 'vitest';
import { parseCatalogBuffer } from './catalogParsing';

const source = {
  catalog: {
    uuid: 'catalog-worker-fixture',
    metadata: {
      title: 'Worker-Fixture',
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

describe('parseCatalogBuffer', () => {
  it('parses an isolated catalog source and reports both parse-phase durations', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(source));

    const result = parseCatalogBuffer(bytes.buffer, {
      catalogKey: 'gspp',
      trustClass: 'class-1-verified-public',
    });

    expect(result.catalogDocument.context).toMatchObject({
      catalogKey: 'gspp',
      trustClass: 'class-1-verified-public',
    });
    expect(result.catalogDocument.view.controlsById.get('G.1')?.title).toBe('Kontrolle');
    expect(result.timings.jsonParseMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.domainParseMs).toBeGreaterThanOrEqual(0);
  });

  it('does not hide a root-type error from the caller', () => {
    const bytes = new TextEncoder().encode('{"profile":{"metadata":{"oscal-version":"1.1.3"}}}');

    expect(() =>
      parseCatalogBuffer(bytes.buffer, {
        catalogKey: 'gspp',
        trustClass: 'class-1-unverified-public',
      }),
    ).toThrow('OSCAL_ROOT_TYPE_MISMATCH');
  });
});
