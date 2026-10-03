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
| Scrollleisten | OverlayScrollbars (MIT) |
| Testing | Vitest + @testing-library/react + jsdom + Chromium-Browser-Lane; jsdom parst im Build zusätzlich die gebaute HTML-Auslieferung für den Titelvertrag |
| Deployment | GitHub Pages (via GitHub Actions) |

## Browser-Testlane

`npm run test` läuft vollständig in jsdom und schließt Dateien unter `src/test/browser/**/*.browser.test.ts` explizit aus (Ausschluss in `vite.config.ts`).

`npm run test:browser` startet die getrennte Vitest-Browser-Lane aus `vitest.browser.config.ts` mit dem Playwright-Provider und Chromium. Jede Testdatei läuft in einem eigenen Test-iframe (`isolate: true`); `src/test/browser/iframePath+encoding.browser.test.ts` sichert ab, dass ein `+` im Testdateipfad die iframe-Zuordnung nicht bricht. Die Lane führt `ajv` in `optimizeDeps.include`, weil die Schemaprüfung das Paket erst zur Laufzeit importiert. Jeder Test bereinigt seine eigene IndexedDB-Datenbank, und der Egress-Guard setzt seinen Zustand vor jedem Test zurück.

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

Der Baum ist vollständig: Jedes Verzeichnis, unter dem Einträge stehen, führt alle seine Dateien und Unterverzeichnisse auf. Ausgenommen sind nur die kolokierten Tests (`*.test.*`). Ein Verzeichnis ohne eigene Einträge steht für seinen gesamten Inhalt. `scripts/architecture-tree.test.ts` prüft ihn in `npm run test` gegen alle Dateien, die Git führt oder nicht ignoriert: Der Test schlägt fehl, wenn ein Eintrag keine Beschreibung trägt, auf keinen existierenden Pfad passenden Typs zeigt oder ein aufgezähltes Verzeichnis eine nicht aufgeführte Datei enthält.

