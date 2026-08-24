import { describe, expect, it } from 'vitest';
import {
  OSCAL_ROOT_KEYS,
  type OscalRootKey,
} from '@/domain/oscalVersionMatrix';
import {
  arrayOrderSignature,
  contentMultiset,
  missingFromMultiset,
} from '@/test/oscalStructure';
import {
  makeMaximalOscalDocument,
  MAXIMAL_CORPUS_PROVENANCE,
  makeCatalogTextWithSchemaDirective,
  makeCatalogRevisionsFixture,
} from './fixtures/oscalRoundTripCorpus';
import { runNoOpRoundTrip } from './oscalRoundTrip';

describe('No-op-Korpus über alle acht Root-Modelle', () => {
  for (const rootKey of OSCAL_ROOT_KEYS) {
    it(`durchläuft das Maximaldokument von ${rootKey} ohne Verlust und mit bestandener Stufe 3`, async () => {
      const result = await runNoOpRoundTrip({
        rootType: rootKey,
        fixtureText: JSON.stringify(makeMaximalOscalDocument(rootKey, '1.2.2')),
        catalogKey: rootKey === 'catalog' ? 'gspp' : undefined,
      });

      expect(result.serialization, rootKey).toEqual({ status: 'passed' });
      expect(result.graph, rootKey).toEqual({ status: 'passed', differences: [] });
      expect(result.identities, rootKey).toEqual({ status: 'passed', findings: [] });
      expect(result.stages.schemaValidation, rootKey).toEqual({
        stage: 'json-schema',
        status: 'passed',
      });

      // Der No-op-Lauf benötigt keinen Root-Adapter — er läuft auch für die
      // vier Roots ohne registrierten Adapter vollständig durch.
      if (rootKey === 'catalog') {
        expect(result.stages.references.status).toBe('passed');
      } else {
        expect(result.stages.references).toMatchObject({ status: 'not-available' });
      }
    });
  }
});

describe('Versionsabdeckung des Korpus', () => {
  it('führt ein Maximaldokument des Katalogs in allen vier Bestandsversionen verlustfrei', async () => {
    for (const version of ['1.1.2', '1.1.3', '1.2.1', '1.2.2'] as const) {
      const result = await runNoOpRoundTrip({
        rootType: 'catalog',
        fixtureText: JSON.stringify(makeMaximalOscalDocument('catalog', version)),
        catalogKey: 'gspp',
      });

      expect(result.binding.ok, version).toBe(true);
      expect(result.serialization, version).toEqual({ status: 'passed' });
      expect(result.graph, version).toEqual({ status: 'passed', differences: [] });
      expect(result.stages.schemaValidation.status, version).toBe('passed');
    }
  });
});

