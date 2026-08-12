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

`npm run test:browser:egress-negative` aktiviert einen absichtlich nicht
erlaubten Request an die aus `window.location` abgeleitete Loopback-Origin mit
abweichendem Port; bei Port 65535 wird auf 65534 ausgewichen. Der Guard bricht
ihn vor jeder Namens- oder Netzauflösung ab. Der Negativtest erwartet genau
einen ausgeführten HTTP-Abbruch und keine WebSocket-Schließung. Der innere
Browser-Lauf **muss** mit dem Egress-Marker fehlschlagen; das Wrapper-Skript
wird nur dann grün, wenn Vitests JSON-Report exakt diesen einen fehlgeschlagenen
Test mit dem Marker enthält. Der Testkörper endet nach der Abbruchzählung
normal; erst der immer aktive `afterEach` ruft `assertNoViolations` über den
Browser-Command auf und erzeugt den Marker. Zusätzliche Testfehler, Timeouts
oder andere Runner-Signale lassen auch den Wrapper scheitern. Der Nachweis
führt damit den HTTP-Cross-Origin-Pfad aus, ohne eine zusätzliche produktive
Fetch-Quelle einzuführen.

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
│   ├── AppShell.tsx              # Routing-Konfiguration
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
• nur supported Katalog und direkte Namespace-CSVs → JSON + Provenance
• Manifest v2 bindet Registry-Metadaten, Git-Blob-SHA und Content-SHA-256
        │
        ▼
public/data/
• catalog.json                    (OSCAL 1.1.3 JSON)
• catalog-metadata.json           (Provenance + Integrity)
• vocabularies.json               (Offizielle BSI-Vokabulare)
• upstream-sources-metadata.json  (Vokabular-Provenance + Manifest v2)
        │
        ▼
CatalogContext (useEffect on mount)
• fetchCatalogWithBuffer()   → ArrayBuffer (Katalog + Vokabulare parallel)
• parseCatalogDocument()     → CatalogDocument { source, context, view }
                               source = unveränderter Quellgraph (ADR-2)
                               view   = kataloggescopter, angereicherter Catalog
• catalogReferenceProjection.ts → ruft referenceResolution.ts gegen source
                               + expliziten Kontext auf (ohne Netzwerk-,
                               Datei- oder Pfadauflösung) und ergänzt vor
                               Veröffentlichung die View: Control.links enthält
                               nur aufgelöste, kataloggescopte Ziele; der
                               Quellbaum wird dafür nur einmal indiziert
• verifyArtifactIntegrity()  → VerificationResult (Katalog + Vokabulare)
• buildVocabularyRegistry()
        │
        ▼
