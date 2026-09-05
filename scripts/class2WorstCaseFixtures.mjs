// =============================================================================
// Synthetische Worst-Case-Dokumente für die Klasse-2-Ressourcengrenzen
// (GSPP-382).
//
// Diese Datei ist ein Wartungswerkzeug und hängt an keinem Anwendungspfad. Sie
// wird von `scripts/measure-class2-budget.mjs` sowohl im Node-Prozess (zur
// Kennzahlberechnung) als auch im Browser-Tab (zur Messung) geladen und
// benutzt deshalb ausschließlich Sprachmittel, die in beiden Laufzeiten
// existieren — kein `node:`-Import, kein DOM.
//
// Leitgedanke: Gemessen wird NICHT der reale BSI-Katalog. Jedes Dokument hier
// liegt exakt auf einer Grenze aus `CLASS_2_IMPORT_LIMITS` und maximiert dabei
// die Arbeit, die ein Angreifer der Prüfkette pro Grenzeinheit aufbürden kann.
// Die Dokumente sind deterministisch: gleicher Aufruf, gleiche Bytes.
//
// Zweite Auflage nach Greptile-Befund zu 6643714: Die erste Fassung erzeugte
// Wurzelarrays und unbekannte Wurzelschlüssel. Solche Dokumente scheitern im
// Root-Dispatch, BEVOR der Schema-Chunk geladen und Ajv ausgeführt wird — die
// gemessenen Kosten ließen damit die teuerste Stufe der Kette aus. Die
// Fixtures sind deshalb jetzt gültige OSCAL-Katalogwurzeln nach dem gepinnten
// Schema 1.1.3 und durchlaufen die Kette vollständig. Ausnahmen sind
// `depth-bound` und `heap-bound`, jeweils mit Begründung an Ort und Stelle.
//
// Dritte Auflage nach Codex-Befund zu 36d9c79: Der Satz enthielt keine Form,
// die die SCHLÜSSEL variiert. Das war die entscheidende Lücke, denn der
// Heap-Treiber ist nicht die Containerzahl, sondern die Zahl verschiedener
// verborgener Klassen: Container gleicher Form teilen sich in V8 eine einzige
// Beschreibung, Container mit je eigenem Schlüssel erzwingen je eine eigene.
// Der bis dahin als Speicher-Worst-Case geführte `depth-bound` besteht aus
// lauter identischen leeren Objekten und ist damit der GÜNSTIGSTE Fall dieser
// Achse, nicht der teuerste. `heap-bound` schließt die Lücke.
// =============================================================================

/**
 * Grenzwerte, gegen die die Fixtures konstruiert werden.
 *
 * Bewusst eine eigene Kopie und kein Import aus `@/domain/oscalImportContract`:
 * Diese Datei muss in einer nackten Node-Laufzeit ohne Aliasauflösung und
 * ohne TypeScript ladbar bleiben, damit die Fixtures unabhängig vom Bundler
 * reproduzierbar sind. Gegen das Auseinanderlaufen steht der Drifttest in
 * `class2WorstCaseFixtures.test.ts`, der beide Tabellen vergleicht.
 */
export const CLASS_2_LIMITS_UNDER_TEST = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 1_000_000,
  maxDecodedBase64Bytes: 4 * 1024 * 1024,
});

const encoder = new TextEncoder();

/** UTF-8-Bytes eines Fixturetextes; die Grenze in Stufe 1 zählt Bytes, nicht Zeichen. */
export function toBytes(text) {
  return encoder.encode(text);
}

// -----------------------------------------------------------------------------
// Kataloghülle
// -----------------------------------------------------------------------------

const CATALOG_HEAD =
  '{"catalog":{"uuid":"11111111-1111-4111-8111-111111111111","metadata":'
  + '{"title":"GSPP-382","last-modified":"2026-09-04T00:00:00Z","version":"1"'
  + ',"oscal-version":"1.1.3"},';
const CATALOG_TAIL = '}}';

/**
 * Knoten der Hülle OHNE das angehängte Mitglied: Wurzelobjekt, `catalog`,
 * `uuid`, `metadata` und dessen vier Stringmitglieder.
 */