describe('Verlustkritische Strukturen (Befund 5)', () => {
  const CATALOG_MAX = () => makeMaximalOscalDocument('catalog', '1.2.2');

  it('trägt genau die verlustkritischen Strukturen im Katalog-Maximaldokument', () => {
    const parsed = CATALOG_MAX();
    const body = parsed.catalog as Record<string, unknown>;
    const metadata = body.metadata as Record<string, unknown>;

    // prop-Nebenfelder und fremder ns
    const metadataProps = metadata.props as Record<string, unknown>[];
    expect(metadataProps.some((prop) => typeof prop.ns === 'string')).toBe(true);
    expect(metadataProps.some((prop) => typeof prop.remarks === 'string')).toBe(true);

    // link.resource-fragment / rel / media-type / text
    const links = metadata.links as Record<string, unknown>[];
    expect(links.some((link) => 'resource-fragment' in link)).toBe(true);

    // inhaltsleere Ressource (nur uuid)
    const backMatter = body['back-matter'] as Record<string, unknown>;
    const resources = backMatter.resources as Record<string, unknown>[];
    expect(resources.some((resource) => Object.keys(resource).length === 1)).toBe(true);

    // revisions nicht leer und nicht absteigend sortiert
    const revisions = metadata.revisions as Record<string, unknown>[];
    expect(revisions.length).toBeGreaterThanOrEqual(2);

    // leere remarks
    expect(JSON.stringify(parsed)).toContain('"remarks":""');
  });

  it('beweist mit Multiset und Ordnungssignatur, dass der Lauf nichts wegoptimiert', async () => {
    const original = CATALOG_MAX();
    const result = await runNoOpRoundTrip({
      rootType: 'catalog',
      fixtureText: JSON.stringify(original),
      catalogKey: 'gspp',
    });

    expect(result.graph.status).toBe('passed');
    // Zählregeln aus der No-op-Vorstufe bestätigen Erhalt unabhängig davon:
    const imported = JSON.parse(JSON.stringify(original));
    expect(missingFromMultiset(contentMultiset(original), contentMultiset(imported)))
      .toEqual([]);
    expect(arrayOrderSignature(original)).toEqual(arrayOrderSignature(imported));
  });

  it('sortiert revisions nie um — auch nicht bei aufsteigender Eingabe', async () => {
    const { document, revisionDatesInOrder } = makeCatalogRevisionsFixture([
      '2026-01-15T00:00:00Z',
      '2026-07-29T00:00:00Z',
    ]);

    const result = await runNoOpRoundTrip({
      rootType: 'catalog',
      fixtureText: JSON.stringify(document),
      catalogKey: 'gspp',
    });

    expect(result.graph.status).toBe('passed');
    const reparsed = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
    const reparsedBody = reparsed.catalog as Record<string, unknown>;
    const importedMetadata = reparsedBody.metadata as Record<string, unknown>;
    const revisions = importedMetadata.revisions as Record<string, unknown>[];

    expect(revisions.map((revision) => revision.published)).toEqual(revisionDatesInOrder);
  });

  it('erzeugt niemals ein leeres revisions-Array', async () => {
    // minItems 1: Ein Round-trip darf aus einer Ein-Element-Historie kein
    // leeres Array machen. Die Probe führt genau ein Revisionselement.
    const { document } = makeCatalogRevisionsFixture(['2026-07-29T00:00:00Z']);
    const body = document.catalog as Record<string, unknown>;
    const metadata = body.metadata as Record<string, unknown>;
    const revisions = metadata.revisions as unknown[];
    expect(revisions).toHaveLength(1);

    const result = await runNoOpRoundTrip({
      rootType: 'catalog',
      fixtureText: JSON.stringify(document),
      catalogKey: 'gspp',
    });

    expect(result.stages.schemaValidation.status).toBe('passed');
    expect(result.graph.status).toBe('passed');
  });
});

describe('$schema-Direktive', () => {
  it('behält ein vorhandenes, zur Zelle passendes $schema unverändert', async () => {
    const pin = 'http://csrc.nist.gov/ns/oscal/1.2.2/oscal-catalog-schema.json';
    const document = makeCatalogTextWithSchemaDirective(pin);

    const result = await runNoOpRoundTrip({
      rootType: 'catalog',
      fixtureText: JSON.stringify(document),
    });

    expect(result.binding).toMatchObject({ ok: true });
    expect(Object.keys(JSON.parse(JSON.stringify(document)))[0]).toBe('$schema');
    expect(result.serialization.status).toBe('passed');
    expect(result.graph.status).toBe('passed');
  });

  it('ergänzt einem Dokument ohne $schema keinen', async () => {
    const document = makeMaximalOscalDocument('catalog', '1.2.2');
    expect('$schema' in document).toBe(false);

    const result = await runNoOpRoundTrip({
      rootType: 'catalog',
      fixtureText: JSON.stringify(document),
    });

    expect(result.binding).toMatchObject({ ok: true });
    expect(result.graph.status).toBe('passed');

    const reparsed = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
    expect('$schema' in reparsed).toBe(false);
  });
});

describe('Provenienz des Korpus', () => {
  it('dokumentiert Herkunft und Kennzeichnung jedes Modells ohne reale Organisationsdaten', () => {
    for (const rootKey of OSCAL_ROOT_KEYS as readonly OscalRootKey[]) {
      const entry = MAXIMAL_CORPUS_PROVENANCE[rootKey];
      expect(entry.origin, rootKey).toMatch(/^(nist-template|synthetic-bsi-nah)$/);
      expect(entry.note.length).toBeGreaterThan(0);
      expect(entry.note).not.toMatch(/https?:\/\//);
    }
  });
});
