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
// liegt exakt auf genau einer Grenze aus `CLASS_2_IMPORT_LIMITS` und maximiert
// dabei die Arbeit, die ein Angreifer der Prüfkette pro Grenzeinheit aufbürden
// kann. Die Dokumente sind deterministisch: gleicher Aufruf, gleiche Bytes.
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

/**
 * Byte-Grenze (10 MiB), maximale Stufe-1-Arbeit pro Byte.
 *
 * Der teuerste Byteverbrauch der Bytepolitik ist die `\uXXXX`-Escapesequenz:
 * sechs Quellbytes lösen im `DuplicateMemberScanner` einen Slice, einen
 * Regex-Test und eine `String.fromCodePoint`-Konkatenation aus, und
 * `JSON.parse` dekodiert sie anschließend ein zweites Mal. Ein Dokument aus
 * nichts als Escapes bürdet der Bytepolitik damit die höchstmögliche Arbeit
 * pro zugelassenem Byte auf.
 *
 * @param {number} totalBytes Zielgröße des Dokuments in Bytes.
 */
export function buildByteBoundDocumentText(totalBytes = CLASS_2_LIMITS_UNDER_TEST.maxBytes) {
  const prefix = '{"a":"';
  const suffix = '"}';
  const payloadBytes = totalBytes - prefix.length - suffix.length;
  if (payloadBytes < 0) throw new RangeError('totalBytes zu klein für die Hülle');

  const escapeCount = Math.floor(payloadBytes / 6);
  const filler = payloadBytes - escapeCount * 6;
  return `${prefix}${'\\u0041'.repeat(escapeCount)}${'A'.repeat(filler)}${suffix}`;
}

/**
 * Knotengrenze (1 000 000), maximale Containerzahl.
 *
 * Die Knotensemantik der Prüfkette zählt jeden Container und jedes primitive
 * Mitglied als einen Knoten. Der Heap-Treiber ist dabei nicht die Knotenzahl
 * als solche, sondern die Containerzahl: `enforceClass2ObjectGraphInvariants`
 * hält jeden besuchten Container in einer `Set`-Identitätsmenge, und
 * `parseClass2OscalInput` trägt zusätzlich jeden Container in ein `WeakSet`
 * ein. Das leere Objekt ist der billigste Container, den JSON erzeugen kann
 * (zwei Bytes), und maximiert deshalb bei ausgeschöpfter Knotengrenze die
 * Zahl gleichzeitig gehaltener Identitäten.
 *
 * @param {number} totalNodes Zielzahl der Knoten in der Knotensemantik der Prüfkette.
 */
export function buildNodeBoundDocumentText(totalNodes = CLASS_2_LIMITS_UNDER_TEST.maxNodes) {
  // Wurzelarray ist Knoten 1; jedes Element ist ein weiterer Knoten.
  const elements = totalNodes - 1;
  if (elements < 0) throw new RangeError('totalNodes zu klein für das Wurzelarray');
  return `[${Array.from({ length: elements }, () => '{}').join(',')}]`;
}

/**
 * Tiefengrenze (64) bei gleichzeitig ausgeschöpfter Knotengrenze.
 *
 * Tiefe allein ist billig — eine Kette aus 64 Arrays kostet nichts. Der
 * belastbare Worst Case ist die Kombination: Die Rekursion läuft auf voller
 * Tiefe UND trägt die volle Knotenlast, sodass jeder der teuersten Knoten am
 * tiefsten Punkt des Stapels anfällt.
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
 * Alle drei durchgesetzten Grenzen gleichzeitig: Tiefe 64, 1 000 000 Knoten
 * UND 10 MiB.
 *
 * Die Einzelgrenzen schließen einander nicht aus, und genau ihre Kombination
 * ist der Fall, den ein Ressourcenbudget tragen muss: Die Containerkette
 * treibt den Identitätsspeicher der Strukturinvariante auf sein Maximum,
 * während der verbleibende Byteraum als ein einziger langer String an der
 * tiefsten Stelle liegt und den Heap zusätzlich um seinen vollen Inhalt
 * belastet, ohne nennenswert Knoten zu verbrauchen. Ein Dokument, das nur je
 * eine Grenze trifft, unterschätzt den Abdruck.
 *
 * @param {number} depth Zieltiefe.
 * @param {number} totalNodes Zielzahl der Knoten.
 * @param {number} totalBytes Zielgröße in Bytes.
 */
