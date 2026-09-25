import { describe, expect, it } from 'vitest';
import {
  createClass2UnprovenancedDiagnostic,
  isParserProducedRoot,
  OSCAL_OBJECT_UNPROVENANCED,
} from './oscalObjectProvenance';
import { OBJECT_GRAPH_STAGE } from './oscalObjectGraph';
import { processClass2OscalValue } from './oscalObjectPipeline';
import { processClass2OscalBytes } from './oscalClass2Import';
import { parseClass2OscalInput } from './oscalImportProcessing';
import { CLASS_2_IMPORT_LIMITS } from './oscalImportContract';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';

const context = { trustClass: 'class-2-local-user' } as const;
const CATALOG_JSON = JSON.stringify(makeSchemaValidOscalDocument('catalog', '1.1.3'));
const BYTE_LIMIT_DIAGNOSTIC = { code: 'OSCAL_BYTE_LIMIT_EXCEEDED', stage: 'resource-limit' };

/** Parst über den eigenen Byte-Eintrittspunkt; nur so ist der Graph registriert. */
function parseRegistered(json: string): unknown {
  const input = parseClass2OscalInput(new TextEncoder().encode(json));
  if (!input.ok) throw new Error('Fixture muss parsen');
  return input.source;
}

function metadataOf(source: unknown): Record<string, unknown> {
  return (source as { catalog: { metadata: Record<string, unknown> } }).catalog.metadata;
}

async function expectRejected(source: unknown, diagnostic: Record<string, unknown>) {
  const result = await processClass2OscalValue(source, context);

  expect(result).toMatchObject({ ok: false, diagnostic });
}

