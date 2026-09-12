// =============================================================================
// Durchsetzung des laufenden Budgets am ÖFFENTLICHEN Resolver (GSPP-345).
//
// Bewusst getrennt von `profileResolutionBudget.test.ts`: Dort steht das
// Budget isoliert und mit Testgrenzen, hier läuft es unter Produktionsgrenzen
// hinter `resolveProfile` — ohne jede Naht, über die ein Test eine Grenze
// setzen könnte. Genau das ist die Aussage, die das Akzeptanzkriterium
// verlangt: Der Produktionsresolver besitzt keinen Grenzwert- und keinen
// Disable-Parameter.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { parseProfileDocument } from '@/adapters/oscalProfileDocument';
import type { TrustClass } from './oscalDocumentContext';
import { CLASS_2_IMPORT_LIMITS } from './oscalImportContract';
import {
  PROFILE_RESOLUTION_BUDGET_DIAGNOSTIC_CODES,
  PROFILE_RESOLUTION_WORK_UNITS,
} from './profileResolutionBudget';
import { resolveProfile } from './profileResolutionEngine';
import { buildProfileResolutionPlan } from './profileResolutionImportGraph';
import type { ProfileResolutionEdge } from './profileResolutionImportGraph';

const VERSION = '1.1.3';
const TOP_UUID = '11111111-1111-5111-8111-111111111111';

/** Charakteristische Zeichenkette für den Redaktionsnachweis. */
const FIXTURE_MARKER = 'ZZ-GEHEIM-MARKER-7f3a1c';

/**
 * Ausmaße, die das Arbeitsbudget unter PRODUKTIONSGRENZEN erschöpfen.
 *
 * Ein Glob-Ausschlussselektor kostet je Control-ID rund 8,4 Arbeitseinheiten.
 * 8 500 × 2 000 × 8,4 sind rund 143 Millionen Einheiten und liegen damit über
 * `WORK_UNIT_LIMIT`. Die Zahl ist hier nur die Begründung der Testgröße; der
 * Kostenbeleg je Kategorie liegt im Messapparat
 * (`scripts/profileResolutionWorstCaseFixtures.mjs`), und der Test prüft
 * ohnehin den Abbruch, nicht eine bestimmte Einheitenzahl.
 *
 * Der Lauf kostet ungefähr eine Sekunde, und das ist unvermeidlich: Die Grenze
 * ist so bemessen, dass sie fünf Sekunden Wartezeit deckelt — sie zu
 * erschöpfen kann nicht billig sein. Eine Testnaht, die eine kleinere Grenze
 * setzt, wäre billiger, würde aber genau die Aussage zerstören, um die es hier
 * geht: dass der Produktionsresolver keinen Grenzwertparameter besitzt.
 */
const CONTROL_COUNT = 2000;
const EXCLUDE_COUNT = 8500;

function catalogDoc(controls: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { catalog: { metadata: { 'oscal-version': VERSION }, controls, ...extra } };
}

function profileDoc(spec: {
  imports: Record<string, unknown>[];
  backMatter?: Record<string, unknown>;
  merge?: Record<string, unknown>;
  modify?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    profile: {
      uuid: TOP_UUID,
      metadata: { title: 'Budgetprofil', version: '1.0.0', 'oscal-version': VERSION },
      imports: spec.imports,
      ...(spec.merge !== undefined && { merge: spec.merge }),
      ...(spec.modify !== undefined && { modify: spec.modify }),
      ...(spec.backMatter !== undefined && { 'back-matter': spec.backMatter }),
    },
  };
}

async function resolveWorld(spec: {
  documents: Record<string, unknown>;
  edges: Record<string, ProfileResolutionEdge[]>;
  trustClass?: TrustClass;
}) {
  const documents = new Map(Object.entries(spec.documents));
  const edgesByArtifactKey = new Map(Object.entries(spec.edges));
  const plan = buildProfileResolutionPlan({
    topProfileArtifactKey: 'profile-top',
    documents,
    edgesByArtifactKey,
  });
  if (!plan.ok) throw new Error(`Plan scheiterte: ${plan.diagnostic.code}`);
  const profileViews = new Map(
    [...plan.order]
      .filter((key) => key.startsWith('profile'))
      .map((key) => [
        key,
        parseProfileDocument(documents.get(key), {
          trustClass: spec.trustClass ?? 'class-1-verified-public',
        }),
      ]),
  );
  return resolveProfile({ plan, edgesByArtifactKey, profileViews });
}