```
src/                              # Anwendungsquellcode
├── domain/                       # Domänenmodelle und Geschäftslogik
│   ├── catalogLineage.d.mts          # Typen der Profile-Importkette
│   ├── catalogLineage.mjs            # Profile-Importkette für die About-Provenienz (reines ESM)
│   ├── catalogLineage.ts             # Typsicherer Einstieg in catalogLineage.mjs
│   ├── catalogLineageValidation.ts   # Strukturprüfung und Auswahl der aktiven Sidecar-Lineage
│   ├── catalogReferenceProjection.ts # Aufgelöste Control-Links in der Katalog-View
│   ├── class2ImportLimits.d.mts      # Typen der Klasse-2-Ressourcengrenzen
│   ├── class2ImportLimits.mjs        # Klasse-2-Ressourcengrenzen (einzige Quelle, reines ESM)
│   ├── componentDefinitionModel.ts   # Domänenmodell der Component Definition
│   ├── controlRef.ts                 # Kataloggescopte interne Control-Referenzen
│   ├── controlRelationships.ts       # Link-Relationen, Beschriftungen, eingehende Links
│   ├── germanCollation.ts            # Wiederverwendete deutsche Sortierkomparatoren
│   ├── identifierQuery.ts            # Query-Vertrag für Kennungssuchen (UUID v4/v5)
│   ├── integrity.ts                  # SHA-256 Integritätsprüfung
│   ├── mappingModel.ts               # Domänenmodell der Mapping Collection
│   ├── models.ts                     # Zwei-Schichten-Datentypen
│   ├── oscalBackMatterBase64.ts      # Base64-Buchhaltung des Klasse-2-Ressourcenlimits
│   ├── oscalClass2Import.ts          # Worker-interne Klasse-2-Pipeline ab den Bytes
│   ├── oscalComponentDefinition.ts   # Raw-Typen des Roots component-definition
│   ├── oscalDerivedGraph.ts          # Kontrollierter Builder des Ableitungswegs
│   ├── oscalDiagnostics.ts           # Gemeinsames Diagnosemodell aller Validierungsstufen
│   ├── oscalDocumentContext.ts       # Vertrauensklasse und Ableitungskontext
│   ├── oscalImportContract.ts        # Validatorpin, Worker-Timeout, Limit-Diagnosen
│   ├── oscalImportProcessing.ts      # Byte-Eintrittspunkt mit Herkunftsregister
│   ├── oscalImportTransport.ts       # Fragmentierter Rückweg des Quellgraphen aus dem Worker
│   ├── oscalMapping.ts               # Raw-Typen des Roots mapping-collection
│   ├── oscalObjectGraph.ts           # Objektgraph-Invariante und Ressourcenlimits
│   ├── oscalObjectPipeline.ts        # Gemeinsame objektorientierte Klasse-2-Prüfkette
│   ├── oscalObjectProvenance.ts      # Herkunftsfrage und fail-closed Diagnose
│   ├── oscalObjectWalk.ts            # Gemeinsamer Containerdurchlauf der Herkunftskette
│   ├── oscalProfile.ts               # Raw-Typen des Roots profile
│   ├── oscalRootDocument.ts          # Root-Envelope des generischen Dispatch
│   ├── oscalSchemaBundle.ts          # Einziger Zugriffsweg auf die gepinnten NIST-Schemas
│   ├── oscalSchemaValidation.ts      # Stufe 3: JSON-Schema-Prüfung im Worker
│   ├── oscalVersionMatrix.d.mts      # Typen der Versionsmatrix
│   ├── oscalVersionMatrix.mjs        # Root-Typ × OSCAL-Version × gepinntes Schema
│   ├── oscalVersionMatrix.ts         # Typsicherer Einstieg in oscalVersionMatrix.mjs
│   ├── placeholderNamespace.ts       # Erkennt BSI-Platzhalter als Prop-Namensraum
│   ├── profileModel.ts               # Domänenmodell des Profile
│   ├── profileResolutionBudget.ts    # Laufendes Arbeits- und Ausgabebudget
│   ├── profileResolutionBudgetLimits.d.mts # Typ der Arbeitsgrenze
│   ├── profileResolutionBudgetLimits.mjs   # Arbeitsgrenze (einzige Quelle, reines ESM)
│   ├── profileResolutionEngine.ts    # Orchestrator Import → Merge → Modify
│   ├── profileResolutionImportGraph.ts # Deterministischer, fail-closed Importgraph
│   ├── profileResolutionMerge.ts     # Phase 2: Merge
│   ├── profileResolutionModify.ts    # Phase 3: Modify
│   ├── profileResolutionSelection.ts # Phase 1: Selektion
│   ├── projectProps.ts               # Registry der projekteigenen OSCAL-Props
│   ├── referenceGraph.ts             # Referenzgraph über alle vier Root-Typen (Stufe 5)
│   ├── referenceGraphContext.ts      # Auswertungskontext und Kantenablage
│   ├── referenceGraphEdges.ts        # Kanten für Profile, Mappings, Components
│   ├── referenceGraphIndex.ts        # Knotenindex je Dokument aus dem Quellgraphen
│   ├── referenceGraphModel.ts        # Knoten, Kanten, Zustände, Diagnostic-Codes
│   ├── referenceGraphPolicy.ts       # CI-Politik: fail-closed, Allowlist, Bericht
│   ├── referenceResolution.ts        # Fail-closed OSCAL-Referenzauflösung auf source
│   ├── securityTargets.ts            # Schutzziel-Skala, Klassifikation, Facetten
│   ├── sourceRegistry.d.mts          # Typen des Quellregisters
│   ├── sourceRegistry.mjs            # Verbindlicher Upstream-/Katalogvertrag
│   ├── sourceRegistry.ts             # Typsicherer Einstieg in sourceRegistry.mjs
│   ├── statementSegments.ts          # Reine Segmentierung des Anforderungssatzes
│   ├── taxonomyVocabulary.ts         # Auflösung von Praktiken und Themen
│   ├── uuidV5.ts                     # Deterministische UUIDv5-Ableitung
│   ├── vocabulary.ts                 # BSI-Vokabular-Auflösung
│   ├── vocabularyNamespaces.ts       # Namespace-URLs aus dem Quellregister
│   ├── vocabularyRouteId.d.mts       # Typ der Routenkennung
│   ├── vocabularyRouteId.mjs         # Routenkennung aus dem Upstream-Pfad (einzige Quelle, reines ESM)
│   └── vocabularyRouteId.ts          # Typsicherer Einstieg in vocabularyRouteId.mjs
├── adapters/                     # Infrastruktur- und Datengrenzen
│   ├── browserDownload.ts            # Temporärer Browser-Download mit Cleanup
│   ├── oscalAdapter.ts               # OSCAL-Katalogkörper → Domain Model
│   ├── oscalComponentAdapter.ts      # Projektion der Component Definition
│   ├── oscalComponentDocument.ts     # Verlustfreier Dokumenteinstieg Component Definition
│   ├── oscalComponentReaders.ts      # Knotenleser und Diagnosen des Component-Adapters
│   ├── oscalDocument.ts              # Verlustfreier Dokumenteinstieg Katalog
│   ├── oscalImportGate.ts            # Main-Thread-Tor des Klasse-2-Imports über den Worker
│   ├── oscalMappingAdapter.ts        # Projektion der Mapping Collection
│   ├── oscalMappingDocument.ts       # Verlustfreier Dokumenteinstieg Mapping Collection
│   ├── oscalMappingReaders.ts        # Knotenleser und Diagnosen des Mapping-Adapters
│   ├── oscalProfileAdapter.ts        # Projektion des Profile
│   ├── oscalProfileDocument.ts       # Verlustfreier Dokumenteinstieg Profile
│   ├── oscalProfileReaders.ts        # Knotenleser und Diagnosen des Profile-Adapters
│   ├── oscalRootAdapters.ts          # Adapter-Registrierung je Root-Typ
│   └── oscalRootDispatch.ts          # Stufe 2: Root-Dispatch
├── state/                        # Globaler Anwendungszustand
│   ├── CatalogContext.tsx            # Katalog-Kontextprovider
│   ├── MobileNavigationContext.ts    # Mobiler Navigationszustand für Sheet-Mount-Gates
│   ├── catalogArtifacts.ts           # Auslieferungsvertrag und Ladevorgang je Katalog
│   ├── catalogParseWorker.ts         # Typisierter Client des Katalog-Parser-Workers
│   ├── catalogParsing.ts             # Parsepipeline für Worker und Main-Thread-Fallback
│   └── catalogReducer.ts             # Zustand der Katalogsammlung
├── hooks/                        # Wiederverwendbare React Hooks
│   ├── useActiveVocabulary.ts        # Katalog-/Control-gescopte Vokabularkarte
│   ├── useBottomSheetDrag.ts         # Ziehen und Wegwischen mobiler Bottom Sheets
│   ├── useCatalog.ts                 # Katalog-Daten
│   ├── useClipboard.ts               # Kopieren in die Zwischenablage mit Rückmeldung
│   ├── useControlNavigation.ts       # Kataloggescopte Detailnavigation
│   ├── useControlSelection.ts        # Katalog-/Gruppen-gescopte Auswahl
│   ├── useDocumentDetailPage.ts      # Scroll- und Fokusvertrag der mobilen Detailseite
│   ├── useDragToResize.ts            # Größenänderung von Panels per Ziehen
│   ├── useFilterParams.ts            # URL-Parameter-Sync
│   ├── useFilteredControls.ts        # Filterlogik
│   ├── useFocusTrap.ts               # Barrierefreiheit
│   ├── useGlobalEventListener.ts     # Globale Listener mit stabilem Cleanup
│   ├── useGuidanceOverflow.ts        # Scopegebundener Guidance-/Messzustand
│   ├── useMediaQuery.ts              # Responsive Design
│   ├── useOverlayScrollbars.ts       # Überlagernde, beim Scrollen eingeblendete Scrollleisten
│   ├── useRowWindow.ts               # Windowing für Listen einheitlicher Zeilenhöhe
│   └── useScrollLock.ts              # Reversibler Body-Scroll-Lock
├── features/                     # Feature-Module (Seite + Komponenten)
│   ├── catalog/                      # Katalogansicht
│   │   ├── CatalogBrowser.tsx            # Katalogseite mit Tabelle, Filtern und Detailpanel
│   │   ├── CatalogDesktopSidebar.tsx     # Ein- und ausklappbare Filterleiste (Desktop)
│   │   ├── CatalogDetailPanel.tsx        # Detailpanel einer Anforderung
│   │   ├── CatalogExportMenu.tsx         # Exportmenü der Toolbar
│   │   ├── CatalogMobileExportSheet.tsx  # Export als Bottom Sheet (mobil)
│   │   ├── CatalogMobileFilterSheet.tsx  # Filter als Bottom Sheet (mobil)
│   │   ├── CatalogMobileList.tsx         # Trefferliste unterhalb lg mit Auswahlmodus
│   │   ├── CatalogMobileSelectToggle.tsx # Auswahl-Schalter unter lg (Katalog und Suche)
│   │   ├── CatalogMobileSelectionBar.tsx # Auswahlleiste (mobil): „Fertig“ und Export mit Zähler
│   │   ├── CatalogSelectionChip.tsx      # Zähler-Chip „n ausgewählt“ (Katalog und Suche)
│   │   ├── CatalogTargetNotFound.tsx     # Hinweis auf ein nicht gefundenes Routenziel
│   │   ├── CatalogToolbar.tsx            # Titel, Trefferzahl und Aktionen
│   │   ├── catalogScopeTitle.ts          # Bereichsüberschrift und Dokumenttitel eines Scopes
│   │   ├── ControlClassification.tsx     # Kriterien-Badges und Legenden-Einträge
│   │   ├── ControlDependencies.tsx       # Aus- und eingehende Control-Links
│   │   ├── ControlDetail.tsx             # Detailansicht einer Anforderung
│   │   ├── ControlDetailSection.tsx      # Abschnittsrahmen der Detailansicht
│   │   ├── ControlGuidance.tsx           # Umsetzungshinweis mit Auf- und Zuklappen
│   │   ├── ControlHierarchy.tsx          # Eltern- und Kind-Anforderungen
│   │   ├── ControlListLink.tsx           # Link-Zeilen in „Zusammenhänge“ mit gemeinsamer Kennungsspalte
│   │   ├── ControlMetadata.tsx           # Kennungen und Elternbezug
│   │   ├── ControlMobileReferenceRow.tsx # Tabellenzeile der Mobilansicht
│   │   ├── ControlSecurityContext.tsx    # Schutzziele und Gefährdungen in „Schutzziele und Gefährdungen“
│   │   ├── ControlSecurityTargets.tsx    # Raster der Schutzziel-Relevanz
│   │   ├── ControlSources.tsx            # Aufgelöste Quellenverweise
│   │   ├── ControlStatement.tsx          # Segmentierter Anforderungstext mit Inline-Begriffen
│   │   ├── ControlStatementDetails.tsx   # Nicht im Satz gefundene Angaben und Dokumentation
│   │   ├── ControlTable.tsx              # Gefensterte Anforderungstabelle mit Auswahl und Sortierung
│   │   ├── ControlTaxonomy.tsx           # Zielobjekt- bzw. Tag-Gruppe und WLAN-Taxonomie
│   │   ├── ControlTaxonomyBreadcrumb.tsx # Praktik- und Themenbegriffe im Kopf
│   │   ├── ControlVocabularyPrimitives.tsx # Gemeinsame Bausteine der Vokabularanzeige
│   │   ├── FilterPanel.tsx               # Filterpanel
│   │   └── SecurityTargetFilterSection.tsx # Schutzziel-Facetten im Filterpanel
│   ├── export/                       # CSV-Export
│   │   └── csvExport.ts                  # CSV-Erzeugung mit Formelschutz
│   ├── home/                         # Startseite
│   │   └── HomePage.tsx                  # Startseite mit Katalogkennzahlen und Praktikenliste
│   ├── pages/                        # About, Impressum, Datenschutz, Lizenzen
│   │   ├── AboutPage.tsx                 # About mit Provenienz der Kataloge
│   │   ├── DatenschutzPage.tsx           # Datenschutzerklärung aus VITE_IMPRESSUM_*
│   │   ├── ImpressumPage.tsx             # Impressum aus VITE_IMPRESSUM_*
│   │   └── LizenzenPage.tsx              # Lizenzen
│   ├── search/                       # Volltextsuche
│   │   ├── SearchPage.tsx                # Suchseite mit Ergebnisliste
│   │   ├── SearchResultsToolbar.tsx      # Auswahl und CSV-Export der Treffer
│   │   ├── searchRanking.ts              # Trefferbewertung als reine Funktion
│   │   └── useSearch.ts                  # FlexSearch-Index mit begrenztem Cache
│   ├── vocabularies/                 # Vokabular-Seiten
│   │   ├── VocabularyEntryCard.tsx       # Karte eines Vokabulareintrags
│   │   ├── VocabularyNamespacePage.tsx   # Einträge eines Namespace
│   │   ├── VocabularyOverviewPage.tsx    # Übersicht aller Vokabulare
│   │   └── vocabularyTitle.ts            # Anzeigetitel je Vokabulardatei
│   └── vocabulary/                   # Vokabular-Anzeige-Helpers
│       ├── display.ts                    # Offizielle Stufen, Beschriftungen, Tooltips
│       └── routes.ts                     # Routen der Vokabularseiten
├── components/                   # Wiederverwendbare UI-Komponenten
│   ├── BackdropTint.tsx              # Abdunklung fester Hintergründe als Kind-Element
│   ├── Badge.tsx                     # Badge-Varianten
│   ├── Button.tsx                    # Button-Varianten und -Größen
│   ├── CatalogSwitcher.tsx           # Katalogauswahl
│   ├── CheckboxLabel.tsx             # Checkbox mit Beschriftung und Zähler
│   ├── FilterSection.tsx             # Aufklappbarer Filterabschnitt
│   ├── Footer.tsx                    # Seitenfuß
│   ├── HeaderBar.tsx                 # Kopfleiste mit Suche und Katalogauswahl
│   ├── Input.tsx                     # Eingabefeld mit Icon und Label
│   ├── StatusMeta.tsx                # Status-Badges für Modalverb, Niveau, Aufwand
│   ├── Tooltip.tsx                   # Hover- und antippbare Begriffserklärungen
│   ├── TreeNav.tsx                   # Gruppenbaum der Navigation
│   ├── icons.tsx                     # Inline-SVG-Icons (Lucide)
│   ├── index.ts                      # Sammelexport der Komponenten
│   ├── legendStyles.ts               # Legendenschema für Legenden und Vokabelkarten
│   └── tooltipPlacement.ts           # Begrenzung eines geöffneten Tooltips auf Panel und Fenster
├── app/                          # Anwendungshell
│   ├── AppShell.tsx                  # Routing-Konfiguration und Layoutrahmen
│   ├── PageTitle.tsx                 # Deklarativer Routentitel (hebt <title> in den <head>)
│   ├── pageTitles.ts                 # Feste Seitentitel als einzige Quelle der Wahrheit
│   ├── routes.ts                     # Kanonische URL-Builder und Resolver
│   ├── staticPageRoutes.tsx          # Statische Routen samt deklariertem Titel
│   └── staticTitleFallback.ts        # Entfernt den markierten index.html-Titel
├── workers/                      # Modul-Worker
│   ├── catalogParser.worker.ts       # Klasse-1-Katalogparser
│   └── oscalImport.worker.ts         # Klasse-2-Import
├── test/                         # Testinfrastruktur (siehe docs/OSCAL_ROUND_TRIP.md)
│   ├── browser/                      # Chromium-Browser-Lane
│   │   ├── browserCommands.d.ts          # Typen der Browser-Commands
│   │   ├── browserEgressDecision.ts      # Reine Egress-Entscheidung
│   │   ├── browserEgressGuard.ts         # Playwright-Egress-Guard
│   │   ├── browserSetup.ts               # Setup der Browser-Lane mit Egress-Prüfung
│   │   ├── egressOracleContract.d.mts    # Typen der Negativfälle
│   │   └── egressOracleContract.mjs      # Negativfälle des Egress-Orakels
│   ├── fixtures/                     # Testfixtures, darunter der NIST-Orakelkorpus
│   ├── catalogState.ts               # Sammlungsfelder des CatalogState für Komponententests
│   ├── documentTitle.ts              # Prüft den Seitentitel auf genau ein <title>
│   ├── eslintWithoutTypes.ts         # Repo-ESLint ohne Project Service für Regeltests
│   ├── oscalGraphCompare.ts          # Graphvergleich mit Object.is-Semantik
│   ├── oscalRoundTrip.ts             # No-op-Round-trip-Harnisch
│   └── oscalStructure.ts             # Strukturorakel (Zählregeln A und B)
├── index.css                     # Tailwind-Einstieg und Design-Tokens
├── main.tsx                      # Einstiegspunkt
├── test-setup.ts                 # Vitest-Setup der jsdom-Lane
└── vite-env.d.ts                 # Typen der Vite-Umgebungsvariablen

public/data/                      # Generierte Katalog-Daten (nicht im Repo)

scripts/                          # Build-, CI- und Wartungsskripte
├── measure/                          # Browserseite der Klasse-2-Kostenmessung
│   ├── class2-budget.harness.mjs         # Messharnisch im Browser-Tab
│   └── class2-budget.html                # Messseite des temporären Vite-Servers
├── backmerge-main-to-develop.mjs     # Übernahme-Lane main → develop
├── bootstrap.mjs                     # npm run setup für frische Checkouts und Worktrees
├── branchLineFixtures.ts             # Git-Testvorlage der Übernahme- und Release-Lane
├── catalog-sync-guard.mjs            # Fail-closed Prüfung von Sync-PRs
├── catalog-sync-policy.mjs           # Prüfung der Repository-Policy
├── check-catalog-freshness.d.mts     # Typen der Frischeprüfung
├── check-catalog-freshness.mjs       # Frischeprüfung der lokalen Katalogdaten
├── check-deploy-idempotency.mjs      # Redundanten Fallback-Deploy desselben Commits verhindern
├── check-seo-titles.d.mts            # Typen der Titelvertragsprüfung
├── check-seo-titles.mjs              # Titelvertrag der gebauten HTML-Auslieferung
├── ci-scope.mjs                      # Scope-Entscheider für Step-Skips im Job validate
├── class2TransportFixtures.mjs       # Fixtures des fragmentierten Rückwegs
├── class2WorstCaseFixtures.mjs       # Worst-Case-Dokumente der Klasse-2-Grenzen
├── control-identity-delta.mjs        # Control-Identitätsdelta zwischen Snapshots
├── deployChecksums.d.mts            # Typen des Prüfsummen-Manifests
├── deployChecksums.mjs               # Prüfsummen-Manifest SHA256SUMS der Pages-Auslieferung
├── fetch-catalog.mjs                 # Registry-gesteuerter Abruf, Validierung und Ausgabe
├── git-changed-files.mjs             # Geänderte Dateien eines Pull Requests
├── githubApiFetch.mjs                # Gemeinsamer GitHub-JSON-Abruf der CI-Guards
├── greptile-review-nudge.mjs         # Greptile-Auslösung bei übersprungenem PR
├── guard-cli-test-helper.ts          # spawnSync-Rahmen der Guard-CLI-Tests
├── measure-class2-budget.mjs         # Kostenmessung der Klasse-2-Grenzen (Wartung)
├── measureClass2BudgetReport.mjs     # Argumente, Verdichtung und Bericht der Messung
├── measureClass2Timing.mjs           # Eingaben und Ablauf der Zeitmessung
├── measureWorkLimitCallCounts.mjs    # Aufrufzählung des gemessenen Auflösungslaufs
├── measureWorkLimitProvenance.mjs    # Fingerprint des gemessenen Auflösungspfads
├── oscal-domain-bridge.mjs           # Node-Brücke in src/domain/ mit @/-Auflösung
├── oscal-schema-vendor.mjs           # Ablageort-Vertrag der gepinnten Schemas
├── pr-documentation-contract.mjs     # Dokumentationsvertrag im PR-Body
├── profileResolutionCorpusOracle.ts  # Vergleichsorakel des Bauzeitlaufs
├── profileResolutionWorstCaseFixtures.mjs # Worst-Case-Eingaben der Arbeitsgrenze
├── release-prepare.mjs               # Release-PR aus einem Vorbereitungsbranch
├── review-policy.mjs                 # Generator, Drift-Guard und CLI der Review-Policy
├── review-policy.rules.mjs           # Regeltabelle der Review-Policy
├── security-guards.mjs               # Upstream-Allowlist (Repo, Pfade, Refs)
├── seoRouteEntries.ts               # Öffentliche Routentitel und sichere statische OG-HTML-Einstiege
├── sonar-token-guard.mjs             # Entscheidet, ob die Sonar-Analyse laufen kann
├── sync-oscal-content-oracle.mjs     # Wartungssync des NIST-Orakelkorpus
├── sync-oscal-schemas.mjs            # Wartungslauf der gepinnten OSCAL-Schemas
├── sync-upstream-manifest.mjs        # Manifest-Sync für update-catalog.yml
├── taxonomy-coverage.mjs             # Integrität und Coverage der Taxonomie-Vokabulare
├── transientRetry.mjs                # Gemeinsamer transienter Abruf der Lieferkette
├── upstream-artifacts.mjs            # Tree-Diff, Manifest v2 und Root-Prüfung
├── upstream-corpus-cache.mjs         # Korpus-Cache des Bauzeitlaufs
├── verify-browser-egress.mjs         # Negativläufe des Browser-Egress-Guards
├── verify-catalog-deploy.mjs         # Post-Merge-Deploy bestätigen oder Fallback freigeben
├── verify-documented-versions.mjs    # Toolchain-Vertrag der Browser-Testlane
├── verify-node-version.mjs           # .nvmrc gegen engines.node und gegen Versionsliterale prüfen
├── verify-oscal-schemas.mjs          # Netzfreie Integritätsprüfung der Schemas
├── verify-upstream-oscal.mjs         # Gepinnter go-oscal-Korpuslauf
├── verifyDeployment.mjs              # Prüfbefehl für eine Live-Datei gegen das attestierte Manifest
├── vitest.corpus.config.ts           # Vitest-Lane des Bauzeitlaufs
├── vocabulary-utils.mjs              # CSV-/Namespace-Hilfsfunktionen
└── workflowDefinitions.mjs           # Gemeinsame Sammlung der Workflow- und Action-Definitionen

.github/                          # GitHub-Konfiguration
├── actions/                          # Composite Actions
│   ├── fetch-pinned-catalog/             # Gepinnte Snapshot-SHA lesen und Katalog holen
│   └── setup-node-env/                   # Node aus .nvmrc plus npm ci --ignore-scripts
├── workflows/                        # GitHub-Actions-Workflows
│   ├── backmerge-main-to-develop.yml     # Übernahme-PR main → develop
│   ├── ci.yml                            # PR-Metadatenverträge (documentation-contract, catalog-sync-guard)
│   ├── deploy.yml                        # GitHub Pages Deployment
│   ├── greptile-review-nudge.yml         # Greptile-Auslösung bei übersprungenem PR
│   ├── release-prepare.yml               # Release-PR aus einem Vorbereitungsbranch
│   ├── sonar.yml                         # SonarQube-Analyse des Push-Pfads auf main und develop
│   ├── update-catalog.yml                # Automatischer Katalog-Sync
│   ├── validate.yml                      # Vollständige Verifikations- und Build-Lane (validate, sonarqube)
│   └── verify-catalog-merge.yml          # Post-Merge-Prüfung und Deploy-Fallback
├── dependabot.yml                    # Dependabot-Update-Gruppen
├── pull_request_template.md          # PR-Vorlage mit Dokumentationsvertrag
├── zizmor.version                    # Gepinnte zizmor-Version des Workflow-Audits
└── zizmor.yml                        # Audit-Konfiguration von zizmor im Job validate

upstream-manifest.json            # Gepinnter Upstream-Snapshot (Manifest v2)
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

Der Worker akzeptiert nur Nachrichten mit leerem Origin oder seiner eigenen Origin. Ein explizit fremder Origin beendet das Protokoll vor der Auswertung von `event.data` mit genau einem `failure`-Frame; ein laufender Stream wird verworfen und jede Folgenachricht bleibt ohne Antwort. Das Gate meldet dafür `OSCAL_IMPORT_WORKER_FAILURE`, statt auf den Timeout zu warten.

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

Das Vite-Plugin `github-pages-spa-fallback` (`vite.config.ts`) erzeugt beim Build statische HTTP-200-Einstiege unter `dist/<route>/index.html`. Es gilt nur für den Build (`apply: 'build'`), weil Vite `closeBundle` auch beim Schließen von Dev-Server und Vitest aufruft. Die festen Inhaltsrouten (`/suche`, `/vokabular`, `/about`, `/datenschutz`, `/impressum`, `/lizenzen`) stammen aus der gemeinsamen Titeltabelle `STATIC_CONTENT_TITLES` in `scripts/seoRouteEntries.ts`; Katalogeinstiege und deren adressierbare Praktiken, Themen und Kontrollen stammen ausschließlich aus den von `listSupportedCatalogs()` ausgelieferten öffentlichen Katalogen. Der Helfer prüft die Katalogbytes gegen ihre Integritätsmetadaten, verarbeitet sie mit dem bestehenden `parseCatalog()` und verwendet dieselben URL-Builder wie die App. Die bestehende Node-Brücke löst beim Laden dieser TypeScript-Module den Projektalias auf, bevor Vite selbst seine Konfiguration geladen hat.

Jeder HTML-Einstieg erhält genau einen inhaltsbezogenen `og:title` und eine kanonische `og:url`. Die Titel lauten: Produktname für die Startseite, fester Seitentitel für Inhaltsseiten, Katalogname für einen Katalog, `Gruppenname | Katalogname` für Praktik oder Thema und `Kontroll-ID: Kontrolltitel | Katalogname` für eine Kontrolle. Die Titeltrenner `: ` zwischen Kennung und Titel sowie ` | ` vor dem übergeordneten Namen werden zentral als `TITLE_ID_SEPARATOR` und `TITLE_PARENT_SEPARATOR` in `src/app/pageTitles.ts` gepflegt. Browser-Titel ergänzen ` | Grundschutz++ Navigator`; Vokabularseiten verwenden `<Vokabularname> | Vokabulare | Grundschutz++ Navigator`. Die Meta-Beschreibung verwendet einen Doppelpunkt nach dem Produktnamen; der Alternativtext des OG-Bildes gibt die Textzeilen des Bildes als Sätze wieder. Die URL verwendet den Production-Origin und die normalisierte Deployment-Basis aus `BUILD_BASE`. HTML-Attributwerte werden maskiert. Beim Erzeugen der Routen-HTML ersetzt `writeSeoRouteEntries` nur `og:title` und `og:url`; `PageTitle` entfernt den statischen Titel-Fallback im Layout-Effekt.

Query und Fragment erzeugen keine zusätzlichen Dateien und erscheinen nicht in Metadaten; ein Such- oder Filterlink erhält den Kopf seiner Route. Gruppen ohne ID erzeugen keinen Einstieg. Fehlende oder nicht auflösbare unterstützte Daten, Hashabweichungen, Pfad-Ausbruch, Symlinks und kollidierende Ausgabepfade führen vor dem Schreiben der Routendateien zum Fehler. Nach dem Schreiben prüft der Titelvertrag (`scripts/check-seo-titles.mjs`) jede gebaute HTML-Datei mit dem HTML-Parser von jsdom auf genau einen `<title>`-, `og:title`-, Meta-Description- und `og:image:alt`-Treffer ohne Gedankenstrich — erst er sieht das gebaute `dist/`-HTML statt der Quellvorlage. Für unbekannte Ziele dient `dist/404.html` als Fallback mit neutralem Produkttitel und kanonischer Startseiten-URL. Der Fallback bleibt bytegleich zum gebauten Startseiten-HTML.

### Sitemap

Beim Build entsteht deterministisch eine UTF-8-kodierte `dist/sitemap.xml` mit XML-Deklaration und dem Namespace `http://www.sitemaps.org/schemas/sitemap/0.9`. Sie enthält genau einmal die absolute kanonische URL der Startseite, der sechs festen Inhaltsrouten und jedes von `listSupportedCatalogs()` gelieferten Katalogeinstiegs — die feste Einstiegs-Positivliste aus `listCanonicalEntryRoutes()`. Die zusätzlichen Gruppen- und Kontroll-HTML-Einstiege erweitern diesen Sitemapvertrag nicht. Origin (`https://dfurater.github.io`) und Basispfad (`/Grundschutz-Navigator/`) sind die Production-Defaults des Buildvertrags; XML-Sonderzeichen werden escaped. Geschrieben werden ausschließlich die Pflichtfelder `urlset`, `url` und `loc`. Die manuelle Einreichung in der Search Console liegt beim Projekt-Owner und ist kein Teil des Builds.

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

