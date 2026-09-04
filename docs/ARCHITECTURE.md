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

Die Standard-Lane bleibt `npm run test`: Sie läuft vollständig in jsdom und
schließt Dateien unter `src/test/browser/**/*.browser.test.ts` explizit aus.
Damit bleibt sie schnell und alle bestehenden Tests laufen unverändert weiter.

`npm run test:browser` startet die getrennte Vitest-Browser-Lane aus
`vitest.browser.config.ts` mit dem Playwright-Provider und Chromium. Sie
verwendet einen gemeinsamen Test-iframe (`browser.isolate: false`), weil
Vitest 4.1 den absoluten Dateipfad als Query-Parameter des isolierten iframes
verwendet; ein lokaler Projektpfad mit `+` würde dabei in Leerzeichen
dekodiert und den Ready-Handshake blockieren. Jeder Test bereinigt seine
eigene IndexedDB-Datenbank, und der Egress-Guard setzt seinen Zustand vor jedem
Test zurück.

| Abhängigkeit | Exakte Version | Lizenz | Zweck |
| --- | --- | --- | --- |
| `vitest` + `@vitest/coverage-v8` | `4.1.10` | MIT | Kompatible Test- und Coverage-Basis für beide Vitest-Lanes |
| `@vitest/browser-playwright` | `4.1.10` | MIT | Playwright-Provider für das Vitest-Browser-Projekt |
| `playwright` | `1.62.1` | Apache-2.0 | Startet das gepinnte Chromium in CI und lokal |

Die exakte `playwright`-Version `1.62.1` liefert laut ihrem mitinstallierten
`browsers.json` Chromium-Revision `1234` als Chrome for Testing
`151.0.7922.34`. Der CI-Schritt verwendet ausschließlich den lokalen Befehl
`./node_modules/.bin/playwright install chromium`; es gibt keinen
`latest`-Tag oder unversionierten Browser-Download.

Der Referenztest in `src/test/browser/indexedDb.browser.test.ts` legt eine
IndexedDB-Datenbank an, schreibt und liest einen Datensatz, löscht die
Datenbank und prüft anschließend ihre Abwesenheit über
`indexedDB.databases()`. Ein durch eine noch offene Verbindung blockiertes
`deleteDatabase()` wartet bis zu zwei Sekunden auf deren Schließen und lehnt
danach mit einem erklärenden Fehler ab, statt den Hook unbefristet hängen zu
lassen.

`src/test/browser/browserEgressDecision.ts` entscheidet als reine Funktion
über HTTP(S)- und Service-Worker-Ereignisse. Der Playwright-Guard in
`browserEgressGuard.ts` nutzt sie dafür; fremde HTTP(S)-Requests werden vor
Namens- oder Netzauflösung abgebrochen. Für WebSockets setzt der Guard im
tatsächlich ausgeführten Vitest-Testframe eine `connect-src`-CSP: Sie erlaubt
nur den lokalen WebSocket-Host, verhindert fremde Verbindungen vor dem
Netzwerkzugriff und erfasst die dadurch ausgelöste Browser-Verletzung mit
eigenem Zähler. `context.routeWebSocket()` ist hier bewusst keine zweite
Durchsetzungsschicht: Der Handler läuft im gemeinsamen Vitest-Testframe mit
`browser.isolate: false` nicht verlässlich. Der HTTP-Zähler wird erst beim
zugehörigen `ERR_BLOCKED_BY_CLIENT`-Ereignis erhöht; der WebSocket-Zähler erst
bei der CSP-Verletzung erhöht, während der Chromium-Referenztest den daraus
resultierenden geschlossenen Browser-WebSocket prüft. Bereits vorhandene oder
neu registrierte Service Worker gelten ebenfalls als Verstoß.

Der WebSocket-Zustand liegt absichtlich im `window` des aktuellen Testframes:
Die Browser-Commands lesen ihn aus derselben Ausführungsumgebung aus, die die
CSP tatsächlich durchsetzt. Navigiert ein Test diesen Frame, entfernt der
Browser die CSP zusammen mit dem Dokument. Der Guard registriert diese
Navigation deshalb Node-seitig als Verstoß und installiert die CSP nicht still
im Ziel-Dokument neu; der anschließende `afterEach` schlägt mit dem
Egress-Marker fehl.

`npm run test:browser:egress-negative` startet zwei getrennte innere
Browser-Läufe für absichtlich nicht abgewartete `fetch`- und
`navigator.sendBeacon`-Requests. Beide Ziele werden aus `window.location` als
Loopback-Origin mit abweichendem Port abgeleitet; bei Port 65535 wird auf 65534
ausgewichen. Der Guard bricht sie vor jeder Namens- oder Netzauflösung ab. Die
Testkörper werfen nicht selbst und warten die Requests nicht ab. Erst der immer
aktive `afterEach` ruft `assertNoViolations` über den Browser-Command auf und
erzeugt den Egress-Marker.

Jeder innere Lauf **muss** mit genau einem Marker, der zum ausgewählten Fall,
zur erwarteten HTTP-Methode und zum erwarteten Loopback-Pfad passt,
fehlschlagen. Das Wrapper-Skript wird nur dann grün, wenn Vitests JSON-Report
exakt diesen einen fehlgeschlagenen Test enthält. Eine falsche Methode, mehrere
Marker, ein zusätzlicher Verstoß, ein unerwartet grüner Lauf, weitere
Testfehler, Timeouts oder Runner-Signale lassen auch den Wrapper scheitern. Die
Nachweise führen damit die HTTP-Cross-Origin-Pfade aus, ohne zusätzliche
produktive Fetch-Quellen einzuführen.

