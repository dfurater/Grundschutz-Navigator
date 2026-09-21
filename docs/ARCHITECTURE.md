# Architektur — Grundschutz++ Navigator

Überblick über die Software-Architektur der Anwendung.

## Überblick

Bei der Anwendung handelt es sich um eine **Client-Side Single-Page Application (SPA)** für das Durchsuchen und Filtern des BSI IT-Grundschutz-Kontrollkatalogs (Grundschutz++). Die Anwendung wird vollständig im Browser ausgeführt und deployed auf GitHub Pages.

## Technologie-Stack

| Schicht | Technologie |
|---------|-------------|
| Framework | React 19 + TypeScript |
| Build-Tool | Vite 8 |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite` Plugin) |
| Routing | React Router v8 |
| Volltextsuche | FlexSearch |
| Testing | Vitest + @testing-library/react + jsdom + Chromium-Browser-Lane |
| Deployment | GitHub Pages (via GitHub Actions) |

## Browser-Testlane

`npm run test` läuft vollständig in jsdom und schließt Dateien unter `src/test/browser/**/*.browser.test.ts` explizit aus (Ausschluss in `vite.config.ts`).

`npm run test:browser` startet die getrennte Vitest-Browser-Lane aus `vitest.browser.config.ts` mit dem Playwright-Provider und Chromium. Sie verwendet einen gemeinsamen Test-iframe (`isolate: false`) und führt `ajv` in `optimizeDeps.include`, weil die Schemaprüfung das Paket erst zur Laufzeit importiert. Jeder Test bereinigt seine eigene IndexedDB-Datenbank, und der Egress-Guard setzt seinen Zustand vor jedem Test zurück.

| Abhängigkeit | Pin | Lizenz | Zweck |
| --- | --- | --- | --- |
| `vitest` + `@vitest/coverage-v8` + `@vitest/browser-playwright` | exakt, für alle drei identisch | MIT | Kompatible Test-, Coverage- und Provider-Basis für beide Vitest-Lanes |
| `playwright` | exakt | Apache-2.0 | Startet das gepinnte Chromium in CI und lokal |

Die Versionen stehen in `package.json`, `package-lock.json` bindet sie samt Integritätshashes. Chromium ist an den gepinnten `playwright`-Stand gebunden: Der CI-Schritt lädt ausschließlich die Revision, die das `browsers.json` der von `playwright` aufgelösten `playwright-core`-Installation nennt; einen unversionierten Browser-Download gibt es nicht.

Ob der Vertrag nach einem Versions-Bump noch gilt, prüft `npm run verify-documented-versions` als Pflichtschritt im CI-Job `validate`. Der Guard verlangt exakte Pins in `package.json`, identische Pins für das Vitest-Trio, die zur `playwright`-Auflösung gehörende `playwright-core`-Version samt Chromium-Eintrag und einen Abschnitt ohne Versionsliteral. Er ist netzfrei und fail-closed: Eine nicht auffindbare Überschrift, Kopfzeile, Tabellenzeile oder Satzform lässt ihn ebenso fehlschlagen wie ein verletzter Vertragspunkt. Er ergänzt den PR-Dokumentationsvertrag aus `scripts/pr-documentation-contract.mjs`, der nur bei Änderungen unter `src/` greift und Dependency-PRs deshalb nicht erfasst.

Der Referenztest in `src/test/browser/indexedDb.browser.test.ts` legt eine IndexedDB-Datenbank an, schreibt und liest einen Datensatz, löscht die Datenbank und prüft anschließend ihre Abwesenheit über `indexedDB.databases()`. Ein durch eine noch offene Verbindung blockiertes `deleteDatabase()` wartet bis zu zwei Sekunden auf deren Schließen und lehnt danach mit einem erklärenden Fehler ab.

`src/test/browser/browserEgressDecision.ts` entscheidet als reine Funktion über HTTP(S)- und Service-Worker-Ereignisse. Der Playwright-Guard in `browserEgressGuard.ts` bricht fremde HTTP(S)-Requests vor Namens- oder Netzauflösung ab. Für WebSockets setzt der Guard im ausgeführten Vitest-Testframe eine `connect-src`-CSP, die nur den lokalen WebSocket-Host erlaubt und die ausgelöste Browser-Verletzung mit eigenem Zähler erfasst. Der HTTP-Zähler wird erst beim zugehörigen `ERR_BLOCKED_BY_CLIENT`-Ereignis erhöht, der WebSocket-Zähler erst bei der CSP-Verletzung. Bereits vorhandene oder neu registrierte Service Worker gelten ebenfalls als Verstoß.

Der WebSocket-Zustand liegt im `window` des aktuellen Testframes, weil die Browser-Commands ihn aus derselben Ausführungsumgebung lesen, die die CSP durchsetzt. Navigiert ein Test diesen Frame, entfernt der Browser die CSP mit dem Dokument. Der Guard registriert diese Navigation Node-seitig als Verstoß und installiert die CSP nicht still im Ziel-Dokument neu; der anschließende `afterEach` schlägt mit dem Egress-Marker fehl.

`npm run test:browser:egress-negative` startet zwei getrennte innere Browser-Läufe für absichtlich nicht abgewartete `fetch`- und `navigator.sendBeacon`-Requests. Beide Ziele werden aus `window.location` als Loopback-Origin mit abweichendem Port abgeleitet; bei Port 65535 wird auf 65534 ausgewichen. Der Guard bricht sie vor jeder Namens- oder Netzauflösung ab. Die Testkörper werfen nicht selbst und warten die Requests nicht ab; erst der immer aktive `afterEach` ruft `assertNoViolations` über den Browser-Command auf und erzeugt den Egress-Marker.

Jeder innere Lauf **muss** mit genau einem Marker fehlschlagen, der zum ausgewählten Fall, zur erwarteten HTTP-Methode und zum erwarteten Loopback-Pfad passt. Das Wrapper-Skript wird nur dann grün, wenn Vitests JSON-Report exakt diesen einen fehlgeschlagenen Test enthält. Eine falsche Methode, mehrere Marker, ein zusätzlicher Verstoß, ein unerwartet grüner Lauf, weitere Testfehler, Timeouts oder Runner-Signale lassen auch den Wrapper scheitern.

Die Hook-Grenze erfasst keine Browser-Aufgabe, die erst *nach* Ende des Tests einen Request startet. Dafür ist eine veränderte Testlaufzeit-Architektur erforderlich, kein Timeout.

Die Browser-Lane erzeugt keine Coverage-Ausgabe. Die verbindlichen V8-Coverage-Schwellen bleiben ausschließlich in der jsdom-Lane (`npm run test:coverage`): Lines 87, Branches 77, Functions 88, Statements 85 (`vite.config.ts`).

## Verzeichnisstruktur

```
src/
├── domain/           # Domänenmodelle und Geschäftslogik
│   ├── models.ts                 # Zwei-Schichten-Datentypen
│   ├── integrity.ts              # SHA-256 Integritätsprüfung
│   ├── vocabulary.ts             # BSI-Vokabular-Auflösung
│   ├── sourceRegistry.{mjs,ts}   # Verbindlicher Upstream-/Katalogvertrag
│   ├── sourceRegistry.d.mts      # Typen des Quellregisters
│   ├── oscalVersionMatrix.{mjs,ts} # Root-Typ × OSCAL-Version × gepinntes Schema
│   ├── oscalVersionMatrix.d.mts  # Typen der Versionsmatrix
│   ├── controlRef.ts             # Kataloggescopte interne Control-Referenzen
│   ├── referenceResolution.ts    # Fail-closed OSCAL-Referenzauflösung auf source
│   ├── referenceGraph.ts         # Referenzgraph über alle vier Root-Typen (Stufe 5)
│   ├── referenceGraphModel.ts    # Knoten, Kanten, Zustände, Diagnostic-Codes
│   ├── referenceGraphIndex.ts    # Knotenindex je Dokument aus dem Quellgraphen
│   ├── referenceGraphContext.ts  # Auswertungskontext und Kantenablage
│   ├── referenceGraphEdges.ts    # Kanten für Profile, Mappings, Components
│   ├── referenceGraphPolicy.ts   # CI-Politik: fail-closed, Allowlist, Bericht
│   └── controlRelationships.ts   # Steuerungsbeziehungen
├── adapters/         # Infrastruktur- und Datengrenzen
│   ├── oscalAdapter.ts           # OSCAL → Domain Model Parser
│   └── browserDownload.ts        # Temporärer Browser-Download mit Cleanup
├── state/            # Globaler Anwendungszustand
│   └── CatalogContext.tsx        # Katalog-Kontextprovider
├── hooks/            # Wiederverwendbare React Hooks
│   ├── useCatalog.ts             # Katalog-Daten
│   ├── useFilteredControls.ts    # Filterlogik
│   ├── useFilterParams.ts        # URL-Parameter-Sync
│   ├── useControlNavigation.ts   # Kataloggescopte Detailnavigation
│   ├── useControlSelection.ts    # Katalog-/Gruppen-gescopte Auswahl
│   ├── useActiveVocabulary.ts    # Katalog-/Control-gescopte Vokabularkarte
│   ├── useGuidanceOverflow.ts    # Scopegebundener Guidance-/Messzustand
│   ├── useFocusTrap.ts           # Barrierefreiheit
│   ├── useGlobalEventListener.ts # Globale Listener mit stabilem Cleanup
│   ├── useScrollLock.ts          # Reversibler Body-Scroll-Lock
│   └── useMediaQuery.ts          # Responsive Design
├── features/         # Feature-Module (Seite + Komponenten)
│   ├── home/
│   ├── catalog/
│   ├── vocabularies/             # Vokabular-Seiten
│   ├── vocabulary/               # Vokabular-Anzeige-Helpers (display.ts, routes.ts)
│   ├── search/
│   ├── export/                   # CSV-Export
│   └── pages/                    # About, Impressum, Datenschutz, Lizenzen
├── components/       # Wiederverwendbare UI-Komponenten
│   ├── HeaderBar.tsx
│   ├── Footer.tsx
│   ├── TreeNav.tsx
│   ├── FilterSection.tsx
│   ├── StatusMeta.tsx
│   └── ...
├── app/              # Anwendungshell
│   ├── AppShell.tsx              # Routing-Konfiguration und Layoutrahmen
│   ├── PageTitle.tsx             # Deklarativer Routentitel (hebt <title> in den <head>)
│   ├── pageTitles.ts             # Feste Seitentitel als einzige Quelle der Wahrheit
│   ├── staticPageRoutes.tsx      # Statische Routen samt deklariertem Titel
│   ├── staticTitleFallback.ts    # Entfernt den markierten index.html-Titel
│   └── routes.ts                 # Kanonische URL-Builder und Resolver
└── main.tsx          # Einstiegspunkt