Breakpoint-abhängige UI wird über `useMediaQuery('(min-width: 1024px)')` (`isDesktop`) bedingt **gemountet**, nicht per CSS versteckt — zu jedem Zeitpunkt ist nur der passende Teilbaum im DOM. Drei Ausnahmen: Der `CatalogMobileDetailOverlay` behält sein `active`-Prop-Muster, weil er inaktiv `null` rendert und seinen Modal-Lifecycle (Focus-Trap, Scroll-Lock, Escape) selbst besitzt; die mobile Detailseite blendet Toolbar und Liste per `hidden` aus, statt sie abzubauen, und baut nur die mobilen Filter- und Export-Sheets ab (siehe „Mobile Detailseite“); kleine stateless Buttons dürfen bei `lg:hidden` bleiben, da sie keinen schweren Teilbaum doppelt mounten.

Die sichtbare Bereichsüberschrift der Toolbar nennt nur den Namen der gewählten Praktik oder des Themas, etwa „Notfallvorsorge“ für NOT.3; der Dokumenttitel behält Kennung und Name („NOT.3: Notfallvorsorge | …“). Beide liefert `describeCatalogScope` (`catalogScopeTitle.ts`).

| Baustein | Verantwortung |
|----------|----------------|
| `useControlNavigation` | Löst Control-Route, Scope und Not-found-Zustand auf und erhält Push-/Replace-Semantik sowie Query-Parameter. Routerwerte und `NavigateFunction` werden injiziert; der Hook verwendet keine Router-Hooks. |
| `useControlSelection` | Verwaltet die markierten Control-IDs. Der Hook ist scope-agnostisch: Er liefert synchron eine leere Auswahl, sobald sich der von außen übergebene `scopeId`-Wert ändert. `CatalogBrowser` übergibt dafür ausschließlich den `catalogKey`, sodass die Auswahl bei Themen-/Practice-Navigation und Cross-Referenz-Sprüngen innerhalb desselben Katalogs erhalten bleibt und nur bei einem echten Katalogwechsel geleert wird. |
| `CatalogToolbar` | Stellt Titel, Counts, Auswahlmodus sowie Filter- und Exportzugänge aus Props zusammen und mountet Filter-Sheet, Export-Menü und Export-Sheet breakpoint-conditional über `isDesktop`. Ihre Überschrift ist Rückkehrziel beim Schließen der mobilen Detailseite. Unter `sm` steht die Überschrift über die volle Breite (bis zu zwei Zeilen, umbrochen und getrennt statt abgeschnitten); darunter folgen links Anzahl und „Filter zurücksetzen“, rechts Auswahl, Filter und CSV als gleich große 44-px-Icon-Schalter, deren letzter am Viewport-Rand endet. Ab `sm` bleibt die einzeilige Anordnung, ab `md` die feste Höhe von 51 px. |
| `CatalogMobileList` | Rendert die ungefensterte Trefferliste unterhalb `lg` mit Auswahlmodus und Auswahlleiste; ab `md` trägt sie einen eigenen Scrollbereich, darunter scrollt das Dokument. |
| `CatalogExportMenu` | Besitzt den Desktop-Menüzustand, Outside-Click, Escape, Autofokus und die Desktop-Exportaktionen. Das Mount-Gate liegt beim Aufrufer (`isDesktop`). |
| `CatalogMobileFilterSheet` | Besitzt Trigger, Sichtbarkeit, Focus-Trap, Escape, Backdrop, Drag-Dismiss und Scroll-Lock des mobilen Filters. |
| `CatalogMobileExportSheet` | Besitzt Trigger, Sichtbarkeit, Focus-Trap, Escape, Backdrop, Scroll-Lock und mobile Exportaktionen. Der Trigger ist ein Icon-Schalter mit dem Namen „CSV exportieren“. |
| `CatalogMobileSelectToggle` | Auswahl-Schalter unter `lg` mit `IconListChecks` (Lucide `list-checks`) und `aria-pressed`; aktiv ist er die Glyphe in Akzentfarbe auf einer 36-px-Tönung, nicht eine gefüllte Fläche. Katalog und Suche verwenden denselben Baustein. |
| `CatalogSelectionChip` | Zähler-Chip „n ausgewählt“ mit Aufheben-Kreuz für Katalog und Suche. Er entfällt im mobilen Auswahlmodus, weil dort die Auswahlleiste die Zahl trägt, und ist unter `sm` generell ausgeblendet. |
| `CatalogMobileSelectionBar` | Exportiert die mobile Auswahl und beendet anschließend den Auswahlmodus. Links steht „Fertig“, rechts „Export“ mit Zähler: Icon und Zähler tragen die Akzentfarbe, die Zahl steht damit genau einmal sichtbar. Der Button nennt sie in seinem zugänglichen Namen, eine unsichtbare Live-Region sagt Änderungen an; ohne Auswahl ist der Export deaktiviert. |
| `CatalogDesktopSidebar` | Kapselt Filter-/Detaildarstellung und die veränderbare Desktop-Panelbreite; der Breitenzustand bleibt beim Composer. |
| `CatalogDetailPanel` | Baut eingehende Links und Parent-/Child-Beziehungen auf und versorgt `ControlDetail`. |
| `CatalogMobileDetailOverlay` | Besitzt Focus-Trap, Escape und Scroll-Lock des Details zwischen `md` und `lg`, wo die Shell selbst nicht scrollt. Bleibt als Komponente gemountet und steuert Sichtbarkeit über das `active`-Flag; inaktiv rendert sie `null` (dokumentierte Ausnahme der Breakpoint-Mount-Strategie). |
| `CatalogDetailPage` | Zeigt das Detail unterhalb `md` als Seite im Dokumentfluss (`ControlDetail` mit `layout="page"`), ohne Overlay und ohne Scroll-Sperre. |
| `useDocumentDetailPage` | Besitzt Scroll-, Fokus- und Escape-Vertrag der mobilen Detailseite (siehe unten). |