Feature-Komponenten und Hooks
• useFilteredControls()      → gefilterte Steuerungen
• useSearch()                → FlexSearch-Volltextsuche
• resolveControlVocabularies() → Vokabular-Auflösung
```

### Klasse-2-OSCAL-Eingang

Der bestehende Katalogfluss verarbeitet ausschließlich Build-Zeit-Artefakte
aus dem Quellregister. Lokale Klasse-2-Dokumente benutzen ihn nicht.
`src/adapters/oscalImportGate.ts` ist ihr einziger Anwendungseinstieg: Er
kopiert `ArrayBuffer` oder `Uint8Array` nur für die Übertragung und startet
`src/workers/oscalImport.worker.ts` als Modul-Worker. Der Main-Thread dekodiert,
parst oder interpretiert die Bytes nicht.

Im Worker läuft die feste Reihenfolge aus dem
[OSCAL-Validierungsvertrag](./OSCAL_VALIDATION.md): Bytelimit, fataler
UTF-8-Decoder, Duplicate-Member-Scanner, `JSON.parse`, iterative
Ressourcenlimits und anschließend `dispatchOscalDocument()`. Das Ergebnis ist
entweder ein vollständiger Root-Envelope mit explizitem
`class-2-local-user`-Kontext oder genau eine redigierte Diagnose. Der Worker
führt keine Netzwerk-, Dateisystem-, Telemetrie- oder URL-Operation aus und
terminiert nach seiner Antwort.

Dieser Einstieg liefert weder Dateiauswahl noch Persistenz, UI oder Renderer.
Er ändert deshalb weder den Klasse-1-Katalogladepfad noch dessen
Integritätskette.

Der separate Sync-Pfad (`scripts/sync-upstream-manifest.mjs` mit `scripts/upstream-artifacts.mjs`) vergleicht die vollständigen normalisierten Trees des bisherigen und des neuen Snapshots. Erst dort entstehen die Status `added`, `modified` und `removed`; neue nicht registrierte Pfade werden als `unclassified` gemeldet, ohne ihren Blob zu fetchen oder sie auszuliefern. Weil `snapshotCommitSha` Bestandteil der Manifest-Signatur ist, löst auch ein neuer Snapshot, dessen einziges Delta eine unregistrierte Datei ist, diesen Vergleich aus.

## Zustandsverwaltung

Die Anwendung verwendet React Context für den globalen Zustand:

### CatalogContext (`src/state/CatalogContext.tsx`)

Zentraler Provider, der folgende Daten bereitstellt:

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

## Routing

Die Anwendung verwendet React Router mit `BrowserRouter` und pfadbasierten URLs. Das `basename` wird aus `import.meta.env.BASE_URL` abgeleitet (`src/main.tsx`), sodass die App auch unter dem GitHub-Pages-Unterpfad `/Grundschutz-Navigator/` funktioniert. Für Deep Links kopiert das Vite-Plugin `github-pages-spa-fallback` (`vite.config.ts`) beim Build `index.html` nach `404.html`, sodass GitHub Pages unbekannte Pfade an die SPA durchreicht.

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

Die Zuständigkeiten sind wie folgt getrennt:

| Baustein | Verantwortung |
|----------|----------------|
| `useControlNavigation` | Löst Control-Route, Scope und Not-found-Zustand auf und erhält Push-/Replace-Semantik sowie Query-Parameter. Routerwerte und `NavigateFunction` werden injiziert; der Hook verwendet keine Router-Hooks. |
| `useControlSelection` | Verwaltet die markierten Control-IDs. Der Hook selbst ist scope-agnostisch: Er liefert synchron eine leere Auswahl, sobald sich der von außen übergebene `scopeId`-Wert ändert. `CatalogBrowser` übergibt dafür ausschließlich den `catalogKey` (GRU-267), sodass die Auswahl bei Themen-/Practice-Navigation und Cross-Referenz-Sprüngen innerhalb desselben Katalogs erhalten bleibt und nur bei einem echten Katalogwechsel geleert wird. |
| `CatalogToolbar` | Stellt Titel, Counts, Auswahlmodus sowie Filter- und Exportzugänge ausschließlich aus Props zusammen. |
| `CatalogExportMenu` | Besitzt den Desktop-Menüzustand, Outside-Click, Escape, Autofokus und die Desktop-Exportaktionen. |
| `CatalogMobileFilterSheet` | Besitzt Trigger, Sichtbarkeit, Focus-Trap, Escape, Backdrop, Drag-Dismiss und Scroll-Lock des mobilen Filters. |
| `CatalogMobileExportSheet` | Besitzt Trigger, Sichtbarkeit, Focus-Trap, Escape, Backdrop, Scroll-Lock und mobile Exportaktionen. |
| `CatalogMobileSelectionBar` | Exportiert die mobile Auswahl und beendet anschließend den Auswahlmodus. |
| `CatalogDesktopSidebar` | Kapselt Filter-/Detaildarstellung und die veränderbare Desktop-Panelbreite; der Breitenzustand bleibt beim Composer. |
| `CatalogDetailPanel` | Baut eingehende Links und Parent-/Child-Beziehungen auf und versorgt `ControlDetail`. |
| `CatalogMobileDetailOverlay` | Besitzt Focus-Trap, Escape und Scroll-Lock des mobilen Details. |

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
| `ControlClassification` | Rendert Kriterien und bindet `ControlTaxonomy` an der fachlich festgelegten GRU-140-Position ein. |
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

Die ausgelieferten Artefakte `catalog.json` und `vocabularies.json` werden zum Build-Zeitpunkt jeweils mit einem SHA-256-Hash versehen. Zur Laufzeit wird der Hash erneut berechnet und mit den gespeicherten Metadaten verglichen. Abweichungen werden der Benutzerin / dem Benutzer in der UI angezeigt.

Siehe [INTEGRITY.md](./INTEGRITY.md) für Details.

## Content Security Policy

GitHub Pages erlaubt in diesem Setup keine projektspezifischen HTTP-Security-Header. Die Produktionsanwendung setzt deshalb eine Meta-CSP in `index.html`:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';
```

Die Policy begrenzt Skripte, Datenabrufe, Bilder und Schriften auf die ausgelieferte Anwendung, blockiert Plugin-Objekte und beschränkt `<base>` sowie Form-Ziele auf dieselbe Origin. `font-src 'self'` ist möglich, weil die UI-Schriften lokal unter `public/fonts/` ausgeliefert werden.

`style-src 'unsafe-inline'` bleibt bewusst gesetzt, weil Teile der React-/Tailwind-Oberfläche dynamische Inline-Styles für Interaktionen verwenden. Das ist ein eingegrenzter Tradeoff: Skripte bleiben weiterhin auf `'self'` beschränkt, und die Anwendung lädt keine externen Stylesheet-Origins.

`frame-ancestors` kann nach CSP-Spezifikation nicht wirksam per Meta-Tag gesetzt werden und würde in Chromium als ignorierte Direktive protokolliert. Ein echtes Framing-Verbot muss als HTTP-CSP-Header auf der Hosting-Schicht gesetzt werden; GitHub Pages stellt dafür in diesem Projekt derzeit keinen Mechanismus bereit.

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

Bei fehlender oder abweichender vom Preflight geprüfter Policy, einem API-Fehler, unerwartetem Diff oder fehlendem `autoMergeRequest` bricht der Workflow ab. Der Preflight prüft die Bindung der Ruleset-Conditions an `main` fail-closed mit. Der BSI-Upstream bleibt als Datenquelle grundsätzlich vertraut; eine fachliche Two-Source-Verifikation ist nicht Teil dieser Merge-Lane.

## Siehe auch

- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [FILTERING.md](./FILTERING.md) — Filter-System
- [INTEGRITY.md](./INTEGRITY.md) — Integritätsprüfung
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