public/data/          # Generierte Katalog-Daten (nicht im Repo)
scripts/              # Build-Skripte
  ├── fetch-catalog.mjs           # Registry-gesteuerter Abruf, Validierung und Ausgabe
  ├── security-guards.mjs         # Upstream-Allowlist (Repo, Pfade, Refs)
  ├── upstream-artifacts.mjs      # Tree-Diff, Manifest v2 und Root-Prüfung
  ├── vocabulary-utils.mjs        # CSV-/Namespace-Hilfsfunktionen
  ├── catalog-sync-guard.mjs      # Fail-closed Prüfung von Sync-PRs
  ├── catalog-sync-policy.mjs     # Prüfung der Repository-Policy
  ├── sync-upstream-manifest.mjs  # Manifest-Sync für update-catalog.yml
  ├── verify-catalog-deploy.mjs   # Post-Merge-Deploy bestätigen oder Fallback freigeben
  ├── check-deploy-idempotency.mjs # Redundanten Fallback-Deploy desselben Commits verhindern
  ├── verify-node-version.mjs     # .nvmrc gegen engines.node und gegen Versionsliterale prüfen
  └── workflowDefinitions.mjs     # Gemeinsame Sammlung der Workflow- und Action-Definitionen

upstream-manifest.json            # Gepinnter Upstream-Snapshot (Manifest v2)

.github/workflows/
  ├── deploy.yml                  # GitHub Pages Deployment
  ├── ci.yml                      # PR-Metadatenverträge (documentation-contract, catalog-sync-guard)
  ├── validate.yml                # Vollständige Verifikations- und Build-Lane (validate, sonarqube)
  ├── sonar.yml                   # SonarQube-Analyse des Push-Pfads auf main und develop
  ├── update-catalog.yml          # Automatischer Katalog-Sync
  └── verify-catalog-merge.yml    # Post-Merge-Prüfung und Deploy-Fallback

.github/actions/
  ├── setup-node-env/             # Node aus .nvmrc plus npm ci --ignore-scripts
  └── fetch-pinned-catalog/       # Gepinnte Snapshot-SHA lesen und Katalog holen

.nvmrc                            # Einzige Quelle der Node-Version (gegen engines.node geprüft)
```

## Datenfluss

```
BSI GitHub Repository
(BSI-Bund/Stand-der-Technik-Bibliothek)
  • OSCAL-Artefakte verschiedener Root-Typen
  • alle direkten CSVs der registrierten Namespace-Collection
  • vollständige Read-only-Trees der überwachten Upstream-Wurzeln
        │
        ▼
npm run fetch-catalog → scripts/fetch-catalog.mjs
• Abruf über die GitHub-API mit Retry bei transienten Fehlern
• Snapshot-Pinning: BSI_SNAPSHOT_SHA aus upstream-manifest.json
• sourceRegistry: einzige Ingestion-Quelle für Pfad, Root-Typ, Lifecycle und
  erwartete oscal-version je Artefakt
• oscalVersionMatrix: fail-closed Schemaauswahl über Root-Typ × oscal-version;
  fehlende, nicht gepinnte oder unmögliche Version bricht den Lauf ab
• Security-Guards: nur erlaubtes Repo, erlaubte Hosts, Pfade und Refs
• registrierte preview-/draft-Artefakte werden transient geprüft, nicht ausgeliefert
• catalogLineage.mjs projiziert für registrierte Profile die belegte Kette
  Import-Fragment → back-matter.resource → exakter rlinks.href → Registry-Artefakt
• jeder supported Katalog und die direkten Namespace-CSVs → JSON + Provenance
• Manifest v2 bindet Registry-Metadaten, Git-Blob-SHA und Content-SHA-256
• Korpus-Cache (gitignoriert, `.cache/upstream-corpus/` + Begleitmanifest)
  versorgt den Bauzeitlauf der Profile Resolution mit den Lineage-Dokumenten
  (Profile sowie Quell- und Anwenderkataloge); die Korpus-Suite prüft die
  Vollständigkeit hart gegen das Begleitmanifest
        │
        ▼
public/data/  (Dateimenge aus dem Quellregister abgeleitet)
• catalog.json                    (Einstiegskatalog, OSCAL-JSON)
• catalog-metadata.json           (Provenance + Integrity des Einstiegs)
• catalog-<catalogKey>.json       (je weiterem supported Katalog)
• catalog-<catalogKey>-metadata.json
• vocabularies.json               (Offizielle BSI-Vokabulare)
• upstream-sources-metadata.json  (Vokabular-Provenance + Manifest v2 + Lineage-Projektion)
        │
        ▼
Profile Resolution (deterministisch)
• Plan: Importgraph (Zyklus/Versions/Root-Prüfungen) → DAG-sichere Postorder
• Selektion je Import, danach Merge (combine use-first/keep, flat/as-is/custom
  mit insert-controls/order) und Modify (set-parameter, alters) in der
  Reihenfolge Import → Merge → Modify
• Ergebnis ausschließlich über `createOscalDerivedGraph()`; laufendes
  Arbeits- und Ausgabebudget mit monotonen Zählern und Prüfung VOR Operation
  und Allokation (siehe unten)
• jedes Zwischen- und Endergebnis durchläuft fail-closed dieselbe Objekt-,
  Root-, Versions- und Schema-Pipeline wie lokale Klasse-2-Dokumente
• Orakel: BSI- und NIST-Referenzdokumente plus synthetische Fixtures
  (`scripts/profileResolutionCorpusOracle.ts`, `profileResolutionNistOracle`-Tests)
        │
        ▼
CatalogContext (Einstiegskatalog eager, weitere bedarfsgerecht)
├─ Katalog: loadCatalogArtifacts()
│  • fetchCatalogBuffer()    → ArrayBuffer
│  • verifyArtifactIntegrity() → VerificationResult
│  • parseCatalogInWorker()  → CatalogDocument { source, context, view }
│                               source = unveränderter Quellgraph,
│                               view   = kataloggescopter, angereicherter Catalog
│  • catalogReferenceProjection.ts projiziert aufgelöste, kataloggescopte
│    Ziele in Control.links der View; der Quellbaum wird dafür nur einmal
│    indiziert. Der Resolver führt kein I/O aus.
└─ Vokabulare: fetchCatalogWithBuffer() → { buffer, text }
   • buildVocabularyRegistry()
   • fetchVocabularyProvenance() + verifyArtifactIntegrity()
        │
        ▼
Feature-Komponenten und Hooks
• useFilteredControls()      → gefilterte Steuerungen
• useSearch()                → FlexSearch-Volltextsuche mit kataloggescoptem LRU-Cache
                               (`MAX_SEARCH_CACHE_ENTRIES = 3`) plus exaktem
                               Kennungsindex im selben Cache-Eintrag (siehe docs/FILTERING.md)