### Mobile Navigation

Unterhalb `md` (768 px, `OWN_SCROLL_AREA_QUERY`) besitzt die offene Navigationsschublade Escape in der Capture-Phase am `document`. `useGlobalEventListener` behält für bestehende Aufrufer die Bubble-Phase bei; seine optionale Capture-Einstellung wird bei Anmeldung und Cleanup identisch verwendet. Die Schublade verhindert die Standardaktion und stoppt die Weitergabe, bevor darunterliegende Detail- oder Sheet-Handler reagieren, unabhängig von deren Registrierungsreihenfolge. Sie schließt und setzt den Fokus mit `preventScroll` auf das Menü-Symbol im App-Kopf zurück. X, Abdunklung und Navigationsauswahl verwenden denselben Schließübergang zum Menüsymbol. Verlässt die Navigationsauswahl eine offene mobile Detailseite und zeigt einen anderen Themen- oder Praktikbereich, setzt `useDocumentDetailPage` den abschließenden Fokus auf dessen Bereichsüberschrift und startet die Liste oben. Auf dem Desktop bleibt die Fokusführung der persistenten Navigation erhalten. Beim bloßen Schließen per Escape, X oder Abdunklung bleibt das Detail dahinter offen; ein weiteres Escape am Menüsymbol bleibt außerhalb des Detail-Geltungsbereichs. Erst Escape aus dem Detail oder vom `body` schließt es regulär. Der Menübutton meldet den Zustand mit `aria-expanded` und verweist über `aria-controls` auf die stabile ID der Schublade. Eine geschlossene mobile Schublade bleibt für die vorhandene Transition gerendert, ist jedoch per `inert` weder fokussierbar noch im Barrierefreiheitsbaum erreichbar. Beim Öffnen setzt die Shell den Fokus mit `preventScroll` auf den Menübutton, bevor der Hauptinhalt `inert` wird oder ein bereits geöffnetes Sheet abgebaut wird; damit erhält auch ein Safari-Klick ohne nativen Button-Fokus ein sichtbares Fokusziel. Solange die mobile Schublade offen ist, ist der Hauptinhalt per `inert` aus Tastatur- und Screenreader-Navigation genommen. So können dort keine Filter- oder Export-Sheets hinter der Schublade geöffnet werden. Der App-Kopf bleibt bedienbar, und der Katalogwechsler schließt die Schublade über den bestehenden Zustandsausschluss. Ab `md` sind Hauptinhalt und Seitenleiste ohne `inert` bedienbar; die Navigation besitzt dort keinen mobilen Escape-Handler.

