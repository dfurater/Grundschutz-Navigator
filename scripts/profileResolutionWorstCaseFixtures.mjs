/**
 * Worst-Case-Eingaben für die Arbeitsgrenze der Profile Resolution
 * (GSPP-345) — je Work-Unit-Kategorie eine eigene Reihe.
 *
 * Wartungswerkzeug, hängt an keinem Anwendungspfad. Wie
 * `class2WorstCaseFixtures.mjs` wird die Datei sowohl im Node-Prozess (zur
 * Kennzahlberechnung) als auch im Browser-Tab (zur Messung) geladen und
 * benutzt deshalb ausschließlich Sprachmittel, die in beiden Laufzeiten
 * existieren — kein `node:`-Import, kein DOM.
 *
 * LEITGEDANKE, derselbe wie bei den Ressourcengrenzen: Gemessen wird NICHT
 * der BSI-Korpus. Der ist kein Angriffsfall. Jedes Dokument hier maximiert die
 * Arbeit, die ein Angreifer dem Resolver pro zugelassener Ressourceneinheit
 * aufbürden kann, und hält die AUSGABE dabei klein — genau die Lücke, die eine
 * reine Ausgabegrenze offenließe.
 *
 * WARUM SECHS REIHEN. Die erste Fassung fuhr nur `selector-worst`. Eine
 * Arbeitseinheit kostet aber je nach Kategorie unterschiedlich viel Zeit, und
 * alle Kategorien verbrauchen DENSELBEN Zähler: Eine Grenze, die auf der Rate
 * des Selektorpfads steht, trägt für eine langsamere Kategorie nicht. Jede
 * Kategorie des geschlossenen Satzes bekommt deshalb ein eigenes,
 * ausgabekleines Profil, und der Grenzwert wird fail-closed über alle Reihen
 * abgeleitet — die langsamste Reihe entscheidet.
 */

import { CLASS_2_IMPORT_LIMITS } from '../src/domain/class2ImportLimits.mjs';

const VERSION = '1.1.3';
const TOP_UUID = '11111111-1111-5111-8111-111111111111';
const TOP_KEY = 'profile-top';
const SOURCE_KEY = 'catalog-src';
const SOURCE_HREF = './src.json';

/** Zahl der Controls im Quellkatalog. Klein genug für ein Dokument weit unter der Bytegrenze. */
const SOURCE_CONTROL_COUNT = 2000;

/** Länge der Control-IDs der Glob-Reihe; die Glob-Kosten hängen an ihr. */
const GLOB_SUBJECT_LENGTH = 120;

/** Sterne des Glob-Musters — dieselbe Musterform wie die Mikroreihe aus GSPP-382. */
const GLOB_STAR_COUNT = 6;

/** Zahl der `parts` der einen Control, gegen die die Alter-Kandidaten laufen. */
const ALTER_PART_COUNT = 2000;

/** Zahl der Controls, die die Alter-Zielsuche je Lauf abfragt. */
const ALTER_TARGET_CONTROL_COUNT = 2000;

function flatControls(count, idPrefix = 'ac') {
  const controls = [];
  for (let index = 0; index < count; index += 1) {
    controls.push({ id: `${idPrefix}-${index}`, title: `Control ${index}` });
  }
  return controls;
}

function catalogOf(body) {
  return { catalog: { metadata: { 'oscal-version': VERSION }, ...body } };
}

function profileOf(body) {
  return {
    profile: {
      uuid: TOP_UUID,
      metadata: { title: 'Arbeitsgrenze', version: '1.0.0', 'oscal-version': VERSION },
      ...body,
    },
  };
}

function world(id, label, sourceDocument, profileDocument) {
  return {
    id,
    label,
    documents: { [SOURCE_KEY]: sourceDocument, [TOP_KEY]: profileDocument },
    edges: { [TOP_KEY]: [{ href: SOURCE_HREF, artifactKey: SOURCE_KEY }] },
    topProfileArtifactKey: TOP_KEY,
  };
}

/** Eine ID, die in keinem der Quellkataloge vorkommt. */
const ABSENT_ID = 'zzz-kein-treffer';

