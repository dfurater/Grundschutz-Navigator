// =============================================================================
// Seitenseitiger Messharnisch der Klasse-2-Kostenmessung (GSPP-382).
//
// Wartungswerkzeug, kein Anwendungspfad: Die Datei wird ausschließlich von
// `scripts/measure-class2-budget.mjs` über einen eigenen, temporären
// Vite-Dev-Server geladen und ist an keinem Einstieg der App verlinkt.
//
// Der Harnisch ruft die PRODUKTIVEN Einheiten der Prüfkette auf — keine
// nachgebaute Kopie, auch nicht für die Glob-Übersetzung. Er ist in Schritte
// zerlegt, weil die Heap-Messung zwischen den Schritten über CDP aus dem
// Node-Prozess erfolgt und das Zwischenergebnis dafür referenziert bleiben
// muss.
//
// WARUM DIE SPITZE GEHALTEN UND NICHT ABGETASTET WIRD
//
// Eine Momentaufnahme des Heaps mitten in der Prüfkette gibt es nicht: Jede
// CDP-Antwort — `Runtime.getHeapUsage` eingeschlossen — wird vom Inspektor des
// betroffenen Isolats bedient und liegt in dessen Warteschlange, solange dort
// synchroner JavaScript-Code läuft. Die Kette ist von ihrem Eintritt bis zu
// ihrer Rückkehr genau das. Aus derselben Warteschlange heraus lässt sich der
// Verlauf des Speichers während des Laufs nicht abtasten, und für das
// Worker-Isolat gilt dasselbe.
//
// Der Harnisch baut deshalb den gleichzeitig lebenden Bestand JEDER der beiden
// Stufen nacheinander auf, hält ihn fest und lässt messen. Jeder Posten ist
// dabei keine nachgebildete Schätzung, sondern dieselbe Datenstruktur, die die
// produktive Kette anlegt, über denselben Graphen. Was die beiden Bestände
// decken, steht bei `holdStage1Peak` und `holdChainPeak` an Ort und Stelle.
//
// Gemessen wird mit `performance.measureUserAgentSpecificMemory()`, nicht mit
// CDP `Runtime.getHeapUsage`: Letzteres deckt allein den V8-JS-Heap und ließ
// Puffer-Backing-Stores und externe Blink-Strings — zusammen zweistellige
// MiB-Beträge — vollständig aus. `assertMemoryObservability` belegt vor jeder
// Messreihe, dass der gewählte Weg sie sieht.
// =============================================================================

import { parseClass2OscalInput } from '@/domain/oscalImportProcessing';
import { processClass2OscalValue } from '@/domain/oscalObjectPipeline';
import { globToRegExp } from '@/domain/profileResolutionSelection';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { walkOwnContainers } from '@/domain/oscalObjectWalk';
import {
  CLASS_2_WORST_CASE_FIXTURES,
  buildGlobPatternWorstCase,
  buildNodeBoundDocumentText,
  toBytes,
} from '../class2WorstCaseFixtures.mjs';

const CONTEXT = { trustClass: 'class-2-local-user' };

/** Hält das Zwischenergebnis eines Laufs, damit der Heap es nicht einsammelt. */
let held = null;

function nowMs() {
  return performance.now();
}

async function timed(run) {
  const start = nowMs();
  const value = await run();
  return { value, ms: nowMs() - start };
}