Der von der Shell bereitgestellte `MobileNavigationContext` trägt ausschließlich den mobilen Öffnungszustand an die Katalog- und Such-Toolbar weiter. Während die Navigation offen ist, bauen sie ihre mobilen Filter- und Export-Sheets einschließlich der Trigger ab. Damit gibt auch ein zuvor geöffnetes Sheet seine Fokus- und Scroll-Sperre frei, wenn die Navigation anschließend über den App-Kopf geöffnet wird. Nach dem Schließen der Navigation erscheinen die Trigger wieder mit geschlossenem Sheet; Filter- und Auswahlzustand bleiben beim jeweiligen Composer erhalten.

### Mobile Detailseite

Unterhalb `md` (`OWN_SCROLL_AREA_QUERY`) scrollt das Dokument, nicht ein innerer Bereich. Dort ersetzt das geöffnete Detail die Liste als Seite im normalen Dokumentfluss, ohne Scroll-Sperre am `body` und ohne eigenen Scrollbereich; so scrollt das Dokument, und mobile Browser können beim Scrollen ihre Leiste einklappen, wie in der Liste. Toolbar und Liste bleiben gemountet, sind aber per `hidden` weder sichtbar noch per Tastatur oder Screenreader erreichbar; Auswahlmodus, Filter und Zeilenzustand überstehen so das Öffnen und Schließen. `ControlDetail` verzichtet mit `layout="page"` auf feste Höhe, eigenen Scrollbereich und OverlayScrollbars-Instanz. Zwischen `md` und `lg` scrollt die Shell nicht; dort bleibt es beim Overlay mit Focus-Trap und Scroll-Sperre, ab `lg` bei der Desktop-Spalte.