/**
 * `import-edge`: Jeder Import indiziert sein Quelldokument erneut — der Index
 * wird bewusst nicht über Importe hinweg zwischengespeichert. Viele Importe
 * DESSELBEN Katalogs kaufen deshalb je Import einen vollen Katalogdurchlauf,
 * während die Selektion nichts trifft und die Ausgabe leer bleibt.
 */
function buildImportEdgeWorstCase(repetitions) {
  const imports = [];
  for (let index = 0; index < repetitions; index += 1) {
    imports.push({
      href: SOURCE_HREF,
      'include-controls': [{ 'with-ids': [ABSENT_ID] }],
    });
  }
  return world(
    'import-edge',
    `${repetitions} Importe über ${SOURCE_CONTROL_COUNT} Control-IDs, Auswahl leer`,
    catalogOf({ controls: flatControls(SOURCE_CONTROL_COUNT) }),
    // `flat` statt as-is: Ohne Merge-Direktive liefe zusätzlich der
    // as-is-Durchlauf je Record und verschöbe die Reihe nach `merge-step`.
    profileOf({ imports, merge: { flat: {} } }),
  );
}

/**
 * `selector-compare`: Ein Ausschlussselektor mit `with-child-controls: yes`
 * trifft eine einzige ID und expandiert von dort über den gesamten
 * Nachfahrenbaum — zwei Vergleiche je Kind (Expansion und Entfernen) für rund
 * fünfzig Byte Dokument. Die Ausgabe bleibt leer, weil der Selektor die
 * Wurzel samt allen Kindern wieder herausnimmt.
 */
function buildSelectorCompareWorstCase(repetitions) {
  const excludeControls = [];
  for (let index = 0; index < repetitions; index += 1) {
    excludeControls.push({ 'with-ids': ['sel-root'], 'with-child-controls': 'yes' });
  }
  return world(
    'selector-compare',
    `${repetitions} Ausschlussselektoren über ${SOURCE_CONTROL_COUNT} Nachfahren`,
    catalogOf({
      controls: [
        {
          id: 'sel-root',
          title: 'Wurzel',
          controls: flatControls(SOURCE_CONTROL_COUNT),
        },
      ],
    }),
    profileOf({
      imports: [{ href: SOURCE_HREF, 'include-all': {}, 'exclude-controls': excludeControls }],
      merge: { flat: {} },
    }),
  );
}

/** Muster der Form `(*a)ⁿ!` — die Form, an der GSPP-382 das Backtracking maß. */
function globPattern(stars) {
  return `${'*a'.repeat(stars)}!`;
}

/** Control-IDs der Glob-Reihe: lang, ohne `!`, damit kein Muster je trifft. */
function globControls(count) {
  const controls = [];
  for (let index = 0; index < count; index += 1) {
    const id = `g${String(index).padStart(6, '0')}`.padEnd(GLOB_SUBJECT_LENGTH, 'a');
    controls.push({ id, title: 'G' });
  }
  return controls;
}

/**
 * `glob-state`: Jeder Ausschlussselektor fährt sein Muster gegen JEDE
 * Control-ID. Muster und Subjekt sind so gewählt, dass der Abgleich nie
 * trifft und deshalb die volle Zustandszahl durchläuft. Die Ausgabe ist die
 * unveränderte Auswahl — klein gegenüber der Arbeit, weil die Zahl der
 * Selektoren wächst und die der Controls nicht.
 */
function buildGlobStateWorstCase(repetitions) {
  const excludeControls = [];
  for (let index = 0; index < repetitions; index += 1) {
    excludeControls.push({ matching: [{ pattern: globPattern(GLOB_STAR_COUNT) }] });
  }
  return world(
    'glob-state',
    `${repetitions} Glob-Selektoren über ${SOURCE_CONTROL_COUNT} IDs à ${GLOB_SUBJECT_LENGTH} Zeichen`,
    catalogOf({ controls: globControls(SOURCE_CONTROL_COUNT) }),
    profileOf({
      imports: [{ href: SOURCE_HREF, 'include-all': {}, 'exclude-controls': excludeControls }],
      merge: { flat: {} },
    }),
  );
}

/**
 * `merge-step`: Ohne Merge-Direktive gilt as-is, und der as-is-Zweig filtert
 * je Record die VOLLSTÄNDIGE Quellhierarchie gegen die Auswahl — auch wenn
 * die Auswahl leer ist. Viele Importe kaufen damit je Import einen vollen
 * Hierarchiedurchlauf in der Merge-Phase bei leerer Ausgabe.
 */