• resolveControlVocabularies() → Vokabular-Auflösung
```

### Klasse-2-OSCAL-Eingang

Lokale Klasse-2-Dokumente benutzen den Katalogfluss nicht. `src/adapters/oscalImportGate.ts` ist ihr einziger Anwendungseinstieg: Er kopiert `ArrayBuffer` oder `Uint8Array` nur für die Übertragung und startet `src/workers/oscalImport.worker.ts` als Modul-Worker. Der Main-Thread dekodiert, parst oder interpretiert die Bytes nicht.

Nach der Größenkontrolle läuft im Worker die feste Reihenfolge aus dem [OSCAL-Validierungsvertrag](./OSCAL_VALIDATION.md): Bytelimit, fataler UTF-8-Decoder, Duplicate-Member-Scanner, `JSON.parse` — und ab dort die gemeinsame objektorientierte Prüfkette (`src/domain/oscalObjectPipeline.ts`) mit Stufen aus Herkunfts-, Struktur-, Tiefen-, Knoten- und Base64-Durchlauf sowie Stufe 3 als Schema-Validierung. Das Bytelimit greift bereits vor Worker-Erzeugung und Transferkopie. Das Ergebnis ist entweder ein vollständiger Root-Envelope mit explizitem `class-2-local-user`-Kontext oder genau eine redigierte Diagnose. Der Worker führt keine Dateisystem-, Telemetrie- oder URL-Operation aus; sein einziger Netzbezug ist der Modulabruf des Schema-Chunks derselben Origin (siehe unten). Nach seiner Antwort beendet ihn der Adapter; bleibt eine Antwort aus, beendet der Adapter ihn nach 30 Sekunden (`CLASS_2_IMPORT_WORKER_TIMEOUT_MS = 30_000`) fail-closed mit einer redigierten Worker-Diagnose.

Stufe 3 prüft mit `ajv` 8.20.0 gegen das gepinnte NIST-Schema der von Stufe 2 gewählten Matrixzelle. Die Schemabytes liegen eingecheckt unter `schemas/oscal/` und werden über `src/domain/oscalSchemaBundle.ts` je Zelle in einen eigenen Chunk gebaut. Zur Laufzeit lädt der Worker genau einen davon nach — den der ausgewählten Zelle, als Modul **derselben Origin** wie die Anwendung. Weder das Release-Asset auf `github.com` noch die `$id`-Domain `csrc.nist.gov` wird angefragt; ein Browsertest prüft das über das Egress-Orakel. Vite baut den Modul-Worker über `worker.format: 'es'` als ES-Modul, damit nicht alle Schemas in einer Worker-Datei liegen.

Dieser Einstieg liefert weder Dateiauswahl noch Persistenz, UI oder Renderer. Er ändert weder den Klasse-1-Katalogladepfad noch dessen Integritätskette.

Wohin ein importiertes Klasse-2-Dokument gespeichert wird, sobald Persistenz entsteht, legt der [Persistenzvertrag](./PERSISTENCE.md) fest: eine eigene IndexedDB-Datenbank `gspp-workspace`, in der Klasse 1 **keinen** Store besitzt. Der Arbeitsbereich hält allenfalls einen `artifactKey`-Verweis. Speicherschlüssel, Envelope, Versionsführung, Referenzbindung, Migration, Export und Löschung sind dort verbindlich beschrieben.

Der separate Sync-Pfad (`scripts/sync-upstream-manifest.mjs` mit `scripts/upstream-artifacts.mjs`) vergleicht die vollständigen normalisierten Trees des bisherigen und des neuen Snapshots. Neue nicht registrierte Pfade werden als `unclassified` gemeldet, ohne ihren Blob zu fetchen oder sie auszuliefern.

### Laufendes Budget der Profile Resolution

Die abschließende Objektprüfung sieht nur das fertige Ergebnis — weder verbrauchte Arbeit noch aufgebauten Zwischenzustand. Für eine von einem lokalen Klasse-2-Dokument gesteuerte Ableitung läuft deshalb zusätzlich ein Budget während der Ableitung. Umgesetzt in `src/domain/profileResolutionBudget.ts`.

**Eigentum.** Genau eine Budgetinstanz je Lauf, nach unten durchgereicht. Kein Modulzustand, kein globaler Zähler, keine Wiederverwendung über Läufe. Die öffentliche Signatur trägt weder einen Grenzwert- noch einen Disable-Parameter.

**Zwei Achsen.** Das Ausgabebudget zählt **kumulativ erzeugte** Knoten — emittierte Ausgabeknoten und die Container des Zwischenzustands, den Merge und Modify vor der Emission anlegen —, die größte je begonnene Tiefe und die kumulative `base64`-Größe. Container heißt Objekt **und** Liste. Nicht gebucht werden die kurzlebigen Lesekopien der Traversierung — sie stehen auf der Arbeitsachse, wo derselbe Aufruf die Elementzahl vorab bucht. Entfernen senkt keinen Zähler. Das Arbeitsbudget zählt deterministische Schritte, keine Wall-Clock-Zeit. Der geschlossene Satz der sechs Kategorien (`import-edge`, `selector-compare`, `glob-state`, `merge-step`, `alter-target-lookup`, `alter-candidate`) deckt jede potenziell wachsende Operation in Selektion, Merge, Modify und Emission ab. Die Grenze gilt über die **Summe** aller Kategorien; `usage().workUnitsByCategory` schlüsselt sie zusätzlich auf.

**Unveränderliche Produktionsgrenzen.** Die Arbeitsgrenze steht als `WORK_UNIT_LIMIT` in `src/domain/profileResolutionBudgetLimits.mjs`. Die Ausgabegrenzen sind dieselben Werte, die die Postcondition prüft, und kommen unverändert aus `CLASS_2_IMPORT_LIMITS`. Der Wert der Arbeitsgrenze wird bei jedem Lauf aus dem committeten Messartefakt hergeleitet; Zahlen, Herleitung und Messprotokoll stehen im [OSCAL-Validierungsvertrag](./OSCAL_VALIDATION.md).

**Abbruchfluss.** Die Zählmethoden werfen; der Wurf verlässt den Lauf an genau einer Fangstelle. Dort wird ein Budgetabbruch zu seiner bereits redigierten Diagnose und jede andere Ausnahme zu einem redigierten Projektfehler ohne Rohtext und ohne Stapel. Weder ein Teilergebnis noch ein Builder-Handle verlässt den Lauf.

**Zwei Vertrauensklassen, getrennt geführt.** `trustClass` ist unveränderlich `class-2-local-user`, `controllingTrustClass` ist die Klasse des **steuernden** Profils. Sie steuert keinen Grenzwert; das Budget läuft in jedem Lauf identisch. Bei ausschließlich Klasse-1-Eingaben ist das Budget ein Reliability-Hardstop, bei einem lokalen Klasse-2-Steuerdokument die Sicherheitskontrolle.

## Zustandsverwaltung

Die Anwendung verwendet React Context für den globalen Zustand:

### CatalogContext (`src/state/CatalogContext.tsx`)

Zentraler Provider, der eine **Katalogsammlung** hält. Der Einstiegskatalog aus dem Quellregister wird beim Mounten geladen; jeder weitere ausgelieferte Katalog erst, wenn eine Route ihn auswählt.

Sammlungsbezogene Felder:

- `catalogs` — `ReadonlyMap<CatalogKey, LoadedCatalogState>` aller angeforderten Kataloge. Jeder Eintrag trägt sein eigenes Dokument, seine eigene Provenance, sein eigenes Verifikationsergebnis und seinen eigenen Fehlerzustand.
- `entryCatalogKey` — der ausgezeichnete Einstiegskatalog
- `activeCatalogKey` — der aktuell ausgewählte Katalog
- `selectCatalog(catalogKey)` — wählt einen ausgelieferten Katalog aus und stößt ihn bei Bedarf an. `AppShell` ruft das aus dem Routen-`catalogKey` auf.

Projektionen des **aktiven** Katalogs:

- `catalogDocument` — Katalogdokument mit unverändertem Quellgraph (`source`), explizitem Ableitungskontext (`context`) und Projektion (`view`). Siehe [DOMAIN_MODELS.md](./DOMAIN_MODELS.md).
- `catalog` — angereicherter Katalog (Practices, Topics, Controls); identisch mit `catalogDocument.view`
- `provenance` — Provenance-Metadaten vom Build-Zeitpunkt
- `verification` — Integritätsprüfungsergebnis
- `vocabularyRegistry` — Registry der offiziellen BSI-Vokabulare
- `vocabularyProvenance` — Vocabulary Provenance Metadaten
- `vocabularyVerification` — Vocabulary Integritätsprüfung
- `loading` — Ladezustand
- `error` — Fehlermeldung

### Startup-Parsing im Modul-Worker

Nach der Hashprüfung überträgt `catalogArtifacts.ts` den `ArrayBuffer` per Transfer (ohne Kopie) an den Parser-Worker. Dort dekodiert und parst der Worker den Katalog, führt Root-Dispatch und Link-Projektion aus und gibt das strukturklonbare `CatalogDocument` zurück. Angenommen wird eine Antwort nur, wenn Request-ID, `catalogKey` und Vertrauensklasse zur Anfrage passen. Parse- und Root-Type-Fehler bleiben als verständlicher Ladefehler am betroffenen Katalog sichtbar. Nur ohne `Worker`-API bleibt der gleiche Parser als Fallback im Main Thread. Kann ein vorhandener Worker nicht starten oder fehlschlägt er, bleibt dies ein sichtbarer Katalog-Ladefehler; nach dem Transfer gibt es keinen stillen Main-Thread-Fallback.

## Anwenderkataloge sind fachlich getrennt

Die App liefert mehrere BSI-Anwenderkataloge aus. Jeder ist ein **eigenständiges OSCAL-Dokument** mit eigener `uuid`. Ausgeliefert wird, was im Quellregister `lifecycle: 'supported'` trägt.

Daraus folgen vier Regeln, die der gesamte Katalogpfad einhält:

**1. Gleiche Control-IDs sind erwartbar, nicht fehlerhaft.** `control/@id` ist nur innerhalb seines Katalogs eindeutig. Zwei aufgelöste Kataloge aus demselben Quellbestand teilen sich deshalb regelmäßig Control-IDs — am gepinnten Snapshot kollidieren 82 der 83 Controls des Lieferkettenkatalogs mit dem Grundschutz++-Katalog (Ausnahme: `KONF.2.4.2`). Eine Kollision wird **nie** als Fehler gemeldet. Unterschieden wird ausschließlich über den `catalogKey`: Lookups laufen über `ControlRef = { catalogKey, controlId }` (`src/domain/controlRef.ts`), jeder Katalog hält seine eigene `controlsById`-Map, und es findet keine Zusammenführung oder katalogübergreifende Verlinkung statt.

**2. Keine gemeinsamen Props oder Taxonomien.** Der vorgefundene `ns` wird unverändert übernommen — einschließlich seines Fehlens; es wird kein projekteigener Namensraum vergeben und kein fremder normalisiert. Der Lieferkettenkatalog führt auf Controls nur `alt-identifier` (ohne `ns`), `sec_level`, `effort_level` und `tags`. Die Schutzziel-Props (`confidentiality`, `integrity`, `availability`, `authenticity`), `threats` und `label` fehlen dort vollständig und werden weder angezeigt noch als fehlend bemängelt.

Der WLAN-Katalog ergänzt auf jedem Control die offenen Props `Taxonomy-L1` bis `Taxonomy-L4`. Der Adapter projiziert ausschließlich diese exakten Namen in Ebenenreihenfolge und erhält `name`, `value` und den optionalen Originalwert von `ns`. Der vorgefundene Placeholder-Namensraum trägt kein Verhalten, und `Taxonomy-Mapping-Rationale` wird nicht als zusätzliche Ebene erfunden.

**3. Referenzen bleiben Daten bis zur bewussten Navigation.** Der originale `link.rel`-Wert wird erhalten; `reference` ist der einzige im Catalog-Modell dokumentierte Wert, offene Tokens wie `related` bleiben als benutzerdefiniert sichtbar. Externe `resource.rlinks[].href` sind nur bei einer syntaktisch gültigen absoluten HTTPS-URL klickbar. Der Resolver führt kein I/O aus. Ohne deklarierten `media-type` gibt es weder Vorschau noch Content-Sniffing; Dateiendungen sind keine Medienaussage.

**4. Optionale Identifikatoren erzwingen kein Routing.** `group.id` ist in OSCAL 1.1.3 optional, `part` verlangt nur `name`, und ein Katalog ganz ohne `groups` und `controls` ist schema-valide. Eine Gruppe ohne `id` bleibt vollständig sichtbar, ist aber **nicht adressierbar**: sie erzeugt weder Route noch Anker, und ein aktiver Gruppen- oder Praktik-Filter trifft sie nie. Ein leerer Katalog erzeugt einen Empty State, keinen Fehler — der Empty State gilt aber nur, wenn **weder** `groups` **noch** `controls` vorhanden sind. `catalog.controls` steht im Schema gleichberechtigt neben `groups`; solche Root-Controls gehören zu keiner Gruppe, werden ohne `groupId` und `practiceId` geführt und bleiben über ihren kanonischen `altIdentifier` adressierbar.

Die Vokabular-Membership wird aus **allen** ausgelieferten Katalogen abgeleitet (`scripts/fetch-catalog.mjs`); alle Namensräume stammen aus demselben Snapshot und durchlaufen dieselbe Hash-Prüfung. Die Topic- und Practice-Coverage-Baselines (`scripts/taxonomy-coverage.mjs`) bleiben auf den Einstiegskatalog bezogen: Sie fordern `orphanCsvEntryCount === 0`. Für einen Teilmengenkatalog wie Lieferkettensicherheit ist diese Bedingung strukturell nicht erfüllbar, weil er nur einen Teil der Themen nutzt.

## Routing

Die Anwendung verwendet React Router mit `BrowserRouter` und pfadbasierten URLs. Das `basename` wird aus `import.meta.env.BASE_URL` abgeleitet (`src/main.tsx`), sodass die App auch unter dem GitHub-Pages-Unterpfad `/Grundschutz-Navigator/` funktioniert.

Für kanonische Einstiegsrouten erzeugt das Vite-Plugin `github-pages-spa-fallback` (`vite.config.ts`) beim Build zusätzlich zu `404.html` je Route ein statisches `dist/<route>/index.html`, bytegleich zum gebauten `index.html`. GitHub Pages liefert diese Dokumente mit HTTP 200 aus; die Routen kommen ausschließlich aus dem gemeinsamen Vertrag `listCanonicalEntryRoutes()` — den sechs festen Inhaltsrouten (`/suche`, `/vokabular`, `/about`, `/datenschutz`, `/impressum`, `/lizenzen`) plus je einem Einstieg `/katalog/<catalogKey>` für jeden von `listSupportedCatalogs()` im Quellregister (`src/domain/sourceRegistry.mjs`) als `supported` geführten Katalog. Das absichtlich ungültige `/katalog`, der Redirect `/mehr`, parametrisierte Gruppen-, Control- und Vokabular-Detailrouten sowie Query-/Filter-URLs werden nicht materialisiert. Für alle übrigen Pfade dient `dist/404.html` als Fallback.

### Sitemap

Beim Build entsteht deterministisch eine UTF-8-kodierte `dist/sitemap.xml` mit XML-Deklaration und dem Namespace `http://www.sitemaps.org/schemas/sitemap/0.9`. Sie enthält genau einmal die absolute kanonische URL der Startseite, der sechs festen Inhaltsrouten und jedes von `listSupportedCatalogs()` gelieferten Katalogeinstiegs — dieselbe Positivliste wie die statischen 200-Einstiege, gebildet aus demselben Vertrag `listCanonicalEntryRoutes()`. Origin (`https://dfurater.github.io`) und Basispfad (`/Grundschutz-Navigator/`) sind die Production-Defaults des Buildvertrags; XML-Sonderzeichen werden escaped. Geschrieben werden ausschließlich die Pflichtfelder `urlset`, `url` und `loc`. Die manuelle Einreichung in der Search Console liegt beim Projekt-Owner und ist kein Teil des Builds.