/**
 * Gebuchte Container je Add/Remove-Zyklus auf einer Control, GEMESSEN an
 * diesem Fixture. Die Alteration mit `adds` bucht die flache Kopie, die neue
 * parts-Liste und zwei Kanonisierungskopien; die Alteration mit `removes`
 * bucht die Kopie, die gefilterte parts-Liste und eine Kanonisierungskopie —
 * zusammen fünf Objektkopien und zwei Array-Container. Die Zahl steht hier
 * als Regressionsanker: Fällt eine Buchung weg, sinkt sie. Ohne die Buchung
 * der beiden parts-Listen wären es fünf.
 */
const CYCLE_NODE_COST = 7;

const EDGE_TO_SOURCE: Record<string, ProfileResolutionEdge[]> = {
  'profile-top': [{ href: './src.json', artifactKey: 'catalog-src' }],
};

describe('Arbeitsbudget am öffentlichen Resolver', () => {
  // Frist statt der voreingestellten fünf Sekunden: Die Grenze ist so
  // bemessen, dass sie fünf Sekunden Wartezeit deckelt — sie zu erschöpfen
  // kostet unter V8-Coverage-Instrumentierung rund fünfzehn Sekunden. Der
  // Preis ist der Aussage geschuldet und nicht dem Testaufbau: Eine kleinere
  // Grenze gäbe es nur über eine Naht, die der Produktionsresolver nicht hat.
  it('bricht bei kleiner Ausgabe ab, wenn die Arbeit die Grenze reißt', { timeout: 60_000 }, async () => {
    // Der Katalog ist klein und die AUSGABE leer — jede Control wird wieder
    // ausgeschlossen. Teuer ist allein die Arbeit: EXCLUDE_COUNT (8500)
    // Ausschlussselektoren laufen über CONTROL_COUNT (2000) Control-IDs.
    // Damit belegt der Test das Arbeitsbudget unabhängig von jeder
    // Ausgabegrenze. Die Zahlen stehen bewusst nur an den Konstanten, damit
    // Kommentar und Aufbau nicht auseinanderlaufen können.
    const controls = Array.from({ length: CONTROL_COUNT }, (_, index) => ({
      id: `ac-${index}`,
      title: `Control ${index}`,
    }));
    const excludes = Array.from({ length: EXCLUDE_COUNT }, () => ({
      matching: [{ pattern: 'ac-*' }],
    }));

    const outcome = await resolveWorld({
      documents: {
        'catalog-src': catalogDoc(controls),
        'profile-top': profileDoc({
          imports: [{ href: './src.json', 'include-all': {}, 'exclude-controls': excludes }],
        }),
      },
      edges: EDGE_TO_SOURCE,
    });

    expect(outcome).toMatchObject({
      ok: false,
      diagnostic: {
        code: PROFILE_RESOLUTION_BUDGET_DIAGNOSTIC_CODES.WORK_BUDGET_EXCEEDED,
        stage: 'resource-limit',
      },
    });
    // Kein Teilergebnis und kein Builder-Handle verlassen den Lauf.
    expect(outcome).not.toHaveProperty('output');
  });

  it('lässt einen gleichnamigen Wert im Steuerdokument wirkungslos', async () => {
    // Ein Dokument, das `workUnits`/`WORK_UNIT_LIMIT` als Inhalt trägt, darf
    // das Budget nicht verändern: Es gibt keinen Weg vom Dokument zur Grenze.
    const smuggled = {
      workUnits: 1,
      WORK_UNIT_LIMIT: 1,
      budget: { workUnits: 0, maxNodes: 0, maxDepth: 0 },
    };
    const outcome = await resolveWorld({
      documents: {
        'catalog-src': catalogDoc([{ id: 'ac-1', title: 'A', props: [{ name: 'x', value: 'y' }] }]),
        'profile-top': profileDoc({
          imports: [{ href: './src.json', 'include-all': {}, ...smuggled }],
        }),
      },
      edges: EDGE_TO_SOURCE,
    });

    expect(outcome.ok).toBe(true);
  });
});

