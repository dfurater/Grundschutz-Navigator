// =============================================================================
// Mehr-Katalog-Ladepfad (GSPP-284)
//
// Der Korpus ist fixture-basiert: der Provider nimmt seine Katalogmenge als
// Deskriptorliste entgegen, damit Identitätskollision, Integritätsisolation und
// bedarfsgerechtes Nachladen unabhängig vom jeweiligen Auslieferungsstand
// beobachtbar sind.
//
// Seit GSPP-242 liefert das reale Register mehr als einen Katalog aus. Der
// abschließende Block prüft deshalb zusätzlich gegen die **realen** Deskriptoren,
// dass die Promotion den Initial-Load nicht vergrößert hat.
// =============================================================================

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogProvider, type SupportedCatalogDescriptor } from './CatalogContext';
import { buildSupportedCatalogDescriptors } from './catalogArtifacts';
import { computeSHA256 } from '@/domain/integrity';
import { useCatalog } from '@/hooks/useCatalog';

const ENTRY_DATA_URL = '/data/catalog.json';
const ENTRY_METADATA_URL = '/data/catalog-metadata.json';
const SECOND_DATA_URL = '/data/catalog-wlan.json';
const SECOND_METADATA_URL = '/data/catalog-wlan-metadata.json';

const descriptors: readonly SupportedCatalogDescriptor[] = [
  {
    catalogKey: 'gspp',
    dataUrl: ENTRY_DATA_URL,
    metadataUrl: ENTRY_METADATA_URL,
    isEntryCatalog: true,
  },
  {
    catalogKey: 'wlan',
    dataUrl: SECOND_DATA_URL,
    metadataUrl: SECOND_METADATA_URL,
    isEntryCatalog: false,
  },
];

/**
 * Zwei Kataloge mit **derselben** `control/@id`. Das ist der Normalfall, nicht
 * die Ausnahme: `control/@id` trägt im OSCAL-Catalog-Metaschema
 * `identifier-uniqueness="local"` und ist über Kataloggrenzen hinweg
 * ausdrücklich nicht eindeutig.
 */