`useDocumentDetailPage` regelt Scrollposition und Fokus. Solange die Liste sichtbar ist, merkt sich der Hook bei jedem Scroll-Ereignis die Dokumentposition. Sein Abo endet im Commit, der das Detail zeigt, also vor dem Scroll-Ereignis, mit dem der Browser die kürzere Seite nachführt. Öffnen und jeder Wechsel zu einer verknüpften Kontrolle beginnen oben und setzen den Fokus auf die Überschrift des Details (`[data-control-detail-title]`, `tabIndex=-1`). Schließen über den Zurück-Button, Escape oder Browser-Zurück läuft über dieselbe Routenänderung: Im Layout-Effekt, bevor die Liste gemalt wird, stellt der Hook die gemerkte Position wieder her und fokussiert die Zeile der Kontrolle, mit der die Seite geöffnet wurde (`[data-control-row]`), auch nach Wechseln zu verknüpften Kontrollen. Escape schließt nur, wenn kein anderer Baustein es schon behandelt hat (`defaultPrevented`) und es aus der Detailseite (`[data-control-detail-page]`) oder vom `body` kommt; Escape im mitlaufenden App-Kopf, etwa im Katalogwechsler oder in der Suche, lässt das Detail offen. Fehlt sie, etwa nach einem Direktaufruf mit gefilterter Liste, geht der Fokus auf die Bereichsüberschrift der Toolbar. Führt das Schließen in einen anderen Listenbereich, etwa weil über den Navigations-Drawer ein anderes Thema gewählt wurde, gilt die gemerkte Position nicht: Die Liste beginnt oben, und der Fokus geht auf die Bereichsüberschrift. Maßgeblich ist der Bereich der zuletzt sichtbaren Liste (Katalog laut Route und Thema bzw. Praktik), nicht das Thema der geöffneten Kontrolle und nicht der noch geladene Katalog während eines Katalogwechsels; wer aus der Gesamtliste öffnet und schließt, kehrt also zur alten Position zurück. Steht das Rückkehrziel noch nicht im DOM, etwa während ein anderer Katalog lädt, setzt der Hook den Fokus, sobald die Liste erscheint. `CatalogBrowser` bestimmt einen gemeinsamen Anzeigezustand mit der Priorität `loading`, `error`, `notFound` (ungültige Route oder fehlender Katalog), `content`. Sowohl die Renderzweige als auch `listReady` verwenden diesen Zustand; der Inhaltsfall trägt den vorhandenen Katalog typsicher. Bereich und Position merkt sich der Hook nur bei `listReady` im Inhaltsfall und geschlossener Detailseite (`controlId === null`), wenn die Liste tatsächlich sichtbar ist; Lade-, Fehler- und Nicht-gefunden-Ansicht, etwa beim Direktaufruf oder im Zwischenstand eines Katalogwechsels, zählen nicht als Herkunft. Solange das Detail als Seite offen ist, baut `CatalogToolbar` Filter- und Export-Sheet ab (`mobileSheetsSuspended`); ein offenes Sheet, etwa vor Browser-Vorwärts auf eine Kontrollroute, hielte sonst unsichtbar Scroll-Sperre und Focus-Trap, und die Detailseite ließe sich nicht scrollen. Wechselt die Breite bei offenem Detail auf `md` oder breiter, zeigen Overlay bzw. Desktop-Spalte dieselbe Kontrolle. Die gemerkte Ausgangszeile samt Listenbereich und Dokumentposition bleibt dabei erhalten, auch wenn in der breiten Ansicht zu einer verknüpften Kontrolle gewechselt wird. Nach Rückkehr unter `md` führt das Schließen zur ursprünglichen Zeile zurück. Wird das Detail schon in der breiten Ansicht geschlossen, endet diese Rückkehrbindung; die nächste mobile Öffnung erhält einen neuen Ausgangspunkt. Der App-Kopf bleibt oben stehen (`sticky`); ein geöffneter Tooltip beginnt deshalb unter ihm (`[data-sticky-header]` in `tooltipPlacement.ts`). `html` trägt dieselbe Hintergrundfarbe wie `body` (`src/index.css`); ohne sie zeigt Safari 26 unter seiner Liquid-Glass-Leiste eine undurchsichtige graue Fläche statt des Seiteninhalts. Aus demselben Grund tragen feste Hintergründe, die den unteren Rand in voller Breite berühren (Abdunklung hinter Navigations-Drawer, Filter- und Export-Sheet), keine eigene Hintergrundfarbe; die Abdunklung liegt auf einem absolut positionierten Kind (`BackdropTint`), weil Safari 26 seine Leiste sonst mit der Farbe des festen Elements füllt.

### Rendering der Desktop-Tabelle

`ControlTable` rendert gefenstert (`useRowWindow`): Im DOM stehen nur die sichtbaren Zeilen plus bis zu zehn Zeilen Überhang je Richtung, am Listenanfang und -ende entsprechend weniger. `aria-hidden`-Platzhalterzeilen ohne `tabindex` vor und nach dem Fenster sowie, wenn die Tab-Stopp-Zeile außerhalb des Fensters liegt, zwischen ihr und dem Fenster halten Gesamthöhe und Scrollposition wie bei der vollständigen Liste; es sind daher null bis drei. Die Zeilenhöhe ist durch `line-clamp-1` und feste Innenabstände einheitlich und wird als Abstand aufeinanderfolgender Zeilen am DOM gemessen, weil `border-collapse` die erste Zeile nach einem Platzhalter um einen halben Rand verkürzt. Die Tabelle nutzt `table-layout: fixed` mit einer `<colgroup>`, damit die Spaltenbreiten nicht von den gerade gerenderten Zeilen abhängen. `src/test/browser/controlTableWindow.browser.test.ts` prüft das in Chromium mit echter Tabellengeometrie, geladenen Schriften und dem Stylesheet der Scrollleisten, auf dem Desktop und unterhalb von `sm`, jeweils ohne und mit Auswahlspalte sowie mit einer per Tastatur auf die letzte Zeile gesetzten Tab-Stopp-Zeile außerhalb des Fensters: An mehreren Scrollpositionen bis zum Listenende steht jede gerenderte Zeile dort, wo sie in der vollständigen Liste stünde, der sichtbare Bereich unter der Kopfzeile ist lückenlos gefüllt, und die Gesamthöhe entspricht der vollständigen Liste.

* Barrierefreiheit: `aria-rowcount` trägt die volle Ergebnismenge plus Kopfzeile, jede Datenzeile ihr `aria-rowindex` in der vollständigen Liste.
* Tastatur: `ArrowUp`/`ArrowDown`/`Home`/`End` fokussieren eine gerenderte Zielzeile sofort; eine noch nicht gerenderte wird zur Tab-Stopp-Zeile, vom Fenster gerendert und nach dem Commit fokussiert. Die Tab-Stopp-Zeile ist an die Control-ID gebunden, wandert also bei Umsortierung mit, und bleibt gerendert, wenn der Nutzer sie wegscrollt, sodass Fokus und Roving Tabindex erhalten bleiben.
* „Alle auswählen" und Zählungen wirken auf die vollständige Ergebnismenge, nicht auf die gerenderten Zeilen.
* Die Browser-Seitensuche findet nur gerenderte Zeilen; für die Suche im Katalog ist die App-Suche vorgesehen.
* Der Lesecursor eines Screenreaders (Browse-Modus) erreicht ebenfalls nur gerenderte Zeilen. Der vorgesehene Leseweg durch die gesamte Ergebnismenge ist die Grid-Navigation per Pfeiltasten, `Home` und `End`, die das Fenster mitführt; `aria-rowcount` und `aria-rowindex` nennen dabei die Position in der vollständigen Liste.

Die mobile Liste bleibt ungefenstert: `content-visibility: auto` auf `.catalog-mobile-reference-row` hält ihr Layout bereits unabhängig von der Zeilenzahl. `index.html` lädt die vier Inter-Latin-Schnitte per `preload` vor, weil die Tabelle Inter 600 sonst erst nach ihrem ersten Render anfordert und das Eintreffen der Schrift ein zweites Layout aller Zeilen auslöst.

Alle eigenen Scrollbereiche tragen überlagernde Scrollleisten aus OverlayScrollbars über `useOverlayScrollbars`: im Ruhezustand unsichtbar und ohne Breitenbedarf, beim Scrollen eingeblendet, danach wieder ausgeblendet. Der Hook macht das bestehende Scroll-Element selbst zum Viewport, statt es in erzeugte Elemente zu verpacken. So misst `useRowWindow` `scrollTop` und `clientHeight` am Scroll-Element selbst, und der Tooltip begrenzt sich auf `[data-control-detail-scroll]`. Bereiche, die erst ab `md` selbst scrollen (Seiteninhalt, mobile Trefferlisten), erhalten die Instanz nur ab dieser Breite; darunter scrollt das Dokument mit den nativen Leisten des Geräts. Das Theme `.os-theme-gspp` in `src/index.css` setzt das Aussehen aus den Tokens `--color-surface-scrollbar` und `--color-surface-scrollbar-hover`.

`useScrollLock` zählt aktive Sperren mit: Die erste merkt sich den vorherigen Inline-Wert von `body.style.overflow`, erst das Ende der letzten stellt ihn exakt wieder her. Überlappende Sperren, etwa ein Sheet und das Detail-Overlay zwischen `md` und `lg`, dürfen so in beliebiger Reihenfolge enden.