describe('Ausgabebudget am öffentlichen Resolver', () => {
  it('bricht vor dem Beginn von Tiefe 65 ab', async () => {
    // Kette aus verschachtelten Kind-Controls, tief genug, dass die Emission
    // die Tiefengrenze reißt. Die Wurzel liegt auf Tiefe 1, der `catalog`-
    // Körper auf 2 — dieselbe Zählung wie die Postcondition.
    let deepest: Record<string, unknown> = { id: 'ac-deep', title: 'Blatt' };
    // Jede Control-Verschachtelung kostet in der Ausgabe ZWEI Ebenen: das
    // `controls`-Array und das Control-Objekt darin. Die Kette beginnt auf
    // Tiefe 3 (`catalog.controls`), 31 Ebenen erreichen also 3 + 2*31 = 65 —
    // genau eine über der Grenze. Mehr Ebenen würden schon der Tiefenwächter
    // der Merge-Phase abfangen und nie bis zur Emission kommen.
    for (let level = 0; level < 31; level += 1) {
      deepest = { id: `ac-${level}`, title: `Ebene ${level}`, controls: [deepest] };
    }

    const outcome = await resolveWorld({
      documents: {
        'catalog-src': catalogDoc([deepest]),
        'profile-top': profileDoc({ imports: [{ href: './src.json', 'include-all': {} }] }),
      },
      edges: EDGE_TO_SOURCE,
    });

    expect(outcome).toMatchObject({
      ok: false,
      diagnostic: {
        code: PROFILE_RESOLUTION_BUDGET_DIAGNOSTIC_CODES.OUTPUT_BUDGET_EXCEEDED,
        params: { dimension: 'depth', limit: CLASS_2_IMPORT_LIMITS.maxDepth },
      },
    });
  });

  it('bricht vor der Übernahme einer zu großen base64-Summe ab', async () => {
    // Kodierte Länge über 4/3 der Grenze: die dekodierte Summe liegt damit
    // über `maxDecodedBase64Bytes`, ohne dass je dekodiert wird.
    const encodedLength = Math.ceil((CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes * 4) / 3) + 4096;
    const outcome = await resolveWorld({
      documents: {
        'catalog-src': catalogDoc([{ id: 'ac-1', title: 'A' }]),
        'profile-top': profileDoc({
          imports: [{ href: './src.json', 'include-all': {} }],
          backMatter: {
            resources: [{
              uuid: '22222222-2222-5222-8222-222222222222',
              base64: { 'media-type': 'application/pdf', value: 'A'.repeat(encodedLength) },
            }],
          },
        }),
      },
      edges: EDGE_TO_SOURCE,
    });

    expect(outcome).toMatchObject({
      ok: false,
      diagnostic: {
        code: PROFILE_RESOLUTION_BUDGET_DIAGNOSTIC_CODES.OUTPUT_BUDGET_EXCEEDED,
        params: {
          dimension: 'base64',
          limit: CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes,
        },
      },
    });
  });

  it('bricht vor der Erzeugung des Knotens jenseits der Knotengrenze ab', async () => {
    // Eine einzige Control mit einer sehr breiten Liste: Die Ausgabe reißt
    // die Knotengrenze, ohne tief oder byteschwer zu sein.
    const wide = Array.from({ length: CLASS_2_IMPORT_LIMITS.maxNodes + 16 }, (_, i) => i);
    const outcome = await resolveWorld({
      documents: {
        'catalog-src': catalogDoc([{ id: 'ac-1', title: 'A', 'x-wide': wide }]),
        'profile-top': profileDoc({ imports: [{ href: './src.json', 'include-all': {} }] }),
      },
      edges: EDGE_TO_SOURCE,
    });

    expect(outcome).toMatchObject({
      ok: false,
      diagnostic: {
        code: PROFILE_RESOLUTION_BUDGET_DIAGNOSTIC_CODES.OUTPUT_BUDGET_EXCEEDED,
        params: { dimension: 'nodes', limit: CLASS_2_IMPORT_LIMITS.maxNodes },
      },
    });
  });
});