function buildMergeStepWorstCase(repetitions) {
  const imports = [];
  for (let index = 0; index < repetitions; index += 1) {
    imports.push({
      href: SOURCE_HREF,
      'include-controls': [{ 'with-ids': [ABSENT_ID] }],
    });
  }
  return world(
    'merge-step',
    `${repetitions} as-is-Importe über ${SOURCE_CONTROL_COUNT} Controls in Gruppen`,
    catalogOf({
      groups: [
        { id: 'grp-1', title: 'G1', controls: flatControls(SOURCE_CONTROL_COUNT / 2, 'ma') },
        { id: 'grp-2', title: 'G2', controls: flatControls(SOURCE_CONTROL_COUNT / 2, 'mb') },
      ],
    }),
    profileOf({ imports }),
  );
}

/**
 * `alter-target-lookup`: Die Zielsuche fällt je betrachteter Control einmal an
 * und je auf sie zeigender Alteration ein weiteres Mal. Beides ist nach oben
 * gedeckelt — die Zahl der Controls durch die Knotengrenze, die Zahl der
 * Alterationen durch die Dokumentgröße —, deshalb kann diese Kategorie den
 * Zähler NICHT allein bis zur Arbeitsgrenze treiben. Die Reihe misst ihre
 * Rate, nicht ihre Reichweite; der Deckel steht im Messprotokoll.
 */
function buildAlterTargetLookupWorstCase(repetitions) {
  const alters = [];
  for (let index = 0; index < repetitions; index += 1) {
    alters.push({ 'control-id': 'ac-0' });
  }
  return world(
    'alter-target-lookup',
    `${repetitions} Alterationen auf einer Control, ${ALTER_TARGET_CONTROL_COUNT} Zielsuchen`,
    catalogOf({ controls: flatControls(ALTER_TARGET_CONTROL_COUNT) }),
    profileOf({
      imports: [{ href: SOURCE_HREF, 'include-all': {} }],
      merge: { flat: {} },
      modify: { alters },
    }),
  );
}

/**
 * `alter-candidate`: Jede Alteration prüft jeden `parts`-Eintrag der Control
 * gegen ihre `removes`-Anweisung. Die Anweisung trifft nie, die Liste bleibt
 * also vollständig — die Ausgabe ist in jedem Stützpunkt dieselbe eine
 * Control, allein die Zahl der Alterationen wächst.
 */
function buildAlterCandidateWorstCase(repetitions) {
  const alters = [];
  for (let index = 0; index < repetitions; index += 1) {
    alters.push({ 'control-id': 'ac-0', removes: [{ 'by-id': ABSENT_ID }] });
  }
  const parts = [];
  for (let index = 0; index < ALTER_PART_COUNT; index += 1) {
    parts.push({ id: `p-${index}`, name: 'note' });
  }
  return world(
    'alter-candidate',
    `${repetitions} Alterationen über ${ALTER_PART_COUNT} parts-Kandidaten`,
    catalogOf({ controls: [{ id: 'ac-0', title: 'A', parts }] }),
    profileOf({
      imports: [{ href: SOURCE_HREF, 'include-all': {} }],
      merge: { flat: {} },
      modify: { alters },
    }),
  );
}

