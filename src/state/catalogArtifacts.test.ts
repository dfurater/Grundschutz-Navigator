import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_CATALOGS } from '@/domain/sourceRegistry';
import {
  buildSupportedCatalogDescriptors,
  createProvenanceRequests,
  loadCatalogDirectory,
} from '@/state/catalogArtifacts';

const descriptors = buildSupportedCatalogDescriptors('/fixture/');

afterEach(() => vi.restoreAllMocks());

describe('loadCatalogDirectory', () => {
  it('lädt für alle unterstützten Kataloge nur Metadaten und erhält Titel unverändert', async () => {
    const titles = new Map(descriptors.map((entry) => [entry.metadataUrl, `  ${entry.catalogKey} ++ — ü\n`]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      new Response(JSON.stringify({ title: titles.get(String(input)) })),
    );
    const directory = await loadCatalogDirectory(descriptors);
    expect(directory).toEqual(SUPPORTED_CATALOGS.map((entry) => ({
      catalogKey: entry.catalogKey,
      title: `  ${entry.catalogKey} ++ — ü\n`,
    })));
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual(descriptors.map((entry) => entry.metadataUrl));
  });

  it.each([undefined, '', null, 42, {}, []].map((title) => ({ title })))('fällt bei ungültigem Titel nur für diesen Eintrag auf den Schlüssel zurück: %j', async ({ title }) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      new Response(JSON.stringify({ title: String(input) === descriptors[0].metadataUrl ? title : 'Upstream' })),
    );
    const directory = await loadCatalogDirectory(descriptors);
    expect(directory[0]).toEqual({ catalogKey: descriptors[0].catalogKey, title: descriptors[0].catalogKey });
    expect(directory.slice(1).every((entry) => entry.title === 'Upstream')).toBe(true);
  });

  it.each(['missing', 'invalid-json', 'null-json', 'network'])('isoliert nicht lesbare Metadaten: %s', async (failure) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) !== descriptors[0].metadataUrl) return new Response(JSON.stringify({ title: 'Upstream' }));
      if (failure === 'network') throw new TypeError('Network failed');
      if (failure === 'missing') return new Response(null, { status: 404 });
      return new Response(failure === 'null-json' ? 'null' : '{');
    });
    const directory = await loadCatalogDirectory(descriptors);
    expect(directory[0]).toEqual({ catalogKey: descriptors[0].catalogKey, title: descriptors[0].catalogKey });
    expect(directory.slice(1).every((entry) => entry.title === 'Upstream')).toBe(true);
  });
});

describe('createProvenanceRequests', () => {
  it('teilt je URL eine Anfrage und fragt nach einer Ablehnung neu an', async () => {
    let calls = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 503 })
        : new Response(JSON.stringify({ title: 'Upstream' }));
    });
    const requestProvenance = createProvenanceRequests();
    const url = descriptors[0].metadataUrl;

    const failed = requestProvenance(url);
    expect(requestProvenance(url)).toBe(failed);
    await expect(failed).rejects.toThrow('503');

    const retried = requestProvenance(url);
    expect(retried).not.toBe(failed);
    await expect(retried).resolves.toEqual({ title: 'Upstream' });
    expect(requestProvenance(url)).toBe(retried);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