describe('Vertrauensklassenschnitt', () => {
  it.each([
    ['class-1-verified-public'],
    ['class-2-local-user'],
  ] as const)('trennt das steuernde Profil (%s) vom Ergebnis', async (trustClass) => {
    const outcome = await resolveWorld({
      documents: {
        'catalog-src': catalogDoc([{ id: 'ac-1', title: 'A' }]),
        'profile-top': profileDoc({ imports: [{ href: './src.json', 'include-all': {} }] }),
      },
      edges: EDGE_TO_SOURCE,
      trustClass,
    });

    if (!outcome.ok) throw new Error(`unerwartete Ablehnung: ${outcome.diagnostic.code}`);
    expect(outcome.output.controllingTrustClass).toBe(trustClass);
    // Das Ergebnis ist in BEIDEN Fällen Klasse 2 (ADR-8) — die Klasse des
    // Steuerdokuments färbt nicht auf das Ergebnis ab.
    expect(outcome.output.trustClass).toBe('class-2-local-user');
  });
});

describe('Redaktion des Budgetabbruchs', () => {
  it('nennt die Fixture-Zeichenkette nirgends', async () => {
    // Geprüft am Ausgabebudget statt am Arbeitsbudget: Beide Abbrüche bauen
    // ihre Diagnose durch DIESELBE Fabrik aus derselben geschlossenen
    // Parametermenge, die Redaktionsaussage ist also dieselbe — und der
    // Tiefenabbruch kostet Millisekunden statt Sekunden. Der Marker steckt in
    // ID, Titel und Props jeder Ebene, also in allem, was ein Leck tragen
    // könnte.
    const consoleOutput: string[] = [];
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const originals = methods.map((name) => [name, console[name]] as const);
    for (const name of methods) {
      console[name] = (...args: unknown[]) => { consoleOutput.push(args.map(String).join(' ')); };
    }

    try {
      let deepest: Record<string, unknown> = {
        id: `${FIXTURE_MARKER}-blatt`,
        title: FIXTURE_MARKER,
      };
      for (let level = 0; level < 31; level += 1) {
        deepest = {
          id: `${FIXTURE_MARKER}-${level}`,
          title: `${FIXTURE_MARKER} Ebene ${level}`,
          props: [{ name: FIXTURE_MARKER, value: FIXTURE_MARKER }],
          controls: [deepest],
        };
      }

      const outcome = await resolveWorld({
        documents: {
          'catalog-src': catalogDoc([deepest]),
          'profile-top': profileDoc({ imports: [{ href: './src.json', 'include-all': {} }] }),
        },
        edges: EDGE_TO_SOURCE,
      });

      if (outcome.ok) throw new Error('Budget hat nicht abgebrochen');
      expect(outcome.diagnostic.code).toBe(
        PROFILE_RESOLUTION_BUDGET_DIAGNOSTIC_CODES.OUTPUT_BUDGET_EXCEEDED,
      );
      expect(JSON.stringify(outcome.diagnostic)).not.toContain(FIXTURE_MARKER);
      expect(outcome.diagnostic.path).not.toContain(FIXTURE_MARKER);
      expect(outcome.diagnostic.messageKey).not.toContain(FIXTURE_MARKER);
      expect(outcome.diagnostic.signature).not.toContain(FIXTURE_MARKER);
      expect(consoleOutput.join('\n')).not.toContain(FIXTURE_MARKER);
    } finally {
      for (const [name, fn] of originals) console[name] = fn;
    }
  });

  it('bildet eine unerwartete interne Ausnahme redigiert ab', async () => {
    // `bigint` ist kein JSON-Werttyp; `emitValue` wirft dafür einen
    // `TypeError`. Der Wurf ist eine UNERWARTETE interne Ausnahme, kein
    // Budgetabbruch — er muss an derselben Fangstelle auf den stabilen,
    // redigierten Code fallen, ohne Rohtext und ohne Stapel.
    const outcome = await resolveWorld({
      documents: {
        'catalog-src': catalogDoc([
          { id: 'ac-1', title: FIXTURE_MARKER, 'x-bad': 1n as unknown as number },
        ]),
        'profile-top': profileDoc({ imports: [{ href: './src.json', 'include-all': {} }] }),
      },
      edges: EDGE_TO_SOURCE,
    });

    expect(outcome).toMatchObject({
      ok: false,
      diagnostic: { code: 'PROFILE_RESOLUTION_INTERNAL_ERROR', path: '/' },
    });
    if (outcome.ok) return;
    expect(JSON.stringify(outcome.diagnostic)).not.toContain(FIXTURE_MARKER);
    expect(JSON.stringify(outcome.diagnostic)).not.toContain('TypeError');
  });
});