/**
 * GEMESSENE Kennzahlen je Wiederholung — Import, Selektor beziehungsweise
 * Alteration. Alle Werte stammen aus dem Kalibrierlauf des Messapparats
 * (`node scripts/measure-class2-budget.mjs --calibrate`, 2026-09-12) und
 * nicht aus einer Überschlagsrechnung: Die erste Fassung dieser Datei
 * schätzte die Selektorrate und baute damit Dokumente, die ihren Stützpunkt
 * um dreißig Prozent verfehlten — die Leiterbeschriftung log über die
 * tatsächlich gemessene Arbeit.
 *
 * `units`/`baseUnits` beschreiben die Arbeit als Gerade über der
 * Wiederholungszahl, `bytes`/`baseBytes` die Größe des Steuerdokuments,
 * `nodes` seine Knoten je Wiederholung (aus der festen Form der Einträge
 * abgezählt). `share` ist der im Kalibrierlauf gemessene Anteil der
 * benannten Kategorie an der Gesamtarbeit des Laufs — er belegt, dass die
 * Reihe die Kategorie wirklich treibt, die sie behauptet. Der Anteil hängt an
 * der Wiederholungszahl: Die Grundlast fällt je Lauf einmal an und verdünnt
 * sich, je weiter die Reihe getrieben wird. Die Werte hier stehen am HÖHEREN
 * der beiden Kalibrierpunkte einer Kategorie — 300 Wiederholungen, für
 * `glob-state` 15, weil dort schon hundert Selektoren die Grenze rissen
 * (`CALIBRATION_REPETITIONS` in `measure-class2-budget.mjs`).
 * `docs/OSCAL_VALIDATION.md` weist die Anteile dagegen am größten gehaltenen
 * Stützpunkt aus, wo sie deshalb höher liegen.
 *
 * Eine Abweichung der Rate ist unkritisch: Der Bericht weist für jeden
 * Stützpunkt die WIRKLICH verbrauchten Einheiten aus, und der Grenzwert steht
 * auf dieser Zahl, nicht auf dem Ziel.
 */
const CALIBRATION = Object.freeze({
  'import-edge': { units: 6006, baseUnits: 20, bytes: 77, baseBytes: 170, nodes: 6, share: 0.667 },
  'selector-compare': { units: 6002, baseUnits: 8029, bytes: 54, baseBytes: 230, nodes: 4, share: 0.998 },
  'glob-state': { units: 466000, baseUnits: 34025, bytes: 43, baseBytes: 230, nodes: 4, share: 0.995 },
  'merge-step': { units: 20028, baseUnits: 20, bytes: 77, baseBytes: 150, nodes: 6, share: 0.700 },
  'alter-target-lookup': { units: 13, baseUnits: 36025, bytes: 22, baseBytes: 231, nodes: 2, share: 0.058 },
  'alter-candidate': { units: 4029, baseUnits: 14047, bytes: 63, baseBytes: 231, nodes: 5, share: 0.986 },
});

/**
 * Grenzen, durch die das STEUERDOKUMENT selbst passen muss. Sie sind der
 * Grund, warum nicht jede Kategorie beliebig weit getrieben werden kann: Ein
 * Angreifer schickt sein Profil durch dieselbe Klasse-2-Eingangsprüfung wie
 * jede andere Eingabe — also gelten hier dieselben Zahlen und nicht eine
 * zweite Fassung davon. Der relative Import auf das reine `.mjs`-Modul ist
 * derselbe Weg, den `class2WorstCaseFixtures.mjs` geht: Er trägt in Node und
 * im Browser-Tab, ohne Aliasauflösung.
 */
const DOCUMENT_LIMITS = CLASS_2_IMPORT_LIMITS;

/** Grundknoten eines Steuerdokuments ohne Wiederholungen, großzügig geschätzt. */
const BASE_NODES = 40;

/**
 * Größte Wiederholungszahl, die noch durch Byte- UND Knotengrenze passt.
 *
 * @param {string} category Eine der `WORK_UNIT_CATEGORIES`.
 */
export function maxRepetitions(category) {
  const calibration = CALIBRATION[category];
  return Math.max(1, Math.min(
    Math.floor((DOCUMENT_LIMITS.maxBytes - calibration.baseBytes) / calibration.bytes),
    Math.floor((DOCUMENT_LIMITS.maxNodes - BASE_NODES) / calibration.nodes),
  ));
}

/**
 * Arbeitseinheiten, die die Kategorie bei maximal zulässigem Steuerdokument
 * überhaupt erreichen kann. Liegt dieser Deckel unter dem Grenzwertkandidaten,
 * kann die Kategorie den Zähler nicht bis zur Grenze treiben — sie ist dann
 * durch die Dokumentgrenzen gedeckelt und nicht durch die Arbeitsgrenze.
 *
 * @param {string} category Eine der `WORK_UNIT_CATEGORIES`.
 */
export function reachableWorkUnits(category) {
  const calibration = CALIBRATION[category];
  return calibration.baseUnits + maxRepetitions(category) * calibration.units;
}