CSV-Serialisierung und Browserauslösung sind getrennte Grenzen: `features/export/csvExport.ts` erzeugt Inhalt und `Blob`; `adapters/browserDownload.ts` erstellt den temporären Link und widerruft Link und Object-URL auch bei Fehlern in `finally`.

Der Export ist semikolongetrennt und deckt drei Quellen ab: die gefilterte Tabelle, die Suchtreffer und eine manuelle Auswahl. Die Spalte `control_alt_identifier` ist innerhalb des aktuellen Katalogs eindeutig, aber nicht garantiert über BSI-Versionen hinweg stabil.

ESLint sichert diese Architektur statisch ab: `CatalogBrowser` darf weder den CSV-Exporter noch den Beziehungsgraphen importieren. In App-, Komponenten- und Feature-Code (`src/features/**/*.{ts,tsx}`, `src/app/**/*.{ts,tsx}`, `src/components/**/*.{ts,tsx}`) ist direkter `document.body`-Zugriff ein Fehler, imperative Event-Listener werden dort als Warnungen ausgewiesen. Dateien unter `src/**/*.{ts,tsx}` mit mehr als 300 physischen Zeilen werden ebenfalls als Warnungen ausgewiesen. `useGlobalEventListener` bündelt globale Window- und Document-Listener und garantiert symmetrischen Abbau beim Deaktivieren oder Unmount.

Für `src/**/*.{ts,tsx}` läuft ESLint zusätzlich mit Typinformation (typescript-eslint Project Service über die Referenzen in `tsconfig.json`) und erzwingt zwei Promise-Regeln als Fehler: `await-thenable` verbietet ein `await` auf synchrone Werte, weil es einen veralteten Async-Vertrag vortäuscht, und `no-floating-promises` verlangt, dass ein Promise im Produktionscode abgewartet, abgefangen oder mit `void` ausdrücklich als Fire-and-forget markiert wird. Die `.mjs`-Dateien unter `src/` liegen außerhalb dieses Gates. In Tests (`src/**/*.test.{ts,tsx}`) ist nur `no-floating-promises` abgeschaltet: Dort meldet die Regel vor allem synchrone `act()`-Aufrufe, und unbehandelte Rejections lassen den Vitest-Lauf ohnehin fehlschlagen.

## Control-Detail-Grenzen

`src/features/catalog/ControlDetail.tsx` ist der Composer der Kontrollansicht und der einzige `useCatalog`-Aufrufer dieses Teilbaums. Er bestimmt den Scope `${catalogKey}:${control.id}`, löst Vokabulare memoisiert auf und komponiert Kopf, Anforderung (mit den Kriterien-Badges als erster Zeile), Umsetzungshinweise, „Schutzziele und Gefährdungen“, „Einordnung“, Zusammenhänge und Fußzeile in dieser Reihenfolge. Alle Blöcke sind gleich aufgebaut: Die Blocküberschrift bildet eine schmale Leiste, der Inhalt liegt auf Weiß, zwischen den Blöcken und vor der Fußzeile stehen 20 px. Leere Bereiche entfallen. Beschriftete Unterabschnitte eines Blocks trennt eine dekorative 1-px-Linie in der Rahmenfarbe mit je 12 px Abstand (`subSectionStackClass`); sie hängt am Geschwister-Selektor und erscheint deshalb nur zwischen tatsächlich gerenderten Abschnitten. Router-gebundene `VocabularyEntryCard`-Ausgabe bleibt an dieser Grenze: Die Sektionen erhalten einen stabilen Render-Callback und sind dadurch ohne Router oder Katalogprovider isoliert testbar.

`segmentStatement()` in `src/domain/statementSegments.ts` zerlegt den rohen Anforderungstext und die `ParamMeta`-Werte ohne React in Satzteile. Praktik, Modalverb, Handlungswort, Ergebnis und Präzisierung werden nur als eigenständige Wörter verankert, damit etwa das Ergebnis „Risiko“ nicht in „Risikoanalyse“ landet; die Praktik zählt nur am Satzanfang. BSI-Auswahlklammern entfernt sie in derselben Reihenfolge wie `resolveParams`: erst Parameter einsetzen, dann Klammern entfernen. So verschwindet auch eine Klammer, die einen Platzhalter umschließt, und die aneinandergereihten Segmente ergeben genau `Control.statement`. Die Darstellung setzt Begriffstrigger direkt an gefundenen Satzteilen; fehlende Ergebnis-, Präzisierungs- und Handlungswort-Anker erscheinen mit Beschriftung unter dem Satz. Als gefunden zählt nur eine Fundstelle, die die Segmente vollständig tragen: Jedes berührte Stück ist ein Textstück oder, bei Ergebnis und Präzisierung, ein Parameterwert ganz im Satzteil, und keine Grenze zwischen Text und Parameterwert teilt ein Wort. Ein gesetzter leerer Wert erzeugt keine solche Grenze; der Text davor und danach bleibt ein Stück. Eine Fundstelle im eingesetzten Wert eines Parameters, eine, die einen Wert nur anschneidet, und eine, in der ein Wert ein Wort teilt (`Risi` + Wert `ko`), wird übersprungen; gibt es keine weitere im Text, gilt der Satzteil als fehlend. Verdeckt ein früherer Satzteil einen Anker, etwa ein Handlungswort im Ergebnis, sucht der Anker hinter diesem Satzteil weiter und fehlt erst ohne weitere erreichbare Fundstelle. So bleibt etwa ein Handlungswort, das nur als Parameterwert vorkommt, über seine Restzeile erklärbar, und kein Auslöser trägt nur einen Wortteil. Dokumentation steht dort unabhängig davon. Ein Parameter ohne gesetzten Wert bleibt als aufgelöster Label-Fallback lesbar und erhält eine antippbare Erklärung. Fehlt auch das Label, bleibt er ein leeres Segment; die Darstellung zeigt dann „…“ mit dem zugänglichen Namen „Festzulegender Wert“ und derselben Erklärung, statt einer Lücke oder eines unsichtbaren Fokusziels. Ein gesetzter leerer Wert erzeugt kein Fokusziel. `Control.statement` bleibt der aufgelöste Text für Suche und Export. Der gemeinsame `Tooltip`-Baustein steuert Hover- und Antipp-Erklärungen, während `useActiveVocabulary` die geöffnete Vokabularkarte begrenzt. Ergebnis und Präzisierung ohne eigenen Vokabeleintrag sind je ein Tastatur-Fokusziel, auch wenn Platzhalter sie unterbrechen; die Platzhalter darin bleiben eigene Fokusziele. Mit Vokabeleintrag wird jedes Textstück des Satzteils ein eigener Begriffs-Trigger; besteht der Satzteil nur aus gesetzten Parameterwerten, tragen diese den Trigger, damit die Erklärung erreichbar bleibt. Die Karten-Container aller aufgelösten Begriffe stehen auch geschlossen (`hidden`) im DOM, sodass `aria-controls` der Trigger immer auflöst. Die Satzteil-Beschriftung erscheint bei Hover und Tastaturfokus, nicht nach Antippen; Antippen eines Platzhalters darin zählt nicht als Antippen des Satzteils. Der Tooltip-Text bleibt versteckt im DOM, damit `aria-describedby` schon beim Fokus auflöst, und Esc schließt nur den Tooltip, nicht das umgebende mobile Detail. Seine ID bildet jeder Tooltip aus einem lesbaren Präfix und einer eigenen Kennung (`useId`): Die Stücke eines Satzteils mit Vokabeleintrag steuern dieselbe Vokabelkarte, beschreiben aber je ihren eigenen Tooltip. Ein geöffneter Tooltip hält sich im sichtbaren Teil des Detail-Panels unterhalb des mitlaufenden App-Kopfs (`tooltipPlacement.ts`) und misst seine Lage bei jedem Scrollen außerhalb seiner selbst und jeder Größenänderung von Fenster und Panel neu. Das Panel ändert seine Breite auch ohne das Fenster, beim Ziehen am Rand; das Ziehen nimmt den Fokus nicht, ein per Tastatur geöffneter Tooltip bleibt also offen. `src/test/browser/tooltipPanelResize.browser.test.ts` prüft in Chromium, dass er nach dem Verengen innerhalb der verengten Panelkante steht, auch beim Ziehen mit echter Maus am Handle des Katalog-Browsers: Der Fokus bleibt am Auslöser, und der Tooltip bleibt offen. Reicht der Platz unter seinem Auslöser nicht, klappt er über ihn, statt ihn zu verdecken; scrollt der Auslöser ganz hinaus, bleibt er an ihm. Passt er auf keine Seite ganz, nimmt er die Seite mit mehr Platz und scrollt in deren Höhe, damit der Auslöser antippbar bleibt; nur wenn der Auslöser selbst den sichtbaren Bereich ausfüllt, wird der Tooltip über ihn geklemmt. Den Scrollstand seines Inhalts setzt jede Nachmessung danach wieder. Dieselbe Chromium-Datei prüft das in einem niedrigen Panel, auch dass Scrollen im Tooltip keine Nachmessung auslöst.