function makeCatalogFixture({
  uuid,
  title,
  oscalVersion,
  controlTitle,
  altIdentifier,
}: {
  uuid: string;
  title: string;
  oscalVersion: string;
  controlTitle: string;
  altIdentifier: string;
}) {
  return {
    catalog: {
      uuid,
      metadata: {
        title,
        'last-modified': '2026-08-18T00:00:00Z',
        version: '1.0.0',
        'oscal-version': oscalVersion,
      },
      groups: [
        {
          id: 'GC',
          title: 'Governance und Compliance',
          groups: [
            {
              id: 'GC.1',
              title: 'Strategie',
              controls: [
                {
                  id: 'GC.1.1',
                  title: controlTitle,
                  props: [{ name: 'alt-identifier', value: altIdentifier }],
                  parts: [{ name: 'statement', prose: 'Eine Kontrolle MUSS umgesetzt werden.' }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

const entryCatalogJson = makeCatalogFixture({
  uuid: 'entry-catalog',
  title: 'Einstiegskatalog',
  oscalVersion: '1.1.3',
  controlTitle: 'Kontrolle im Einstiegskatalog',
  altIdentifier: 'alt-entry-gc-1-1',
});

// Bewusst eine andere gepinnte OSCAL-Version: der Ladepfad darf keine
// gemeinsame Versionsannahme über alle Kataloge treffen (GSPP-283).
const secondCatalogJson = makeCatalogFixture({
  uuid: 'second-catalog',
  title: 'Zweitkatalog',
  oscalVersion: '1.1.2',
  controlTitle: 'Kontrolle im Zweitkatalog',
  altIdentifier: 'alt-second-gc-1-1',
});

function serialize(value: unknown) {
  return JSON.stringify(value);
}

async function provenanceFor(value: unknown, sha256?: string) {
  const bytes = new TextEncoder().encode(serialize(value));
  return {
    source: {
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      file: 'control_layer/Fixture/fixture.json',
      commit_sha: 'snapshot-284',
      git_blob_sha: 'blob-fixture',
    },
    integrity: {
      sha256: sha256 ?? (await computeSHA256(bytes.buffer as ArrayBuffer)),
      size_bytes: bytes.byteLength,
      fetched_at: '2026-08-18T12:00:00Z',
    },
    build: {
      workflow_run_id: 'local',
      workflow_run_url: null,
      runner_environment: 'local',
    },
  };
}

function jsonResponse(value: unknown) {
  return new Response(serialize(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockArtifacts(responses: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url in responses) return jsonResponse(responses[url]);
    return new Response(null, { status: 404, statusText: 'Not Found' });
  });
}

function renderProvider() {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <CatalogProvider
      supportedCatalogs={descriptors}
      vocabulariesUrl="/data/vocabularies.json"
      upstreamSourcesMetadataUrl="/data/upstream-sources-metadata.json"
    >
      {children}
    </CatalogProvider>
  );

  return renderHook(() => useCatalog(), { wrapper });
}

async function waitForEntryCatalog(result: { current: ReturnType<typeof useCatalog> }) {
  await waitFor(() => {
    expect(result.current.loading).toBe(false);
    expect(result.current.catalogs.get('gspp')?.catalog).not.toBeNull();
  });
}

describe('CatalogProvider — mehrere Kataloge', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lädt initial nur den Einstiegskatalog', async () => {
    const fetchSpy = mockArtifacts({
      [ENTRY_DATA_URL]: entryCatalogJson,
      [SECOND_DATA_URL]: secondCatalogJson,
    });

    const { result } = renderProvider();
    await waitForEntryCatalog(result);

    expect(result.current.entryCatalogKey).toBe('gspp');
    expect(result.current.activeCatalogKey).toBe('gspp');
    expect([...result.current.catalogs.keys()]).toEqual(['gspp']);

    const requested = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(requested).not.toContain(SECOND_DATA_URL);
    expect(requested.filter((url) => url === ENTRY_DATA_URL)).toHaveLength(1);
  });

  it('lädt einen weiteren Katalog erst bei Auswahl und genau einmal', async () => {
    const fetchSpy = mockArtifacts({
      [ENTRY_DATA_URL]: entryCatalogJson,
      [SECOND_DATA_URL]: secondCatalogJson,
    });

    const { result, rerender } = renderProvider();
    await waitForEntryCatalog(result);

    act(() => {
      result.current.selectCatalog('wlan');
    });

    await waitFor(() => {
      expect(result.current.catalogs.get('wlan')?.catalog).not.toBeNull();
    });

    // Erneutes Rendern und erneute Auswahl dürfen keinen zweiten Fetch auslösen.
    rerender();
    act(() => {
      result.current.selectCatalog('wlan');
    });

    expect(
      fetchSpy.mock.calls.map(([url]) => String(url)).filter((url) => url === SECOND_DATA_URL),
    ).toHaveLength(1);
    expect(result.current.activeCatalogKey).toBe('wlan');
    expect(result.current.catalog?.catalogKey).toBe('wlan');
  });

  it('hält identische Control-IDs zweier Kataloge kollisionsfrei getrennt', async () => {
    mockArtifacts({
      [ENTRY_DATA_URL]: entryCatalogJson,
      [SECOND_DATA_URL]: secondCatalogJson,
    });

    const { result } = renderProvider();
    await waitForEntryCatalog(result);
    act(() => {
      result.current.selectCatalog('wlan');
    });
    await waitFor(() => {
      expect(result.current.catalogs.get('wlan')?.catalog).not.toBeNull();
    });

    const entry = result.current.catalogs.get('gspp')?.catalog;
    const second = result.current.catalogs.get('wlan')?.catalog;

    expect(entry?.controlsById.get('GC.1.1')?.title).toBe('Kontrolle im Einstiegskatalog');
    expect(second?.controlsById.get('GC.1.1')?.title).toBe('Kontrolle im Zweitkatalog');

    // Der alt-identifier des einen Katalogs ist im anderen unbekannt: die
    // kanonische Route bleibt kataloggescopt.
    expect(entry?.controlsByAltIdentifier.has('alt-second-gc-1-1')).toBe(false);
    expect(second?.controlsByAltIdentifier.has('alt-entry-gc-1-1')).toBe(false);

    expect(result.current.catalogs.get('gspp')?.catalogDocument?.context.catalogKey).toBe('gspp');
    expect(result.current.catalogs.get('wlan')?.catalogDocument?.context.catalogKey).toBe('wlan');
  });

  it('lädt Kataloge unterschiedlicher deklarierter OSCAL-Version gleichzeitig', async () => {
    mockArtifacts({
      [ENTRY_DATA_URL]: entryCatalogJson,
      [SECOND_DATA_URL]: secondCatalogJson,
    });

    const { result } = renderProvider();
    await waitForEntryCatalog(result);
    act(() => {
      result.current.selectCatalog('wlan');
    });
    await waitFor(() => {
      expect(result.current.catalogs.get('wlan')?.catalog).not.toBeNull();
    });

    expect(result.current.catalogs.get('gspp')?.catalog?.metadata.oscalVersion).toBe('1.1.3');
    expect(result.current.catalogs.get('wlan')?.catalog?.metadata.oscalVersion).toBe('1.1.2');
  });

  it('isoliert eine Integritätsverletzung auf den betroffenen Katalog', async () => {
    mockArtifacts({
      [ENTRY_DATA_URL]: entryCatalogJson,
      [ENTRY_METADATA_URL]: await provenanceFor(entryCatalogJson),
      [SECOND_DATA_URL]: secondCatalogJson,
      [SECOND_METADATA_URL]: await provenanceFor(secondCatalogJson, 'abweichender-hash'),
    });

    const { result } = renderProvider();
    await waitForEntryCatalog(result);
    act(() => {
      result.current.selectCatalog('wlan');
    });
    await waitFor(() => {
      expect(result.current.catalogs.get('wlan')?.catalog).not.toBeNull();
    });

    const entry = result.current.catalogs.get('gspp');
    const second = result.current.catalogs.get('wlan');

    expect(second?.verification?.valid).toBe(false);
    expect(second?.catalogDocument?.context.trustClass).toBe('class-1-unverified-public');
    // Bestandssemantik: herabgestuft, nicht verworfen.
    expect(second?.catalog?.controlsById.has('GC.1.1')).toBe(true);

    // Der andere Katalog behält seine Vertrauensklasse und bleibt nutzbar.
    expect(entry?.verification?.valid).toBe(true);
    expect(entry?.catalogDocument?.context.trustClass).toBe('class-1-verified-public');
    expect(entry?.error).toBeNull();
  });

  it('hält einen fehlenden Katalog lokal, ohne die übrigen zu beschädigen', async () => {
    mockArtifacts({
      [ENTRY_DATA_URL]: entryCatalogJson,
      [ENTRY_METADATA_URL]: await provenanceFor(entryCatalogJson),
    });

    const { result } = renderProvider();
    await waitForEntryCatalog(result);
    act(() => {
      result.current.selectCatalog('wlan');
    });

    await waitFor(() => {
      expect(result.current.catalogs.get('wlan')?.error).not.toBeNull();
    });

    expect(result.current.catalogs.get('wlan')?.loading).toBe(false);
    expect(result.current.catalogs.get('wlan')?.catalog).toBeNull();
    expect(result.current.catalogs.get('gspp')?.catalog?.controlsById.has('GC.1.1')).toBe(true);
    expect(result.current.catalogs.get('gspp')?.error).toBeNull();
    expect(result.current.catalogs.get('gspp')?.catalogDocument?.context.trustClass).toBe(
      'class-1-verified-public',
    );
  });

  it('ignoriert die Auswahl eines nicht ausgelieferten Katalogs', async () => {
    mockArtifacts({ [ENTRY_DATA_URL]: entryCatalogJson });

    const { result } = renderProvider();
    await waitForEntryCatalog(result);

    act(() => {
      // Ein registrierter, aber nicht ausgelieferter Katalog: der Provider
      // kennt ausschließlich seine Deskriptormenge.
      result.current.selectCatalog('mindeststandard-tls');
    });

    expect(result.current.activeCatalogKey).toBe('gspp');
    expect([...result.current.catalogs.keys()]).toEqual(['gspp']);
  });
});

/* ------------------------------------------------------------------ */
/*  Realer Auslieferungsstand (GSPP-242)                               */
/* ------------------------------------------------------------------ */

describe('CatalogProvider — reales Quellregister', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('leitet je supported-Katalog genau ein Daten- und ein Metadatenartefakt ab', () => {
    const real = buildSupportedCatalogDescriptors('/');

    // Untergrenze: mit nur einem Katalog wäre der Nachweis gegenstandslos.
    expect(real.length).toBeGreaterThan(1);
    expect(real.filter((descriptor) => descriptor.isEntryCatalog)).toHaveLength(1);

    const entry = real.find((descriptor) => descriptor.isEntryCatalog)!;
    const promoted = real.find((descriptor) => descriptor.catalogKey === 'lieferkette')!;

    // Der Einstiegskatalog behält seinen unveränderten Auslieferungsvertrag.
    expect(entry.dataUrl).toBe('/data/catalog.json');
    expect(entry.metadataUrl).toBe('/data/catalog-metadata.json');
    // Der promotete Katalog erhält den aus seinem catalogKey abgeleiteten Namen.
    expect(promoted.isEntryCatalog).toBe(false);
    expect(promoted.dataUrl).toBe('/data/catalog-lieferkette.json');
    expect(promoted.metadataUrl).toBe('/data/catalog-lieferkette-metadata.json');
  });

  it('lässt den Initial-Load durch die Promotion nicht wachsen', async () => {
    const real = buildSupportedCatalogDescriptors('/');
    const entry = real.find((descriptor) => descriptor.isEntryCatalog)!;
    const fetchSpy = mockArtifacts({ [entry.dataUrl]: entryCatalogJson });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CatalogProvider
        vocabulariesUrl="/data/vocabularies.json"
        upstreamSourcesMetadataUrl="/data/upstream-sources-metadata.json"
      >
        {children}
      </CatalogProvider>
    );
    const { result } = renderHook(() => useCatalog(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.catalogs.get(entry.catalogKey)?.catalog).not.toBeNull();
    });

    const requested = fetchSpy.mock.calls.map(([url]) => String(url));
    // Kein ausgelieferter Nicht-Einstiegskatalog wird eager angefordert.
    for (const descriptor of real.filter((candidate) => !candidate.isEntryCatalog)) {
      expect(requested).not.toContain(descriptor.dataUrl);
      expect(requested).not.toContain(descriptor.metadataUrl);
    }
    expect([...result.current.catalogs.keys()]).toEqual([entry.catalogKey]);
  });
});