| Route | Komponente | Beschreibung |
|-------|------------|--------------|
| `/` | HomePage | Startseite |
| `/katalog/:catalogKey` | CatalogBrowser | Katalog-Browser (Liste + Detail) |
| `/katalog/:catalogKey/:groupId` | CatalogBrowser | Practice- oder Topic-Auswahl im Katalog |
| `/katalog/:catalogKey/kontrolle/:altIdentifier` | CatalogBrowser | Kanonische Control-Detailroute |
| `/suche` | SearchPage | Volltextsuche |
| `/vokabular` | VocabularyOverviewPage | Vokabular-Übersicht |
| `/vokabular/:namespaceId` | VocabularyNamespacePage | Vokabular-Namensraum |
| `/about` | AboutPage | Über das Projekt (inkl. Provenance/Integrität) |
| `/datenschutz` | DatenschutzPage | Datenschutzerklärung |
| `/impressum` | ImpressumPage | Impressum |
| `/lizenzen` | LizenzenPage | Lizenzen |
| `/mehr` | — | Redirect auf `/about` |
| `*` | — | 404-Seite |

## Katalog-Browser-Grenzen

`src/features/catalog/CatalogBrowser.tsx` ist der Composer des Katalog-Browsers. Er bindet Router, Katalog- und Filterzustand aneinander, bestimmt den Practice-/Topic-Scope, hält Breakpoint- und Panelbreitenzustand und komponiert Liste, Toolbar und Seitenleisten. Direkte CSV-Downloads und imperative Zugriffe auf `document.body` gehören nicht zu dieser Grenze.

Breakpoint-abhängige UI wird über `useMediaQuery('(min-width: 1024px)')` (`isDesktop`) bedingt **gemountet**, nicht per CSS versteckt — zu jedem Zeitpunkt ist nur der passende Teilbaum im DOM. Zwei Ausnahmen: Der `CatalogMobileDetailOverlay` behält sein `active`-Prop-Muster, weil er inaktiv `null` rendert und seinen Modal-Lifecycle (Focus-Trap, Scroll-Lock, Escape) selbst besitzt; kleine stateless Buttons dürfen bei `lg:hidden` bleiben, da sie keinen schweren Teilbaum doppelt mounten.

| Baustein | Verantwortung |
|----------|----------------|
| `useControlNavigation` | Löst Control-Route, Scope und Not-found-Zustand auf und erhält Push-/Replace-Semantik sowie Query-Parameter. Routerwerte und `NavigateFunction` werden injiziert; der Hook verwendet keine Router-Hooks. |
| `useControlSelection` | Verwaltet die markierten Control-IDs. Der Hook ist scope-agnostisch: Er liefert synchron eine leere Auswahl, sobald sich der von außen übergebene `scopeId`-Wert ändert. `CatalogBrowser` übergibt dafür ausschließlich den `catalogKey`, sodass die Auswahl bei Themen-/Practice-Navigation und Cross-Referenz-Sprüngen innerhalb desselben Katalogs erhalten bleibt und nur bei einem echten Katalogwechsel geleert wird. |
| `CatalogToolbar` | Stellt Titel, Counts, Auswahlmodus sowie Filter- und Exportzugänge aus Props zusammen und mountet Filter-Sheet, Export-Menü und Export-Sheet breakpoint-conditional über `isDesktop`. |
| `CatalogExportMenu` | Besitzt den Desktop-Menüzustand, Outside-Click, Escape, Autofokus und die Desktop-Exportaktionen. Das Mount-Gate liegt beim Aufrufer (`isDesktop`). |
| `CatalogMobileFilterSheet` | Besitzt Trigger, Sichtbarkeit, Focus-Trap, Escape, Backdrop, Drag-Dismiss und Scroll-Lock des mobilen Filters. |
| `CatalogMobileExportSheet` | Besitzt Trigger, Sichtbarkeit, Focus-Trap, Escape, Backdrop, Scroll-Lock und mobile Exportaktionen. |
| `CatalogMobileSelectionBar` | Exportiert die mobile Auswahl und beendet anschließend den Auswahlmodus. |
| `CatalogDesktopSidebar` | Kapselt Filter-/Detaildarstellung und die veränderbare Desktop-Panelbreite; der Breitenzustand bleibt beim Composer. |
| `CatalogDetailPanel` | Baut eingehende Links und Parent-/Child-Beziehungen auf und versorgt `ControlDetail`. |
| `CatalogMobileDetailOverlay` | Besitzt Focus-Trap, Escape und Scroll-Lock des mobilen Details. Bleibt als Komponente gemountet und steuert Sichtbarkeit über das `active`-Flag; inaktiv rendert sie `null` (dokumentierte Ausnahme der Breakpoint-Mount-Strategie). |

`useScrollLock` speichert keinen globalen Refcount, sondern stellt beim Cleanup exakt den vorherigen Inline-Wert von `body.style.overflow` wieder her.

CSV-Serialisierung und Browserauslösung sind getrennte Grenzen: `features/export/csvExport.ts` erzeugt Inhalt und `Blob`; `adapters/browserDownload.ts` erstellt den temporären Link und widerruft Link und Object-URL auch bei Fehlern in `finally`.