export const CATALOG_WRAPPER_NODES = 8;

/** Bytelänge der Hülle; die Fixtures rechnen ihre Nutzlast daran aus. */
export const CATALOG_WRAPPER_BYTES = CATALOG_HEAD.length + CATALOG_TAIL.length;

/**
 * Feste Bytes um die Mitglieder von `heap-bound` herum: die beiden Klammern des
 * Wurzelarrays und die beiden Anführungszeichen des Füllers. Das Komma vor dem
 * Füller gehört nicht dazu — `pairs * (keyLength + 8)` schlägt jedem Paar
 * bereits ein Trennzeichen zu und deckt damit alle Kommata ab, auch das letzte.
 */
const MEMBER_OVERHEAD_BYTES = 4;

/**
 * Setzt einen Katalog aus der festen Hülle und genau einem Mitglied zusammen.
 *
 * @param {string} member Serialisiertes Mitglied, etwa `"groups":[…]`.
 */
function wrapCatalog(member) {
  return `${CATALOG_HEAD}${member}${CATALOG_TAIL}`;
}

/**
 * Kleinste schemagültige Gruppe: `title` ist ihr einziges Pflichtfeld.
 * Zwei Knoten — das Objekt und der Titelstring.
 */
const GROUP = '{"title":"a"}';

/** Gruppe mit einem zusätzlichen erlaubten Stringmitglied: drei Knoten. */
const GROUP_WITH_CLASS = '{"title":"a","class":"a"}';

/**
 * Serialisiert `"groups":[…]`. `nodeBudget` ist die Zahl der Knoten, die die
 * Gruppen zusammen belegen sollen; eine ungerade Zahl wird mit einer
 * dreiknotigen Gruppe punktgenau getroffen.
 *
 * @param {number} nodeBudget Knoten, die die Gruppen belegen sollen.
 * @param {string[]} extraMembers Zusätzliche, bereits serialisierte Gruppen.
 */
function serializeGroups(nodeBudget, extraMembers = []) {
  if (nodeBudget < 2) throw new RangeError('nodeBudget trägt keine Gruppe');

  const withOddGroup = nodeBudget % 2 === 1;
  const groupCount = withOddGroup ? (nodeBudget - 3) / 2 : nodeBudget / 2;
  const members = Array.from({ length: groupCount }, () => GROUP);
  if (withOddGroup) members.push(GROUP_WITH_CLASS);
  members.push(...extraMembers);
  return `"groups":[${members.join(',')}]`;
}

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

/**
 * Byte-Grenze (10 MiB), maximale Stufe-1-Arbeit pro Byte.
 *
 * Der teuerste Byteverbrauch der Bytepolitik ist die `\uXXXX`-Escapesequenz:
 * sechs Quellbytes lösen im `DuplicateMemberScanner` einen Slice, einen
 * Regex-Test und eine `String.fromCodePoint`-Konkatenation aus, und
 * `JSON.parse` dekodiert sie anschließend ein zweites Mal. Der Escape-Text
 * steht als Gruppentitel, damit das Dokument die Schemastufe erreicht.
 *
 * @param {number} totalBytes Zielgröße des Dokuments in Bytes.
 */
export function buildByteBoundDocumentText(totalBytes = CLASS_2_LIMITS_UNDER_TEST.maxBytes) {
  const head = '"groups":[{"title":"';
  const tail = '"}]';
  const payloadBytes = totalBytes - CATALOG_WRAPPER_BYTES - head.length - tail.length;
  if (payloadBytes < 0) throw new RangeError('totalBytes zu klein für die Hülle');

  const escape = String.raw`\u0041`;
  const escapeCount = Math.floor(payloadBytes / escape.length);
  const filler = payloadBytes - escapeCount * escape.length;
  return wrapCatalog(`${head}${escape.repeat(escapeCount)}${'A'.repeat(filler)}${tail}`);
}

