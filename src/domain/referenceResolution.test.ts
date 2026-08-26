import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCatalog } from '@/adapters/oscalAdapter';
import {
  REFERENCE_RESOLUTION_VALIDATOR,
  classifyCatalogLinkRelation,
  createReferenceDocument,
  isSafeExternalHref,
  resolveCatalogMetadataReferences,
  resolveCatalogControlLinks,
  resolveCatalogResources,
  resolveControlReferences,
  resolveOscalReference,
} from '@/domain/referenceResolution';
import type { UnresolvedOscalReference } from '@/domain/referenceResolution';
import type { CatalogKey } from '@/domain/sourceRegistry';
import {
  EXTERNAL_HTTPS_SOURCE,
  makeReferenceResolutionCatalogSource,
} from '@/test/fixtures/referenceResolution';

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeDocument(catalogKey: CatalogKey = 'gspp') {
  return createReferenceDocument({
    source: makeReferenceResolutionCatalogSource(),
    context: {
      catalogKey,
      trustClass: 'class-1-verified-public',
    },
    rootType: 'catalog',
    oscalVersion: '1.1.3',
  });
}

function makeCatalogsByKey() {
  const gsppSource = makeReferenceResolutionCatalogSource();
  const wlanSource = makeReferenceResolutionCatalogSource();
  wlanSource.catalog.groups[0]!.groups[0]!.controls![1]!.title = 'WLAN-Zielkontrolle';

  const gspp = parseCatalog(gsppSource.catalog, { catalogKey: 'gspp' });
  const wlan = parseCatalog(wlanSource.catalog, { catalogKey: 'wlan' });
  return new Map([
    [gspp.catalogKey, gspp],
    [wlan.catalogKey, wlan],
  ]);
}