export function buildCombinedBoundDocumentText(
  depth = CLASS_2_LIMITS_UNDER_TEST.maxDepth,
  totalNodes = CLASS_2_LIMITS_UNDER_TEST.maxNodes,
  totalBytes = CLASS_2_LIMITS_UNDER_TEST.maxBytes,
) {
  const chainLength = depth - 1;
  const wrappers = chainLength - 1;
  // Knoten: Kettenarrays + leere Objekte + der eine String.
  const emptyObjects = totalNodes - chainLength - 1;
  if (emptyObjects < 1) throw new RangeError('totalNodes trägt Kette und String nicht');

  // Bytes: Wrapperklammern + Nutzlastarray (Klammern, Container, Trenner)
  // + Stringhülle. Der String füllt den Rest exakt aus.
  const structureBytes = wrappers * 2 + 2 + emptyObjects * 3 + 2;
  const stringLength = totalBytes - structureBytes;
  if (stringLength < 0) throw new RangeError('totalBytes trägt die Struktur nicht');

  const members = `${Array.from({ length: emptyObjects }, () => '{}').join(',')},"${'A'.repeat(stringLength)}"`;
  return `${'['.repeat(wrappers)}[${members}]${']'.repeat(wrappers)}`;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_PREFIX = '{"back-matter":{"resources":[{"base64":{"value":"';
const BASE64_SUFFIX = '"}}]}}';

function wrapBase64(encoded) {
  return `${BASE64_PREFIX}${encoded}${BASE64_SUFFIX}`;
}

/**
 * Base64-Grenze: die dekodierte Summe liegt exakt auf
 * `maxDecodedBase64Bytes`.
 *
 * `accountEmbeddedBase64` rechnet `floor(len/4) * 3 - padding`. Die
 * zweizeichige Polsterung trifft damit jede dekodierte Größe punktgenau, auch
 * wenn sie nicht durch drei teilbar ist.
 *
 * @param {number} decodedBytes Ziel der dekodierten Summe in Bytes.
 */
export function buildBase64BoundDocumentText(
  decodedBytes = CLASS_2_LIMITS_UNDER_TEST.maxDecodedBase64Bytes,
) {
  const fullGroups = Math.floor((decodedBytes - 1) / 3);
  const remainder = decodedBytes - fullGroups * 3;
  // Rest 1 braucht `==`, Rest 2 braucht `=`, Rest 3 eine volle Gruppe.
  const tail = remainder === 1 ? 'AA==' : remainder === 2 ? 'AAA=' : 'AAAA';
  const unit = BASE64_ALPHABET.repeat(Math.ceil((fullGroups * 4) / BASE64_ALPHABET.length) || 1);
  return wrapBase64(`${unit.slice(0, fullGroups * 4)}${tail}`);
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
  const available = totalBytes - BASE64_PREFIX.length - BASE64_SUFFIX.length;
  if (available < 0) throw new RangeError('totalBytes zu klein für die Hülle');

  // Auf ein Vielfaches von 4 kürzen: nur das ist eine gültige, ungepolsterte
  // base64-Länge.
  const usableLength = available - (available % 4);
  const unit = BASE64_ALPHABET.repeat(Math.ceil(usableLength / BASE64_ALPHABET.length));
  return wrapBase64(unit.slice(0, usableLength));
}

/** Arithmetische, dekodierte Größe einer kodierten Länge ohne Polsterung. */
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
 * `stars` ist die Zahl der `*a`-Glieder, `subjectLength` die Länge der
 * Control-ID, gegen die geprüft wird. Das Muster endet auf `!`, das im Subjekt
 * nicht vorkommt, und erzwingt damit den vollständigen Fehlschlag.
 */
export function buildGlobPatternWorstCase(stars, subjectLength) {
  return {
    pattern: `${'*a'.repeat(stars)}!`,
    subject: 'a'.repeat(subjectLength),
  };
}

/** Vollständiges Klasse-2-Profildokument mit dem Glob-Worst-Case als `matching.pattern`. */
export function buildGlobPatternDocumentText(stars, subjectLength) {
  const { pattern } = buildGlobPatternWorstCase(stars, subjectLength);
  return JSON.stringify({
    profile: {
      uuid: '11111111-1111-4111-8111-111111111111',
      metadata: {
        title: 'GSPP-382 Glob-Worst-Case',
        'last-modified': '2026-09-04T00:00:00Z',
        version: '1',
        'oscal-version': '1.1.3',
      },
      imports: [{ href: '#catalog', 'include-controls': [{ matching: [{ pattern }] }] }],
    },
  });
}

/**
 * Registrierte Fixtures in Messreihenfolge. Jeder Eintrag benennt die Grenze,
 * auf der er exakt liegt, damit das Messprotokoll die Zuordnung nicht raten
 * muss.
 */
export const CLASS_2_WORST_CASE_FIXTURES = Object.freeze([
  Object.freeze({
    id: 'byte-bound',
    limit: 'maxBytes',
    label: 'Bytegrenze 10 MiB, ausschließlich \\uXXXX-Escapes',
    build: () => buildByteBoundDocumentText(),
  }),
  Object.freeze({
    id: 'node-bound',
    limit: 'maxNodes',
    label: 'Knotengrenze 1 000 000, maximale Containerzahl',
    build: () => buildNodeBoundDocumentText(),
  }),
  Object.freeze({
    id: 'depth-bound',
    limit: 'maxDepth',
    label: 'Tiefengrenze 64 bei ausgeschöpfter Knotengrenze',
    build: () => buildDepthBoundDocumentText(),
  }),
  Object.freeze({
    id: 'base64-bound',
    limit: 'maxDecodedBase64Bytes',
    label: 'Dekodierte Base64-Summe exakt auf der Grenze',
    build: () => buildBase64BoundDocumentText(),
  }),
  Object.freeze({
    id: 'combined-bound',
    limit: 'maxDepth + maxNodes + maxBytes',
    label: 'Alle drei durchgesetzten Grenzen gleichzeitig ausgeschöpft',
    build: () => buildCombinedBoundDocumentText(),
  }),
]);