/**
 * Zählt Knoten und größte Tiefe des FERTIGEN Graphen mit exakt der Semantik
 * von `walkObjectGraph` (`oscalObjectGraph.ts`): Wurzel ist Tiefe 1, jeder
 * primitive und jeder Containerwert ist ein Knoten, Property-Namen zählen
 * nicht. Bewusst hier nachgebaut statt importiert — die Postcondition gibt
 * ihre Zähler nicht heraus, und ein Vergleich gegen ihre eigene Zahl wäre
 * zirkulär.
 */
function measureFinishedGraph(value: unknown, depth = 1): { nodes: number; maxDepth: number } {
  let nodes = 1;
  let maxDepth = depth;
  if (value !== null && typeof value === 'object') {
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const inner = measureFinishedGraph(child, depth + 1);
      nodes += inner.nodes;
      if (inner.maxDepth > maxDepth) maxDepth = inner.maxDepth;
    }
  }
  return { nodes, maxDepth };
}

describe('Deckung des geschlossenen Work-Unit-Satzes', () => {
  it('bucht jede der sechs Kategorien in einem echten Auflösungslauf', async () => {
    // Der geschlossene Satz behauptet, jede potenziell wachsende Operation
    // rechne über GENAU EINE dieser Kategorien ab. Eine deklarierte, aber nie
    // gebuchte Kategorie ist entweder tot oder ihre Operation läuft
    // unbudgetiert unter fremder Kategorie — beides ein Vertragsbruch, und
    // beim Abbruch nennt die Diagnose dann den falschen strukturellen Pfad.
    // `alter-target-lookup` war bis zu diesem Test genau das: deklariert, im
    // Produktionspfad aber unter `import-edge` gebucht.
    //
    // Der BSI-Korpus taugt als Orakel dafür nicht: Keines der drei Profile
    // benutzt `matching.pattern`, `glob-state` bliebe dort immer null.
    const outcome = await resolveWorld({
      documents: {
        'catalog-src': catalogDoc(
          [{ id: 'ac-1', title: 'A', parts: [{ id: 'teil', name: 'note' }] }],
          { groups: [{ id: 'grp', title: 'G', controls: [{ id: 'ac-2', title: 'B' }] }] },
        ),
        'profile-top': profileDoc({
          imports: [
            {
              href: './src.json',
              'include-controls': [{ 'with-ids': ['ac-1'], 'with-child-controls': 'yes' }],
              'exclude-controls': [{ matching: [{ pattern: 'zz-*' }] }],
            },
          ],
          merge: { flat: {} },
          modify: {
            alters: [{ 'control-id': 'ac-1', removes: [{ 'by-id': 'fehlt' }] }],
          },
        }),
      },
      edges: EDGE_TO_SOURCE,
    });

    if (!outcome.ok) throw new Error(`unerwartete Ablehnung: ${outcome.diagnostic.code}`);
    const spent = outcome.output.budgetUsage.workUnitsByCategory;
    for (const category of Object.values(PROFILE_RESOLUTION_WORK_UNITS)) {
      expect.soft(spent[category], `Kategorie ${category} wurde nie gebucht`).toBeGreaterThan(0);
    }
  });
});