| Baustein | Verantwortung |
|----------|----------------|
| `useActiveVocabulary` | Hält höchstens eine Vokabularkarte offen und setzt den Zustand bei Katalog- oder Control-Wechsel synchron zurück. |
| `useGuidanceOverflow` | Besitzt Expansion, Overflow-Messung, `ResizeObserver`, Window-Fallback und symmetrisches Listener-/Observer-Cleanup. |
| `ControlClassification` | Rendert die Kriterien-Badges für Modalverb, Sicherheitsniveau und Aufwand im Block „Anforderung“ und liefert Einträge für die dort von `ControlDetailSection` gerenderte Legende. |
| `ControlTaxonomy` | Rendert je eine beschriftete Gruppe ohne Rahmen oder Symbol: „Zielobjekte“ im Block „Anforderung“, weil das BSI sie im `statement`-Part ablegt, und „Tags“ im Block „Einordnung“, weil sie an der Anforderung selbst hängen; dazu die WLAN-Taxonomie in „Einordnung“ als Tabelle (Stufe links, Wert rechts); die Namensraum-Adresse erscheint nur, wenn sie kein Platzhalter ist (`isPlaceholderNamespace`). |
| `ControlSecurityContext` | Rendert Schutzziele und elementare Gefährdungen im Block „Schutzziele und Gefährdungen“; der Gefährdungsname öffnet eine Karte mit Kennung. |
| `ControlSecurityTargets` | Rendert die vier Schutzziele mit Relevanz-Skala: ab 18.5rem Inhaltsbreite in zwei Spaltenpaaren, darunter in einer Spalte. Das 2×2-Raster braucht mit geladenen App-Schriften 18,16rem; `src/test/browser/controlSecurityTargets.browser.test.ts` prüft beide Anordnungen unmittelbar am Umschaltpunkt, bei 288, 361 und 370 px sowie mit 20 px Grundschrift. Die Relevanz ist reine Anzeige ohne eigene Karte; Schutzziel und Wert ordnet die Gruppe für Screenreader zu, erklärt wird die Skala in der Legende, deren Einträge dieselbe Punkte-Skala verwenden. |
| `ControlStatement` | Rendert den segmentierten Anforderungssatz mit Begriffstriggern und Platzhalter-Erklärungen. |
| `ControlStatementDetails` | Rendert nicht im Satz gefundene Angaben und die Dokumentation als Zeilen mit Beschriftung darüber. |
| `ControlGuidance` | Rendert die bei Bedarf aufklappbare Guidance; Messung und State liegen im Hook. |
| `ControlDependencies` | Rendert aufgelöste interne Control-Beziehungen unter „Verknüpft" mit lesbaren Relationsnamen und Herkunftslegende. Ausgehende Links stehen je Relationsart in einer Gruppe, deren Beschriftung einmal sichtbar über der Liste steht und die Gruppe zugleich benennt. Unter einem Link steht nur ein eigener Hinweis zur Gegenrichtung, „Verweist auf diese Kontrolle · <Relationsart>“, mehrere Relationsarten kommagetrennt; rein eingehende Kontrollen erscheinen einmal mit allen ihren Relationsarten. Der Hinweis ist zugleich die Beschreibung (`aria-describedby`) des Links. |
| `ControlListLink` | Link-Zeile für Erweiterungen und Verknüpfungen: Kennung in einer gemeinsamen Monospace-Spalte, deren Breite `ControlDetail` für den ganzen Block „Zusammenhänge“ an der längsten sichtbaren Kennung bemisst (`controlIdColumnStyle`, in `ch`), Titel und Zusatztexte (`ControlListNote`) bündig daneben. |
| `ControlSources` | Rendert aufgelöste `back-matter`-, externe und nicht auflösbare Verweise unter „Quellen" als Liste mit Punkten; alle Zeilen einer Quelle stehen bündig. |
| `ControlHierarchy` | Rendert Erweiterungen unter „Zusammenhänge"; der aufgelöste Parent steht als „Teil von" im Kopf. |
| `ControlMetadata` | Rendert UUID, OSCAL-`class` und den Parent-ID-Fallback in der Fußzeile ohne Überschrift, als Begriffspaare aus Beschriftung und Wert. |

Die Sektionsmodule erhalten ausschließlich benötigte Controls, aufgelöste Vokabularwerte und Callbacks. Sie verwenden weder Katalog-, Router- noch Filterkontext.

## Suchseiten-Grenzen

`src/features/search/SearchPage.tsx` ist der Composer der Volltextsuche (`/suche?q=…`). Er bindet `useSearch`, die 50er-Pagination und dieselben Desktop-/Mobile-Präsentationskomponenten wie der Katalog-Browser ein, hält dafür aber eine eigene, unabhängige Auswahl- und Export-Grenze. Die Ergebnislisten folgen derselben Breakpoint-Mount-Strategie wie der Katalog-Browser: genau eine gemountete Liste je Breakpoint.

| Baustein | Verantwortung |
|----------|----------------|
| `useControlSelection` | Läuft mit dem Scope `search:<catalogKey>:<query>` — unabhängig vom Katalog-Browser-Scope (`catalogKey` allein). Jede Änderung von `q` liefert synchron eine leere Auswahl. |
| `resultsUiState` | Führt `sort`, `visibleResultCount` und `mobileSelectMode` gemeinsam query-gebunden; ein Query-Wechsel setzt sie synchron zurück. |
| `SearchResultsToolbar` | Zähler-Chip (`CatalogSelectionChip`), Auswahl-Schalter (`CatalogMobileSelectToggle`) sowie die wiederverwendeten Export-Komponenten, beide über die Prop `isDesktop` bedingt gemountet; Chip-Regel, Auswahl-Schalter und CSV-Auslöser sind dieselben wie im Katalog. Kein Filter-Zugang. |
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

Die Bewertung einer Anfrage liegt getrennt davon in `rankSearchResults` (`src/features/search/searchRanking.ts`): eine reine Funktion ohne React und ohne Cache-Zugriff, die eine schmale, unveränderliche `SearchView` auf Suchdokumente, Indizes und Kennungsauflösung erhält. Der Cache-Eintrag erfüllt diese Sicht strukturell; `useSearch` ruft die Funktion nur noch memoisiert auf. Kennungsklassifikation, Gewichte, Präfixsuche und Gleichstandsregeln sind dort direkt testbar (`searchRanking.test.ts`), Cache-Invalidierung, LRU und Katalogtrennung weiter über die Hook-Tests.

## Filter-System

Filter werden bidirektional mit URL-Suchparametern synchronisiert (`src/hooks/useFilterParams.ts`):

- `sl` — Sicherheitsniveau (`normal-SdT`, `erhöht`)
- `el` — Aufwandsstufe (0–5)
- `mv` — Modalverb (MUSS, SOLLTE, KANN)
- `tags` — Tags
- `zk` — Zielobjekt-Kategorien
- `hw` — Handlungswort
- `dt` — Dokumentationsvorgaben
- `lr` — Link-Relationen (`related`, `required`)
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
4. App wird gebaut mit Impressum-Secrets; letzter Build-Schritt ist das Prüfsummen-Manifest `dist/SHA256SUMS` über alle veröffentlichten Dateien
5. `npm run check:deployment-manifest -- --dist dist` prüft, dass das Manifest den fertigen Bestand bytegenau bindet; derselbe Schritt läuft im Pflichtcheck `validate`
6. CycloneDX-App-SBOM der produktiven npm-Abhängigkeiten wird lockfile-basiert erzeugt (`npm sbom --package-lock-only --omit=dev --sbom-format=cyclonedx --sbom-type=application` nach `$RUNNER_TEMP`; nicht unter `dist/`, keine Pages-Auslieferung) und SLSA-Provenance wird generiert — zwei getrennte Attestierungen mit `dist/SHA256SUMS` als einzigem Subject, weil `sbom-path` am Provenance-Schritt dessen Modus ersetzen würde und `actions/attest` mehr als 1.024 Dateien je Subject ablehnt
7. Deployment auf GitHub Pages, das Manifest wird mit ausgeliefert

Eine einzelne Live-Datei prüft `npm run verify:deployment` gegen beide Attestierungen des Manifests und dessen Prüfsumme; Ablauf und Fehlerverhalten: [SLSA Provenance](./INTEGRITY.md#slsa-provenance).

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

`update-catalog.yml` läuft werktags um 07:30 und 17:30 Uhr (Zeitzone `Europe/Berlin`, `schedule` im Workflow) und lässt sich zusätzlich manuell über `workflow_dispatch` starten.

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