ESLint sichert diese Architektur statisch ab: `CatalogBrowser` darf weder den CSV-Exporter noch den Beziehungsgraphen importieren, direkter `document.body`-Zugriff ist in App-, Komponenten- und Feature-Code ein Fehler, imperative Event-Listener und Dateien über 300 physische Zeilen werden als Warnungen ausgewiesen. `useGlobalEventListener` bündelt globale Window- und Document-Listener und garantiert symmetrischen Abbau beim Deaktivieren oder Unmount.

## Control-Detail-Grenzen

`src/features/catalog/ControlDetail.tsx` ist der Composer der Kontrollansicht und der einzige `useCatalog`-Aufrufer dieses Teilbaums. Er bestimmt den Scope `${catalogKey}:${control.id}`, löst Vokabulare memoisiert auf und komponiert die Sektionen in fachlicher Reihenfolge. Router-gebundene `VocabularyEntryCard`-Ausgabe bleibt an dieser Grenze: Die Sektionen erhalten einen stabilen Render-Callback und sind dadurch ohne Router oder Katalogprovider isoliert testbar.

| Baustein | Verantwortung |
|----------|----------------|
| `useActiveVocabulary` | Hält höchstens eine Vokabularkarte offen und setzt den Zustand bei Katalog- oder Control-Wechsel synchron zurück. |
| `useGuidanceOverflow` | Besitzt Expansion, Overflow-Messung, `ResizeObserver`, Window-Fallback und symmetrisches Listener-/Observer-Cleanup. |
| `ControlClassification` | Rendert Kriterien und bindet `ControlTaxonomy` ein. |
| `ControlTaxonomy` | Rendert Tags und Zielobjektkategorien einschließlich optionaler Vokabularinteraktion. |
| `ControlSecurityContext` | Rendert die Sektion „Schutzziele und Gefährdungen". |
| `ControlSecurityTargets` | Rendert die vier Schutzziele als Tabelle mit zweistufiger Relevanz-Skala. |
| `ControlStatement` | Rendert den Anforderungstext. |
| `ControlStatementDetails` | Rendert Ergebnis, Präzisierung, Handlungswort und Dokumentation. |
| `ControlGuidance` | Rendert die bei Bedarf aufklappbare Guidance; Messung und State liegen im Hook. |
| `ControlDependencies` | Rendert ausschließlich aufgelöste interne Control-Beziehungen. |
| `ControlSources` | Rendert aufgelöste `back-matter`-, externe und nicht auflösbare Quellen getrennt von Abhängigkeiten. |
| `ControlHierarchy` | Rendert aufgelösten Parent und Erweiterungen. |
| `ControlMetadata` | Rendert UUID und den Parent-ID-Fallback. |

Die Sektionsmodule erhalten ausschließlich benötigte Controls, aufgelöste Vokabularwerte und Callbacks. Sie verwenden weder Katalog-, Router- noch Filterkontext.

## Suchseiten-Grenzen

`src/features/search/SearchPage.tsx` ist der Composer der Volltextsuche (`/suche?q=…`). Er bindet `useSearch`, die 50er-Pagination und dieselben Desktop-/Mobile-Präsentationskomponenten wie der Katalog-Browser ein, hält dafür aber eine eigene, unabhängige Auswahl- und Export-Grenze. Die Ergebnislisten folgen derselben Breakpoint-Mount-Strategie wie der Katalog-Browser: genau eine gemountete Liste je Breakpoint.

| Baustein | Verantwortung |
|----------|----------------|
| `useControlSelection` | Läuft mit dem Scope `search:<catalogKey>:<query>` — unabhängig vom Katalog-Browser-Scope (`catalogKey` allein). Jede Änderung von `q` liefert synchron eine leere Auswahl. |
| `resultsUiState` | Führt `sort`, `visibleResultCount` und `mobileSelectMode` gemeinsam query-gebunden; ein Query-Wechsel setzt sie synchron zurück. |
| `SearchResultsToolbar` | Auswahlanzahl/Aufheben, mobiler Auswahlmodus-Toggle sowie die wiederverwendeten Export-Komponenten, beide über die Prop `isDesktop` bedingt gemountet. Kein Filter-Zugang. |
| `ControlTable`s `selectableControls` | Optionale Prop, die ausschließlich die Header-Aktion „Alle auswählen" bestimmt; Standard bleibt `controls`. `SearchPage` übergibt die gerenderte Seite als `controls`, aber alle sortierten Query-Treffer als `selectableControls`. |
| `CatalogMobileSelectionBar` | Unverändert wiederverwendet; `SearchPage` rendert sie selbst im mobilen Auswahlmodus und beendet Modus und Auswahl nach Export oder „Fertig". |

Export-Dateinamen sind fest: Query-Treffer heißen `grundschutz-suchergebnisse.csv` (Desktop in aktueller Tabellensortierung, Mobile in Suchrelevanzreihenfolge), Auswahl heißt `grundschutz-auswahl.csv`, der Gesamtkatalogexport bleibt `grundschutz-gesamtkatalog.csv`. Der Suchbegriff selbst fließt nie in Dateiname, Log oder zusätzlichen Speicher ein.

### Suchindex-Cache

`useSearch` baut je Katalog fünf FlexSearch-Indizes (`controlIds`, `titles`, `links`, `metadata`, `content`) aus den normalisierten Suchdokumenten. Der Aufbau ist im Production-Build teuer genug, um das Frame-Budget zu sprengen und einen Long Task auszulösen.

Weil ein komponentenlokaler Cache die Indizes beim Unmount der `SearchPage` verwerfen und für unveränderte Eingaben neu aufbauen würde, hält `useSearch` einen **kataloggescopten, begrenzten LRU-Cache** (`MAX_SEARCH_CACHE_ENTRIES = 3`):

* Schlüssel: stabiler `catalogKey` plus Objektidentität von `controls`, `practices` und `vocabularyRegistry`. Die Frischeprüfung (`isFreshCacheEntry`) vergleicht diese drei Referenzen, nicht die Array-Länge.
* Begrenzung: LRU mit fester Obergrenze (3 = Anzahl `supported`-Kataloge). Überschreitet der Cache die Grenze, wird der älteste Eintrag verworfen. Die Einfügereihenfolge wird beim Rebuild via `delete`+`set` aufgefrischt.
* `SearchPage` übergibt `catalog?.catalogKey` explizit an `useSearch`. Leere Controls oder fehlender `catalogKey` (transienter Ladezustand) legen keinen Cache-Eintrag an und belegen kein LRU-Budget.
* Mutationen des Modul-Caches laufen ausschließlich in einem `useEffect` (Commit-Phase), nicht in `useMemo`/Render.

Der Cache liegt als Modul-eigenes `Map<string, SearchCacheEntry>` in `src/features/search/useSearch.ts` (`clearSearchCache`, `getSearchCacheSize`, `getSearchCacheKeys`, `getSearchCacheEntry` für Tests) und ist strikt UI-seitig — kein zusätzlicher Speicher im `CatalogContext` und kein Persistenz- oder Netzwerkzugriff.

## Filter-System

Filter werden bidirektional mit URL-Suchparametern synchronisiert (`src/hooks/useFilterParams.ts`):

- `sl` — Sicherheitsniveau (`normal-SdT`, `erhöht`)
- `el` — Aufwandsstufe (0–5)
- `mv` — Modalverb (MUSS, SOLLTE, KANN)
- `tags` — Tags
- `zk` — Zielobjekt-Kategorien
- `hw` — Handlungswort
- `dt` — Dokumentationstyp
- `lr` — Link-Beziehungen (`related`, `required`)
- `sort` — Sortierfeld + Richtung

Die Volltextsuche ist eine eigene Route (`/suche?q=…`) und kein Filter des Katalog-Browsers. Practice- und Topic-Auswahl laufen über die kataloggescopte Route (`/katalog/:catalogKey/:groupId`), nicht über Query-Parameter. Die kanonische Control-URL verwendet ausschließlich `catalogKey + altIdentifier`. Unbekannte oder nicht geladene Katalogschlüssel und unbekannte Alt-Identifier führen ohne globalen Fallback, Control-ID-Auflösung, Redirect oder Legacy-Route zur Not-found-Ansicht.

Siehe [FILTERING.md](./FILTERING.md) für Details.

## Integritätsprüfung

Jeder ausgelieferte Katalog und `vocabularies.json` werden zum Build-Zeitpunkt mit einem eigenen SHA-256-Hash versehen. Zur Laufzeit wird der Hash je Artefakt erneut berechnet und mit **dessen eigenen** Metadaten verglichen. Abweichungen werden in der UI angezeigt und bleiben auf das betroffene Artefakt beschränkt.

Siehe [INTEGRITY.md](./INTEGRITY.md) für Details.

## Content Security Policy