/** Der im Kalibrierlauf gemessene Anteil der Kategorie an der Gesamtarbeit. */
export function measuredCategoryShare(category) {
  return CALIBRATION[category].share;
}

const BUILDERS = Object.freeze({
  'import-edge': buildImportEdgeWorstCase,
  'selector-compare': buildSelectorCompareWorstCase,
  'glob-state': buildGlobStateWorstCase,
  'merge-step': buildMergeStepWorstCase,
  'alter-target-lookup': buildAlterTargetLookupWorstCase,
  'alter-candidate': buildAlterCandidateWorstCase,
});

/**
 * Reihenfolge der Reihen im Bericht. Identisch mit dem geschlossenen Satz aus
 * `PROFILE_RESOLUTION_WORK_UNITS`; eine Kategorie ohne Reihe wäre eine
 * Kategorie ohne Kostenbeleg.
 */
export const WORK_UNIT_CATEGORIES = Object.freeze([
  'import-edge',
  'selector-compare',
  'glob-state',
  'merge-step',
  'alter-target-lookup',
  'alter-candidate',
]);

/**
 * Baut den Auflösungsfall EINER Kategorie, dessen Arbeit den Zielwert
 * annähert. Der gebaute Wert liegt bewusst UNTER dem Ziel: Ein Fall, der die
 * Grenze reißt, liefert keine Laufzeit, sondern einen Abbruch — und ein
 * Stützpunkt ohne Laufzeit trägt keinen Grenzwert.
 *
 * @param {string} category Eine der `WORK_UNIT_CATEGORIES`.
 * @param {number} targetWorkUnits Angestrebte Arbeitseinheiten.
 */
export function buildWorkUnitWorstCase(category, targetWorkUnits) {
  const builder = BUILDERS[category];
  if (builder === undefined) throw new RangeError(`Unbekannte Work-Unit-Kategorie: ${category}`);
  const calibration = CALIBRATION[category];
  const wanted = Math.max(1, Math.floor((targetWorkUnits - calibration.baseUnits) / calibration.units));
  const cap = maxRepetitions(category);
  if (wanted > cap) {
    // Fail-closed statt stillschweigend kleiner bauen: Ein Stützpunkt, den
    // das Dokument nicht trägt, ist kein gehaltener Stützpunkt. Er als
    // solcher gemeldet zu werden, ist die ganze Aussage.
    return {
      id: category,
      capped: true,
      targetWorkUnits,
      repetitions: cap,
      reachableWorkUnits: reachableWorkUnits(category),
    };
  }
  return { ...builder(wanted), capped: false, targetWorkUnits, repetitions: wanted };
}

/**
 * Baut einen Fall mit EXPLIZITER Wiederholungszahl — der Kalibrierpfad, der
 * `UNITS_PER_REPETITION` und `BASE_UNITS` überhaupt erst erhebt. Zwei
 * Wiederholungszahlen liefern Rate und Grundlast als Geradengleichung.
 *
 * @param {string} category Eine der `WORK_UNIT_CATEGORIES`.
 * @param {number} repetitions Zahl der Importe, Selektoren oder Alterationen.
 */
export function buildWorkUnitCalibration(category, repetitions) {
  const builder = BUILDERS[category];
  if (builder === undefined) throw new RangeError(`Unbekannte Work-Unit-Kategorie: ${category}`);
  const fixture = builder(repetitions);
  return { ...fixture, targetWorkUnits: null, repetitions };
}

/**
 * Stützpunkte für die Herleitung: Bruchteile der Kandidatengrenze bis zu ihr
 * selbst. Über die Grenze hinaus lässt sich nicht messen — der Resolver bricht
 * dort ab, und das ist der Zweck der Grenze. Eine Anhebung braucht deshalb
 * einen Menschen, der den Kandidaten erhöht und neu misst; die Messung kann
 * einen Wert nur BESTÄTIGEN oder nach unten korrigieren.
 *
 * @param {number} candidateLimit Der aktuell einkompilierte `WORK_UNIT_LIMIT`.
 */
export function workUnitSupportPoints(candidateLimit) {
  return [32, 16, 8, 4, 2, 1]
    .map((divisor) => Math.floor(candidateLimit / divisor))
    .filter((value, index, all) => value > 0 && all.indexOf(value) === index)
    .sort((left, right) => left - right);
}
