import { readFileSync } from 'node:fs';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { makeMaximalOscalDocument } from '@/test/fixtures/oscalRoundTripCorpus';
import { formatRoundTripDifferences, runNoOpRoundTrip } from './oscalRoundTrip';

const CATALOG_MAX = () => makeMaximalOscalDocument('catalog', '1.2.2');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Offline-Vertrag des Harnischs', () => {
  it('löst zu keinem Zeitpunkt einen Netzwerkzugriff auf einen href aus', async () => {
    // Der Korpus trägt https-hrefs und interne Fragmente; keiner davon darf
    // je adressiert werden — weder fetch noch XHR.
    const fetchSpy = vi.fn(async () => {
      throw new Error('Netzwerkzugriff im Harnisch verboten');
    });
    const openSpy = vi.fn(() => {
      throw new Error('XHR-Zugriff im Harnisch verboten');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', class { open = openSpy; });

    const document = CATALOG_122_WITH_EXTERNAL_HREFS();
    const result = await runNoOpRoundTrip({
      rootType: 'catalog',
      fixtureText: JSON.stringify(document),
      catalogKey: 'catalog-gspp',
    });

    expect(result.stages.references.status).toBe('passed');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();

    // Auch ein unsicheres Protokoll wird nur klassifiziert, nie adressiert.
    const unsafe = CATALOG_122_WITH_EXTERNAL_HREFS();
    ((unsafe.catalog as Record<string, unknown>).metadata as Record<string, unknown>)
      .links = [{ href: 'javascript:beispiel' }];

    await expect(runNoOpRoundTrip({
      rootType: 'catalog',
      fixtureText: JSON.stringify(unsafe),
      catalogKey: 'catalog-gspp',
    })).resolves.toMatchObject({ stages: { references: { status: 'failed' } } });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe('Determinismus', () => {
  it('liefert wiederholte Läufe auf identischer Eingabe tiefgleiche Ergebnisse', async () => {
    const fixtureText = JSON.stringify(CATALOG_MAX());

    const first = await runNoOpRoundTrip({
      rootType: 'catalog',
      fixtureText,
      catalogKey: 'catalog-gspp',
    });
    const second = await runNoOpRoundTrip({
      rootType: 'catalog',
      fixtureText,
      catalogKey: 'catalog-gspp',
    });

    expect(JSON.parse(JSON.stringify(second))).toEqual(JSON.parse(JSON.stringify(first)));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.graph)).toBe(true);
  });
});

describe('Redaction der Fehlerausgabe', () => {
  it('gibt Pfade und Wertarten aus, aber niemals Dokumentwerte', async () => {
    const MARKER = 'streng-geheimer-korpuswert-42';
    const document = CATALOG_MAX();
    const body = document.catalog as Record<string, unknown>;
    const metadata = body.metadata as Record<string, unknown>;
    metadata.title = MARKER;

    // Ein eingespeister Export verwirft das Feld, damit eine Differenz entsteht.
    const result = await runNoOpRoundTrip({
      rootType: 'catalog',
      fixtureText: JSON.stringify(document),
      exportDocument: (parsed) => {
        const copy = structuredClone(parsed) as Record<string, unknown>;
        const body = copy.catalog as Record<string, unknown>;
        const bodyMetadata = body.metadata as Record<string, unknown>;
        delete bodyMetadata.title;
        return copy;
      },
    });

    expect(result.graph.status).toBe('failed');
    if (result.graph.status !== 'failed') throw new Error('unerreichbar');

    const output = formatRoundTripDifferences(result.graph.differences);
    expect(output.length).toBeGreaterThan(0);
    expect(output[0]).toContain('$.catalog.metadata.title');
    expect(output.join('\n')).not.toContain(MARKER);
  });
});

describe('Statischer Vertragscheck: keine eigene Versionsliste', () => {
  it('delegiert die Bindung an den Root-Dispatch und führt keine Versionsliterale', () => {
    const source = readFileSync('src/test/oscalRoundTrip.ts', 'utf8');

    // Der Harnisch ruft Stufe 2 auf — dort wählt resolveSchemaBinding(); er
    // spiegelt sie nicht.
    expect(source).toContain('dispatchOscalDocument');

    for (const version of ['1.1.2', '1.1.3', '1.2.1', '1.2.2']) {
      // Die Versionen kommen ausschließlich aus der Matrix; ein Literal im
      // Quelltext wäre der Anfang einer gespiegelten Liste.
      expect(source.includes(`'${version}'`), version).toBe(false);
    }
  });
});

/** Katalog mit externem und internem href in den Metadaten-Links. */
function CATALOG_122_WITH_EXTERNAL_HREFS(): Record<string, unknown> {
  const document = CATALOG_MAX();
  const body = document.catalog as Record<string, unknown>;
  const metadata = body.metadata as Record<string, unknown>;
  metadata.links = [
    { href: '#dddddddd-0000-4000-8000-000000000001', rel: 'reference' },
    { href: 'https://beispiel.invalid/quelle.pdf', rel: 'reference' },
  ];
  return document;
}