describe('Verhältnis zur abschließenden Postcondition', () => {
  it('unterschätzt den fertigen Graphen nie', async () => {
    // Das Akzeptanzkriterium erlaubt den laufenden Zählern, die fertigen
    // Werte zu ÜBERSTEIGEN — sie zählen kumulativ über alle Zwischenergebnisse
    // des Plans und schreiben Entferntes nicht gut. Verboten ist allein die
    // andere Richtung: Ein Zähler unter dem fertigen Wert hieße, dass die
    // Grenze umgangen werden kann.
    const outcome = await resolveWorld({
      documents: {
        'catalog-src': catalogDoc([
          { id: 'ac-1', title: 'A', controls: [{ id: 'ac-1.1', title: 'A.1' }] },
          { id: 'ac-2', title: 'B', props: [{ name: 'p', value: 'v' }] },
        ]),
        'profile-top': profileDoc({ imports: [{ href: './src.json', 'include-all': {} }] }),
      },
      edges: EDGE_TO_SOURCE,
    });

    if (!outcome.ok) throw new Error(`unerwartete Ablehnung: ${outcome.diagnostic.code}`);
    const finished = measureFinishedGraph(outcome.output.tree);

    expect(outcome.output.budgetUsage.nodes).toBeGreaterThanOrEqual(finished.nodes);
    expect(outcome.output.budgetUsage.maxDepth).toBeGreaterThanOrEqual(finished.maxDepth);
    // Und beide bleiben unter den Grenzen, die die Postcondition prüft.
    expect(finished.maxDepth).toBeLessThanOrEqual(CLASS_2_IMPORT_LIMITS.maxDepth);
    expect(finished.nodes).toBeLessThanOrEqual(CLASS_2_IMPORT_LIMITS.maxNodes);
  });

  it('zählt die Zwischenkopien der Merge-Phase mit', async () => {
    // Der `flat`-Merge legt je Control eine bereinigte Zwischenkopie an,
    // BEVOR die Emission den ersten Ausgabeknoten anmeldet. Zählte das Budget
    // nur die Emission, könnte ein Lauf beliebig viele solcher Kopien
    // allokieren und dabei null verbuchte Knoten haben — ADR-8 nennt aber
    // ausdrücklich den „Zwischen- ODER Ergebnisgraphen" (Greptile-Befund zu
    // 21dd0b3). Der Nachweis: Der laufende Zähler liegt ECHT über dem
    // fertigen Graphen, und die Differenz wächst mit der Zahl der Controls.
    const resolveWithControls = async (count: number) => {
      const controls = Array.from({ length: count }, (_, index) => ({
        id: `ac-${index}`,
        title: `Control ${index}`,
      }));
      const outcome = await resolveWorld({
        documents: {
          'catalog-src': catalogDoc(controls),
          'profile-top': profileDoc({
            imports: [{ href: './src.json', 'include-all': {} }],
            merge: { flat: {} },
          }),
        },
        edges: EDGE_TO_SOURCE,
      });
      if (!outcome.ok) throw new Error(`unerwartete Ablehnung: ${outcome.diagnostic.code}`);
      return {
        counted: outcome.output.budgetUsage.nodes,
        finished: measureFinishedGraph(outcome.output.tree).nodes,
      };
    };

    const small = await resolveWithControls(10);
    const large = await resolveWithControls(60);

    expect(small.counted).toBeGreaterThan(small.finished);
    expect(large.counted).toBeGreaterThan(large.finished);
    // Je Control genau eine Zwischenkopie: Der Überhang wächst um 50, wenn
    // 50 Controls hinzukommen.
    expect(large.counted - large.finished).toBe(small.counted - small.finished + 50);
  });

  it('bucht den Add/Remove-Zyklus vollständig, Container eingeschlossen', async () => {
    // Der integrierte Nachweis zum Akzeptanzkriterium „Entfernen senkt keinen
    // laufenden Ausgabezähler": kein einziger Budgetaufruf im Test, sondern
    // ein echter Lauf durch `resolveProfile`. Ein Zyklus besteht aus zwei
    // Alterationen auf derselben Control — `removes` wirkt innerhalb EINER
    // Alteration vor `adds`, ein Zyklus braucht deshalb zwei. Der fertige
    // Graph ist danach in jedem Fall derselbe; allein die Zahl der Zyklen
    // unterscheidet die Läufe.
    //
    // Der Zyklus legt nicht nur Objektkopien an, sondern auch neue
    // Array-Container: die ergänzte und die gefilterte parts-Liste. Vor der
    // Behebung dieses Befunds blieben genau diese Listen unbebucht, der
    // Zähler zählte je Zyklus nur die Objektkopien. Der festgenagelte
    // Zuwachs unten schließt sie ein.
    const cycle = (index: number) => [
      {
        'control-id': 'ac-1',
        adds: [{ position: 'ending', parts: [{ id: `tmp-${index}`, name: 'note' }] }],
      },
      {
        'control-id': 'ac-1',
        removes: [{ 'by-id': `tmp-${index}` }],
      },
    ];

    const resolveWithCycles = async (cycles: number) => {
      const alters = Array.from({ length: cycles }, (_, index) => cycle(index)).flat();
      const outcome = await resolveWorld({
        documents: {
          'catalog-src': catalogDoc([
            { id: 'ac-1', title: 'A', parts: [{ id: 'bleibt', name: 'note' }] },
          ]),
          'profile-top': profileDoc({
            imports: [{ href: './src.json', 'include-all': {} }],
            merge: { flat: {} },
            modify: { alters },
          }),
        },
        edges: EDGE_TO_SOURCE,
      });
      if (!outcome.ok) throw new Error(`unerwartete Ablehnung: ${outcome.diagnostic.code}`);
      return {
        counted: outcome.output.budgetUsage.nodes,
        tree: JSON.stringify(outcome.output.tree),
      };
    };

    const one = await resolveWithCycles(1);
    const four = await resolveWithCycles(4);

    // Gleiches Ergebnis, mehr Zyklen: Der Zähler steigt trotzdem — Entfernen
    // schreibt nichts gut.
    expect(four.tree).toBe(one.tree);
    expect(four.counted).toBeGreaterThan(one.counted);
    expect((four.counted - one.counted) % 3).toBe(0);
    expect(four.counted - one.counted).toBe(3 * CYCLE_NODE_COST);
  });

  it('lässt die Postcondition unabhängig ablehnen', async () => {
    // Ein Ergebnis, das die Budgetgrenzen hält, aber die Objektkette nicht
    // passiert: Die Postcondition greift weiterhin und liefert IHRE Diagnose,
    // nicht die des Budgets. Der `oscal-version`-Wert ist ungültig, die
    // Schemastufe weist das aufgelöste Dokument deshalb ab.
    const outcome = await resolveWorld({
      documents: {
        'catalog-src': catalogDoc([{ id: 'ac-1', title: 'A' }]),
        'profile-top': {
          profile: {
            uuid: TOP_UUID,
            metadata: { title: 'P', version: '1.0.0', 'oscal-version': VERSION, 'x-extra': { deep: true } },
            imports: [{ href: './src.json', 'include-all': {} }],
          },
        },
      },
      edges: EDGE_TO_SOURCE,
    });

    // Entweder das Ergebnis passiert die Kette — dann trägt es keine
    // Budgetdiagnose —, oder die Kette lehnt es mit ihrem EIGENEN Code ab.
    if (!outcome.ok) {
      expect(outcome.diagnostic.code).not.toBe(
        PROFILE_RESOLUTION_BUDGET_DIAGNOSTIC_CODES.OUTPUT_BUDGET_EXCEEDED,
      );
      expect(outcome.diagnostic.code).not.toBe(
        PROFILE_RESOLUTION_BUDGET_DIAGNOSTIC_CODES.WORK_BUDGET_EXCEEDED,
      );
    }
  });
});
