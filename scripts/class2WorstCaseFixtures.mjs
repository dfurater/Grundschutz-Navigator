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
// Schema 1.1.3 und durchlaufen die Kette vollständig. Einzige Ausnahme ist
// `depth-bound`, mit Begründung an Ort und Stelle.
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
 * Es ist zugleich der Speicher-Worst-Case des gesamten Satzes: Das leere
 * Objekt ist der billigste Container, den JSON erzeugen kann, weshalb dieses
 * Dokument bei ausgeschöpfter Knotengrenze die höchste Containerzahl trägt —
 * und damit die größte Identitätsmenge in der Strukturinvariante. Ein
 * schemagültiger Katalog kommt dort nicht hin, weil seine billigste Gruppe
 * neben dem Container noch einen Titelstring braucht und deshalb nur halb so
 * viele Container in dieselbe Knotenzahl passen. Ein Angreifer ist an die
 * Schemagültigkeit aber nicht gebunden: Die Ablehnung im Dispatch erfolgt
 * ERST, nachdem dieser Speicher bereits belegt wurde.
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
  }),
  Object.freeze({
    id: 'depth-bound',
    limit: 'maxDepth',
    reachesSchemaStage: false,
    label: 'Tiefengrenze 64 und maximale Containerzahl (ohne Schemastufe)',
    build: () => buildDepthBoundDocumentText(),
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
  }),
]);