/**
 * Knotengrenze (1 000 000), maximale Containerzahl.
 *
 * Die Knotensemantik der Prüfkette zählt jeden Container und jedes primitive
 * Mitglied als einen Knoten. Der Heap-Treiber ist dabei nicht die Knotenzahl
 * als solche, sondern die Containerzahl: `enforceClass2ObjectGraphInvariants`
 * hält jeden besuchten Container in einer `Set`-Identitätsmenge, und
 * `parseClass2OscalInput` trägt zusätzlich jeden Container in ein `WeakSet`
 * ein. Die Minimalgruppe ist der billigste schemagültige Container und
 * maximiert deshalb bei ausgeschöpfter Knotengrenze die Zahl gleichzeitig
 * gehaltener Identitäten.
 *
 * @param {number} totalNodes Zielzahl der Knoten in der Knotensemantik der Prüfkette.
 */
export function buildNodeBoundDocumentText(totalNodes = CLASS_2_LIMITS_UNDER_TEST.maxNodes) {
  // Hülle plus das `groups`-Array selbst.
  const nodeBudget = totalNodes - CATALOG_WRAPPER_NODES - 1;
  return wrapCatalog(serializeGroups(nodeBudget));
}

/**
 * Tiefengrenze (64) bei gleichzeitig ausgeschöpfter Knotengrenze.
 *
 * Dieses Fixture ist die EINZIGE Ausnahme von der Schemafähigkeit, aus einem
 * belegbaren Grund: In einem OSCAL-Katalog liegen Gruppenobjekte
 * ausschließlich auf geraden Tiefen und ihre Blätter deshalb ausschließlich
 * auf ungeraden. Ein Blatt exakt auf Tiefe 64 ist mit einer schemagültigen
 * Katalogstruktur damit nicht konstruierbar — erreichbar wäre nur 63. Da die
 * Aufgabe lautet, die Grenze EXAKT zu treffen, hat das hier Vorrang: Das
 * Fixture belegt, dass die Tiefengrenze bindet, und wird planmäßig erst im
 * Root-Dispatch abgewiesen — seine Messwerte decken deshalb Stufe 1 und die
 * Objektkette bis zum Dispatch ab, nicht die Schemastufe.
 *
 * Es trägt bei ausgeschöpfter Knotengrenze die höchste CONTAINERZAHL des
 * Satzes und damit die größte Identitätsmenge in der Strukturinvariante. Das
 * macht es NICHT zum Speicher-Worst-Case: Die zweite Auflage hat genau das
 * behauptet, und der Codex-Befund zu 36d9c79 hat es widerlegt. Lauter
 * identische leere Objekte teilen sich in V8 eine einzige verborgene Klasse,
 * weshalb der Container hier so billig ist wie er überhaupt werden kann. Wer
 * stattdessen jedem Container einen eigenen Schlüssel gibt, zahlt eine
 * verborgene Klasse pro Container und liegt um ein Vielfaches darüber — siehe
 * `heap-bound`. Dieses Fixture belegt die Tiefengrenze, sonst nichts.
 *
 * @param {number} depth Zieltiefe.
 * @param {number} totalNodes Zielzahl der Knoten.
 */
export function buildDepthBoundDocumentText(
  depth = CLASS_2_LIMITS_UNDER_TEST.maxDepth,
  totalNodes = CLASS_2_LIMITS_UNDER_TEST.maxNodes,
) {
  // Arrays auf den Tiefen 1..depth-1, die Nutzlastcontainer auf Tiefe `depth`.
  const chainLength = depth - 1;
  const payloadCount = totalNodes - chainLength;
  if (payloadCount < 1) throw new RangeError('totalNodes trägt die Kette nicht');

  const payload = `[${Array.from({ length: payloadCount }, () => '{}').join(',')}]`;
  // Das innerste Kettenglied IST das Nutzlastarray; darüber liegen chainLength-1
  // weitere Arrays, damit die Nutzlastelemente exakt auf Tiefe `depth` sitzen.
  return `${'['.repeat(chainLength - 1)}${payload}${']'.repeat(chainLength - 1)}`;
}