describe('Herkunftsnachweis am Objekteinstieg', () => {
  it('lehnt ein fremdes Rohobjekt an der Kette ab — vor jeder Reflexion', async () => {
    await expectRejected(makeSchemaValidOscalDocument('catalog', '1.1.3'), {
      stage: OBJECT_GRAPH_STAGE,
      code: OSCAL_OBJECT_UNPROVENANCED,
    });
  });

  it('lehnt einen transparenten Proxy als Rohgraph mit derselben Diagnose ab', async () => {
    const proxy = new Proxy(makeSchemaValidOscalDocument('catalog', '1.1.3'), {});

    await expectRejected(proxy, { code: OSCAL_OBJECT_UNPROVENANCED });
  });

  it('lehnt einen Proxy um ein echtes geparstes Ergebnis ab — andere Containeridentität', async () => {
    const wrapped = new Proxy(parseRegistered(CATALOG_JSON) as object, {});

    await expectRejected(wrapped, { code: OSCAL_OBJECT_UNPROVENANCED });
  });

  it('belegt die Herkunft strukturell: kein Pfadsegment, keine Parameter, kein Inhalt', () => {
    const diagnostic = createClass2UnprovenancedDiagnostic();
    const serialized = JSON.stringify(diagnostic);

    expect(diagnostic.path).toBe('/');
    expect(Object.keys(diagnostic.params)).toHaveLength(0);
    expect(serialized).not.toContain('catalog');
  });

  it('akzeptiert das unmittelbare JSON.parse-Ergebnis des eigenen Byte-Eintrittspunkts', async () => {
    const bytes = new TextEncoder().encode(CATALOG_JSON);
    const result = await processClass2OscalBytes(bytes, context);

    expect(result).toMatchObject({ ok: true, document: { rootType: 'catalog' } });
  });

  it('stellt die registrierte Herkunft als reine Identitätsfrage bereit', () => {
    expect(isParserProducedRoot(parseRegistered('{"a":1}') as object)).toBe(true);

    const foreign = { a: 1 };
    expect(isParserProducedRoot(foreign)).toBe(false);
    expect(isParserProducedRoot(new Proxy(foreign, {}))).toBe(false);
  });

  it('bindet die Herkunft über den gesamten Baum — eingetauschter Teilbaum fällt auf', async () => {
    // Greptile-Befund zu 3a1b1d6: Nur die Wurzel war registriert. Ein Aufrufer,
    // der nach dem Parse catalog.metadata durch ein Fremdobjekt ersetzt, muss
    // am fehlenden Beleg des Ersatzcontainers scheitern — nicht erst am
    // Prototypvergleich eines Proxies.
    const source = parseRegistered(CATALOG_JSON);
    (source as { catalog: Record<string, unknown> }).catalog['metadata'] = {};

    await expectRejected(source, { code: OSCAL_OBJECT_UNPROVENANCED });
  });

  it('bindet die Herkunft über den gesamten Baum — Proxy-Ersatz fällt auf', async () => {
    const source = parseRegistered(CATALOG_JSON);
    (source as { catalog: Record<string, unknown> }).catalog['metadata'] = new Proxy({}, {});

    await expectRejected(source, { code: OSCAL_OBJECT_UNPROVENANCED });
  });

  it('terminiert den Belegdurchlauf kontrolliert, wenn registrierte Container nachträglich in einen Kreis gehängt werden', async () => {
    // Gitar-Befund zu 7e2fa02 (Lockstep) und Greptile zu 76746af: Der gemeinsame
    // Durchlauf muss auch dann kontrolliert enden, wenn ein nach dem Parse
    // verketteter registrierter Container einen Zyklus bildet; die Antwort ist
    // die etablierte Identitätsdiagnose der Invariantenprüfung, nie Hängen
    // oder Stapelüberlauf.
    const source = parseRegistered('{"a":{"b":{"c":1}}}');
    const root = source as { a: { b: Record<string, unknown> } };
    root.a.b['next'] = root.a.b;

    await expectRejected(source, {
      code: 'OSCAL_OBJECT_IDENTITY_REJECTED',
      stage: OBJECT_GRAPH_STAGE,
    });
  });

  it('bindet den Parser-erzeugten Wertpfad an dieselbe Byte-Zulassungsgrenze wie den Byteweg', async () => {
    // Greptile-Befund zu 6f39e72 (P1): Eine Primitive-Nachbeladung am
    // registrierten Graphen durfte die Importgröße über die Grenze treiben,
    // die der öffentliche Byteeintritt für dieselben Inhalte durchsetzt. Der
    // Belegdurchlauf summiert deshalb die Nutzlast des Baums und endet
    // fail-closed an derselben Grenze — ohne Serialisierung als Prüfmittel,
    // denn die Nutzlastsumme unterschreitet die serialisierte Größe nie.
    const source = parseRegistered('{"catalog":{"metadata":{"title":"kurz"}}}');
    metadataOf(source)['title'] = 'x'.repeat(CLASS_2_IMPORT_LIMITS.maxBytes + 1);

    await expectRejected(source, BYTE_LIMIT_DIAGNOSTIC);
  });

  it('misst die Nutzlast in UTF-8-Bytes — Mehrbytezeichen umgehen die Grenze nicht', async () => {
    // Greptile-Befund zu cb5f960: UTF-16-.length unterzählt mehrbyteige
    // Zeichen; dieselben Inhalte scheitern am Byteeintritt an derselben
    // Grenze. Der Wertpfad muss denselben Byteetat in derselben Einheit
    // messen.
    const source = parseRegistered('{"catalog":{"metadata":{"title":"x"}}}');
    // '😀' trägt 2 UTF-16-Einheiten, aber 4 UTF-8-Bytes: Die Wiederholung
    // bleibt in UTF-16-Einheiten unter der Grenze und übersteigt sie in
    // UTF-8-Bytes deutlich.
    const units = Math.floor(CLASS_2_IMPORT_LIMITS.maxBytes / 3);
    metadataOf(source)['title'] = '😀'.repeat(units);

    await expectRejected(source, BYTE_LIMIT_DIAGNOSTIC);
  });

  it('rechnet Arrayindizes nicht als Nutzlast — große Arrays behalten ihre Kettendiagnose', async () => {
    // Gitar-Befund zu cb5f960: Indizes und `length` erscheinen nicht in der
    // Serialisierung; ihr Mitsumrieren würde die Untergrenze zur Obergrenze
    // kippen und entry-zulässige Arrays fälschlich an der Bytegrenze
    // ablehnen.
    const elements = JSON.stringify(new Array(300_000).fill(''));

    await expectRejected(parseRegistered(`{"a":${elements}}`), { stage: 'root-dispatch' });
  });

  it('überlässt Symbol-Schlüssel der strukturellen Diagnose statt der Bytegrenze', async () => {
    // Gitar-Befund zu cb5f960: Symbol-Schlüssel machten die Nutzlastsumme
    // zu NaN und erzeugten eine irreführende Byte-Diagnose statt der
    // etablierten Strukturdiagnose.
    const source = parseRegistered('{"a":{"b":1}}');
    const inner = (source as { a: Record<string, unknown> }).a as Record<
      PropertyKey,
      unknown
    >;
    inner[Symbol.iterator] = function* () {};

    await expectRejected(source, {
      code: 'OSCAL_OBJECT_SYMBOL_KEY_REJECTED',
      stage: OBJECT_GRAPH_STAGE,
    });
  });

  it('misst escapepflichtige Zeichen in ihrer serialisierten Länge — Anführungszeichen füllen das Budget', async () => {
    // Greptile-Befund zu 176307f: Escape-Erweiterungen (z. B. \" für jedes
    // Anführungszeichen) verdoppeln die serialisierte Länge gegenüber der
    // Rohform; die Buchhaltung muss die serialisierte Gestalt messen, sonst
    // kippt die Richtungsparität zum Byteeintritt.
    const source = parseRegistered('{"catalog":{"metadata":{"title":"x"}}}');
    const quotes = Math.floor(CLASS_2_IMPORT_LIMITS.maxBytes / 2);
    metadataOf(source)['title'] = '"'.repeat(quotes);

    await expectRejected(source, BYTE_LIMIT_DIAGNOSTIC);
  });

  it('zählt Riesenschlüssel hinter Container-Werten — keine Buchhaltungslücke für verschachtelte Graphen', async () => {
    // Greptile-Befund zu e1d884f: Mitglieder mit Container-Wert durften ihren
    // Schlüssel unaufgerechnet behalten; eine Nachbeladung mit Riesenschlüssel
    // und leerem Array umging die Grenze erneut. Der Schlüssel jedes
    // gezählten Mitglieds trägt seinen serialisierten Anteil, der Container
    // ausschließlich an seinem eigenen Besuch.
    const source = parseRegistered('{"catalog":{"metadata":{"title":"x"}}}');
    // Primitiver Wert, damit ausschließlich die Schlüsselbuchhaltung geprüft
    // wird — ein Container-Wert würde zusätzlich die Herkunftsdiagnose
    // auslösen und den Nachweis verwässern.
    metadataOf(source)['K'.repeat(CLASS_2_IMPORT_LIMITS.maxBytes)] = 0;

    await expectRejected(source, BYTE_LIMIT_DIAGNOSTIC);
  });

  it('weist ein nachträglich sparsam gemachtes registriertes Array ohne Indexiteration ab', async () => {
    // Greptile-Befund zu fe596a5: Das bloße Setzen von length auf einen
    // Riesenwert durfte die Bytebuchhaltung jeden Index durchlaufen lassen,
    // bevor die Formprüfung die Lücken erkennt. Die Dichteprüfung ist eine
    // O(eigene Schlüssel)-Frage — die Iteration startet gar nicht erst.
    const source = parseRegistered('[1,2,3]');
    (source as unknown[]).length = 100_000_000;

    // Ohne Iteration über die Länge gerechnet: 100 Mio null-Löcher reißen
    // zuerst die Knotenuntergrenze — dieselbe Diagnose wie am Byteeingang,
    // ohne Indexiteration und Blockierung.
    await expectRejected(source, {
      code: 'OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED',
      stage: 'resource-limit',
    });
  });

  // Parsen und Durchlaufen des Millionen-Knoten-Graphen dauert auf den
  // GitHub-Actions-Runnern 2,3–4,4s (Runs 35912543867, 35917510807) — zu nah
  // am 5000ms-Default, um zuverlässig zu bestehen.
  it('zählt verschachtelte Container genau einmal — der Grenzgraph von genau einer Million Knoten läuft durch', { timeout: 20_000 }, async () => {
    // Greptile-Befund zu efa1cfa: Die Knotenuntergrenze zählte einen
    // containerwertigen Slot zusätzlich zum späteren Besuch des Containers
    // und lehnte den exakt millionenknotigen Grenzgraphen vor der
    // Strukturvalidierung ab. Die Untergrenze lasst Container-Slots aus;
    // deren Beitrag entsteht ausschließlich am eigenen Besuch.
    const inner = `[${'null,'.repeat(999_997)}null]`;

    // Kein OSCAL-Root-Modell: die Kette antwortet mit der stabilen
    // Root-Dispatch-Diagnose — beweisend, dass Herkunft, Knoten- und
    // Bytegrenze den Grenzgraphen getragen haben.
    await expectRejected(parseRegistered(`[${inner}]`), { stage: 'root-dispatch' });
  });

  it('rechnet sparse Arrays voll — definierte Riesenwerte entgehen der Grenze nicht', async () => {
    // Greptile-Befund zu bcde872: Die Dichte-Frühantwort 0 unterschlug die
    // definierten Slots und ihre null-gefüllten Löcher; dasselbe JSON war am
    // Byteweg OSCAL_BYTE_LIMIT_EXCEEDED. Die Buchhaltung rechnet auch bei
    // Nicht-Dichte vollständig — nur eben ohne Iteration über die Länge.
    const source = parseRegistered('[1,2,3]');
    const array = source as unknown[];
    array[0] = 'y'.repeat(CLASS_2_IMPORT_LIMITS.maxBytes - 1024);
    // Unterhalb der Knotengrenze bleiben: Nur die Bytegrenze soll sprechen.
    array.length = 900_000;

    await expectRejected(source, BYTE_LIMIT_DIAGNOSTIC);
  });

  it('zählt verschachtelte Container genau einmal — kein Doppelsummen-Falschabschluss', async () => {
    // Derselbe Befund, Gegenrichtung: Der Slot eines verschachtelten Arrays
    // darf nicht zusätzlich als null-Pseudowert in den Elternbeitrag laufen.
    const result = await processClass2OscalValue(parseRegistered(CATALOG_JSON), context);

    expect(result).toMatchObject({ ok: true, document: { rootType: 'catalog' } });
  });

  it('registriert auch tief verschachtelte Dokumente ohne Stapelüberlauf', async () => {
    // Greptile-Befund zu 04ccf9c: Die Registrierung rekurrierte unbegrenzt und
    // warf bei tiefer Verschachtelung einen RangeError statt kontrolliert zu
    // antworten. Der Byteweg muss jeden Baum ohne Kontrollverlust tragen.
    const depth = 20_000;
    const text = `${'['.repeat(depth)}null${']'.repeat(depth)}`;

    const result = await processClass2OscalBytes(new TextEncoder().encode(text), context);
    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: 'OSCAL_RESOURCE_DEPTH_LIMIT_EXCEEDED', stage: 'resource-limit' },
    });

    expect(isParserProducedRoot(parseRegistered('{"a":1}') as object)).toBe(true);
  });

  it('führt ein tiefes Dokument zur etablierten Tiefendiagnose — ohne Stapelüberlauf auf dem Prüfpfad', async () => {
    // Dasselbe Muster für den Beleg-Durchlauf der Kette: Auch er muss einen
    // tiefen Baum kontrolliert tragen, bis die begrenzte Invariantenprüfung
    // die etablierte Diagnose liefert. Der Weg läuft über den echten
    // Byte-Eintrittspunkt — der einzige Beleggeber.
    const depth = 20_000;
    const text = `${'['.repeat(depth)}null${']'.repeat(depth)}`;

    const result = await processClass2OscalBytes(new TextEncoder().encode(text), context);

    expect(result).toMatchObject({
      ok: false,
      diagnostic: { code: 'OSCAL_RESOURCE_DEPTH_LIMIT_EXCEEDED', stage: 'resource-limit' },
    });
  });
});