GitHub Pages erlaubt in diesem Setup keine projektspezifischen HTTP-Security-Header. Die Produktionsanwendung setzt deshalb eine Meta-CSP in `index.html`:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';
```

Die Policy begrenzt Skripte, Datenabrufe, Bilder und Schriften auf die ausgelieferte Anwendung, blockiert Plugin-Objekte und beschränkt `<base>` sowie Form-Ziele auf dieselbe Origin. `font-src 'self'` ist möglich, weil die UI-Schriften lokal unter `public/fonts/` ausgeliefert werden.

`style-src 'unsafe-inline'` bleibt gesetzt, weil Teile der React-/Tailwind-Oberfläche dynamische Inline-Styles für Interaktionen verwenden. Skripte bleiben auf `'self'` beschränkt, und die Anwendung lädt keine externen Stylesheet-Origins.

`frame-ancestors` kann nach CSP-Spezifikation nicht wirksam per Meta-Tag gesetzt werden. Ein Framing-Verbot als HTTP-CSP-Header stellt GitHub Pages in diesem Projekt derzeit nicht bereit.

`connect-src 'self'` bildet zusammen mit den Egress-Nachweisen der Browser-Testlane (`src/test/browser/browserEgressGuard.ts`, `src/test/browser/egressOracle.negative.browser.test.ts`) die technische Grundlage dafür, dass Dokumentinhalte das Gerät nicht verlassen. Telemetrie, Fehlerreporting, Synchronisation oder Dokumentinhalte in URL-Parametern ändern die datenschutzrechtliche Rolle des Betreibers gegenüber diesen Daten.

## Import-Alias

Das Projekt verwendet den `@/` Alias für projektinterne Importe:

```typescript
import type { Control } from '@/domain/models';
import { parseCatalog } from '@/adapters/oscalAdapter';
```

Konfiguriert in `tsconfig.app.json` (`compilerOptions.paths`) und `vite.config.ts` (`resolve.alias`).

## Umgebungsvariablen

| Variable | Kontext | Beschreibung |
|----------|---------|---------------|
| `VITE_IMPRESSUM_NAME` | App (Build) | Impressum: Name |
| `VITE_IMPRESSUM_STRASSE` | App (Build) | Impressum: Straße |
| `VITE_IMPRESSUM_PLZ_ORT` | App (Build) | Impressum: PLZ und Ort |
| `VITE_IMPRESSUM_EMAIL` | App (Build) | Impressum: E-Mail |
| `BUILD_BASE` | Build | Überschreibt die GitHub-Pages-Base (`vite.config.ts`) |
| `BSI_SNAPSHOT_SHA` | fetch-catalog | Vollständige Commit-SHA für einen festgelegten BSI-Datenstand; ausschließlich der Catalog-Sync fordert mit `latest` ausdrücklich den neuesten Stand an. `latest` ist außerhalb dieser Lane unzulässig. |
| `GH_TOKEN` / `GITHUB_TOKEN` | fetch-catalog | Token für die GitHub-API (optional lokal, gesetzt in CI) |
| `CATALOG_SYNC_APP_CLIENT_ID` | Catalog-Sync | Repository-Variable mit der Client-ID der dedizierten GitHub App |
| `CATALOG_SYNC_APP_PRIVATE_KEY` | Catalog-Sync | Actions-Secret mit dem Private Key der dedizierten GitHub App |
| `CATALOG_SYNC_RULESET_UPDATED_AT` | Catalog-Sync | Audit-Pin der zuletzt vollständig geprüften Ruleset-Version |

Die Impressum-Werte kommen lokal aus `.env.local` (nicht committet, siehe `.env.local.example`) und in CI aus GitHub Actions Secrets.

`import.meta.env.BASE_URL` ist keine setzbare Umgebungsvariable, sondern eine von Vite aus der `base`-Konfiguration generierte Konstante; der projektseitige Override läuft über `BUILD_BASE`.

## CI-Pipeline

Die Pull-Request-Prüfung liegt in zwei Workflows mit unterschiedlichen Ereignislisten. `.github/workflows/ci.yml` führt `documentation-contract` und `catalog-sync-guard`; beide urteilen über die Pull-Request-Metadaten und abonnieren deshalb zusätzlich `edited`. `.github/workflows/validate.yml` führt `validate` (Schema-Verifikation, Node-Versionsquelle, Lint vor dem ersten Netzschritt, Scope-Entscheider direkt hinter Lint, Katalog-Fetch, Profilauflösung, go-oscal-Lauf, Tests mit Coverage, Playwright-Cache mit Browser-Tests, Build und als letzte Schritte desselben Jobs den zizmor-Audit) und abonniert `edited` nicht.

Ohne abonniertes `edited` entsteht bei einer Titel- oder Body-Bearbeitung kein neuer Lauf und damit kein neuer Check-Run; das Ergebnis des letzten Code-Laufs bleibt stehen. Step-Skips innerhalb des einen Jobs erzeugen keine neuen Check-Runs; der Pflichtcheck bleibt genau dieser Lauf.

Der Scope-Entscheider (`scripts/ci-scope.mjs`) schreibt genau einen Wert nach `GITHUB_OUTPUT` (`full`, `docs_only` oder `manifest_only`). Er läuft direkt hinter Lint. Profilauflösung, go-oscal und Build entfallen bei `docs_only` (Upstream-Bytes gegen Manifest + Register ändern sich nicht); bei `manifest_only` misst der Pin-Wechsel Fetch, Profilauflösung, go-oscal und Build gegen den neuen Pin, nur Browser-Cache, Chromium-Installation, Browser-Tests und Egress-Nachweis entfallen. Fetch, Coverage, Lint, Schema-, Policy-, Versions- und zizmor-Gates laufen immer. Der Entscheider holt Base- wie Head-Commit samt Historie in den flachen Checkout, weil der Drei-Punkt-Diff sonst keine Merge-Basis findet; jeder Fetch-/Diff-Fehler fällt fail-closed auf `full` zurück.

Die Jobnamen `validate` und `catalog-sync-guard` sind die vom Preflight erwarteten Required Status Checks (`REQUIRED_CHECKS` in `scripts/catalog-sync-policy.mjs`). Der zizmor-Audit läuft als Schritte im Job `validate` statt als eigener Job, damit ein roter Audit `validate` fehlschlagen lässt.

Beide Workflows tragen eine `concurrency`-Gruppe je `github.ref` und brechen überholte Pull-Request-Läufe ab (`cancel-in-progress` nur für Pull-Request-Läufe; ein laufender manueller `workflow_dispatch` wird nicht abgebrochen).

## Deployment

Das Deployment erfolgt automatisch via GitHub Actions bei Push auf `main` (`.github/workflows/deploy.yml`):

1. Gepinnter Snapshot-Commit wird aus `upstream-manifest.json` gelesen
2. Alle materialisierten Registry-Artefakte werden gegen den BSI-Snapshot validiert; nur `supported`-Daten werden ausgeliefert (`npm run fetch-catalog`)
3. Tests laufen mit Coverage (`npm run test:coverage`)
4. App wird gebaut mit Impressum-Secrets
5. CycloneDX-App-SBOM der produktiven npm-Abhängigkeiten wird lockfile-basiert erzeugt (`npm sbom --package-lock-only --omit=dev --sbom-format=cyclonedx --sbom-type=application` nach `$RUNNER_TEMP`; nicht unter `dist/`, keine Pages-Auslieferung) und SLSA-Provenance wird generiert — zwei getrennte Attestierungen über `dist/**`, weil `sbom-path` am Provenance-Schritt dessen Modus ersetzen würde
6. Deployment auf GitHub Pages

### Gemeinsame Setup-Schicht

Setup und Installation stehen in Composite Actions unter `.github/actions/`, nicht als wortgleiche Blöcke in den Workflows. `setup-node-env` richtet Node ein und installiert; `fetch-pinned-catalog` liest die gepinnte Snapshot-SHA aus `upstream-manifest.json` und holt den Katalog von genau diesem Stand. Die drei Jobs, die gegen den Pin bauen — `validate`, `build-and-deploy` und der Push-Pfad in `sonar.yml` — rufen beide auf.

Die Aufrufer referenzieren beide Actions über die self-repository-Syntax `$/` statt über das arbeitsbereichsrelative `./`. `$/` löst auf das Repository im gerade ausgeführten Commit auf; `./` könnte eine Action laden, die ein vorheriger Schritt erst hineinkopiert hat. Der zizmor-Audit `self-repository` im Pflichtcheck `validate` erzwingt diese Form.

Der Checkout bleibt außerhalb der Actions, weil `ref`, `fetch-depth` und Zweck des Klons je Job abweichen. Zwei Aufrufer bleiben bei einer eigenen Fassung: `greptile-review-nudge` installiert nicht; `update-catalog` fordert mit `BSI_SNAPSHOT_SHA: latest` den neuesten Upstream-Stand an, weil es den Pin fortschreibt statt ihn zu lesen.

Die Node-Version steht ausschließlich in `.nvmrc`. Jedes Setup liest sie über `node-version-file`. `scripts/verify-node-version.mjs` prüft sie gegen `engines.node` aus `package.json` und verbietet Versionsliterale in Workflows und Actions. Der Guard läuft hinter dem Setup-Schritt, ist netzfrei und fail-closed und läuft als `npm run verify-node-version` im Job `validate`.

`scripts/workflowDefinitions.mjs` trägt die gemeinsame Sammlung aus Workflow- und Action-Definitionen. Die Guards, die am Vorkommen statt an einer Dateiliste hängen — Action-Pinning, `npm ci --ignore-scripts`, `persist-credentials: false`, kein `npx`/`npm exec` —, lesen ihr Prüfgut daraus.

### Ausführungsumgebung und Berechtigungen

Wo Abhängigkeiten installiert werden, geschieht es mit `npm ci --ignore-scripts` — an genau einer Stelle, in `.github/actions/setup-node-env`. Der Coverage-Lauf des Deploy-Workflows ruft Vitest über `npm run test:coverage` auf. Kein Workflow ruft ein Binary über `npx` oder `npm exec` auf. Der zizmor-Audit im Job `validate` lässt das Image direkt per Digest laufen (`ghcr.io/zizmorcore/zizmor:1.30.1@sha256:a2eb396d886c053073405c7a980f2139ba2248ec172243cfa3841e57196e8101`) — per `docker pull` plus `docker run --network none` mit `--offline`, `--persona auditor`, Config `.github/zizmor.yml`, ohne Token und mit Read-only-Mount. Alle Actions bleiben per SHA gepinnt (erzwungen über `scripts/workflow-action-pinning.test.ts`, das auch die Composite Actions unter `.github/actions/` erfasst); der Digest ist der Pin des Binaries. Plain-Output mit Exit non-zero bei Befunden ist das Blockiergate (SARIF exitt immer 0).

Die Standardberechtigung des Deploy-Workflows beschränkt sich auf `contents: read`. Schreibrechte für GitHub Pages, OIDC, Attestations und Artefaktmetadaten besitzt ausschließlich der Job `build-and-deploy`; der vorgeschaltete `idempotency_guard` behält nur Lesezugriffe.

Die generierten Katalog- und Vokabulardaten werden **nie** im Repository committet — sie werden immer frisch zum Build-Zeitpunkt von BSI abgerufen. Der Workflow `.github/workflows/update-catalog.yml` vergleicht die vollständigen Trees der in `sourceRegistry` definierten Monitoring-Wurzeln. Änderungen an registrierten Artefakten aktualisieren `upstream-manifest.json`; neue, nicht registrierte Dateien werden ausschließlich als `unclassified` gemeldet und weder gefetcht noch ausgeliefert.

Manifest v2 enthält für jede materialisierte Datei `artifactKey`, erwarteten `rootType`, `lifecycle`, Pfad, Git-Blob-SHA und Content-SHA-256. Dadurch umfasst das Delta auch registrierte Kataloge, Profile, Mappings und Component Definitions; produktiv ausgeliefert werden weiterhin ausschließlich `supported`-Artefakte.

### Policy-gesteuerter Catalog-Sync

Der Sync verwendet ausschließlich eine auf dieses Repository beschränkte GitHub App. Ihr kurzlebiges Installation-Token wird zur Laufzeit erzeugt und unverändert an `gh` und Git übergeben; es gibt weder einen PAT-Fallback noch Annahmen über das Tokenformat.

Ein erkannter Upstream-Delta durchläuft folgende Lane:

1. Der Workflow checkt explizit `main` aus und prüft Auto-Merge, automatische Branch-Löschung, Ruleset samt Ref-Scope auf `main`, required Checks und CodeQL. `updated_at` muss denselben Zeitpunkt wie das nach vollständigem Admin-Audit gesetzte `CATALOG_SYNC_RULESET_UPDATED_AT` bezeichnen; jede tatsächliche Ruleset-Änderung blockiert bis zur erneuten Prüfung.
2. Der deterministische Branch `chore/catalog-sync-<sha12>` wird neu aus `origin/main` aufgebaut und enthält genau einen Manifest-Commit.
3. Die GitHub App pusht den Branch und erstellt oder aktualisiert den PR.
4. `validate` und `catalog-sync-guard` sind die vom Preflight erwarteten Required Status Checks (`REQUIRED_CHECKS` in `scripts/catalog-sync-policy.mjs`). Der Guard bindet Registry-Metadaten, Datei-Inventur, Blob-SHAs und Content-Hashes an den ausgewählten BSI-Snapshot.
5. Der Workflow fordert ausschließlich GitHub Auto-Merge mit Squash und Branch-Löschung an.
6. `.github/workflows/verify-catalog-merge.yml` verifiziert Merge-Commit und Manifest auf `main`. Die anschließende Deploy-Prüfung liegt in `scripts/verify-catalog-deploy.mjs`: Sie bestätigt den Push-Deploy zum Merge-Commit erst bei terminalem Zustand mit `conclusion = success`. Ein fehlgeschlagener oder unbestätigter Deploy lässt den Verify-Job fehlschlagen. Erscheint gar kein Push-Deploy, werden Merge-Commit und Manifest erneut gegen `main` geprüft, bevor der Workflow den begrenzten Fallback dispatcht.
7. Der Fallback-Dispatch übergibt `dispatch_source=catalog-sync-fallback` an `deploy.yml`, wo der Job `idempotency_guard` (`scripts/check-deploy-idempotency.mjs`) prüft, ob für denselben Commit-SHA bereits ein Deploy-Lauf erfolgreich abgeschlossen wurde. Der Guard kann einen Deploy ausschließlich verhindern, nie erzwingen. Ein manueller `workflow_dispatch` lässt `dispatch_source` leer und deployt immer.

#### Vom Guard anerkannte PR-Typen

`catalog-sync-guard.mjs` rechnet den PR-Diff als Drei-Punkt-Diff gegen die Merge-Basis (`<base>...<head>`) — dieselbe Bezugsgröße, die GitHub für „Files changed" verwendet. Berührt dieser Diff `upstream-manifest.json` nicht und trägt die PR weder Sync-Branchnamen noch Sync-Titel, passiert sie ohne Netzzugriff. Andernfalls muss die PR genau einem der folgenden Typen entsprechen; jede Abweichung fällt fail-closed auf den regulären Sync-Pfad zurück und wird dort abgelehnt.

| Typ | Prädikat | Kennzeichen | Netzprüfung |
| --- | --- | --- | --- |
| Autonomer Katalog-Sync | `validateCatalogSyncPullRequest` | Branch `chore/catalog-sync-<sha12>`, exakter Titel, genau `upstream-manifest.json` geändert | `verifySnapshotProgress` und `verifySnapshotFiles` |
| Registry-Lifecycle-Migration | `isRegistryLifecycleOnlyMigration` | Manifest und Quellregister gemeinsam, **unveränderter** Snapshot, alle Content-Pins identisch, mindestens ein Lifecycle-Wechsel; keine Entsperrung aus `blocked-by-upstream` | keine |
| Registry-Preview-Erweiterung | `isRegistryPreviewArtifactExpansion` | Manifest und Quellregister gemeinsam, unveränderter Snapshot, ausschließlich neue interne Preview-Kataloge ohne `catalogKey` | `verifySnapshotFiles` |
| OSCAL-Versionsmigration | `isRegistryOscalVersionMigration` | Manifest und Quellregister gemeinsam, **vorwärts bewegter** Snapshot, unveränderte Artefaktidentität, im Register bewegt sich einzig `oscalVersion` von OSCAL-Artefakten; Begleitpfade nur unter `src/` und `docs/` | `verifySnapshotProgress` und `verifySnapshotFiles`, ungekürzt |
| Manifest-Übernahme nach `develop` | `isCatalogImportToDevelop` | Base `develop`, Branch exakt `chore/catalog-import-to-develop`, genau ein Eintrag `M upstream-manifest.json`, Manifest am Head byte-identisch mit dem an `origin/main` | `verifySnapshotProgress` und `verifySnapshotFiles`, ungekürzt |

Die OSCAL-Versionsmigration löst einen strukturellen Deadlock: Hebt BSI die `metadata.oscal-version` eines registrierten Artefakts an, blockiert der fail-closed-Abgleich jeden Fetch, und beide Einzelwege bleiben rot. Registerbump und Snapshot-Advance müssen deshalb im selben Commit liegen. Die Sicherheit stammt aus der ungekürzten Snapshot-Verifikation gegen die BSI-API und aus der Positivliste der Begleitpfade (`src/`, `docs/`).

Die Manifest-Übernahme bezieht ihre Sicherheit aus der **Herkunft**: Weil das Manifest am PR-Head byte-identisch mit dem an `origin/main` sein muss, kann dieser Zweig nichts durchlassen, was nicht bereits die vollständige Sync-Lane auf `main` passiert hat. `verifySnapshotProgress` und `verifySnapshotFiles` laufen trotzdem ungekürzt gegen die BSI-API.

Bei fehlender oder abweichender vom Preflight geprüfter Policy, einem API-Fehler, unerwartetem Diff oder fehlendem `autoMergeRequest` bricht der Workflow ab.

### Inhalts-Übernahme und Release-Vorbereitung

Drei Linien mit drei getrennten Aufgaben: Die Produktionslane (`update-catalog.yml`) stellt den Manifest-PR nach `main`. Die Übernahme-Lane (`.github/workflows/backmerge-main-to-develop.yml` → `scripts/backmerge-main-to-develop.mjs`) bringt den Inhalt nach `develop`. Die Release-Lane (`.github/workflows/release-prepare.yml` → `scripts/release-prepare.mjs`) erzeugt den Freigabe-PR. Keiner der beiden neuen Workflows mergt oder löscht Branches.

Die Übernahme überträgt die **Änderung**, nicht den Zustand. Jede Klasse hat deshalb ihre eigene Bezugsgröße:

| Klasse | Bedingung | Branch | Bezugsgröße | Merge-Methode |
| --- | --- | --- | --- | --- |
| Reparatur | Ancestry einer abgeschlossenen M2-/M3-Übernahme fehlt | `chore/backmerge-main-to-develop` | ausschließlich Historie; der Pull Request ändert keine Datei | Merge-Commit |
| M1 | ausschließlich `upstream-manifest.json` bewegt, `snapshotCommitSha` wechselt | `chore/catalog-import-to-develop` | Vorbedingung: develops Manifest ist byte-identisch mit dem an irgendeinem von `origin/main` erreichbaren Commit | Squash zulässig |
| M2 | `upstream-manifest.json` und `src/domain/sourceRegistry.mjs` gemeinsam bewegt | `chore/backmerge-main-to-develop` | Drei-Wege-Merge gegen `git merge-base origin/main origin/develop`, Zielzustand muss ein Migrationsprädikat erfüllen | Merge-Commit |
| M3 | Inhalt ohne Manifestpfad | `chore/backmerge-main-to-develop` | Drei-Wege-Merge gegen dieselbe Basis | Merge-Commit |
| Konflikt | Manifest bewegt, aber weder M1 noch M2 greift | entfällt | — | kein PR, Lauf schlägt mit Befund fehl |

M1 arbeitet mit einer Vorbedingung statt mit einer Patch-Basis: Übernommen wird immer der Sprung auf `main`s aktuellen Stand. Weil die Vorbedingung inhaltsbasiert ist, braucht M1 keine Historie und darf gesquasht werden. Ein gesquashter M1 schreibt die gemeinsame Basis nicht fort; ein anschließender M2-Merge kollidiert dann, und die Auflösung ist Handarbeit.

Die Ancestry-Prüfung abgeschlossener M2- und M3-Übernahmen läuft vor dem Leerlauftest. Der Quell-SHA wird dem PR als Marke `<!-- backmerge-source: <sha> -->` im Body zugeordnet. Geprüft wird fail-closed: Der markierte SHA muss von der PR-Spitze erreichbar sein, danach ob er Vorfahr von `develop` geworden ist. Eine fehlende Marke ist ein Fehler. Fehlt die Ancestry, entsteht der wiederherstellende PR, und der Lauf endet trotzdem mit einem Fehler.

Die Reparatur ist der **alleinige** Gegenstand ihres Laufs; eine gleichzeitig anstehende Inhaltsübernahme folgt erst im Lauf nach ihrem Merge. Der Reparatur-PR hat einen leeren Drei-Punkt-Diff und passiert den Guard ohne Netzzugriff.

Der Leerlauftest vergleicht das **Ergebnis** der Übernahme mit dem aktuellen `develop`-Baum. Überlappende Läufe aus `push main` und `push develop` serialisiert eine `concurrency`-Gruppe ohne `cancel-in-progress`.

Die Release-Vorbereitung erzeugt einen kurzlebigen Branch `release/<sha12>` aus aktuellem `origin/main` und mergt den freigegebenen `develop`-SHA hinein. Die Eingabe ist zwingend ein 40-stelliger Kleinbuchstaben-SHA. Zwei Bedingungen gelten vor dem PR: `git merge-base --is-ancestor origin/main <head>`, und der resultierende Baum entspricht exakt dem Baum des freigegebenen `develop`-SHA. Trägt `main` noch Inhalt, den `develop` nicht hat, stoppt die Freigabe. Der PR-Body trägt die Marke `<!-- release-source: <sha> -->`; der Job `catalog-sync-guard` rechnet die Bedingung bei jedem `synchronize`-Ereignis nach (genau eine Marke, markierter Stand auf `origin/develop`, Baum des Heads gleich dem markierten Commit). Die Prüfung greift an Base `main` plus Branchpräfix `release/`.

## Versionierte Review-Policy

Gitar und Greptile prüfen dieses Repository parallel. Regeln sind versioniert, haben genau eine Autorenquelle, und alles Weitere wird daraus deterministisch erzeugt.

Die Autorenquelle besteht aus zwei Dateien: `scripts/review-policy.rules.mjs` trägt die Regeltabelle als reine Daten — Regel-ID, Scope und Regeltext. `scripts/review-policy.mjs` trägt Generator, Drift-Guard und CLI. Erzeugt werden vier Adapter: `docs/REVIEW_INVARIANTS.md`, `.gitar/review/invarianten.md`, `.greptile/config.json` und `.greptile/files.json`. `npm run review-policy` erzeugt neu, `npm run review-policy:check` schlägt bei jeder manuellen Abweichung fehl und läuft als Pflichtschritt im CI-Job `validate`.

Der Guard prüft neben der Byte-Gleichheit der erzeugten Dateien, dass keine Anweisungsfläche an der Autorenquelle vorbei existiert: Dateien unter den von den Reviewern gelesenen Verzeichnissen (`.gitar`, `.greptile`, `.cursor` in jeder Verzeichnistiefe, `.github/skills` an der Wurzel) sowie die Einzeldateien `.cursorrules` und `greptile.json` (ebenfalls in jeder Tiefe), die nicht aus dem Generator stammen, sind Drift. Ein von Hand angelegtes `.greptile/rules.md` fällt damit auf. Aufgezählt wird die Fläche über `git ls-files --cached --others --exclude-standard`, also genau die Menge der Pfade, die im PR-Head landen können. Ist der Index nicht lesbar, schlägt der Guard fehl.

### Greptile-Adapter

`.greptile/config.json` trägt auf oberster Ebene ausschließlich `rules` und keine einzige Review-Einstellung. `statusCheck` wird nicht gespiegelt: Die Dashboard-Schwelle „Required confidence to pass = 5" hängt an der Einstellung „Use Status Checks", für die `config.json` kein Feld kennt. Ein Test hält `config.json` fail-closed auf genau einen Schlüssel der obersten Ebene.

Von Greptiles zwei Regelformaten nutzt der Adapter das strukturierte `config.json` und nicht `.greptile/rules.md`. Nur dort sind Schlüssel und Scope eigene Felder und damit maschinell gegen die Autorenquelle prüfbar. Der Regeltext steht präfixfrei in `rule`, der Schlüssel in `id`.

`.greptile/files.json` bildet die Datei-Kontexte ab.

Fallstrick für spätere Änderungen: Greptiles `strictness` ist invers zu seiner Beschriftung (`1` = ausführlich, `3` = nur Kritisches; die Stufe Low entspricht `strictness: 1`). Der Adapter setzt das Feld nicht.

### Erzwungene Auslösung bei leerem Reviewumfang

Greptile wendet anbieterseitige Ignore-Patterns bereits vor der Auslösung an. Bleibt danach keine Datei übrig, legt es weder Review-Lauf noch Merge-Request-Datensatz an. Weil `Greptile Review` auf `develop` und `main` Pflicht-Check ist, steht ein so übersprungener Pull Request dauerhaft auf `mergeStateStatus: BLOCKED`. Betroffen ist die Klasse der Diffs, die ausschließlich `package-lock.json` ändern.

`.github/workflows/greptile-review-nudge.yml` schließt die Lücke über eine Erwähnung: Sie bewegt Greptile zu einem echten Review auf demselben Head und stellt damit echte Reviewabdeckung her. Ein selbst gebauter Check gleichen Namens ist ausgeschlossen.

Ausgelöst wird über `issue_comment`, gefiltert auf Kommentare an Pull Requests und auf `greptile-apps[bot]` als Autor. Die Bedingung für die Erwähnung ist der Zustand, der den Merge blockiert: Auf dem frisch gelesenen Head-SHA fehlt ein Check-Run namens `Greptile Review`. Ein unsichtbarer Marker mit dem Head-SHA im eigenen Kommentar begrenzt die Erwähnung auf eine je Head. Eine `concurrency`-Gruppe je Pull Request serialisiert die Läufe, mit `cancel-in-progress: false`.

Der Workflow checkt den Default-Branch aus, nie den PR-Head — fremder Code läuft zu keinem Zeitpunkt. Die Job-Berechtigungen sind auf `contents`, `checks` und `pull-requests` lesend plus `issues` schreibend beschränkt. `issue_comment` feuert nur von der Fassung auf dem Default-Branch: Der Guard ist im einführenden Pull Request selbst nicht lauffähig.

### `sonar-project.properties`

SonarQube Cloud analysiert dieses Repository per CI-Analyse. `.github/workflows/sonar.yml` startet den Scanner bei jedem Push nach `main` und `develop`. Für Pull Requests liegt er als Job `sonarqube` in `.github/workflows/validate.yml`: Er hängt über `needs: validate` am Pflichtcheck und lädt dessen `coverage/lcov.info` als Artefakt herunter, statt die Suite ein zweites Mal zu rechnen. Der Required Status Check heißt `SonarCloud Code Analysis` und wird von der SonarQubeCloud-App gesetzt, nicht vom Namen des Jobs.

Weil der Coverage-Lauf damit im Pflichtcheck `validate` liegt, greifen dort auch die in `vite.config.ts` gepinnten Vitest-Schwellen. Die Analyseparameter umfassen Projektschlüssel und Organisation, den lcov-Pfad (`coverage/lcov.info`, erzeugt durch `npm run test:coverage`) sowie eine Duplikatsausnahme: `sonar.cpd.exclusions=scripts/review-policy.rules.mjs`.

Der Grund ist eine Eigenschaft der Copy-Paste-Erkennung: CPD normalisiert Literale, und die strukturgleichen Tabelleneinträge werden dadurch zwangsläufig als Duplikat gemeldet, ohne dass Verhalten kopiert wäre. Weil `sonar.cpd.exclusions` ausschließlich dateiweit greift, hätte eine Ausnahme auf einer gemischten Datei auch Generator, Drift-Guard und CLI von der Duplikatsprüfung befreit — daher der Schnitt in zwei Dateien. Ausgenommen ist allein die Duplikatsmessung auf der Datentabelle.

Die Datei wirkt aus dem PR-Head heraus. Ein PR könnte sich damit selbst eine Gate-Ausnahme erteilen, weshalb sie in `AGENTS.md` zu den Review-Policy-Pfaden zählt: Wer sie anfasst, braucht ein Agenten-Cross-Review. Dasselbe gilt für `.github/workflows/sonar.yml`, `.github/workflows/validate.yml` und `scripts/sonar-token-guard.mjs`. Ob die Analyse überhaupt läuft, entscheidet in beiden Workflows `scripts/sonar-token-guard.mjs`: Fehlt das Secret bei einem Fork-Beitrag, überspringt der Guard die Analyse mit einer sichtbaren Notice; fehlt es im eigenen Repository, schlägt der Lauf fehl.

## Siehe auch

- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [FILTERING.md](./FILTERING.md) — Filter-System
- [INTEGRITY.md](./INTEGRITY.md) — Integritätsprüfung
- [PERSISTENCE.md](./PERSISTENCE.md) — Persistenzvertrag für lokale Arbeitsbereiche
- [REVIEW_INVARIANTS.md](./REVIEW_INVARIANTS.md) — erzeugte Review-Invarianten (nicht von Hand bearbeiten)
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