/**
 * Knoten- UND Bytegrenze gleichzeitig, beide exakt.
 *
 * Die Knotengrenze treibt den Identitätsspeicher der Strukturinvariante auf
 * sein Maximum, während der verbleibende Byteraum als ein einziger langer
 * Gruppentitel liegt und den Heap zusätzlich um seinen vollen Inhalt belastet,
 * ohne nennenswert Knoten zu verbrauchen. Ein Dokument, das nur je eine Grenze
 * trifft, unterschätzt den Abdruck.
 *
 * @param {number} totalNodes Zielzahl der Knoten.
 * @param {number} totalBytes Zielgröße in Bytes.
 */
export function buildCombinedBoundDocumentText(
  totalNodes = CLASS_2_LIMITS_UNDER_TEST.maxNodes,
  totalBytes = CLASS_2_LIMITS_UNDER_TEST.maxBytes,
) {
  // Hülle, `groups`-Array und die Füllergruppe (Objekt plus Titelstring).
  const nodeBudget = totalNodes - CATALOG_WRAPPER_NODES - 1 - 2;
  const groups = serializeGroups(nodeBudget);

  // Die Füllergruppe wird an das fertige Array angehängt: `]` weicht dem
  // Gruppenanfang, der Titel füllt den Rest des Bytebudgets.
  const head = `${groups.slice(0, -1)},{"title":"`;
  const tail = '"}]';
  const fillerBytes = totalBytes - CATALOG_WRAPPER_BYTES - head.length - tail.length;
  if (fillerBytes < 0) throw new RangeError('totalBytes trägt die Struktur nicht');

  return wrapCatalog(`${head}${'A'.repeat(fillerBytes)}${tail}`);
}

/**
 * Speicher-Worst-Case: Knoten- UND Bytegrenze exakt, und jeder Container trägt
 * eine eigene verborgene Klasse.
 *
 * Der Codex-Befund zu 36d9c79 hat die Annahme widerlegt, die Containerzahl
 * allein treibe den Heap. Sie tut es nicht. V8 beschreibt die Form eines
 * Objekts in einer verborgenen Klasse (Map plus Deskriptorfeld), die sich alle
 * formgleichen Objekte TEILEN. Eine Million identischer leerer Objekte kostet
 * deshalb eine einzige solche Beschreibung; eine halbe Million Objekte mit je
 * eigenem Schlüsselnamen kostet eine halbe Million davon, dazu je einen
 * internalisierten Schlüsselstring. Die Kosten pro Container liegen damit um
 * ein Mehrfaches höher, obwohl es weniger Container sind.
 *
 * Konstruktion, die beide Achsen zugleich ausreizt: Jedes Paar aus äußerem
 * Objekt mit eindeutigem Schlüssel und innerem leeren Objekt belegt zwei
 * Knoten und liefert zwei Container — einen mit eigener verborgener Klasse,
 * einen geschenkten. Der Knotenrahmen ist damit voll ausgeschöpft, während die
 * Zahl verschiedener Formen ihr Maximum erreicht. Der Schlüsselname wird so
 * weit gestreckt, wie die Bytegrenze es zulässt, und der verbleibende Byteraum
 * liegt als ein einziger langer String am Ende — er kostet einen Knoten und
 * belastet den Heap mit seinem vollen Inhalt.
 *
 * Wie `depth-bound` ist das ein reines Angriffsdokument ohne Schemagültigkeit:
 * Ein OSCAL-Katalog kennt keine freien Schlüsselnamen. Das ändert an der
 * Kostenrechnung nichts, denn die Ablehnung im Root-Dispatch erfolgt ERST,
 * nachdem Stufe 1 den Graphen aufgebaut und die Strukturinvariante ihre
 * Identitätsmenge über ihn gelegt hat.
 *
 * @param {number} totalNodes Zielzahl der Knoten; muss gerade sein.
 * @param {number} totalBytes Zielgröße in Bytes.
 */
