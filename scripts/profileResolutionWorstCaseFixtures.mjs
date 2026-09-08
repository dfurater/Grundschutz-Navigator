/**
 * Worst-Case-Eingaben für die Arbeitsgrenze der Profile Resolution
 * (GSPP-345).
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
 */

const VERSION = '1.1.3';
const TOP_UUID = '11111111-1111-5111-8111-111111111111';
const TOP_KEY = 'profile-top';
const SOURCE_KEY = 'catalog-src';
const SOURCE_HREF = './src.json';

/**
 * GEMESSENE Arbeitseinheiten, die ein Ausschlussselektor je Control-ID kostet.
 *
 * Erhoben am 2026-09-08 aus einem Lauf dieses Fixtures: 7 871 Selektoren über
 * 2 000 Control-IDs verbrauchten 132 963 218 Arbeitseinheiten, also
 * 132 963 218 / (7 871 × 2 000) = 8,4463 je Paar. Enthalten sind der
 * Selektorvergleich, der Zustandsbesuch des Glob-Abgleichs und die Buchung des
 * Arraylesers.
 *
 * Die erste Fassung schätzte 12 und baute damit Dokumente, die ihren
 * Stützpunkt um dreißig Prozent verfehlten — die Leiterbeschriftung log über
 * die tatsächlich gemessene Arbeit. Der Wert gehört gemessen, nicht geraten.
 */
const UNITS_PER_SELECTOR_AND_CONTROL = 8.4463;

/** Zahl der Controls im Quellkatalog. Klein genug für ein Dokument weit unter der Bytegrenze. */
const SOURCE_CONTROL_COUNT = 2000;

function sourceCatalog(controlCount) {
  const controls = [];
  for (let index = 0; index < controlCount; index += 1) {
    controls.push({ id: `ac-${index}`, title: `Control ${index}` });
  }
  return { catalog: { metadata: { 'oscal-version': VERSION }, controls } };
}

/**
 * Baut einen Auflösungsfall, dessen ARBEIT den Zielwert annähert, während die
 * Ausgabe leer bleibt: `include-all` zieht jede Control herein, die
 * Ausschlussselektoren nehmen sie alle wieder heraus.
 *
 * Der gebaute Wert liegt bewusst UNTER dem Ziel. Ein Fall, der die Grenze
 * reißt, liefert keine Laufzeit, sondern einen Abbruch — und ein Stützpunkt
 * ohne Laufzeit trägt keinen Grenzwert.
 *
 * @param {number} targetWorkUnits Angestrebte Arbeitseinheiten.
 */
export function buildWorkUnitWorstCase(targetWorkUnits) {
  const perSelector = SOURCE_CONTROL_COUNT * UNITS_PER_SELECTOR_AND_CONTROL;
  const selectorCount = Math.max(1, Math.floor(targetWorkUnits / perSelector));
  const excludeControls = [];
  for (let index = 0; index < selectorCount; index += 1) {
    excludeControls.push({ matching: [{ pattern: 'ac-*' }] });
  }

  return {
    id: 'selector-worst',
    label: `${selectorCount} Ausschlussselektoren über ${SOURCE_CONTROL_COUNT} Control-IDs`,
    targetWorkUnits,
    documents: {
      [SOURCE_KEY]: sourceCatalog(SOURCE_CONTROL_COUNT),
      [TOP_KEY]: {
        profile: {
          uuid: TOP_UUID,
          metadata: { title: 'Arbeitsgrenze', version: '1.0.0', 'oscal-version': VERSION },
          imports: [{ href: SOURCE_HREF, 'include-all': {}, 'exclude-controls': excludeControls }],
        },
      },
    },
    edges: { [TOP_KEY]: [{ href: SOURCE_HREF, artifactKey: SOURCE_KEY }] },
    topProfileArtifactKey: TOP_KEY,
  };
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
