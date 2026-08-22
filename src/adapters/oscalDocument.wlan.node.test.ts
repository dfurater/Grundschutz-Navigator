// @vitest-environment node
// =============================================================================
// Positivkorpus — Anwenderkatalog WLAN (GSPP-243)
//
// Der Katalog wird nicht committet. Alle Mengen werden deshalb aus dem jeweils
// gepinnten Snapshot abgeleitet und gegen die Projektion geprüft. Fehlt die
// generierte Datei, wird die Korpussuite übersprungen.
// =============================================================================

import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseCatalogDocument } from './oscalDocument';
import { projectResolvedControlLinks } from '@/domain/catalogReferenceProjection';
import {
  referenceDocumentFromCatalog,
  resolveCatalogControlReferences,
  resolveCatalogMetadataReferences,
  resolveCatalogResources,
} from '@/domain/referenceResolution';
import type { Catalog, PropValue } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';

const WLAN_KEY = 'wlan' as const satisfies CatalogKey;
const wlanPath = process.env.GSPP_WLAN_CORPUS_PATH ?? 'public/data/catalog-wlan.json';
const wlanAvailable = existsSync(wlanPath);
const TAXONOMY_NAMES = [
  'Taxonomy-L1',
  'Taxonomy-L2',
  'Taxonomy-L3',
  'Taxonomy-L4',
] as const;

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

interface SourceControl {
  id: string;
  props: JsonObject[];
  links: JsonObject[];
}

function collectSourceControls(body: JsonObject): SourceControl[] {
  const controls: SourceControl[] = [];

  const visitControls = (candidates: readonly unknown[]): void => {
    for (const candidate of candidates) {
      if (!isJsonObject(candidate) || typeof candidate.id !== 'string') continue;
      controls.push({
        id: candidate.id,
        props: readArray(candidate.props).filter(isJsonObject),
        links: readArray(candidate.links).filter(isJsonObject),
      });
      visitControls(readArray(candidate.controls));
    }
  };
  const visitGroups = (candidates: readonly unknown[]): void => {
    for (const candidate of candidates) {
      if (!isJsonObject(candidate)) continue;
      visitControls(readArray(candidate.controls));
      visitGroups(readArray(candidate.groups));
    }
  };

  visitGroups(readArray(body.groups));
  visitControls(readArray(body.controls));
  return controls;
}

function sourceTaxonomy(props: readonly JsonObject[]): PropValue[] {
  return TAXONOMY_NAMES.flatMap((name) => props.flatMap((prop) => (
    prop.name === name && typeof prop.value === 'string'
      ? [{
        name,
        value: prop.value,
        ns: typeof prop.ns === 'string' ? prop.ns : undefined,
      }]
      : []
  )));
}

function loadCorpus() {
  const original = JSON.parse(readFileSync(wlanPath, 'utf8')) as { catalog: JsonObject };
  const document = projectResolvedControlLinks(parseCatalogDocument(original, {
    catalogKey: WLAN_KEY,
    trustClass: 'class-1-verified-public',
  }));
  return { original, body: original.catalog, document };
}

describe.skipIf(!wlanAvailable)('WLAN-Katalog am realen Snapshot', () => {
  let corpus: ReturnType<typeof loadCorpus> | null = null;

  beforeAll(() => {
    corpus = loadCorpus();
  });

  function current(): ReturnType<typeof loadCorpus> {
    if (corpus === null) throw new Error('WLAN-Korpus wurde nicht geladen.');
    return corpus;
  }

  it('führt den Snapshot als eigenständigen OSCAL-1.1.3-Katalog', () => {
    const { body, document } = current();
    const metadata = body.metadata as JsonObject;
    const sourceControls = collectSourceControls(body);

    expect(sourceControls.length).toBeGreaterThan(0);
    expect(document.view.catalogKey).toBe(WLAN_KEY);
    expect(document.view.uuid).toBe(body.uuid);
    expect(document.view.totalControls).toBe(sourceControls.length);
    expect(document.view.metadata.oscalVersion).toBe('1.1.3');
    expect(document.view.metadata.oscalVersion).toBe(metadata['oscal-version']);
    expect(JSON.stringify(document.source)).toBe(JSON.stringify({ catalog: body }));
  });

  it('erhält Taxonomy-L1 bis Taxonomy-L4 geordnet mit exaktem optionalem Namespace', () => {
    const { body, document } = current();
    const sourceControls = collectSourceControls(body);
    const controlsWithTaxonomy = sourceControls.filter(
      (control) => sourceTaxonomy(control.props).length > 0,
    );

    expect(controlsWithTaxonomy.length).toBeGreaterThan(0);
    expect(controlsWithTaxonomy).toHaveLength(sourceControls.length);
    for (const sourceControl of controlsWithTaxonomy) {
      const expected = sourceTaxonomy(sourceControl.props);
      const projected = document.view.controlsById.get(sourceControl.id)?.taxonomy;

      expect(expected.map((prop) => prop.name)).toEqual(TAXONOMY_NAMES);
      expect(projected).toEqual(expected);
    }
  });

  it('klassifiziert Fragmentziele nach dem Dokumentgraphen und behält href sowie rel', () => {
    const { body, document } = current();
    const sourceControls = collectSourceControls(body);
    const sourceLinks = sourceControls.flatMap((control) => control.links.map((link) => ({
      controlId: control.id,
      href: typeof link.href === 'string' ? link.href : '',
      rel: typeof link.rel === 'string' ? link.rel : undefined,
    })));
    const references = resolveCatalogControlReferences({
      document: referenceDocumentFromCatalog(document),
      catalogsByKey: new Map<CatalogKey, Catalog>([[WLAN_KEY, document.view]]),
    });
    const resolved = [...references.values()].flat();

    expect(sourceLinks.length).toBeGreaterThan(0);
    expect(resolved).toHaveLength(sourceLinks.length);
    expect(resolved.every((reference) => reference.kind === 'control')).toBe(true);
    expect(resolved.every((reference) => reference.kind !== 'unresolved')).toBe(true);

    for (const sourceLink of sourceLinks) {
      const match = (references.get(sourceLink.controlId) ?? []).find(
        (reference) => reference.href === sourceLink.href,
      );
      expect(match?.rel).toBe(sourceLink.rel);
    }

    const metadataReferences = resolveCatalogMetadataReferences({
      document: referenceDocumentFromCatalog(document),
      catalogsByKey: new Map<CatalogKey, Catalog>([[WLAN_KEY, document.view]]),
    });
    expect(metadataReferences.length).toBeGreaterThan(0);
    expect(metadataReferences.every((reference) => reference.kind === 'resource')).toBe(true);
    expect(metadataReferences.every((reference) => reference.rel === 'reference')).toBe(true);
  });

  it('löst Back-Matter-Ressourcen rein als Metadaten mit sicheren HTTPS-Zielen auf', () => {
    const { body, document } = current();
    const sourceResources = isJsonObject(body['back-matter'])
      ? readArray(body['back-matter'].resources)
      : [];
    const resources = resolveCatalogResources({
      document: referenceDocumentFromCatalog(document),
      catalogsByKey: new Map<CatalogKey, Catalog>([[WLAN_KEY, document.view]]),
    });

    expect(sourceResources.length).toBeGreaterThan(0);
    expect(resources).toHaveLength(sourceResources.length);
    expect(resources.every((resource) => resource.rlinks.length > 0)).toBe(true);
    for (const resource of resources) {
      for (const link of resource.rlinks) {
        expect(link.target.kind).toBe('external');
        expect(link.href.startsWith('https://')).toBe(true);
      }
    }
  });
});