export function buildHeapBoundDocumentText(
  totalNodes = CLASS_2_LIMITS_UNDER_TEST.maxNodes,
  totalBytes = CLASS_2_LIMITS_UNDER_TEST.maxBytes,
) {
  // Wurzelarray, `pairs` Paare zu je zwei Knoten, Füllerstring.
  if (totalNodes % 2 !== 0) throw new RangeError('totalNodes muss gerade sein');
  const pairs = (totalNodes - 2) / 2;
  if (pairs < 1) throw new RangeError('totalNodes trägt kein Paar');

  // Alle Schlüssel gleich lang, damit die Bytelänge geschlossen ausrechenbar
  // bleibt; die laufende Nummer wird links mit Nullen aufgefüllt.
  const digits = String(pairs - 1).length;
  // Ein Paar kostet `{"<key>":{}}` plus Trennzeichen, also keyLength + 8 Bytes.
  const keyLength = Math.floor((totalBytes - MEMBER_OVERHEAD_BYTES) / pairs) - 8;
  if (keyLength < digits) throw new RangeError('totalBytes trägt die Schlüssel nicht');

  const prefix = 'k'.repeat(keyLength - digits);
  const members = Array.from(
    { length: pairs },
    (_, index) => `{"${prefix}${String(index).padStart(digits, '0')}":{}}`,
  );
  const fillerBytes = totalBytes - pairs * (keyLength + 8) - MEMBER_OVERHEAD_BYTES;
  return `[${members.join(',')},"${'A'.repeat(fillerBytes)}"]`;
}

/**
 * Schlüsselalphabet der breiten Objektform. 64 Zeichen, allesamt ohne
 * JSON-Escape und ohne Ziffer an erster Stelle relevant — die Kodierung ist
 * reine Eindeutigkeit, keine lesbare Nummer. Zur Basis 64 statt zur Basis 10,
 * weil die Schlüssellänge hier der bindende Bytefaktor ist: Eine Million
 * verschiedene Schlüssel brauchen so vier Zeichen statt sechs, und erst damit
 * passt die volle Knotenzahl überhaupt in die Bytegrenze.
 */
const KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_$';

/** Kleinste Zeichenbreite, in der `count` verschiedene Schlüssel darstellbar sind. */
function keyIndexWidth(count) {
  let width = 1;
  while (KEY_ALPHABET.length ** width < count) width += 1;
  return width;
}

/** Feste Breite, damit alle Schlüssel gleich lang und die Bytelänge geschlossen sind. */
function encodeKeyIndex(index, width) {
  let encoded = '';
  let rest = index;
  for (let position = 0; position < width; position += 1) {
    encoded = KEY_ALPHABET[rest % KEY_ALPHABET.length] + encoded;
    rest = Math.floor(rest / KEY_ALPHABET.length);
  }
  return encoded;
}

/**
 * Transienter Speicher-Worst-Case: EIN Objekt mit maximal vielen Mitgliedern.
 *
 * Der Codex-Befund zu 84ca1f6 hat gezeigt, dass die Messung bis dahin nur den
 * Bestand nach dem Lauf plus die Identitätsmenge kannte und die kurzlebigen
 * Allokationen der Prüfkette ausließ — namentlich die Schlüsselarrays und das
 * Paar-Array aus `Object.entries(record)`. Deren Größe hängt nicht an der
 * Knotenzahl, sondern an der BREITE des einzelnen Containers, und genau diese
 * Achse hatte im Satz keine Form.
 *
 * `visitRecord` in [`oscalObjectGraph.ts`] legt für den gerade besuchten
 * Record ein `Object.entries`-Paar-Array an, das über die gesamte
 * Mitgliederschleife lebt — bei einem Record mit einer Million Mitgliedern ist
 * das eine Million Zwei-Element-Arrays gleichzeitig. `isObjectFormAllowed`,
 * `objectChildNodeFloorDelta` und `serializedObjectBytes` legen für denselben
 * Record je ein `Reflect.ownKeys`-Array derselben Länge an. Ein Satz aus
 * schmalen Containern sieht davon nichts.
 *
 * Konstruktion: Wurzelobjekt mit `totalNodes - 1` Mitgliedern, jedes ein
 * eindeutiger Schlüssel auf einer Zahl. Die Bytegrenze bleibt ausgeschöpft —
 * die Schlüssel werden so lang, wie der verbleibende Byteraum es zulässt, der
 * unteilbare Rest hängt am letzten Schlüssel. Wie `heap-bound` ist das ein
 * reines Angriffsdokument: Ein Wurzelobjekt mit freien Schlüsselnamen
 * scheitert im Root-Dispatch, aber erst nachdem Stufe 1 und die
 * Strukturinvariante ihre Arbeit samt Speicher geleistet haben.
 *
 * @param {number} totalNodes Zielzahl der Knoten; Wurzel plus je ein Mitglied.
 * @param {number} totalBytes Zielgröße in Bytes.
 */