const harness = {
  /** Fixture-Bytes erzeugen und für die folgenden Schritte festhalten. */
  async prepare(fixtureId) {
    const fixture = CLASS_2_WORST_CASE_FIXTURES.find((entry) => entry.id === fixtureId);
    if (fixture === undefined) throw new Error(`Unbekanntes Fixture: ${fixtureId}`);

    const build = await timed(() => fixture.build());
    const bytes = toBytes(build.value);
    held = { bytes, parsed: null, processed: null, live: null, widestRecord: null, result: null };
    return {
      id: fixture.id,
      limit: fixture.limit,
      label: fixture.label,
      reachesSchemaStage: fixture.reachesSchemaStage,
      bytes: bytes.byteLength,
      buildMs: build.ms,
    };
  },

  /**
   * Wie `prepare`, aber mit frei gewählter Knotenzahl.
   *
   * Grundlage der Grenzwertherleitung: Ein einzelner Messpunkt auf der
   * heutigen Grenze sagt nicht, WELCHE Grenze das Budget halten würde. Die
   * zweite Auflage hat diese Lücke mit einer linearen Hochrechnung gefüllt
   * und sie als solche gekennzeichnet; der Codex-Befund zu 36d9c79 verlangt
   * stattdessen eine Messung. Nur knotengebundene Fixtures tragen `buildScaled`.
   *
   * @param {string} fixtureId Registrierte Fixture-Kennung.
   * @param {number} totalNodes Knotenzahl dieses Messpunkts.
   */
  async prepareScaled(fixtureId, totalNodes) {
    const fixture = CLASS_2_WORST_CASE_FIXTURES.find((entry) => entry.id === fixtureId);
    if (fixture === undefined) throw new Error(`Unbekanntes Fixture: ${fixtureId}`);
    if (fixture.buildScaled === undefined) {
      throw new Error(`Fixture ${fixtureId} ist nicht knotenskalierbar`);
    }

    const build = await timed(() => fixture.buildScaled(totalNodes));
    const bytes = toBytes(build.value);
    held = { bytes, parsed: null, processed: null, live: null, widestRecord: null, result: null };
    return {
      id: fixture.id,
      limit: fixture.limit,
      label: fixture.label,
      reachesSchemaStage: fixture.reachesSchemaStage,
      totalNodes,
      bytes: bytes.byteLength,
      buildMs: build.ms,
    };
  },

  /** Stufe 1: Bytelimit, fatale UTF-8-Dekodierung, Scanner, `JSON.parse`, Registrierung. */
  async stage1() {
    const run = await timed(() => parseClass2OscalInput(held.bytes));
    held.parsed = run.value;
    return {
      ms: run.ms,
      ok: run.value.ok,
      code: run.value.ok ? null : run.value.diagnostic.code,
    };
  },

  /** Objektorientierte Kette: Herkunft, Budget, Strukturinvariante, Dispatch, Schemastufe. */
  async objectChain() {
    if (!held.parsed?.ok) return { ms: 0, ok: false, code: 'STUFE_1_ABGEWIESEN' };
    const run = await timed(() => processClass2OscalValue(held.parsed.source, CONTEXT));
    held.processed = run.value;
    return {
      ms: run.ms,
      ok: run.value.ok,
      code: run.value.ok ? null : run.value.diagnostic.code,
    };
  },

  /**
   * Der gleichzeitig lebende Bestand der PARSE-Stufe, festgehalten für eine
   * Messung.
   *
   * Die zweite Auflage erhob nur, was den Lauf überdauert, plus die
   * Identitätsmenge. Der Codex-Befund zu 84ca1f6 hat gezeigt, dass damit genau
   * die kurzlebigen Strukturen fehlen. Die Kette hat zwei verschiedene
   * Höchststände, und keiner von beiden ist die Summe aller Strukturen:
   *
   *   PARSE-STUFE (`parseClass2OscalInput`) hält gleichzeitig die
   *   Eingabebytes, die dekodierte Zeichenkette (die lokale `text` lebt über
   *   `JSON.parse` UND die anschließende Registrierung hinweg), das
   *   Parse-Produkt sowie `visited` und `pending` des Registrierungsdurchlaufs.
   *
   *   OBJEKTKETTE (`processClass2OscalValue`) hält die Eingabebytes, das
   *   Parse-Produkt, die Identitätsmenge und den Arbeitsvorrat des
   *   Herkunftsdurchlaufs sowie das `Object.entries`-Paar-Array des gerade
   *   besuchten Records — aber KEINE Zeichenkette mehr: Stufe 1 ist
   *   zurückgekehrt, `text` ist unerreichbar.
   *
   * Jeder Posten ist keine nachgebildete Schätzung, sondern dieselbe
   * Datenstruktur über denselben Graphen:
   *
   *   - `text` — `new TextDecoder('utf-8', { fatal: true }).decode(bytes)`,
   *     dieselbe Zeile wie in Stufe 1.
   *   - `containers` — die Identitätsmenge als `Set` über jeden Container,
   *     aufgebaut über den produktiven `walkOwnContainers`. Sowohl `visited`
   *     im Durchlauf-Helper als auch `seenContainers` in der
   *     Strukturinvariante sind genau das; nie mehr als eine davon lebt.
   *   - `pending` — der Arbeitsvorrat von `walkOwnContainers`. Seine
   *     Obergrenze ist die Zahl aller Kind-Slots, und genau so lang wird das
   *     Array hier.
   *   - `entries` — das Paar-Array aus `Object.entries(record)`, das
   *     `visitRecord` für den gerade besuchten Record über dessen ganze
   *     Mitgliederschleife hält. Genommen wird der BREITESTE Record des
   *     Graphen. Dieselbe Breite tragen auch die `Reflect.ownKeys`-Arrays in
   *     Formprüfung, Knotenuntergrenze und Bytebuchhaltung.
   */
  holdStage1Peak() {
    if (!held.parsed?.ok) {
      return { containers: 0, childSlots: 0, widestRecordMembers: 0, textLength: 0 };
    }

    const root = held.parsed.source;
    const containers = new Set();
    let childSlots = 0;
    let widestRecord = null;
    let widestRecordMembers = -1;
    walkOwnContainers(root, (container) => {
      containers.add(container);
      const keys = Reflect.ownKeys(container);
      childSlots += keys.length;
      if (!Array.isArray(container) && keys.length > widestRecordMembers) {
        widestRecordMembers = keys.length;
        widestRecord = container;
      }
      return true;
    });

    const text = new TextDecoder('utf-8', { fatal: true }).decode(held.bytes);
    held.widestRecord = widestRecord;
    held.live = { text, containers, pending: new Array(childSlots).fill(root), entries: null };
    return {
      containers: containers.size,
      childSlots,
      widestRecordMembers: Math.max(widestRecordMembers, 0),
      textLength: text.length,
    };
  },

  /**
   * Vom Höchststand der Parse-Stufe zu dem der Objektkette: Die Zeichenkette
   * fällt weg, das Paar-Array des breitesten Records kommt hinzu.
   */
  holdChainPeak() {
    if (held.live === null) return { entries: 0 };
    held.live.text = null;
    held.live.entries = held.widestRecord === null ? [] : Object.entries(held.widestRecord);
    return { entries: held.live.entries.length };
  },

  /**
   * Selbstprüfung des Speichermesswegs, vor jeder Messreihe.
   *
   * Der Vorgänger dieses Harnischs maß über CDP `Runtime.getHeapUsage`. Diese
   * Zahl deckt den V8-JS-Heap und NUR ihn: Der `ArrayBuffer`-Backing-Store
   * eines `Uint8Array` liegt daneben, und das Ergebnis von
   * `TextDecoder.decode` ist in Blink ein externer String, dessen Inhalt
   * ebenfalls nicht darin erscheint. Beides sind zweistellige MiB-Beträge im
   * Tab, die der alten Messung vollständig entgingen — sie hätte ein
   * gehaltenes Budget ausweisen können, das nicht gehalten wird.
   *
   * `performance.measureUserAgentSpecificMemory()` erfasst beides. Diese Probe
   * belegt es für den konkreten Lauf, statt es zu behaupten: Sie hält einen
   * beschriebenen Puffer bekannter Größe und verlangt, dass die Messung ihn
   * sieht. Bleibt er aus, bricht der Lauf ab.
   *
   * @param {number} probeBytes Größe des Prüfpuffers.
   */
  async assertMemoryObservability(probeBytes = 16 * 1024 * 1024) {
    if (globalThis.crossOriginIsolated !== true) {
      throw new Error('Seite ist nicht cross-origin-isoliert; Speichermessung nicht verfügbar');
    }
    if (typeof performance.measureUserAgentSpecificMemory !== 'function') {
      throw new TypeError('performance.measureUserAgentSpecificMemory() fehlt in diesem Browser');
    }

    const before = (await performance.measureUserAgentSpecificMemory()).bytes;
    // Beschrieben, nicht nur reserviert: Ein nur angeforderter Puffer könnte
    // vom Betriebssystem noch gar nicht hinterlegt sein.
    const probe = new Uint8Array(probeBytes);
    probe.fill(0x41);
    globalThis.__gspp382Probe = probe;
    const after = (await performance.measureUserAgentSpecificMemory()).bytes;
    globalThis.__gspp382Probe = null;

    const observedBytes = after - before;
    if (observedBytes < probeBytes * 0.9) {
      throw new Error(
        `Speichermessung meldet zu wenig: ${probeBytes} Bytes Prüfpuffer ergaben `
        + `${observedBytes} Bytes. Speicherwerte dieses Laufs wären wertlos.`,
      );
    }
    return { probeBytes, observedBytes };
  },

  /** Speicherstand des gesamten Agenten: JS-Heap, externe Strings, Puffer. */
  async usedBytes() {
    return (await performance.measureUserAgentSpecificMemory()).bytes;
  },

  /**
   * Produktiver Einstieg mit Worker — gemessen werden ZWEI verschiedene Dinge.
   *
   * `ms` ist die sichtbare Wartezeit, die den 30-s-Timeout verbraucht. Sie
   * sagt nichts darüber, ob die Oberfläche in dieser Zeit bedienbar bleibt:
   * Der Worker rechnet nebenläufig, der Main Thread wartet.
   *
   * `blockingMs` ist die Zeit, in der der Main Thread NICHT bedienbar war.
   * Der Codex-Befund zu 36d9c79 hat gezeigt, dass die zweite Auflage genau
   * diese Zahl nicht erhoben und die Einhaltung des 50-ms-Budgets stattdessen
   * aus einer Architekturannahme abgeleitet hat — der Worker rechne ja
   * ausgelagert, im Main Thread blieben nur Pufferkopie und ausgehendes
   * `postMessage`. Die Annahme lässt den RÜCKWEG aus: Der Worker antwortet mit
   * `self.postMessage(response)` und schickt den vollständigen Ergebnisgraphen
   * mit. Dessen strukturierte Deserialisierung läuft im Main Thread, vor dem
   * `message`-Handler, und ist bei einem Dokument an der Knotengrenze alles
   * andere als umsonst.
   *
   * Gemessen wird ohne jede Instrumentierung im Anwendungscode, auf zwei
   * unabhängigen Wegen:
   *
   *   - `submitMs`: die rein synchrone Zeit, bis `importClass2OscalDocument`
   *     sein Promise zurückgibt. Das ist der Hinweg — Pufferkopie,
   *     Worker-Erzeugung, ausgehendes `postMessage`.
   *   - `longTasks`: die Long-Task-Einträge der Plattform, die das
   *     Importintervall überlappen. Sie erfassen jeden Task über 50 ms,
   *     einschließlich desjenigen, der die Antwort entgegennimmt.
   *
   * Die Long-Task-Schwelle ist mit 50 ms genau das vereinbarte Budget: Ein
   * leerer Eintragssatz IST der Nachweis der Einhaltung, ein nichtleerer der
   * Nachweis der Verletzung.
   *
   * ZWEI Messfallen, die diese Aussage sonst still entwerten, und die
   * `assertLongTaskObservability` unten deshalb vorab ausschließt:
   *
   *   1. Der Aufruf muss in einem ECHTEN Task der Ereignisschleife liegen.
   *      Der Task, den der Fernsteuerungskanal des Messtreibers zum Auswerten
   *      aufmacht, wird von der Long-Task-API nicht attribuiert — eine
   *      dreihundert Millisekunden lange Blockade darin meldet nichts. Der
   *      Import wird darum über `setTimeout` in einen eigenen Task gelegt,
   *      genau wie ihn in der Anwendung ein Ereignisbehandler aufmachen würde.
   *   2. Der Eintrag des zuletzt beendeten Tasks ist beim Weiterlaufen noch
   *      nicht zugestellt. `takeRecords()` holt ihn synchron ab, statt sich
   *      auf die Reihenfolge zweier konkurrierender Warteschlangen zu
   *      verlassen.
   */
  async endToEnd() {
    const observed = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        observed.push({ startTime: entry.startTime, ms: entry.duration });
      }
    });
    observer.observe({ type: 'longtask', buffered: false });

    const startedAt = nowMs();
    // Eigener Task statt des nicht attribuierten Auswertungstasks — sonst
    // bleibt der gesamte Hinweg für die Long-Task-API unsichtbar.
    const { value, submitMs, finishedAt } = await new Promise((resolve, reject) => {
      setTimeout(() => {
        const enteredAt = nowMs();
        let pending;
        try {
          pending = importClass2OscalDocument(held.bytes, CONTEXT);
        } catch (error) {
          reject(error);
          return;
        }
        // Vor dem ersten `await`: der synchrone Hinweg im aufrufenden Task.
        const synchronousMs = nowMs() - enteredAt;
        pending.then(
          (result) => resolve({ value: result, submitMs: synchronousMs, finishedAt: nowMs() }),
          reject,
        );
      }, 0);
    });

    // Erst die noch nicht zugestellten Einträge abholen, dann eine Makrotask-
    // Runde für die regulär zugestellten.
    for (const entry of observer.takeRecords()) {
      observed.push({ startTime: entry.startTime, ms: entry.duration });
    }
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    for (const entry of observer.takeRecords()) {
      observed.push({ startTime: entry.startTime, ms: entry.duration });
    }
    observer.disconnect();

    // Überlappung statt Startzeitpunkt: Der aufrufende Task beginnt vor
    // `startedAt` und der annehmende endet nach `finishedAt` — beide gehören
    // zum Import und dürfen nicht durch ein Intervallkriterium herausfallen.
    // Doppelte Zustellung ist möglich, weil `takeRecords` und der Rückruf
    // dieselbe Warteschlange leeren; die Startzeit identifiziert den Eintrag.
    const seenStarts = new Set();
    const longTasks = observed
      .filter((entry) => entry.startTime + entry.ms > startedAt && entry.startTime < finishedAt)
      .filter((entry) => {
        if (seenStarts.has(entry.startTime)) return false;
        seenStarts.add(entry.startTime);
        return true;
      })
      .map((entry) => entry.ms);

    // Das Ergebnis bleibt referenziert: Es ist der im Main Thread
    // deserialisierte Ergebnisgraph, und genau der ist der Main-Thread-Anteil
    // der Speicherspitze, den die zweite Auflage gar nicht erhoben hat. Der
    // Node-Prozess misst ihn unmittelbar nach der Rückkehr.
    held.result = value;

    return {
      ms: finishedAt - startedAt,
      submitMs,
      longTasks,
      blockingMs: longTasks.reduce((sum, ms) => sum + ms, 0),
      longestTaskMs: longTasks.length === 0 ? 0 : Math.max(...longTasks),
      ok: value.ok,
      code: value.ok ? null : value.diagnostic.code,
    };
  },

  /**
   * Selbstprüfung des Messwegs, vor jeder Messreihe.
   *
   * Eine Blockierzeit von null ist zweideutig: Sie kann heißen, dass der Main
   * Thread frei blieb — oder dass die Instrumentierung in diesem Kontext gar
   * nichts meldet. Der erste Messlauf dieser Auflage hat für JEDES Fixture
   * null gemeldet, weil der Import im nicht attribuierten Auswertungstask
   * lief; die Zahlen sahen aus wie ein eingehaltenes Budget und waren keins.
   *
   * Der Harnisch blockiert deshalb absichtlich `probeMs` Millisekunden in
   * einem regulären Task und verlangt dafür einen Eintrag. Bleibt er aus, ist
   * jede spätere Null unbrauchbar und der Lauf bricht ab, statt ein
   * eingehaltenes Budget zu behaupten.
   *
   * @param {number} probeMs Dauer der absichtlichen Blockade.
   */
  async assertLongTaskObservability(probeMs = 120) {
    const observed = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) observed.push(entry.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });

    await new Promise((resolve) => {
      setTimeout(() => {
        const end = nowMs() + probeMs;
        while (nowMs() < end) { /* absichtliche Blockade */ }
        resolve();
      }, 0);
    });
    for (const entry of observer.takeRecords()) observed.push(entry.duration);
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    for (const entry of observer.takeRecords()) observed.push(entry.duration);
    observer.disconnect();

    const longest = observed.length === 0 ? 0 : Math.max(...observed);
    if (longest < probeMs * 0.5) {
      throw new Error(
        `Long-Task-Instrumentierung meldet nichts: ${probeMs} ms Blockade ergaben `
        + `${longest.toFixed(1)} ms. Blockierzeiten dieses Laufs wären wertlos.`,
      );
    }
    return { probeMs, observedMs: longest };
  },

  /**
   * Einmaliges Aufwärmen vor der ersten Messung.
   *
   * Die Schemastufe lädt ihren Chunk nach und Ajv kompiliert den Validator
   * beim ersten Lauf; beides bleibt danach im Modulspeicher liegen. Ohne
   * Aufwärmen fiele dieser einmalige Aufbau in die Basislinie des ERSTEN
   * Fixtures und höbe dessen ausgewiesenen Speicher um einen Betrag an, der
   * mit dem Dokument nichts zu tun hat.
   */
  async warmUp() {
    const bytes = toBytes(buildNodeBoundDocumentText(12));
    const parsed = parseClass2OscalInput(bytes);
    if (!parsed.ok) throw new Error('Aufwärmdokument scheitert in Stufe 1');
    const processed = await processClass2OscalValue(parsed.source, CONTEXT);
    if (!processed.ok) throw new Error('Aufwärmdokument scheitert in der Objektkette');
    return true;
  },

  /** Referenzen freigeben, damit die anschließende Heap-Basislinie wieder greift. */
  release() {
    held = null;
    return true;
  },

  /**
   * Glob-Worst-Case gegen die produktive Übersetzung aus
   * `src/domain/profileResolutionSelection.ts`. Der Ausdruck wird dort gebaut,
   * nicht hier nachgebildet.
   */
  glob(stars, subjectLength) {
    const { pattern, subject } = buildGlobPatternWorstCase(stars, subjectLength);
    const regexp = globToRegExp(pattern);
    const start = nowMs();
    const matched = regexp.test(subject);
    return { ms: nowMs() - start, patternBytes: pattern.length, subjectLength, matched };
  },

  /** Umgebungsangaben für das Messprotokoll. */
  environment() {
    return {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory ?? null,
    };
  },
};

globalThis.__gspp382 = harness;