describe('referenceResolution', () => {
  it('preserves original optional rel values and resource-fragment in projected control links', () => {
    const source = makeReferenceResolutionCatalogSource();
    const sourceControl = source.catalog.groups[0]!.groups[0]!.controls![0]!;
    (sourceControl as { links: Array<Record<string, unknown>> }).links = [
      {
        href: '#GC.1.2',
        rel: 'maps-to',
        'resource-fragment': 'statement',
      },
      { href: '#GC.1.2' },
    ];
    const document = createReferenceDocument({
      source,
      context: { catalogKey: 'gspp', trustClass: 'class-1-verified-public' },
      rootType: 'catalog',
      oscalVersion: '1.1.3',
    });

    expect(resolveCatalogControlLinks({
      document,
      catalogsByKey: makeCatalogsByKey(),
    }).get('GC.1.1')).toEqual([
      {
        targetId: 'GC.1.2',
        href: '#GC.1.2',
        rel: 'maps-to',
        relStatus: 'custom',
        resourceFragment: 'statement',
      },
      {
        targetId: 'GC.1.2',
        href: '#GC.1.2',
        rel: undefined,
        relStatus: 'missing',
        resourceFragment: undefined,
      },
    ]);
    expect(classifyCatalogLinkRelation('reference')).toBe('documented');
    expect(classifyCatalogLinkRelation('related')).toBe('custom');
    expect(classifyCatalogLinkRelation(undefined)).toBe('missing');
  });

  it('resolves control resources from source, retains resource fragments, and omits base64 payloads', () => {
    const resolved = resolveControlReferences({
      document: makeDocument(),
      controlId: 'GC.1.1',
      catalogsByKey: makeCatalogsByKey(),
    });

    const resource = resolved.find((reference) => reference.kind === 'resource');
    expect(resource).toMatchObject({
      kind: 'resource',
      resourceFragment: 'abschnitt-2.4',
      resource: {
        uuid: 'resource-empty',
        content: 'empty',
      },
    });

    const resources = resolveCatalogResources({ document: makeDocument() });
    expect(resources.find((resource) => resource.uuid === 'resource-rich')).toMatchObject({
      rlinks: [
        { href: 'https://example.invalid/first.pdf', integrity: 'missing' },
        { href: 'https://example.invalid/second.pdf', integrity: 'declared' },
      ],
    });
    expect(resources.find((resource) => resource.uuid === 'resource-embedded')).toMatchObject({
      embeddedContent: {
        filename: 'evidence.pdf',
        mediaType: 'application/pdf',
      },
    });
    expect(JSON.stringify(resources)).not.toContain('DO-NOT-COPY-OR-DECODE-THIS-PAYLOAD');
  });

  it('resolves control ids only in the explicitly supplied catalog context', () => {
    const gsppResolved = resolveControlReferences({
      document: makeDocument('gspp'),
      controlId: 'GC.1.1',
      catalogsByKey: makeCatalogsByKey(),
    });
    const wlanResolved = resolveControlReferences({
      document: makeDocument('wlan'),
      controlId: 'GC.1.1',
      catalogsByKey: makeCatalogsByKey(),
    });

    expect(gsppResolved.find((reference) => reference.kind === 'control')).toMatchObject({
      control: { title: 'Zielkontrolle' },
      catalogKey: 'gspp',
    });
    expect(wlanResolved.find((reference) => reference.kind === 'control')).toMatchObject({
      control: { title: 'WLAN-Zielkontrolle' },
      catalogKey: 'wlan',
    });
  });

  it('fails closed without I/O and redacts the href from unresolved diagnostics', () => {
    const fetch = vi.fn(() => { throw new Error('network access is forbidden'); });
    const XMLHttpRequest = vi.fn(() => { throw new Error('network access is forbidden'); });
    const sendBeacon = vi.fn(() => { throw new Error('network access is forbidden'); });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('XMLHttpRequest', XMLHttpRequest);
    vi.stubGlobal('navigator', { sendBeacon });

    const resolved = resolveControlReferences({
      document: makeDocument(),
      controlId: 'GC.1.1',
      catalogsByKey: makeCatalogsByKey(),
    });

    const relative = resolved.find(
      (reference): reference is UnresolvedOscalReference =>
        reference.kind === 'unresolved' && reference.reason === 'relative',
    );
    expect(relative).toMatchObject({
      kind: 'unresolved',
      diagnostic: {
        stage: 'reference',
        validator: REFERENCE_RESOLUTION_VALIDATOR,
        path: '/catalog/groups/0/groups/0/controls/0/links/4/href',
      },
    });
    expect(JSON.stringify(relative?.diagnostic)).not.toContain('../catalogs/Kernel/catalog.json');
    expect(fetch).not.toHaveBeenCalled();
    expect(XMLHttpRequest).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('classifies only HTTPS URLs as external and rejects all other protocols', () => {
    const context = { document: makeDocument() };

    expect(resolveOscalReference({ href: EXTERNAL_HTTPS_SOURCE, path: '/source' }, context))
      .toMatchObject({ kind: 'external', href: EXTERNAL_HTTPS_SOURCE });
    for (const href of [
      'https:example.invalid/ambiguous',
      'https://',
      'https://user:password@example.invalid/private',
      'javascript:alert(1)',
      'data:text/plain,unsafe',
      'file:///etc/passwd',
      'http://example.invalid/untrusted',
      'mailto:unsafe@example.invalid',
    ]) {
      expect(resolveOscalReference({ href, path: '/source' }, context)).toMatchObject({
        kind: 'unresolved',
        reason: 'unsafe-protocol',
      });
    }

    expect(isSafeExternalHref(EXTERNAL_HTTPS_SOURCE)).toBe(true);
    expect(isSafeExternalHref('HTTPS://example.invalid/upper-case')).toBe(true);
    expect(isSafeExternalHref('https:example.invalid/ambiguous')).toBe(false);
    expect(isSafeExternalHref('https://user:password@example.invalid/private')).toBe(false);
  });

  it('weist die externe GitHub-Referenz des WLAN-Profils (c820c541) als external ab und löst sie nie auf', () => {
    const context = { document: makeDocument() };
    // Exakte URL aus dem WLAN-Profil am Snapshot 9008ca0: dieselbe Ressource
    // wie der relative Import, aber an einem FREMDEN Commit gepinnt.
    const wlanExternalHref =
      'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/blob/47de2824a341812438ef3f044b3f65ce2cad6e32/control_layer/Grundschutz%2B%2B/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-G0-catalog.json';

    const resolved = resolveOscalReference({ href: wlanExternalHref, path: '/back-matter/rlinks/0/href' }, context);
    expect(resolved).toMatchObject({ kind: 'external', href: wlanExternalHref });
    expect('document' in resolved).toBe(false);
  });

  it('only resolves cross-document references explicitly supplied by the caller', () => {
    const href = 'explicit-profile.json#resource-empty';
    const context = { document: makeDocument() };

    expect(resolveOscalReference({ href, path: '/import-profile/href' }, context)).toMatchObject({
      kind: 'unresolved',
      reason: 'document-not-provided',
    });
    expect(resolveOscalReference(
      { href, path: '/import-profile/href' },
      {
        ...context,
        documentsByHref: new Map([[href, makeDocument('wlan')]]),
      },
    )).toMatchObject({
      kind: 'cross-document',
      document: { context: { catalogKey: 'wlan' } },
      resource: { uuid: 'resource-empty', content: 'empty' },
    });
  });

  it('excludes provenance links from resolution and diagnostics', () => {
    const references = resolveCatalogMetadataReferences({ document: makeDocument() });

    expect(references.filter((reference) => reference.kind === 'provenance')).toHaveLength(2);
    expect(references.some((reference) => reference.kind === 'unresolved')).toBe(false);
  });

  it('classifies self-referential and mutually referential resource rlinks without recursion', () => {
    const source = {
      catalog: {
        ...makeReferenceResolutionCatalogSource().catalog,
        'back-matter': {
          resources: [
            { uuid: 'self', rlinks: [{ href: '#self' }] },
            { uuid: 'first', rlinks: [{ href: '#second' }] },
            { uuid: 'second', rlinks: [{ href: '#first' }] },
          ],
        },
      },
    };
    const document = createReferenceDocument({
      source,
      context: { catalogKey: 'gspp', trustClass: 'class-1-verified-public' },
      rootType: 'catalog',
      oscalVersion: '1.1.3',
    });

    const resources = resolveCatalogResources({ document });

    expect(resources).toMatchObject([
      {
        uuid: 'self',
        rlinks: [{ href: '#self', target: { kind: 'resource', resourceUuid: 'self' } }],
      },
      {
        uuid: 'first',
        rlinks: [{ href: '#second', target: { kind: 'resource', resourceUuid: 'second' } }],
      },
      {
        uuid: 'second',
        rlinks: [{ href: '#first', target: { kind: 'resource', resourceUuid: 'first' } }],
      },
    ]);
  });

  it('indexes back-matter resources once for catalog link projection', () => {
    const source = makeReferenceResolutionCatalogSource();
    const backMatter = source.catalog['back-matter'];
    const resources = backMatter.resources;
    let resourceReads = 0;
    Object.defineProperty(backMatter, 'resources', {
      configurable: true,
      get: () => {
        resourceReads += 1;
        return resources;
      },
    });
    const document = createReferenceDocument({
      source,
      context: { catalogKey: 'gspp', trustClass: 'class-1-verified-public' },
      rootType: 'catalog',
      oscalVersion: '1.1.3',
    });

    resolveCatalogControlLinks({ document });

    expect(resourceReads).toBe(1);
  });
});