export function buildRecordBoundDocumentText(
  totalNodes = CLASS_2_LIMITS_UNDER_TEST.maxNodes,
  totalBytes = CLASS_2_LIMITS_UNDER_TEST.maxBytes,
) {
  const members = totalNodes - 1;
  if (members < 1) throw new RangeError('totalNodes trägt kein Mitglied');

  // Geschweifte Klammern plus je ein Trennkomma zwischen zwei Mitgliedern.
  const structureBytes = 2 + (members - 1);
  // Ein Mitglied kostet `"<key>":0`, also keyLength + 4 Bytes.
  const width = keyIndexWidth(members);
  const keyLength = Math.floor((totalBytes - structureBytes) / members) - 4;
  if (keyLength < width) throw new RangeError('totalBytes trägt die Schlüssel nicht');

  // Der unteilbare Rest verlängert den LETZTEN Schlüssel: Er wird dadurch
  // länger als alle anderen und kann mit keinem von ihnen kollidieren.
  const fillerBytes = totalBytes - structureBytes - members * (keyLength + 4);
  const prefix = 'k'.repeat(keyLength - width);
  const parts = Array.from({ length: members }, (_, index) => {
    const padding = index === members - 1 ? 'k'.repeat(fillerBytes) : '';
    return `"${prefix}${padding}${encodeKeyIndex(index, width)}":0`;
  });
  return `{${parts.join(',')}}`;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_HEAD =
  '"back-matter":{"resources":[{"uuid":"22222222-2222-4222-8222-222222222222"'
  + ',"base64":{"value":"';
const BASE64_TAIL = '"}}]}';

/**
 * Abschlussgruppe für einen Rest von einem, zwei oder drei Bytes: Rest 1
 * braucht zwei Polsterzeichen, Rest 2 eines, Rest 3 eine volle Gruppe.
 *
 * @param {number} remainder Restbytes nach den vollen Dreiergruppen.
 */
function base64Tail(remainder) {
  if (remainder === 1) return 'AA==';
  if (remainder === 2) return 'AAA=';
  return 'AAAA';
}

/**
 * Kodierte base64-Länge, deren arithmetisch bestimmte dekodierte Größe exakt
 * `decodedBytes` beträgt.
 *
 * `accountEmbeddedBase64` rechnet `floor(len / 4) * 3` abzüglich Polsterung.
 * Die zweizeichige Polsterung trifft damit jede dekodierte Größe punktgenau,
 * auch wenn sie nicht durch drei teilbar ist.
 *
 * @param {number} decodedBytes Ziel der dekodierten Summe in Bytes.
 */
export function encodedBase64ForDecodedBytes(decodedBytes) {
  const fullGroups = Math.floor((decodedBytes - 1) / 3);
  const remainder = decodedBytes - fullGroups * 3;
  const unit = BASE64_ALPHABET.repeat(
    Math.ceil((fullGroups * 4) / BASE64_ALPHABET.length) || 1,
  );
  return `${unit.slice(0, fullGroups * 4)}${base64Tail(remainder)}`;
}

/**
 * Base64-Grenze: die dekodierte Summe liegt exakt auf `maxDecodedBase64Bytes`.
 *
 * @param {number} decodedBytes Ziel der dekodierten Summe in Bytes.
 */
export function buildBase64BoundDocumentText(
  decodedBytes = CLASS_2_LIMITS_UNDER_TEST.maxDecodedBase64Bytes,
) {
  return wrapCatalog(
    `${BASE64_HEAD}${encodedBase64ForDecodedBytes(decodedBytes)}${BASE64_TAIL}`,
  );
}

/**
 * Der Deckel, den die Bytegrenze der dekodierten Summe überhaupt setzt: ein
 * Dokument, dessen gesamter zugelassener Byteraum aus base64-Text besteht.
 *
 * Dieses Fixture wird nicht gemessen — es belegt die Erreichbarkeitsaussage.
 * Liegt `maxDecodedBase64Bytes` über der dekodierten Summe dieses Dokuments,
 * kann die Grenze durch keine Eingabe je auslösen.
 *
 * @param {number} totalBytes Zielgröße des Dokuments in Bytes.
 */
export function buildBase64CeilingDocumentText(totalBytes = CLASS_2_LIMITS_UNDER_TEST.maxBytes) {
  const available =
    totalBytes - CATALOG_WRAPPER_BYTES - BASE64_HEAD.length - BASE64_TAIL.length;
  if (available < 0) throw new RangeError('totalBytes zu klein für die Hülle');

  // Auf ein Vielfaches von 4 kürzen: nur das ist eine gültige, ungepolsterte
  // base64-Länge.
  const usableLength = available - (available % 4);
  const unit = BASE64_ALPHABET.repeat(Math.ceil(usableLength / BASE64_ALPHABET.length));
  return wrapCatalog(`${BASE64_HEAD}${unit.slice(0, usableLength)}${BASE64_TAIL}`);
}

/**
 * Arithmetische, dekodierte Größe einer kodierten Länge ohne Polsterung.
 *
 * @param {number} encodedLength Länge des kodierten Textes.
 */
export function decodedBase64BytesForLength(encodedLength) {
  return Math.max(0, Math.floor(encodedLength / 4) * 3);
}

/**
 * Worst Case für das Glob-Matching in `globToRegExp`
 * (`src/domain/profileResolutionSelection.ts`).
 *
 * `*` wird unbesehen zu `.*` und der Ausdruck mit `^`/`$` verankert. Eine Kette
 * aus `*a` erzeugt damit verschachtelte, überlappende `.*`-Quantoren; scheitert
 * das Muster am Ende, muss die Regex-Engine alle Aufteilungen des Eingabetextes
 * auf die Quantoren durchprobieren — der Aufwand wächst exponentiell in der
 * Zahl der Sterne, nicht linear in der Musterlänge. Weder Musterlänge noch
 * Zielstringlänge werden von den drei Klasse-2-Grenzen wirksam beschränkt.
 *
 * Das Muster endet auf `!`, das im Subjekt nicht vorkommt, und erzwingt damit
 * den vollständigen Fehlschlag.
 *
 * @param {number} stars Zahl der `*a`-Glieder.
 * @param {number} subjectLength Länge der Control-ID.
 */
export function buildGlobPatternWorstCase(stars, subjectLength) {
  return {
    pattern: `${'*a'.repeat(stars)}!`,
    subject: 'a'.repeat(subjectLength),
  };
}

/**
 * Weist Stützpunkte zurück, aus denen nicht jedes skalierbare Fixture gebaut
 * werden kann.
 *
 * Der Messlauf führt jeden angenommenen Wert für SÄMTLICHE skalierbaren
 * Fixtures aus. Ein Wert, den nur eines von ihnen trägt, beendet den Lauf
 * deshalb mitten in der Reihe mit einem Konstruktionsfehler, nachdem Vite und
 * Chromium bereits gestartet sind — statt eines Berichts bleibt ein Abbruch
 * (Greptile-Befund zu e786a39). Die Prüfung gehört deshalb vor den
 * Serverstart und hierher zu den Fixtures, deren Konstruktion die Anforderung
 * überhaupt erst stellt.
 *
 * @param {number[]} nodeCounts Gewünschte Stützpunkte.
 */
export function assertScalableNodeCounts(nodeCounts) {
  const scalable = CLASS_2_WORST_CASE_FIXTURES.filter(
    (fixture) => fixture.buildScaled !== undefined,
  );
  for (const count of nodeCounts) {
    for (const fixture of scalable) {
      if (count < fixture.minScaledNodes) {
        throw new RangeError(
          `Stützpunkt ${count} trägt das Fixture ${fixture.id} nicht `
          + `(mindestens ${fixture.minScaledNodes} Knoten)`,
        );
      }
    }
  }
  return nodeCounts;
}

/**
 * Registrierte Fixtures in Messreihenfolge. Jeder Eintrag benennt die Grenze,
 * auf der er exakt liegt, damit das Messprotokoll die Zuordnung nicht raten
 * muss, und ob er die Kette vollständig bis zur Schemastufe durchläuft.
 */
export const CLASS_2_WORST_CASE_FIXTURES = Object.freeze([
  Object.freeze({
    id: 'byte-bound',
    limit: 'maxBytes',
    reachesSchemaStage: true,
    label: String.raw`Bytegrenze 10 MiB, ausschließlich \uXXXX-Escapes`,
    build: () => buildByteBoundDocumentText(),
  }),
  Object.freeze({
    id: 'node-bound',
    limit: 'maxNodes',
    reachesSchemaStage: true,
    label: 'Knotengrenze 1 000 000, maximale Containerzahl',
    build: () => buildNodeBoundDocumentText(),
    // Kleinste Knotenzahl, aus der dieses Fixture überhaupt baubar ist:
    // Hülle, `groups`-Array und eine Minimalgruppe.
    minScaledNodes: 12,
    buildScaled: (totalNodes) => buildNodeBoundDocumentText(totalNodes),
  }),
  Object.freeze({
    id: 'depth-bound',
    limit: 'maxDepth',
    reachesSchemaStage: false,
    label: 'Tiefengrenze 64 und maximale Containerzahl (ohne Schemastufe)',
    build: () => buildDepthBoundDocumentText(),
  }),
  Object.freeze({
    id: 'heap-bound',
    limit: 'maxNodes + maxBytes',
    reachesSchemaStage: false,
    label: 'Eigene verborgene Klasse je Container (ohne Schemastufe)',
    build: () => buildHeapBoundDocumentText(),
    // Die Bytegrenze bleibt beim Skalieren ausgeschöpft: Ein Angreifer gibt
    // sie nicht auf, nur weil die Knotengrenze sinkt — die Schlüssel werden
    // dann eben länger.
    // Kleinste Knotenzahl, aus der dieses Fixture überhaupt baubar ist:
    // Wurzelarray, ein Knotenpaar und der Füllerstring.
    minScaledNodes: 4,
    buildScaled: (totalNodes) => buildHeapBoundDocumentText(totalNodes),
  }),
  Object.freeze({
    id: 'record-bound',
    limit: 'maxBytes',
    reachesSchemaStage: false,
    label: 'Ein Container maximaler Breite (ohne Schemastufe)',
    build: () => buildRecordBoundDocumentText(),
    // Kleinste Knotenzahl, aus der dieses Fixture baubar ist: Wurzelobjekt und
    // ein Mitglied.
    minScaledNodes: 2,
    buildScaled: (totalNodes) => buildRecordBoundDocumentText(totalNodes),
  }),
  Object.freeze({
    id: 'base64-bound',
    limit: 'maxDecodedBase64Bytes',
    reachesSchemaStage: true,
    label: 'Dekodierte Base64-Summe exakt auf der Grenze',
    build: () => buildBase64BoundDocumentText(),
  }),
  Object.freeze({
    id: 'combined-bound',
    limit: 'maxNodes + maxBytes',
    reachesSchemaStage: true,
    label: 'Knoten- und Bytegrenze gleichzeitig ausgeschöpft',
    build: () => buildCombinedBoundDocumentText(),
    // Kleinste Knotenzahl, aus der dieses Fixture überhaupt baubar ist:
    // wie `node-bound`, zusätzlich die Füllergruppe.
    minScaledNodes: 14,
    buildScaled: (totalNodes) => buildCombinedBoundDocumentText(totalNodes),
  }),
]);