Die Hook-Grenze kann keine Browser-Aufgabe erfassen, die erst *nach* Ende des
Tests einen Request startet. Dafür wäre eine veränderte Testlaufzeit-Architektur
erforderlich, nicht ein zufallsabhängiger Timeout. Die konsumierenden
[GSPP-289](https://linear.app/grundschutz-plus-plus/issue/GSPP-289) und
[GSPP-340](https://linear.app/grundschutz-plus-plus/issue/GSPP-340) führen
deshalb einen eigenen Akzeptanznachweis für bewusst nicht abgewartete
Requests.

Die Browser-Lane erzeugt keine Coverage-Ausgabe. Die verbindlichen
V8-Coverage-Schwellen bleiben ausschließlich in der jsdom-Lane
(`npm run test:coverage`) und unverändert bei Lines 57, Branches 55,
Functions 56 und Statements 54. So senkt die zusätzliche Infrastruktur weder
die Messlatte noch vermischt sie Browser-Referenztests mit der bestehenden
Quellabdeckung.

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
  └── check-deploy-idempotency.mjs # Redundanten Fallback-Deploy desselben Commits verhindern

upstream-manifest.json            # Gepinnter Upstream-Snapshot (Manifest v2)

.github/workflows/
  ├── deploy.yml                  # GitHub Pages Deployment
  ├── ci.yml                      # CI Pipeline
  ├── update-catalog.yml          # Automatischer Katalog-Sync
  └── verify-catalog-merge.yml    # Post-Merge-Prüfung und Deploy-Fallback
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
• Abruf über die GitHub-API (Retry mit Backoff bei transienten Fehlern)
• Snapshot-Pinning: BSI_SNAPSHOT_SHA aus upstream-manifest.json
• sourceRegistry: einzige Ingestion-Quelle für Pfad, Root-Typ, Lifecycle und
  erwartete oscal-version je Artefakt
• oscalVersionMatrix: fail-closed Schemaauswahl über Root-Typ × oscal-version;
  fehlende, nicht gepinnte oder unmögliche Version bricht den Lauf ab
• Security-Guards: nur erlaubtes Repo, erlaubte Hosts, Pfade und Refs
• registrierte preview-/draft-Artefakte werden transient geprüft, nicht ausgeliefert
• catalogLineage.mjs projiziert für registrierte Profile die belegte Kette
  Import-Fragment → back-matter.resource → exakter rlinks.href → Registry-Artefakt;
  keine Pfadnormalisierung, kein Netzwerk und keine Änderung des Referenzresolvers
• jeder supported Katalog und die direkten Namespace-CSVs → JSON + Provenance
• Manifest v2 bindet Registry-Metadaten, Git-Blob-SHA und Content-SHA-256
• Korpus-Cache (gitignoriert): 10 Dokumente der Lineages (Profile + Quell- und
  Anwenderkataloge) → `.cache/upstream-corpus/` + Begleitmanifest; kein zweiter
  Fetch, keine Env-Pfade, kein Überspringen — der Harnisch scheitert hart
  ohne Cache
        │
        ▼
public/data/  (Dateimenge aus dem Quellregister abgeleitet)
• catalog.json                    (Einstiegskatalog, OSCAL-JSON)
• catalog-metadata.json           (Provenance + Integrity des Einstiegs)
• catalog-<catalogKey>.json       (je weiterem supported Katalog)
• catalog-<catalogKey>-metadata.json
• vocabularies.json               (Offizielle BSI-Vokabulare)
• upstream-sources-metadata.json  (Vokabular-Provenance + Manifest v2 + Lineage-Projektion)
• .cache/upstream-corpus/         (verpflichtender Bauzeitlauf: 10 Lineage-Dokumente)
        │
        ▼
Profile Resolution (deterministisch, GSPP-291 Commit B)
• Plan: Importgraph (Zyklus/Versions/Root-Prüfungen) → DAG-sichere Postorder
• Selektion je Import, danach Merge (combine use-first/keep, flat/as-is/custom
  mit insert-controls/order) und Modify (set-parameter, alters) in der
  Reihenfolge Import → Merge → Modify
• Ergebnis ausschließlich über `createOscalDerivedGraph()` (kontrollierter
  Builder, kein Fremdobjekt, __proto__ als Data-Property, opakes
  DerivedJsonTree-Handle, Vertrauensklasse class-2-local-user)
• jedes Zwischen- und Endergebnis durchläuft fail-closed dieselbe Objekt-,
  Root-, Versions- und Schema-Pipeline wie lokale Klasse-2-Dokumente
• Back-matter: referenzierte Quellressourcen in Import-/Quellreihenfolge,
  danach unverbrauchte Profilressourcen und übrige Profilmitglieder;
  UUID-Kollisionen werden case-insensitiv nach first occurrence aufgelöst
• Orakel zweigeteilt: BSI (3× resolved_catalog, feste Registry aus 21 Link-
  und einer Positionsabweichung) und NIST (4× Baselines v1.5.0, vollständiges
  Back-matter und as-is-Reihenfolge; nur belegte XML-Whitespace-Artefakte
  symmetrisch normalisiert) plus synthetische Fixtures mit
  Draft-/XSpec-Quellenangaben
        │
        ▼
CatalogContext (Einstiegskatalog eager, weitere bedarfsgerecht)
├─ Katalog: loadCatalogArtifacts()
│  • fetchCatalogBuffer()    → ArrayBuffer
│  • verifyArtifactIntegrity() → VerificationResult
│  • parseCatalogInWorker()  → CatalogDocument { source, context, view }
│                               source = unveränderter Quellgraph (ADR-2)
│                               view   = kataloggescopter, angereicherter Catalog
│  • catalogReferenceProjection.ts → ruft referenceResolution.ts gegen source
│                               + expliziten Kontext auf (ohne Netzwerk-,
│                               Datei- oder Pfadauflösung) und ergänzt vor
│                               Veröffentlichung die View: Control.links enthält
│                               nur aufgelöste, kataloggescopte Ziele; der
│                               Quellbaum wird dafür nur einmal indiziert
└─ Vokabulare: fetchCatalogWithBuffer() → { buffer, text }
   • buildVocabularyRegistry()
   • fetchVocabularyProvenance() + verifyArtifactIntegrity()
• Referenzauflösung trennt Fragmentziele nach dem tatsächlichen Dokumentgraphen:
                               control/@id → kataloginterne Navigation,
                               back-matter.resource/@uuid → Ressourcenmetadaten;
                               resource.rlinks bleiben externe Metadaten und
                               werden niemals automatisch geladen
        │
        ▼
Feature-Komponenten und Hooks
• useFilteredControls()      → gefilterte Steuerungen
• useSearch()                → FlexSearch-Volltextsuche mit kataloggescoptem LRU-Cache (GSPP-218, `MAX_SEARCH_CACHE_ENTRIES = 3`)
                               plus exakter Kennungsindex im selben Cache-Eintrag (GSPP-380, siehe docs/FILTERING.md)
• resolveControlVocabularies() → Vokabular-Auflösung
```

### Klasse-2-OSCAL-Eingang

Der bestehende Katalogfluss verarbeitet ausschließlich Build-Zeit-Artefakte
aus dem Quellregister. Lokale Klasse-2-Dokumente benutzen ihn nicht.
`src/adapters/oscalImportGate.ts` ist ihr einziger Anwendungseinstieg: Er
kopiert `ArrayBuffer` oder `Uint8Array` nur für die Übertragung und startet
`src/workers/oscalImport.worker.ts` als Modul-Worker. Der Main-Thread dekodiert,
parst oder interpretiert die Bytes nicht.

Nach der Größenkontrolle läuft im Worker die feste Reihenfolge aus dem
[OSCAL-Validierungsvertrag](./OSCAL_VALIDATION.md): Bytelimit, fataler
UTF-8-Decoder, Duplicate-Member-Scanner, `JSON.parse` — und ab dort die
gemeinsame objektorientierte Prüfkette
([`oscalObjectPipeline.ts`](../src/domain/oscalObjectPipeline.ts)): zuerst ein
rein identitätsbasierter Herkunfts- und Serialisierungsbudget-Durchlauf vor
jeder Wertreflexion, danach der terminierende Struktur-, Tiefen-, Knoten- und
Base64-Durchlauf mit globaler Identitätsmenge,
`dispatchOscalDocument()` und anschließend `validateAgainstPinnedSchema()`
als Stufe 3. Der Byte-Eintrittspunkt `processClass2OscalBytes()` ruft
ausschließlich diese Einheit auf; der Ableitungsweg der Profile Resolution
([GSPP-291](https://linear.app/grundschutz-plus-plus/issue/GSPP-291)) teilt sie.
Das Bytelimit greift bereits vor
Worker-Erzeugung und Transferkopie; der Scanner begrenzt seinen Abstieg
zusätzlich auf die zulässige Tiefe. Das Ergebnis ist entweder ein vollständiger
Root-Envelope mit explizitem `class-2-local-user`-Kontext oder genau eine
redigierte Diagnose. Der Worker führt keine Dateisystem-, Telemetrie- oder
URL-Operation aus und bezieht nichts von einer fremden Origin; sein einziger
Netzbezug ist der Modulabruf des Schema-Chunks derselben Origin, siehe den
folgenden Absatz. Nach seiner Antwort beendet ihn der Adapter; bleibt eine
Antwort aus, beendet der Adapter ihn nach 30 Sekunden fail-closed mit einer
redigierten Worker-Diagnose.

Stufe 3 prüft mit `ajv` 8.20.0 gegen das gepinnte NIST-Schema der von Stufe 2
gewählten Matrixzelle. Die Schemabytes liegen eingecheckt unter
`schemas/oscal/` und werden über `src/domain/oscalSchemaBundle.ts` je Zelle in
einen eigenen Chunk gebaut. Zur Laufzeit lädt der Worker genau einen davon
nach — den der ausgewählten Zelle, als Modul **derselben Origin** wie die
Anwendung. Das ist kein externer Bezug: Weder das Release-Asset auf
`github.com` noch die `$id`-Domain `csrc.nist.gov` wird angefragt, und ein
Browsertest belegt das über das Egress-Orakel aus
[GSPP-339](https://linear.app/grundschutz-plus-plus/issue/GSPP-339). Damit der
Modul-Worker überhaupt code-splitten kann, baut Vite ihn über
`worker.format: 'es'` als ES-Modul; andernfalls lägen alle 30 Schemas in einer
einzigen Worker-Datei. `processClass2OscalBytes()` ist deshalb `async`,
während der öffentliche Einstieg `importClass2OscalDocument()` unverändert ein
`Promise` liefert.

Dieser Einstieg liefert weder Dateiauswahl noch Persistenz, UI oder Renderer.
Er ändert deshalb weder den Klasse-1-Katalogladepfad noch dessen
Integritätskette.

Wohin ein importiertes Klasse-2-Dokument gespeichert wird, sobald Persistenz
entsteht, legt der [Persistenzvertrag](./PERSISTENCE.md) fest: eine eigene
IndexedDB-Datenbank `gspp-workspace`, in der Klasse 1 **keinen** Store besitzt.
Der Arbeitsbereich kann Klasse-1-Inhalte damit strukturell nicht aufnehmen; er
hält allenfalls einen `artifactKey`-Verweis. Speicherschlüssel, Envelope,
Versionsführung, Referenzbindung, Migration, Export und Löschung sind dort
verbindlich beschrieben.

Der separate Sync-Pfad (`scripts/sync-upstream-manifest.mjs` mit `scripts/upstream-artifacts.mjs`) vergleicht die vollständigen normalisierten Trees des bisherigen und des neuen Snapshots. Erst dort entstehen die Status `added`, `modified` und `removed`; neue nicht registrierte Pfade werden als `unclassified` gemeldet, ohne ihren Blob zu fetchen oder sie auszuliefern. Weil `snapshotCommitSha` Bestandteil der Manifest-Signatur ist, löst auch ein neuer Snapshot, dessen einziges Delta eine unregistrierte Datei ist, diesen Vergleich aus.

## Zustandsverwaltung

Die Anwendung verwendet React Context für den globalen Zustand:

### CatalogContext (`src/state/CatalogContext.tsx`)

Zentraler Provider, der eine **Katalogsammlung** hält
([GSPP-284](https://linear.app/grundschutz-plus-plus/issue/GSPP-284)). Der
Einstiegskatalog aus dem Quellregister wird beim Mounten geladen; jeder weitere
ausgelieferte Katalog erst, wenn eine Route ihn auswählt. Der Initial-Load
wächst dadurch nicht mit der Zahl ausgelieferter Kataloge.

Sammlungsbezogene Felder:

- `catalogs` — `ReadonlyMap<CatalogKey, LoadedCatalogState>` aller angeforderten
  Kataloge. Jeder Eintrag trägt sein eigenes Dokument, seine eigene Provenance,
  sein eigenes Verifikationsergebnis und seinen eigenen Fehlerzustand.
- `entryCatalogKey` — der ausgezeichnete Einstiegskatalog
- `activeCatalogKey` — der aktuell ausgewählte Katalog
- `selectCatalog(catalogKey)` — wählt einen ausgelieferten Katalog aus und stößt
  ihn bei Bedarf an. `AppShell` ruft das aus dem Routen-`catalogKey` auf; ein
  nicht ausgelieferter Schlüssel wird fail-closed ignoriert.

Projektionen des **aktiven** Katalogs — unveränderte Zugriffsform:

- `catalogDocument` — Katalogdokument nach
  [ADR-2](https://linear.app/grundschutz-plus-plus/issue/ADR-2): unveränderter Quellgraph
  (`source`), expliziter Ableitungskontext (`context`) und die Projektion
  (`view`). Siehe [DOMAIN_MODELS.md](./DOMAIN_MODELS.md#verlustfreies-dokumentmodell).
- `catalog` — Angereicherter Katalog (Practices, Topics, Controls); identisch
  mit `catalogDocument.view`
- `provenance` — Provenance-Metadaten vom Build-Zeitpunkt
- `verification` — Integritätsprüfungsergebnis
- `vocabularyRegistry` — Registry der offiziellen BSI-Vokabulare
- `vocabularyProvenance` — Vocabulary Provenance Metadaten
- `vocabularyVerification` — Vocabulary Integritätsprüfung
- `loading` — Ladezustand
- `error` — Fehlermeldung

### Startup-Parsing im Modul-Worker

Nach der Hashprüfung überträgt
`catalogArtifacts.ts` den nicht mehr benötigten `ArrayBuffer` ohne Kopie an
`catalogParser.worker.ts`. Dort dekodiert und parst der Worker den Katalog,
führt Root-Dispatch und Link-Projektion aus und gibt das strukturklonbare
`CatalogDocument` zurück. Nachrichten tragen Request-ID und den expliziten
`CatalogDocumentContext`; angenommen wird eine Antwort nur, wenn Request-ID,
`catalogKey` und Vertrauensklasse zur Anfrage passen **und** die zurückgegebene
Projektion vollständig ist — geprüft am `alt-identifier`-Index, den der Parser
fail-closed für jede Kontrolle füllt. Eine fremde, abgeschnittene oder
unvollständig strukturgeklonte Antwort kann damit keinen Katalogzustand
vervollständigen. Parse- und Root-Type-Fehler bleiben
als verständlicher Ladefehler am betroffenen Katalog sichtbar. Nur ohne
`Worker`-API (heute ein Test- bzw. nicht unterstützter Laufzeitpfad) bleibt der
gleiche, fehlertreue Parser als Fallback im Main Thread. Kann ein vorhandener
Worker nicht starten oder fehlschlägt er, bleibt dies ein sichtbarer
Katalog-Ladefehler; nach dem Transfer gibt es bewusst keinen stillen
Main-Thread-Fallback.

Die Auslagerung ist nicht auf Verdacht erfolgt: Auf einem CPU-gedrosselten
Mobilprofil erzeugte das Parsing im Main Thread reproduzierbar Long Tasks, im
Modul-Worker keine mehr. Die Messwerte und die Methodik dahinter hält
[ADR-12](https://linear.app/grundschutz-plus-plus/issue/ADR-12) fest; im
Repository werden sie bewusst nicht gepflegt, weil sie einen bestimmten
Katalog-Snapshot und eine bestimmte Browserversion beschreiben.

## Anwenderkataloge sind fachlich getrennt

Die App liefert mehrere BSI-Anwenderkataloge aus. Jeder ist ein **eigenständiges
OSCAL-Dokument** mit eigener `uuid` — kein Ausschnitt und keine Variante eines
anderen. Ausgeliefert wird, was im Quellregister `lifecycle: 'supported'` trägt;
die Lifecycle-Promotion des Anwenderkatalogs Lieferkettensicherheit erfolgte in
[GSPP-242](https://linear.app/grundschutz-plus-plus/issue/GSPP-242), die des
WLAN-Katalogs in [GSPP-243](https://linear.app/grundschutz-plus-plus/issue/GSPP-243).

Daraus folgen vier Regeln, die der gesamte Katalogpfad einhält:

**1. Gleiche Control-IDs sind erwartbar, nicht fehlerhaft.** `control/@id` trägt
im OSCAL-Catalog-Metaschema `identifier-uniqueness="local"` und ist ausdrücklich
nur innerhalb seines Katalogs eindeutig. Zwei aufgelöste Kataloge aus demselben
Quellbestand teilen sich deshalb regelmäßig Control-IDs — am gepinnten Snapshot
kollidieren *sämtliche* Controls des Lieferkettenkatalogs mit dem
Grundschutz++-Katalog. Eine Kollision wird **nie** als Fehler gemeldet.
Unterschieden wird ausschließlich über den `catalogKey`: Lookups laufen über
`ControlRef = { catalogKey, controlId }` (`src/domain/controlRef.ts`), jeder
Katalog hält seine eigene `controlsById`-Map, und es findet an keiner Stelle
eine Zusammenführung oder katalogübergreifende Verlinkung statt.

**2. Keine gemeinsamen Props oder Taxonomien.** `prop.ns` ist im Metaschema
optional, und OSCAL garantiert zwischen zwei Katalogen weder dieselben `props`
noch dieselben Namensräume. Der vorgefundene `ns` wird unverändert übernommen —
einschließlich seines Fehlens; es wird kein projekteigener Namensraum vergeben
und kein fremder normalisiert. Real belegt: der Lieferkettenkatalog führt nur
`alt-identifier` (ohne `ns`), `sec_level`, `effort_level` und `tags`. Die
Schutzziel-Props (`confidentiality`, `integrity`, `availability`,
`authenticity`), `threats` und `label` fehlen dort vollständig. Sie werden
deshalb weder angezeigt noch als fehlend bemängelt, und die Facettenzählung
erzeugt aus ihrer Abwesenheit keine leeren Filtereinträge
(`src/hooks/useFilteredControls.ts`).

Der WLAN-Katalog ergänzt auf jedem Control die offenen Props `Taxonomy-L1` bis
`Taxonomy-L4`. Der Adapter projiziert ausschließlich diese exakten Namen in
Ebenenreihenfolge und erhält `name`, `value` und den optionalen Originalwert
von `ns`. Der aktuell vorgefundene Placeholder-Namensraum ist keine
Vokabular- oder Vertrauensentscheidung: Kein Verhalten hängt an seiner URI,
und `Taxonomy-Mapping-Rationale` wird nicht als zusätzliche Ebene erfunden.
Die Werte erscheinen in der Detailansicht, im Volltextindex und in separaten
CSV-Wert-/Namespace-Spalten; sie erzeugen bewusst keine neue Filterfacette.

**3. Referenzen bleiben Daten bis zur bewussten Navigation.** Der originale,
optionale `link.rel`-Wert wird mit seinem Dokumentationsstatus erhalten;
`reference` ist der einzige im Catalog-Modell dokumentierte Wert, während
offene Tokens wie `related` als benutzerdefiniert sichtbar bleiben. Die
Zielart folgt ausschließlich aus dem Fragmenttreffer. Externe
`resource.rlinks[].href` sind nur bei einer syntaktisch gültigen absoluten
HTTPS-URL ohne eingebettete Zugangsdaten klickbar. Der Resolver führt dabei
kein I/O aus. Ohne deklarierten `media-type` gibt es weder Vorschau noch
Content-Sniffing; Dateiendungen sind keine Medienaussage.

**4. Optionale Identifikatoren erzwingen kein Routing.** `group.id` ist in OSCAL
1.1.3 optional, `part` verlangt nur `name`, und ein Katalog ganz ohne `groups`
und `controls` ist schema-valide. Eine Gruppe ohne `id` bleibt vollständig
sichtbar — Titel, Badge, Untergruppen und Controls —, ist aber **nicht
adressierbar**: sie erzeugt weder Route noch Anker, und ein aktiver Gruppen-
oder Praktik-Filter trifft sie nie. Es wird kein Ersatzbezeichner erfunden.
Ein leerer Katalog erzeugt einen Empty State, keinen Fehler — der Empty State
gilt aber nur, wenn **weder** `groups` **noch** `controls` vorhanden sind.
`catalog.controls` steht im Schema gleichberechtigt neben `groups`; solche
Root-Controls gehören zu keiner Gruppe, werden ohne `groupId` und `practiceId`
geführt und bleiben über ihren kanonischen `altIdentifier` adressierbar. Sie
werden projiziert, nie stillschweigend verworfen.

Die Vokabular-Membership wird aus **allen** ausgelieferten Katalogen abgeleitet
(`scripts/fetch-catalog.mjs`), damit ein Nicht-Einstiegskatalog sein Vokabular
nicht verliert; alle Namensräume stammen aus demselben Snapshot und durchlaufen
dieselbe Hash-Prüfung. Die Topic- und Practice-Coverage-Baselines
(`scripts/taxonomy-coverage.mjs`) bleiben dagegen bewusst auf den
Einstiegskatalog bezogen: Sie fordern `orphanCsvEntryCount === 0`, also die
exakte wechselseitige Entsprechung von CSV und Katalog. Für einen
Teilmengenkatalog wie Lieferkettensicherheit ist diese Bedingung strukturell
nicht erfüllbar — er nutzt 23 der 140 Themen — und würde einen korrekten
Bestand fälschlich als Drift melden.

## Routing

Die Anwendung verwendet React Router mit `BrowserRouter` und pfadbasierten URLs. Das `basename` wird aus `import.meta.env.BASE_URL` abgeleitet (`src/main.tsx`), sodass die App auch unter dem GitHub-Pages-Unterpfad `/Grundschutz-Navigator/` funktioniert.

Für kanonische Einstiegsrouten erzeugt das Vite-Plugin `github-pages-spa-fallback` (`vite.config.ts`) beim Build zusätzlich zu `404.html` je Route ein statisches `dist/<route>/index.html`, bytegleich zum gebauten `index.html`. GitHub Pages liefert diese Dokumente mit HTTP 200 aus; die Routen kommen ausschließlich aus dem gemeinsamen Vertrag `listCanonicalEntryRoutes()` — den sechs festen Inhaltsrouten (`/suche`, `/vokabular`, `/about`, `/datenschutz`, `/impressum`, `/lizenzen`) plus je einem Einstieg `/katalog/<catalogKey>` für jeden von `listSupportedCatalogs()` im Quellregister (`src/domain/sourceRegistry.mjs`) als `supported` geführten Katalog. Das absichtlich ungültige `/katalog`, der Redirect `/mehr`, parametrisierte Gruppen-, Control- und Vokabular-Detailrouten sowie Query-/Filter-URLs werden bewusst nicht materialisiert. Für alle übrigen Pfade dient `dist/404.html` weiterhin als Fallback: GitHub Pages reicht unbekannte Pfade an die SPA durch, allerdings mit HTTP-Status 404.

### Sitemap

Beim Build entsteht deterministisch eine UTF-8-kodierte `dist/sitemap.xml` mit XML-Deklaration und dem Namespace `http://www.sitemaps.org/schemas/sitemap/0.9`. Sie enthält genau einmal die absolute kanonische URL der Startseite, der sechs festen Inhaltsrouten und jedes von `listSupportedCatalogs()` gelieferten Katalogeinstiegs — dieselbe Positivliste wie die statischen 200-Einstiege, gebildet aus demselben Vertrag `listCanonicalEntryRoutes()`, sodass beide Ausgaben nicht driften können. Origin (`https://dfurater.github.io`) und Basispfad (`/Grundschutz-Navigator/`) sind die Production-Defaults des Buildvertrags; XML-Sonderzeichen werden escaped. Geschrieben werden ausschließlich die Pflichtfelder `urlset`, `url` und `loc` — bewusst ohne unbelegte optionale Felder wie `lastmod`, `changefreq` oder `priority`. Die manuelle Einreichung in der Search Console liegt beim Projekt-Owner und ist kein Teil des Builds.

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

`src/features/catalog/CatalogBrowser.tsx` ist der Composer des Katalog-Browsers.
Er bindet Router, Katalog- und Filterzustand aneinander, bestimmt den
Practice-/Topic-Scope, hält Breakpoint- und Panelbreitenzustand und komponiert
Liste, Toolbar und Seitenleisten. Direkte CSV-Downloads, Beziehungsgraphen und
imperative Zugriffe auf `document.body` gehören ausdrücklich nicht zu dieser
Grenze.

**Breakpoint-Mount-Strategie (GSPP-268):** Breakpoint-abhängige UI wird über
`useMediaQuery('(min-width: 1024px)')` (`isDesktop`) bedingt **gemountet**,
nicht per CSS versteckt — zu jedem Zeitpunkt ist nur der passende Teilbaum im
DOM (Invariante aus GRU-217; kein dauerhaft gemounteter, unsichtbarer Knoten).
Zwei bewusste Ausnahmen: Der `CatalogMobileDetailOverlay` behält sein
`active`-Prop-Muster, weil er inaktiv bereits `null` rendert und seinen
Modal-Lifecycle (Focus-Trap, Scroll-Lock, Escape) selbst besitzt; kleine
stateless Buttons (z. B. der Mobile-Auswahl-Toggle) dürfen bei `lg:hidden`
bleiben, da sie keinen schweren Teilbaum doppelt mounten.

Die Zuständigkeiten sind wie folgt getrennt:

| Baustein | Verantwortung |
|----------|----------------|
| `useControlNavigation` | Löst Control-Route, Scope und Not-found-Zustand auf und erhält Push-/Replace-Semantik sowie Query-Parameter. Routerwerte und `NavigateFunction` werden injiziert; der Hook verwendet keine Router-Hooks. |
| `useControlSelection` | Verwaltet die markierten Control-IDs. Der Hook selbst ist scope-agnostisch: Er liefert synchron eine leere Auswahl, sobald sich der von außen übergebene `scopeId`-Wert ändert. `CatalogBrowser` übergibt dafür ausschließlich den `catalogKey` (GSPP-267), sodass die Auswahl bei Themen-/Practice-Navigation und Cross-Referenz-Sprüngen innerhalb desselben Katalogs erhalten bleibt und nur bei einem echten Katalogwechsel geleert wird. |
| `CatalogToolbar` | Stellt Titel, Counts, Auswahlmodus sowie Filter- und Exportzugänge ausschließlich aus Props zusammen und mountet Filter-Sheet, Export-Menü und Export-Sheet breakpoint-conditional über `isDesktop`. |
| `CatalogExportMenu` | Besitzt den Desktop-Menüzustand, Outside-Click, Escape, Autofokus und die Desktop-Exportaktionen. Das Mount-Gate liegt beim Aufrufer (`isDesktop`); die Komponente führt selbst kein CSS-Breakpoint-Gate mehr. |
| `CatalogMobileFilterSheet` | Besitzt Trigger, Sichtbarkeit, Focus-Trap, Escape, Backdrop, Drag-Dismiss und Scroll-Lock des mobilen Filters. |
| `CatalogMobileExportSheet` | Besitzt Trigger, Sichtbarkeit, Focus-Trap, Escape, Backdrop, Scroll-Lock und mobile Exportaktionen. |
| `CatalogMobileSelectionBar` | Exportiert die mobile Auswahl und beendet anschließend den Auswahlmodus. |
| `CatalogDesktopSidebar` | Kapselt Filter-/Detaildarstellung und die veränderbare Desktop-Panelbreite; der Breitenzustand bleibt beim Composer. |
| `CatalogDetailPanel` | Baut eingehende Links und Parent-/Child-Beziehungen auf und versorgt `ControlDetail`. |
| `CatalogMobileDetailOverlay` | Besitzt Focus-Trap, Escape und Scroll-Lock des mobilen Details. Bleibt als Komponente gemountet und steuert Sichtbarkeit über das `active`-Flag; inaktiv rendert sie `null`, sodass kein dauerhafter DOM-Knoten entsteht (dokumentierte Ausnahme der Breakpoint-Mount-Strategie). |

Mobile Overlays sind weiterhin modal und über die vorhandenen Interaktionspfade
gegenseitig ausschließend. `useScrollLock` speichert deshalb bewusst keinen
globalen Refcount, sondern stellt beim Cleanup exakt den vorherigen Inline-Wert
von `body.style.overflow` wieder her.

CSV-Serialisierung und Browserauslösung sind getrennte Grenzen:
`features/export/csvExport.ts` erzeugt unverändert Inhalt und `Blob`;
`adapters/browserDownload.ts` erstellt den temporären Link und widerruft Link
und Object-URL auch bei Fehlern garantiert in `finally`.

ESLint sichert diese Architektur statisch ab: `CatalogBrowser` darf weder den
CSV-Exporter noch den Beziehungsgraphen importieren, direkter
`document.body`-Zugriff ist in App-, Komponenten- und Feature-Code ein Fehler,
imperative Event-Listener und Dateien über 300 physische Zeilen werden als
Warnungen ausgewiesen. Hooks und Browseradapter bilden die erlaubten
Infrastrukturgrenzen. `useGlobalEventListener` bündelt globale Window- und
Document-Listener, hält den Handler über Re-Renders aktuell und garantiert
symmetrischen Abbau beim Deaktivieren oder Unmount.

## Control-Detail-Grenzen

`src/features/catalog/ControlDetail.tsx` ist der schlanke Composer der
Kontrollansicht und der einzige `useCatalog`-Aufrufer dieses Teilbaums. Er
bestimmt den Scope `${catalogKey}:${control.id}`, löst Vokabulare memoisiert
auf, bindet Clipboard- und UI-State-Hooks an und komponiert die Sektionen in
fachlicher Reihenfolge. Router-gebundene `VocabularyEntryCard`-Ausgabe bleibt
an dieser Grenze: Die reinen Sektionen erhalten einen stabilen Render-Callback
und sind dadurch ohne Router oder Katalogprovider isoliert testbar.

| Baustein | Verantwortung |
|----------|----------------|
| `useActiveVocabulary` | Hält höchstens eine Vokabularkarte offen und setzt den Zustand bei Katalog- oder Control-Wechsel synchron und dauerhaft zurück. |
| `useGuidanceOverflow` | Besitzt Expansion, Overflow-Messung, `ResizeObserver`, Window-Fallback und symmetrisches Listener-/Observer-Cleanup. |
| `ControlClassification` | Rendert Kriterien und bindet `ControlTaxonomy` an der fachlich festgelegten GSPP-140-Position ein. |
| `ControlTaxonomy` | Rendert Tags und Zielobjektkategorien einschließlich optionaler Vokabularinteraktion. |
| `ControlSecurityContext` | Rendert die Sektion „Schutzziele und Gefährdungen": delegiert die Schutzziele an `ControlSecurityTargets` und rendert die elementaren Gefährdungen als `Begriff (ID)`, alphabetisch nach Anzeigename sortiert. |
| `ControlSecurityTargets` | Rendert die vier Schutzziele als Tabelle mit `sr-only`-Spaltenkopf „Schutzziel", sichtbarem Spaltenkopf „Relevanz" und der Relevanz als zweistufige Punkte-Skala; Schutzziel- und Relevanz-Trigger bleiben unabhängig aufklappbar. |
| `ControlStatement` | Rendert den Anforderungstext. |
| `ControlStatementDetails` | Rendert Ergebnis, Präzisierung, Handlungswort und Dokumentation mit korrekter `dl`-Semantik. |
| `ControlGuidance` | Rendert die kontrollierte, bei Bedarf aufklappbare Guidance; Messung und State liegen im Hook. |
| `ControlDependencies` | Baut die lokale Incoming-Map, kombiniert reziproke Relationstexte und rendert ausschließlich aufgelöste interne Control-Beziehungen — nie deaktivierte Pseudo-Ziele. |
| `ControlSources` | Rendert aufgelöste `back-matter`-, externe und nicht auflösbare Quellen getrennt von Abhängigkeiten; nur die Auflösungsschicht entscheidet über Navigation. |
| `ControlHierarchy` | Rendert aufgelösten Parent und Erweiterungen. |
| `ControlMetadata` | Rendert UUID und nur bei nicht auflösbarem Parent den Parent-ID-Fallback. |

Die Sektionsmodule erhalten ausschließlich benötigte Controls, aufgelöste
Vokabularwerte und Callbacks. Sie verwenden weder Katalog-, Router- noch
Filterkontext. Reihenfolge, Überschriften, ARIA-Ziele sowie die
`dl`/`dt`/`dd`- bzw. Tabellensemantik sind Verträge der Kontrollansicht und
werden durch Integrationstests abgesichert. Der Render-Callback für
Vokabelkarten nimmt optional `hiddenColumns` entgegen, damit eine Sektion
Spalten ausblenden kann, deren Wert sie bereits selbst sichtbar macht.

## Suchseiten-Grenzen

`src/features/search/SearchPage.tsx` ist der Composer der Volltextsuche
(`/suche?q=…`). Er bindet `useSearch`, die 50er-Pagination und dieselben
Desktop-/Mobile-Präsentationskomponenten wie der Katalog-Browser ein, hält
dafür aber eine eigene, unabhängige Auswahl- und Export-Grenze. Die
Ergebnislisten folgen derselben Breakpoint-Mount-Strategie wie der
Katalog-Browser (GSPP-261): genau eine gemountete Liste je Breakpoint,
Auswahl-, Sortier- und Paginierungszustand überstehen den Wechsel.

| Baustein | Verantwortung |
|----------|----------------|
| `useControlSelection` | Läuft mit dem Scope `search:<catalogKey>:<query>` — unabhängig vom Katalog-Browser-Scope (`catalogKey` allein). Beide Auswahlen beeinflussen einander nicht; jede Änderung von `q` liefert synchron eine leere Auswahl. |
| `resultsUiState` | Führt `sort`, `visibleResultCount` und `mobileSelectMode` gemeinsam query-gebunden: Ein Vergleich mit der aktuellen Query entscheidet pro Feld, ob der gespeicherte Wert gilt oder auf den Ausgangszustand zurückfällt. Ein echter Query-Wechsel setzt damit synchron auch den mobilen Auswahlmodus zurück. |
| `SearchResultsToolbar` | Schlanker Composer aus Auswahlanzahl/Aufheben, mobilem Auswahlmodus-Toggle sowie den wiederverwendeten `CatalogExportMenu`- und `CatalogMobileExportSheet`-Komponenten; beide Exportzugänge werden über die Prop `isDesktop` bedingt gemountet (GSPP-268). Kein Filter-Zugang — die Suche hat keine Filterleiste. |
| `ControlTable`s `selectableControls` | Optionale Prop, die ausschließlich die Header-Aktion „Alle auswählen" und ihren vollständig/teilweise ausgewählten Zustand bestimmt; Standard bleibt `controls`. `SearchPage` übergibt weiterhin nur die gerenderte Seite als `controls`, aber alle sortierten Query-Treffer als `selectableControls`, sodass „Alle auswählen" auch nicht nachgeladene Treffer erfasst. `CatalogBrowser` übergibt die Prop nicht und bleibt unverändert. |
| `CatalogMobileSelectionBar` | Unverändert wiederverwendet; `SearchPage` rendert sie selbst (nicht die Toolbar) im mobilen Auswahlmodus und beendet Modus und Auswahl nach Export oder „Fertig". |

Export-Dateinamen sind fest: Query-Treffer heißen
`grundschutz-suchergebnisse.csv` (Desktop in aktueller Tabellensortierung,
Mobile in Suchrelevanzreihenfolge), Auswahl heißt `grundschutz-auswahl.csv`,
der Gesamtkatalogexport bleibt `grundschutz-gesamtkatalog.csv`. Der
Suchbegriff selbst fließt nie in Dateiname, Log oder zusätzlichen Speicher
ein.

### Suchindex-Cache (GSPP-218)

`useSearch` baut je Katalog fünf FlexSearch-Indizes (`controlIds`, `titles`,
`links`, `metadata`, `content`) aus den normalisierten Suchdokumenten. Der
Aufbau ist im Production-Build teuer genug, um das Frame-Budget zu sprengen und
einen Long Task auszulösen — auf einem CPU-gedrosselten Mobilprofil deutlich.
Belegt ist das gegen den Production-Build;
[ADR-12](https://linear.app/grundschutz-plus-plus/issue/ADR-12) hält die
Messwerte und die Methodik fest, das Repository pflegt sie bewusst nicht.

Der bisherige komponentenlokale `useMemo`
verwarf die Indizes beim Unmount der `SearchPage` (Detail → Zurück) und
baute sie für unveränderte Eingaben neu. Deshalb hält `useSearch` seit
GSPP-218 einen **kataloggescopten, begrenzten LRU-Cache** (`MAX_SEARCH_CACHE_ENTRIES = 3`):

* Schlüssel: stabiler `catalogKey` (aus `sourceRegistry.GRU-239`) plus
  Objektidentität von `controls`, `practices` und `vocabularyRegistry`. Die
  Frischeprüfung (`isFreshCacheEntry`) vergleicht diese drei Referenzen,
  ausdrücklich **nicht** die Array-Länge: ein gleich großes Ersatz-Array trägt
  anderen Inhalt und muss den Index neu aufbauen. Neue Referenzen invalidieren
  damit deterministisch; keine Ergebnis- oder Indexvermischung zwischen
  Katalogen.
* Begrenzung: LRU mit fester Obergrenze (aktuell 3 = Anzahl `supported`-
  Kataloge). Überschreitet der Cache die Grenze, wird der älteste Eintrag
  verworfen — kein unbegrenzter Speicheraufbau bei Katalogwechseln. Die
  Einfügereihenfolge wird beim Rebuild via `delete`+`set` korrekt
  aufgefrischt, damit ein frisch invalidierter Eintrag nicht als ältester
  gilt und vorschnell verdrängt wird.
* Rückkehr zu einem zuvor besuchten Katalog trifft nur innerhalb des
  Budgets; darüber hinaus wird neu aufgebaut.
* `SearchPage` übergibt `catalog?.catalogKey` explizit an `useSearch`, damit
  der Cache den stabilen Katalogbezeichner nutzen kann. Leere Controls oder
  fehlender `catalogKey` (transienter Ladezustand) legen keinen Cache-Eintrag
  an und belegen kein LRU-Budget — ein leerer `__default__`-Eintrag kann
  keinen echten Katalog verdrängen.
* Mutationen des Modul-Caches laufen ausschließlich in einem `useEffect`
  (Commit-Phase), nicht in `useMemo`/Render — damit erzeugen weder
  StrictMode double-invoke noch abgebrochene Concurrent-Renders verwaiste
  Evictions.

Der Cache liegt als Modul-eigenes `Map<string, SearchCacheEntry>` in
`src/features/search/useSearch.ts` (`clearSearchCache`, `getSearchCacheSize`,
`getSearchCacheKeys`, `getSearchCacheEntry` für Tests) und ist strikt
UI-seitig — kein zusätzlicher Speicher im `CatalogContext` und kein
Persistenz- oder Netzwerkzugriff.

## Filter-System

Filter werden bidirektional mit URL-Suchparametern synchronisiert (`src/hooks/useFilterParams.ts`). Die Parameter-Keys sind bewusst kurz gehalten:

- `sl` — Sicherheitsniveau (`normal-SdT`, `erhöht`)
- `el` — Aufwandsstufe (0–5)
- `mv` — Modalverb (MUSS, SOLLTE, KANN)
- `tags` — Tags
- `zk` — Zielobjekt-Kategorien
- `hw` — Handlungswort
- `dt` — Dokumentationstyp
- `lr` — Link-Beziehungen (`related`, `required`)
- `sort` — Sortierfeld + Richtung

Die Volltextsuche ist eine eigene Route (`/suche?q=…`) und kein Filter des
Katalog-Browsers. Practice- und Topic-Auswahl laufen über die kataloggescopte
Route (`/katalog/:catalogKey/:groupId`), nicht über Query-Parameter. Die
kanonische Control-URL verwendet ausschließlich `catalogKey + altIdentifier`;
die OSCAL-Control-ID bleibt eine interne Referenzidentität. Unbekannte oder
nicht geladene Katalogschlüssel und unbekannte Alt-Identifier führen ohne
globalen Fallback, Control-ID-Auflösung, Redirect oder Legacy-Route zur
Not-found-Ansicht.

Siehe [FILTERING.md](./FILTERING.md) für Details.

## Integritätsprüfung

Jeder ausgelieferte Katalog und `vocabularies.json` werden zum Build-Zeitpunkt mit einem eigenen SHA-256-Hash versehen. Zur Laufzeit wird der Hash je Artefakt erneut berechnet und mit **dessen eigenen** Metadaten verglichen. Abweichungen werden der Benutzerin / dem Benutzer in der UI angezeigt und bleiben auf das betroffene Artefakt beschränkt.

Siehe [INTEGRITY.md](./INTEGRITY.md) für Details.

## Content Security Policy

GitHub Pages erlaubt in diesem Setup keine projektspezifischen HTTP-Security-Header. Die Produktionsanwendung setzt deshalb eine Meta-CSP in `index.html`:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';
```

Die Policy begrenzt Skripte, Datenabrufe, Bilder und Schriften auf die ausgelieferte Anwendung, blockiert Plugin-Objekte und beschränkt `<base>` sowie Form-Ziele auf dieselbe Origin. `font-src 'self'` ist möglich, weil die UI-Schriften lokal unter `public/fonts/` ausgeliefert werden.

`style-src 'unsafe-inline'` bleibt bewusst gesetzt, weil Teile der React-/Tailwind-Oberfläche dynamische Inline-Styles für Interaktionen verwenden. Das ist ein eingegrenzter Tradeoff: Skripte bleiben weiterhin auf `'self'` beschränkt, und die Anwendung lädt keine externen Stylesheet-Origins.

`frame-ancestors` kann nach CSP-Spezifikation nicht wirksam per Meta-Tag gesetzt werden und würde in Chromium als ignorierte Direktive protokolliert. Ein echtes Framing-Verbot muss als HTTP-CSP-Header auf der Hosting-Schicht gesetzt werden; GitHub Pages stellt dafür in diesem Projekt derzeit keinen Mechanismus bereit.

`connect-src 'self'` ist nicht nur eine Härtungsmaßnahme. Zusammen mit den Egress-Nachweisen der Browser-Testlane (`src/test/browser/browserEgressGuard.ts`, `src/test/browser/egressOracle.negative.browser.test.ts`) bildet die Direktive die technische Grundlage, auf der die datenschutzrechtliche Einordnung lokaler Nutzerdokumente ruht: Dokumentinhalte verlassen das Gerät nicht. Wer diese Grenze aufweicht — Telemetrie, Fehlerreporting, Synchronisation, Dokumentinhalte in URL-Parametern —, ändert damit auch die Rolle des Betreibers gegenüber diesen Daten. Ein solcher Eingriff ist deshalb nicht allein eine technische Entscheidung; die Einordnung in [GSPP-341](https://linear.app/grundschutz-plus-plus/issue/GSPP-341) ist vorher fortzuschreiben.

[GSPP-341](https://linear.app/grundschutz-plus-plus/issue/GSPP-341) trägt neben dieser Einordnung auch die ausformulierte Textvorgabe für `src/features/pages/DatenschutzPage.tsx` — einschließlich der heute dort noch fehlenden Pflichtangaben nach Art. 13 DSGVO. Ihre Übernahme in den Code ist ein eigener Schritt und bewusst nicht Teil dieses Abschnitts: Der Seitentext wird eingesetzt, sobald der jeweilige Auslöser eintritt, der in [GSPP-341](https://linear.app/grundschutz-plus-plus/issue/GSPP-341) je Abschnitt benannt ist.

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
| `VITE_IMPRESSUM_TELEFON` | App (Build) | Impressum: Telefon |
| `BUILD_BASE` | Build | Überschreibt die GitHub-Pages-Base (`vite.config.ts`) |
| `BSI_SNAPSHOT_SHA` | fetch-catalog | Pinnt den Upstream-Abruf auf einen Commit |
| `GH_TOKEN` / `GITHUB_TOKEN` | fetch-catalog | Token für die GitHub-API (optional lokal, gesetzt in CI) |
| `CATALOG_SYNC_APP_CLIENT_ID` | Catalog-Sync | Repository-Variable mit der Client-ID der dedizierten GitHub App |
| `CATALOG_SYNC_APP_PRIVATE_KEY` | Catalog-Sync | Actions-Secret mit dem Private Key der dedizierten GitHub App |
| `CATALOG_SYNC_RULESET_UPDATED_AT` | Catalog-Sync | Audit-Pin der zuletzt vollständig geprüften Ruleset-Version |

Die Impressum-Werte kommen lokal aus `.env.local` (nicht committet, siehe `.env.local.example`) und in CI aus GitHub Actions Secrets.

`import.meta.env.BASE_URL` ist keine setzbare Umgebungsvariable, sondern eine von Vite aus der `base`-Konfiguration generierte Konstante; der projektseitige Override läuft über `BUILD_BASE`.

## Deployment

Das Deployment erfolgt automatisch via GitHub Actions bei Push auf `main` (`.github/workflows/deploy.yml`):

1. Gepinnter Snapshot-Commit wird aus `upstream-manifest.json` gelesen
2. Alle materialisierten Registry-Artefakte werden gegen den BSI-Snapshot validiert; nur `supported`-Daten werden ausgeliefert (`npm run fetch-catalog`)
3. Tests laufen mit Coverage
4. App wird gebaut mit Impressum-Secrets
5. SLSA-Provenance wird generiert (`actions/attest` über `dist/**`)
6. Deployment auf GitHub Pages

### Ausführungsumgebung und Berechtigungen

Jeder Workflow, der Abhängigkeiten installiert, verwendet `npm ci --ignore-scripts`.
Damit bleibt das Lockfile die einzige Installationsquelle, ohne dass Lifecycle-Skripte
von transitiven Abhängigkeiten während des CI-Setups ausgeführt werden. Der
Coverage-Lauf des Deploy-Workflows ruft Vitest mit
`npm exec --no -- vitest run --coverage` aus der lokalen, durch `package-lock.json`
festgelegten Installation auf. `--no` unterbindet einen Registry-Fallback.

Die Standardberechtigung des Deploy-Workflows beschränkt sich auf
`contents: read`. Schreibrechte für GitHub Pages, OIDC, Attestations und
Artefaktmetadaten besitzt ausschließlich der Job `build-and-deploy`; der
vorgeschaltete `idempotency_guard` behält nur seine erforderlichen Lesezugriffe.

Die generierten Katalog- und Vokabulardaten werden **nie** im Repository committet — sie werden immer frisch zum Build-Zeitpunkt von BSI abgerufen. Der Workflow `.github/workflows/update-catalog.yml` vergleicht die vollständigen Trees der in `sourceRegistry` definierten Monitoring-Wurzeln. Änderungen an registrierten Artefakten aktualisieren `upstream-manifest.json`; neue, nicht registrierte Dateien werden ausschließlich als `unclassified` gemeldet und weder gefetcht noch ausgeliefert. Tree-Dateidelta und Datenqualitätsbefunde erscheinen getrennt in Workflow-Ausgabe und PR-Beschreibung.

Manifest v2 enthält für jede materialisierte Datei `artifactKey`, erwarteten `rootType`, `lifecycle`, Pfad, Git-Blob-SHA und Content-SHA-256. Dadurch umfasst das Delta auch registrierte Kataloge, Profile, Mappings und Component Definitions; produktiv ausgeliefert werden weiterhin ausschließlich `supported`-Artefakte.

### Policy-gesteuerter Catalog-Sync

Der Sync verwendet ausschließlich eine auf dieses Repository beschränkte GitHub App. Ihr kurzlebiges Installation-Token wird zur Laufzeit erzeugt und unverändert an `gh` und Git übergeben; es gibt weder einen PAT-Fallback noch Annahmen über das Tokenformat. Der temporäre `X-GitHub-Stateless-S2S-Token`-Override wird nicht gesetzt.

Ein erkannter Upstream-Delta durchläuft folgende Lane:

1. Der Workflow prüft Auto-Merge, automatische Branch-Löschung, Ruleset 15503378 samt wirksamem Ref-Scope auf `main`, required Checks und CodeQL. Da GitHub `bypass_actors` für minimal berechtigte Tokens redigiert, muss `updated_at` denselben Zeitpunkt wie das nach vollständigem Admin-Audit gesetzte `CATALOG_SYNC_RULESET_UPDATED_AT` bezeichnen; unterschiedliche ISO-Zeitzonenrepräsentationen desselben Zeitpunkts sind zulässig, jede tatsächliche Ruleset-Änderung blockiert dagegen bis zur erneuten Prüfung.
2. Der deterministische Branch `chore/catalog-sync-<sha12>` wird neu aus `origin/main` aufgebaut und enthält genau einen Manifest-Commit.
3. Die GitHub App pusht den Branch und erstellt oder aktualisiert den PR.
4. `catalog-sync-guard`, `validate` und CodeQL sind die erwarteten Required Checks. Der Guard bindet Registry-Metadaten, Datei-Inventur, Blob-SHAs und Content-Hashes an den ausgewählten BSI-Snapshot.
5. Der Workflow fordert ausschließlich GitHub Auto-Merge mit Squash und Branch-Löschung an. Das Ruleset ist über `conditions.ref_name.include = ["~DEFAULT_BRANCH"]` auf `main` gebunden, sodass GitHub den Merge erst nach grünen Gates ausführt.
6. `.github/workflows/verify-catalog-merge.yml` verifiziert ereignisbasiert Merge-Commit und Manifest auf `main`. Die anschließende Deploy-Prüfung liegt in `scripts/verify-catalog-deploy.mjs`: Sie sucht den normalen Push-Deploy zum Merge-Commit und bestätigt ihn erst, wenn er einen terminalen Zustand mit `conclusion = success` erreicht hat. Ein fehlgeschlagener oder innerhalb des Budgets unbestätigter Deploy lässt den Verify-Job fehlschlagen. Erscheint gar kein Push-Deploy, werden Merge-Commit und Manifest erneut gegen `main` geprüft, bevor der Workflow den begrenzten Fallback dispatcht.
7. Zwischen der letzten Prüfung und dem Dispatch kann GitHub den Push-Deploy noch registrieren; dieses Fenster ist durch weitere Prüfungen nicht schließbar. Der Fallback-Dispatch übergibt deshalb `dispatch_source=catalog-sync-fallback` an `deploy.yml`, wo der Job `idempotency_guard` (`scripts/check-deploy-idempotency.mjs`) prüft, ob für denselben Commit-SHA bereits ein Deploy-Lauf erfolgreich abgeschlossen wurde. Da die Concurrency-Gruppe `pages` den Fallback-Lauf hinter dem Push-Deploy einreiht, ist dessen Zustand zu diesem Zeitpunkt terminal. Der Guard kann einen Deploy ausschließlich verhindern, nie erzwingen: bei fehlgeschlagenem Lookup, fehlenden Eingaben oder einem Job-Fehler wird deployt. Ein manueller `workflow_dispatch` lässt `dispatch_source` leer und deployt immer.

#### Vom Guard anerkannte PR-Typen

`catalog-sync-guard.mjs` läuft auf jeder PR. Berührt der Diff `upstream-manifest.json` nicht und trägt er weder Sync-Branchnamen noch Sync-Titel, passiert er ohne Netzzugriff. Andernfalls muss die PR genau einem der folgenden Typen entsprechen; jede Abweichung fällt fail-closed auf den regulären Sync-Pfad zurück und wird dort abgelehnt.

| Typ | Prädikat | Kennzeichen | Netzprüfung |
| --- | --- | --- | --- |
| Autonomer Katalog-Sync | `validateCatalogSyncPullRequest` | Branch `chore/catalog-sync-<sha12>`, exakter Titel, genau `upstream-manifest.json` geändert | `verifySnapshotProgress` und `verifySnapshotFiles` |
| Registry-Lifecycle-Migration | `isRegistryLifecycleOnlyMigration` | Manifest und Quellregister gemeinsam, **unveränderter** Snapshot, alle Content-Pins identisch, mindestens ein Lifecycle-Wechsel; keine Entsperrung aus `blocked-by-upstream` | keine — es werden keine neuen Bytes gepinnt |
| Registry-Preview-Erweiterung | `isRegistryPreviewArtifactExpansion` | Manifest und Quellregister gemeinsam, unveränderter Snapshot, ausschließlich neue interne Preview-Kataloge ohne `catalogKey` | `verifySnapshotFiles` |
| OSCAL-Versionsmigration | `isRegistryOscalVersionMigration` | Manifest und Quellregister gemeinsam, **vorwärts bewegter** Snapshot, unveränderte Artefaktidentität, im Register bewegt sich einzig `oscalVersion` von OSCAL-Artefakten; Begleitpfade nur unter `src/` und `docs/` | `verifySnapshotProgress` und `verifySnapshotFiles`, ungekürzt |

Die OSCAL-Versionsmigration löst einen strukturellen Deadlock: BSI veröffentlicht abgeleitete Artefakte gebündelt neu, und hebt dabei ein registriertes Artefakt seine `metadata.oscal-version`, blockiert der fail-closed-Abgleich aus [ADR-1](https://linear.app/grundschutz-plus-plus/issue/ADR-1) jeden Fetch. Beide Einzelwege bleiben dann rot — eine reine Registeränderung fetcht am alten Snapshot gegen die neue Erwartung, eine reine Manifest-PR am neuen Snapshot gegen die alte — und die autonome Lane kann sich nicht selbst befreien, weil `update-catalog.yml` `npm run fetch-catalog` vor der Manifest-Erzeugung aufruft. Registerbump und Snapshot-Advance müssen deshalb im selben Commit liegen.

Anders als bei den beiden anderen Ausnahmen stammt die Sicherheit hier nicht aus „keine neuen Bytes" — jeder Pin darf neue Bytes benennen. Sie stammt aus der ungekürzten Snapshot-Verifikation gegen die BSI-API und aus der Positivliste der Begleitpfade: Zulässig sind nur `src/` und `docs/`, alles andere lässt das Prädikat fail-closed zurückfallen. Die harten Regeln des autonomen Pfads — Branchname, exakter Titel, eine Datei — schützen vor Auto-Merge-Missbrauch; `update-catalog.yml` aktiviert Auto-Merge ausschließlich auf der PR, die es selbst erzeugt hat, und eine Migrations-PR mit abweichendem Branchnamen bekommt es nie. Für Produktcode ist der Guard damit nicht das Kontrollinstrument, sondern `validate`, CodeQL, Sonar, Greptile und der menschliche Merge. Was er schützen muss, ist die Beweiskette der Lane selbst — Fetch, Manifest-Erzeugung, Policy, Guard und die Workflows, die sie aufrufen. Sie liegt vollständig unter `scripts/` und `.github/`, und genau die sind von der Positivliste nicht erfasst.

Den Registerstand am PR-Base-SHA lädt `loadSourceRegistryAtRef`. Die Modulkette wird dafür in ein temporäres Verzeichnis außerhalb des Quellbaums geschrieben, damit der relative Import auf die Versionsmatrix auflöst, ohne dass ein abgebrochener Lauf ein importierbares Modul unter `src/` hinterlässt. Der Import läuft in einem Kindprozess, weil ein dynamischer Import mit berechnetem Pfad Vites Rolldown-SSR-Transform dieses Skripts zum Abbruch bringt.

Bei fehlender oder abweichender vom Preflight geprüfter Policy, einem API-Fehler, unerwartetem Diff oder fehlendem `autoMergeRequest` bricht der Workflow ab. Der Preflight prüft die Bindung der Ruleset-Conditions an `main` fail-closed mit. Der BSI-Upstream bleibt als Datenquelle grundsätzlich vertraut; eine fachliche Two-Source-Verifikation ist nicht Teil dieser Merge-Lane.

## Versionierte Review-Policy

Gitar und Greptile prüfen dieses Repository parallel. Gitar liest seine Anweisungen aus `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*`, `.gitar/**`, `.claude/skills/` und `.github/skills/` — und `.gitignore` schließt hier jede einzelne dieser Quellen aus. Bis GSPP-374 lagen die Reviewregeln deshalb vollständig außerhalb des versionierten Repositoriums, und Gitar hat ohne jede repo-seitige Anweisung gereviewt. Greptile bezog seine Regeln bis GSPP-383 aus dem Anbieter-Dashboard, beschickt über einen gitignorierten Importpfad, den jede Regeländerung von Hand nachziehen musste. Seitdem gilt für beide Reviewer dasselbe: Regeln sind versioniert, haben genau eine Autorenquelle, und alles Weitere wird daraus deterministisch erzeugt.

Die Autorenquelle besteht aus zwei Dateien mit klarer Aufgabenteilung. `scripts/review-policy.rules.mjs` trägt die Regeltabelle als reine Daten — Regel-ID, Scope und Regeltext. `scripts/review-policy.mjs` trägt Generator, Drift-Guard und CLI und ist der einzige Einstiegspunkt für Verbraucher; es re-exportiert die Tabelle. Erzeugt werden vier Adapter: `docs/REVIEW_INVARIANTS.md` (menschenlesbar, reviewbar), `.gitar/review/invarianten.md` (dünner Adapter, der die Dokumentation per `@`-Include einbindet) sowie `.greptile/config.json` und `.greptile/files.json` (Greptiles Wurzelkonfiguration, siehe unten). `npm run review-policy` erzeugt neu, `npm run review-policy:check` schlägt bei jeder manuellen Abweichung fehl und läuft als Pflichtschritt im CI-Job `validate`.

Der Guard prüft mehr als Byte-Gleichheit der erzeugten Dateien. Er stellt außerdem sicher, dass keine Anweisungsfläche an der Autorenquelle vorbei existiert: Dateien unter den von den Reviewern gelesenen Verzeichnissen — `.gitar`, `.greptile`, `.cursor` in **jeder** Verzeichnistiefe, `.github/skills` an der Wurzel — sowie die Einzeldateien `.cursorrules` und `greptile.json`, ebenfalls in jeder Tiefe, die nicht aus dem Generator stammen, sind Drift. Ein von Hand angelegtes `.greptile/rules.md` fällt damit auf, statt still zu wirken. Die Tiefenunabhängigkeit ist keine Vorsichtsmaßnahme: Greptile liest `.greptile/` laut Hersteller in jedem Verzeichnis, die Ebenen kaskadieren, und eine Kindkonfiguration schaltet über `disabledRules` geerbte Regeln der Wurzel ab — ein `src/.greptile/config.json` könnte also genau die Regeln abschalten, nach denen der PR bewertet wird, der es mitbringt. `greptile.json` steht mit auf der Liste, obwohl es keine Regeln trägt: Es ist Greptiles Wurzelkonfiguration für Review-Einstellungen und stünde damit genau an der Stelle, die `.greptile/config.json` bewusst frei lässt. Weil `.gitignore` ein `git add -f` nicht verhindert, deckt er neben diesen Flächen auch den Git-Index ab — eine erzwungen versionierte `AGENTS.md` oder `.claude/skills/`-Datei würde von Gitar angewendet, ohne je aus der Autorenquelle zu stammen. Ist der Index nicht lesbar, schlägt der Guard fehl; eine unbeantwortbare Frage ist hier kein „nein".

Aufgezählt wird die Fläche über `git ls-files --cached --others --exclude-standard`, also genau die Menge der Pfade, die im PR-Head landen können: versionierte Dateien plus unversionierte, die `.gitignore` nicht ausschließt. Das ist bewusst kein Dateisystemlauf. Ein solcher müsste `node_modules/`, Build-Ausgaben und lokale Arbeitsbäume von Hand ausnehmen, und jede dieser Ausnahmen wäre wieder eine Stelle, an der eine Anweisungsfläche unbemerkt liegen kann. Eine ausgeschlossene Datei erreicht umgekehrt keinen Reviewer und ist deshalb keine Drift — erzwingt jemand ihre Versionierung, führt `--cached` sie unabhängig von `.gitignore` wieder auf. Fehlt Git oder ist der Index defekt, schlägt der Guard fehl statt zu bestehen.

### Greptile-Adapter

Greptile wertet Konfiguration in fester Reihenfolge aus: Dashboard, dann `greptile.json`, dann `.greptile/`, dann erzwungene Organisationsregeln. Dabei gilt eine Asymmetrie, die den Migrationsweg bestimmt hat — Regeln kumulieren über alle Ebenen, Einstellungen dagegen überschreibt die jeweils nähere Ebene sofort. Solange die Dashboard-Einträge parallel zur Repo-Konfiguration bestehen, sind doppelte Befunde deshalb erwartbar und unschädlich; eine versehentlich mitgespiegelte Einstellung wäre es nicht.

Daraus folgt der Schnitt: `.greptile/config.json` trägt auf oberster Ebene ausschließlich `rules` und keine einzige Review-Einstellung. Ausschlaggebend war der Statuscheck. `Greptile Review` ist im Ruleset `main` Pflicht-Check ohne Bypass-Actors, und an der Dashboard-Einstellung „Use Status Checks" hängt die Schwelle „Required confidence to pass = 5", für die `config.json` kein Feld kennt. Ein gespiegeltes `statusCheck: true` hätte den Check zwar erzwungen, aber möglicherweise die daran hängende Schwelle auf einen Anbieter-Default zurückfallen lassen — das Merge-Gate wäre lautlos von 5/5 auf einen niedrigeren Wert gerutscht. Der gegenteilige Fehlerfall, ein ausbleibender Check, ist an jedem PR sofort sichtbar und durch Entfernen der Datei reversibel. Zwischen stiller Abschwächung und sichtbarer Blockade ist die Blockade das kleinere Übel. Am Wegwerf-Probe-PR [#210](https://github.com/dfurater/Grundschutz-Navigator/pull/210) trat keiner von beiden ein: Der Check wurde weiterhin gemeldet. `statusCheck` fällt bei fehlendem Feld also nicht auf den dokumentierten Default `false` zurück, sondern behält den Dashboard-Wert.

Aus derselben Zurückhaltung folgen die übrigen Auslassungen. `severity` und `enabled` je Regel stehen nicht in der Autorenquelle und werden nicht gesetzt — ein erfundener Wert wäre eine Reviewentscheidung ohne Deckung. Der Generierungsbanner der Markdown-Ziele entfällt ersatzlos, weil JSON keine Kommentare kennt und ein Feld wie `_generated` ein reviewsteuernd wirkender Schlüssel ohne Entsprechung in der Autorenquelle wäre. Ein Test hält `config.json` deshalb fail-closed auf genau einen Schlüssel der obersten Ebene: Wer dort später eine Einstellung ergänzt, muss das sichtbar tun. Der Hinweis „nicht von Hand bearbeiten" steht damit hier und im Drift-Guard, nicht in der erzeugten Datei.

Von Greptiles zwei Regelformaten nutzt der Adapter das strukturierte `config.json` und nicht `.greptile/rules.md`. Nur dort sind Schlüssel und Scope eigene Felder und damit maschinell gegen die Autorenquelle prüfbar; in Markdown wäre der Scope Fließtext. Der Regeltext steht präfixfrei in `rule`, der Schlüssel in `id`. Die `<key>: `-Krücke aus dem Dashboard-Zeitalter, die Regeln über ihren Text wiedererkennbar machen musste, weil Greptile keine Update-API hat, ist damit gegenstandslos — der Generator weist einen Regeltext mit Schlüsselpräfix zurück.

`.greptile/files.json` bildet die Datei-Kontexte ab. Sie waren im Dashboard nie angelegt; die Ansicht *Custom rules* führte am 2026-09-04 ausschließlich Einträge vom Typ `Rule`, und Greptiles Schnittstelle kennt für einen Dateiverweis keinen Typ. Greptile hat also bis zu diesem Adapter ohne die Datei-Kontexte gereviewt. Die Datei ist deshalb keine Migration, sondern die erste Stelle, an der sie überhaupt wirken.

Eine Fallstricknotiz für spätere Änderungen: Greptiles `strictness` ist invers zu seiner eigenen Beschriftung. Das Feld ist als `1 | 2 | 3` mit `1` = ausführlich und `3` = nur Kritisches definiert, die Oberfläche zeigt Low/Medium/High mit Low = „comment on all issues". Die eingestellte Stufe Low entspricht also `strictness: 1`. Der Adapter setzt das Feld nicht; wer es je setzt, darf die Skala nicht aus der Beschriftung ableiten.

### `.sonarcloud.properties`

SonarQube Cloud analysiert dieses Repository per Automatic Analysis; `.sonarcloud.properties` ist der dafür vorgesehene Konfigurationsweg. Die Datei enthält genau eine Einstellung: `sonar.cpd.exclusions=scripts/review-policy.rules.mjs`.

Der Grund ist eine Eigenschaft der Copy-Paste-Erkennung, nicht ein Wartbarkeitsproblem. CPD misst wiederholte Token-Folgen und normalisiert dabei Literale; 26 strukturgleiche Tabelleneinträge aus Schlüssel, Scope-Liste und Regeltext werden dadurch zwangsläufig als Duplikat gemeldet, ohne dass Verhalten kopiert wäre. Gemessen an `466d50c` lagen alle vier gemeldeten Duplikatsgruppen vollständig innerhalb der Regeltabelle. Weil `sonar.cpd.exclusions` ausschließlich dateiweit greift und keine Block- oder Zeilengranularität kennt, hätte eine Ausnahme auf einer gemischten Datei auch Generator, Drift-Guard und CLI von der Duplikatsprüfung befreit — daher der Schnitt in zwei Dateien. Ausgenommen ist allein die Duplikatsmessung auf der Datentabelle; keine Schwelle des Quality Gates wird gesenkt.

Die Datei wirkt aus dem PR-Head heraus. Ein PR könnte sich damit selbst eine Gate-Ausnahme erteilen, weshalb sie in `AGENTS.md` zu den Review-Policy-Pfaden zählt: Wer sie anfasst, braucht ein Agenten-Cross-Review.

## Siehe auch

- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [FILTERING.md](./FILTERING.md) — Filter-System
- [INTEGRITY.md](./INTEGRITY.md) — Integritätsprüfung
- [PERSISTENCE.md](./PERSISTENCE.md) — Persistenzvertrag für lokale Arbeitsbereiche
- [REVIEW_INVARIANTS.md](./REVIEW_INVARIANTS.md) — erzeugte Review-Invarianten (nicht von Hand bearbeiten)
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
