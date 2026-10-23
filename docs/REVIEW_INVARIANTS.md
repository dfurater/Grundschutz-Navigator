<!--
  GENERIERT — nicht von Hand bearbeiten.
  Regeltexte:   scripts/review-policy.rules.mjs
  Generator:    scripts/review-policy.mjs
  Neu erzeugen: npm run review-policy
  Drift prüfen: npm run review-policy:check
-->

# Review-Invarianten

Der verbindliche Reviewvertrag dieses Repositoriums. Er gilt gleichrangig für
Gitar, für Greptile und für jeden Agenten-Cross-Review.

Diese Datei wird von `scripts/review-policy.mjs` erzeugt; die Regeltexte selbst
stehen in `scripts/review-policy.rules.mjs`. Änderungen gehören dorthin;
`npm run review-policy:check` läuft im CI-Job `validate` und schlägt bei jeder
manuellen Abweichung fehl.

## Globale Regeln

Gelten für jeden Review, unabhängig von den geänderten Dateien.

### G1-sprache

Verfasse Zusammenfassung und alle Reviewkommentare auf Deutsch. Fachbegriffe und Code-Bezeichner bleiben englisch.

### G2-anwendungskontext

Die Anwendung läuft vollständig clientseitig auf GitHub Pages unter /Grundschutz-Navigator/. Öffentliche BSI-Artefakte kommen aus dem Quellregister über den gepinnten Build- und Integritätspfad; public/data/ ist gitignored. Die lokale Arbeitsbereichsinfrastruktur speichert organisationseigene OSCAL-Dokumente und Entwürfe in IndexedDB (gspp-workspace). Diese Inhalte können personenbezogene Daten, Systemdetails, Risiken und Nachweise enthalten und sind unvertraut. Es gibt kein Backend, keine Serverlaufzeit und keine Nutzerkonten. Melde keine Befunde, die einen nicht vorhandenen Server oder eine serverseitige Session voraussetzen; die lokale Datenbank und sensible Nutzerdaten sind ausdrücklich Reviewgegenstand. Klasse-1-Provenienz beruht auf Upstream-Pin, Allowlist, SHA-256 und SLSA-Attestation; diese Aussage gilt nicht für eigene Dokumente. Bewerte bei Ausbauregeln den konkret berührten Datenpfad: Das Fehlen einer optionalen oder noch nicht implementierten Produktfunktion ist für sich kein Befund.

### G3-nicht-melden

Lint, Typprüfung, Tests, Coverage-Schwellen, Actions-SHA-Pinning und der PR-Dokumentationsvertrag laufen bereits als CI-Checks. Melde nichts, was eslint.config.js, tsc oder die Guards unter scripts/ ohnehin abfangen. Melde ebenso keine Geschmacksfragen und keine alternativen Formulierungen gleichwertiger Logik. Konzentriere dich auf Logikfehler, gebrochene Invarianten, Sicherheitsauswirkungen und Dokumentation, die nicht mehr zum Code passt.

### G4-befundqualitaet

Jeder Befund nennt den konkreten Fehlerfall: welcher Input, welcher Zustand, welches falsche Ergebnis. Ein Befund ohne benennbaren Fehlerfall ist eine Vermutung und gehört nicht in den Review, sondern allenfalls als Frage formuliert.

### G5-priorisierung

Priorisiere Befunde in dieser Reihenfolge:
1. Datenabfluss, gebrochene Verbundgrenzen, aktive Fremdinhalte und falsche Vertrauensaussagen sowie Brüche von Integritätsprüfung, Quellregister, Versionsmatrix oder Upstream-Allowlist.
2. Irreversibler Datenverlust: verlorene Quellfelder, überschriebene Bearbeitung, Teiltransaktionen und nicht wiederherstellbare Sicherungen.
3. Fachlich falsche Status-, Prüf-, Risiko- oder Aggregationsaussagen.
4. Undefinierte Fehlerpfade bei Netzwerk, Parsing, Worker, Speicherung und Export.
5. Dokumentation, die dem Code widerspricht.

Die Einstufung benennt jeweils den konkreten auslösenden Zustand und seine Auswirkung.

### G6-pruefgrenzen

Repository-Einstellungen wie Rulesets, Branch Protection und Actions-Policies kannst du mit deinem Token nicht lesen. Dokumentiert ein Diff so etwas, halte fest, dass du es nicht verifizieren konntest. Werte es nicht als Fehler und senke dafür nicht den Confidence Score.

## Gescopte Invariantenregeln

Gelten, sobald der Diff mindestens einen Pfad des jeweiligen Scopes berührt.

### R1-integritaet

**Scope:** `src/domain/integrity.ts`, `src/state/CatalogContext.tsx`, `src/adapters/**`, `scripts/fetch-catalog.mjs`

Die SHA-256-Prüfung bezieht sich auf den rohen ArrayBuffer der ausgelieferten Datei, nicht auf das Parse-Ergebnis. Änderungen dürfen die Hash-Berechnung nicht auf serialisierte oder rekonstruierte Objekte umstellen, die Prüfung nicht überspringen und ihren Fehlerfall nicht stillschweigend schlucken. Ein Verstoß ist ein blockierender Befund.

### R2-quellregister

**Scope:** `src/**`, `scripts/**`, `upstream-manifest.json`

Repository, Upstream-Pfade der Produktartefakte, Katalogschlüssel, erwartete OSCAL-Root-Typen und Lifecycle der Produktartefakte kommen ausschließlich aus src/domain/sourceRegistry.mjs. Begleitartefakte (jede andere .json-Datei unter MONITORED_UPSTREAM_ROOTS) entdeckt scripts/companion-artifacts.mjs im gepinnten Tree; ihr Root-Typ kommt aus dem Dokument, ihr Lifecycle ist preview bei bestandener Wurzel-, Versions- und gepinnter Schemaprüfung und sonst blocked-by-upstream, ihr artifactKey stammt für einen bereits getrackten Pfad aus upstream-manifest.json und sonst aus deriveCompanionArtifactKey. artifactKey und vorhandene catalogKey beginnen mit einem kleingeschriebenen ASCII-Buchstaben; danach sind nur kleingeschriebene ASCII-Buchstaben, Ziffern und Bindestriche erlaubt, das letzte Zeichen ist alphanumerisch. Melde jede Aufweitung dieser Grammatik, insbesondere eine führende Ziffer. Melde jede hartcodierte BSI-Repo-Angabe, jeden hartcodierten Upstream-Pfad und jede zusätzliche Fetch-Quelle außerhalb von sourceRegistry.mjs und scripts/security-guards.mjs. Ein Verstoß ist ein blockierender Befund. Eine Fetch-Quelle im Sinne dieser Regel ist ein Endpunkt, aus dem Anwendung oder Build-Pipeline Daten beziehen, die in das Produkt eingehen. Testcode fällt nicht darunter, solange die Anfrage das Testsystem nachweislich nicht verlässt: Der Egress-Guard in src/test/browser/browserEgressGuard.ts fängt in der Browser-Testlane jede Anfrage auf Playwright-Context-Ebene ab und bricht sie vor jeder Namens- oder Netzauflösung ab. Eine URL, die ausschließlich als Ziel eines absichtlich blockierten Egress-Nachweises dient, ist deshalb kein Befund — unabhängig davon, ob sie über eine Loopback-Adresse, einen abweichenden Port oder einen testinternen Canary-Header realisiert ist. Melde sie nur, wenn der Guard sie passieren lässt oder wenn Produktions- oder Build-Code sie benutzt. Verlange nicht, dass solche Nachweise gleichoriginig bleiben; ein Nachweis, der den Cross-Origin-Pfad des Guards ausführt, ist der stärkere und ausdrücklich gewollte. Die Fetch-Grenze in scripts/security-guards.mjs lässt nur das offizielle BSI-Repository, einen gepinnten Snapshot, registrierte Produktpfade, materialisierte Vokabularpfade und Begleitpfade zu, die unter MONITORED_UPSTREAM_ROOTS liegen und im gepinnten Tree stehen; melde jede Aufweitung. Für jeden PR, dessen Diff upstream-manifest.json enthält, gilt in scripts/catalog-sync-guard.mjs genau eine Regel: kein Diff-Pfad unter scripts/ oder .github/, altes und neues Manifest bestehen das v2-Schema mit offiziellem Repository, das neue Manifest passt zum Register im Head, der Snapshot ist gleich oder voraus, und verifySnapshotFiles prüft jede Datei gegen Tree, Blob und Inhalt, die Begleitmenge gegen die im Tree entdeckte Menge und den Lifecycle jedes Begleitartefakts gegen sein Prüfergebnis. Auto-Merge erhält nur der Lane-PR mit Branch chore/catalog-sync-<sha12>, exaktem Titel und einem Diff, der ausschließlich upstream-manifest.json ändert. Melde jede Ausnahme von dieser Regel, jede zusätzliche Sonderprüfung für einzelne Änderungsarten und jede Abschwächung der Snapshot-Verifikation als blockierenden Befund.

### R3-versionsautoritaet

**Scope:** `src/domain/**`, `src/adapters/**`, `scripts/**`

metadata.oscal-version ist die einzige Versionsautorität. $schema darf gelesen, aber niemals zur Auswahl eines Schemas oder eines Codepfads benutzt werden. Schema-Pins (Asset-Name, Release-Tag, $id, SHA-256, Ablageort) leben nur in src/domain/oscalVersionMatrix.mjs. Ein Verstoß ist ein blockierender Befund.

### R4-keine-doppelten-registerfakten

**Scope:** `src/domain/**`, `src/adapters/**`, `scripts/**`

Jeder Fakt hat genau einen Ort: Root-Typ mal Version und Schema-Pin in oscalVersionMatrix.mjs, Artefaktpfade und Lifecycle in sourceRegistry.mjs. Melde jede Kopie dieser Tabellen in Konstanten, Tests oder Skripten.

### R5-generierte-daten

**Scope:** `public/**`, `.gitignore`, `.github/workflows/**`

catalog.json, catalog-wlan.json, catalog-metadata.json, catalog-wlan-metadata.json, vocabularies.json, vocabularies-metadata.json und upstream-sources-metadata.json unter public/data/ werden zur Build-Zeit erzeugt und dürfen nie eingecheckt werden. Melde jede Änderung an .gitignore, die diese Einträge entfernt oder aufweicht. Ein Verstoß ist ein blockierender Befund.

### R6-coverage-schwellen

**Scope:** `vite.config.ts`

Die Coverage-Schwellen in vite.config.ts (lines, branches, functions, statements) dürfen nicht gesenkt werden. Ein Diff, der einen dieser Werte herabsetzt, ist ein blockierender Befund — auch wenn die CI grün ist.

### R7-kolokierte-tests

**Scope:** `src/domain/**`, `src/adapters/**`, `scripts/**`

Logik in src/domain/, src/adapters/ und scripts/ braucht kolokierte Tests in einer *.test.ts neben der Datei. Neue oder geänderte Verzweigungen ohne Testabdeckung sind ein Befund; benenne die konkrete unabgedeckte Verzweigung.

### R8-actions-pinning

**Scope:** `.github/workflows/**`, `.github/actions/**`

Jede fremde GitHub Action wird auf einen vollständigen 40-stelligen Commit-SHA gepinnt, mit der Version als nachgestelltem Kommentar. Tag- oder Branch-Referenzen sind ein blockierender Befund. Self-Repository-Referenzen der Form $/ lösen dagegen auf den unveränderlichen Commit auf, der den Workflow ausführt, und tragen deshalb keinen externen Ref; lokale Composite Actions verwenden ausschließlich diese Form, nie die arbeitsbereichsrelative Form ./. Workflow-Berechtigungen bleiben minimal, und Checkout-Schritte ohne Push-Bedarf setzen persist-credentials: false.

### R9-vite-env-oeffentlich

**Scope:** `src/**`, `vite.config.ts`, `.github/workflows/**`, `.env.local.example`

Alles mit VITE_-Präfix landet im ausgelieferten Bundle und ist damit öffentlich. Melde jeden Versuch, ein Secret, einen Token oder einen API-Schlüssel über eine VITE_-Variable zu führen. Die VITE_IMPRESSUM_*-Felder sind bewusst öffentlich. Ein Verstoß ist ein blockierender Befund.

### R10-basispfad

**Scope:** `src/**`, `index.html`

Die App läuft unter dem GitHub-Pages-Basispfad /Grundschutz-Navigator/. Asset-, Daten- und Routenpfade werden über import.meta.env.BASE_URL gebildet. Ein absoluter Pfad, der mit / beginnt, bricht das Deployment und ist ein Befund.

### R11-tailwind-ohne-postcss

**Scope:** `postcss.config.*`, `tailwind.config.*`, `package.json`, `vite.config.ts`

Tailwind CSS v4 läuft ausschließlich über das Vite-Plugin @tailwindcss/vite. Eine PostCSS-Konfiguration oder eine tailwind.config.js ist ein blockierender Befund, kein Stilthema.

### R12-importalias

**Scope:** `src/**/*.ts`, `src/**/*.tsx`

Projektinterne Imports in src/**/*.ts und src/**/*.tsx nutzen den Alias @/. Melde dort relative Importpfade, die das eigene Verzeichnis verlassen. Außerhalb von src/ gilt die Regel nicht: Node-Wartungs- und Build-Skripte unter scripts/ laufen ohne Vite und ohne tsconfig-Aliasauflösung, @/ ist dort nicht auflösbar. Sie binden gemeinsame Fakten deshalb über einen relativen Pfad auf ein reines .mjs-Modul ein — etwa ../src/domain/sourceRegistry.mjs, ../src/domain/oscalVersionMatrix.mjs oder ../src/domain/class2ImportLimits.mjs. Das ist der vorgesehene Weg und kein Befund.

### R13-deutsche-oberflaeche

**Scope:** `src/features/**`, `src/components/**`, `src/app/**`, `index.html`

Die Oberfläche und alle sichtbaren Texte sind deutsch, mit korrekten Umlauten und ß. Melde englische UI-Strings und ASCII-Ersatzschreibweisen wie "fuer" oder "Loeschen".

### R14-doku-folgt-verhalten

**Scope:** `src/**`, `scripts/**`

Ändert der Diff dokumentiertes Verhalten, muss die betroffene Datei unter docs/ oder README.md mitgeändert werden. Prüfe die inhaltliche Richtigkeit der Doku-Änderung, nicht nur ihr Vorhandensein. Fehlt sie, benenne konkret den Abschnitt, der jetzt falsch ist.

### R15-verlustfreies-dokumentmodell

**Scope:** `src/**`

source trägt den vollständigen geparsten OSCAL-Quellgraphen; view ist eine daraus abgeleitete Projektion und darf die dokumentierten Sichtfilter anwenden. Prüfe Änderungen an Import, Writer und Export: Ein Verlust oder eine unbeauftragte Normalisierung von Quellfeldern, unbekannten Inhalten, fremden Namespaces oder Array-Reihenfolgen ist blockierend. Ein Writer, der das Dokument aus sichtbaren Formularfeldern oder view rekonstruiert und dadurch nicht angezeigte Inhalte verliert, ist ebenfalls blockierend. Ein No-op erhält Quellgraph und Identitätsmetadaten nach docs/OSCAL_ROUND_TRIP.md; Unterschiede allein in der ursprünglichen JSON-Textformatierung sind kein Verlust des geparsten Graphen. Fachliches Schreiben ändert ausschließlich die beauftragten Inhalte und die nach docs/PERSISTENCE.md rootmodellspezifisch fortzuschreibenden Metadaten. Eine pauschale Neuvergabe aller Root-UUIDs oder eine Änderung von localId durch fachliches Schreiben verletzt diesen Vertrag. Verlange für einen berührten Writer den No-op-Nachweis und einen Edit-Fall, der unbekannte Inhalte erhält.

### R16-fehlerpfade

**Scope:** `src/**`

Jeder neue oder geänderte Netzwerk-, Parse-, Worker-, Speicher- und Exportpfad hat einen definierten terminalen Fehlerzustand. Prüfe insbesondere Worker-Abbruch und Timeout, Quota, konkurrierende Änderungen, fehlgeschlagene Transaktionen und Exportfehler. Ein hängender Ladezustand, ein Erfolgssignal vor erfolgreichem Commit, das Verwerfen ungespeicherter Eingaben nach einem Fehler oder das Verschlucken eines Speicher- oder Konfliktfehlers ist ein blockierender Befund. Fehlerdiagnosen bleiben nach dem Klasse-2-Vertrag redigiert. Ein Negativnachweis löst den betroffenen Fehler aus und prüft Fehlerzustand, erhaltene Eingaben und unveränderten Speicherbestand; ein bloß gemockter Erfolg belegt diesen Pfad nicht.

### R17-oscal-belegen

**Scope:** `src/domain/**`, `src/adapters/**`, `scripts/**`, `docs/**`

Normative Aussagen über OSCAL werden gegen usnistgov/OSCAL belegt, gepinnt auf Tag oder Commit. Die vendorten, SHA-256-gepinnten Schemata und src/domain/oscalVersionMatrix.mjs sind für Struktur- und Versionsfragen maßgeblich. Behaupte nichts über OSCAL aus dem Gedächtnis; was du nicht gegen diese Quellen belegen kannst, formulierst du als Frage statt als Befund.

### R18-go-oscal-korpus

**Scope:** `scripts/verify-upstream-oscal.mjs`, `scripts/verify-upstream-oscal.test.ts`, `src/domain/sourceRegistry.mjs`, `upstream-manifest.json`, `.github/workflows/validate.yml`, `docs/OSCAL_VALIDATION.md`

Der unabhängige go-oscal-Korpuslauf nutzt ausschließlich statisch gepinnte Release-Artefakte, den gepinnten BSI-Snapshot und Registry-Fakten. Alle nicht gesperrten Artefakte müssen die Schema-Prüfung bestehen; blocked-by-upstream muss scheitern, ein bestandener Sperreintrag ist ein Entsperrungskandidat. Es gibt keine Diagnosesignatur-Policy, keine Aggregat-Zerlegung und keine Fortsetzung durch einen Schemafehler. Fehlendes oder nicht auswertbares Werkzeugergebnis ist ein redigierter Werkzeugfehler, nie ein Schemaergebnis. Eine temporäre Werkzeugkopie darf allein eine stringförmige Top-Level-$schema-Direktive entfernen, um den bestätigten go-oscal-Modelldetektor-Defekt zu umgehen; die verifizierten Upstream-Bytes und metadata.oscal-version bleiben unverändert.

### R19-stufe-3-schemavalidierung

**Scope:** `src/domain/oscalSchemaBundle.ts`, `src/domain/oscalSchemaValidation.ts`, `src/domain/oscalClass2Import.ts`, `src/workers/**`, `scripts/verify-oscal-schemas.mjs`, `scripts/sync-oscal-schemas.mjs`, `schemas/**`, `.gitattributes`, `vite.config.ts`, `.github/workflows/validate.yml`

Stufe 3 validiert im Modul-Worker mit ajv 8.20.0 gegen die eingecheckten NIST-Schemas unter schemas/oscal/. Verbindlich: Die Zelle kommt ausschließlich aus dem Schema-Pin der Stufe 2, nie aus Dokumentinhalt, und es gibt keinen Fallback auf eine Nachbarversion. src/domain/oscalSchemaBundle.ts führt je Zelle ein ausgeschriebenes import()-Literal; ein aus Daten oder Template zusammengesetzter Importpfad ist ein blockierender Befund. Zum Laufzeitbezug gilt die Grenze genau so: Ein Schema-, Validator- oder Constraint-Bezug von einer FREMDEN Origin zur Laufzeit ist ein blockierender Befund — insbesondere github.com (Release-Asset) und csrc.nist.gov (die $id der Schemas). Der lazy import() des ausgewählten Schema-Chunks von DERSELBEN Origin ist dagegen der vorgesehene Weg und kein Befund; er ist die Voraussetzung dafür, dass nicht alle 30 Schemas im Worker liegen. Eine Dokumentations- oder Kommentaraussage, die jeden Laufzeit-Netzbezug ausschließt statt nur den fremd-originbezogenen, ist ihrerseits ein Befund. validateFormats bleibt false, allErrors bleibt false, unicodeRegExp wird nicht gesetzt — ein Abschalten von unicodeRegExp lässt jedes OSCAL-Dokument am TokenDatatype-Muster scheitern und ist ein blockierender Befund. Ajvs message und params dürfen keine Diagnose erreichen; übernommen werden nur der Keyword-abgeleitete projekteigene Code und der redigierte instancePath, unbekannte Segmente werden zum Platzhalter. Ein nicht in der Keyword-Positivliste geführter Befund wird OSCAL_VALIDATOR_OUTPUT_UNRECOGNIZED, eine nicht ladbare oder nicht kompilierbare Zelle OSCAL_SCHEMA_UNAVAILABLE; Stufe 3 darf nie übersprungen oder als bestanden ausgewiesen werden. npm run verify-oscal-schemas ist das netzfreie CI-Gate über SHA-256, $id, draft-07 und die Abwesenheit ungepinnter Dateien unter schemas/oscal/; ein fetch in scripts/verify-oscal-schemas.mjs, ein Entfernen dieses CI-Schritts, ein Entfernen von worker.format: 'es' aus vite.config.ts oder ein Aufweichen von .gitattributes (schemas/oscal/** -text) ist jeweils ein blockierender Befund. Eine Laufzeit-Hashprüfung der gebündelten Schemas wird nicht verlangt: Der Bundler transformiert die Bytes, ein mitgeliefertes Soll würde sich selbst bestätigen.

### R20-stufe-5-referenzgraph

**Scope:** `src/**`, `scripts/verify-upstream-oscal.mjs`, `scripts/oscal-domain-bridge.mjs`, `tsconfig.app.json`, `tsconfig.node.json`, `docs/OSCAL_VALIDATION.md`, `docs/INTEGRITY.md`

Stufe 5 ist der Referenzgraph in src/domain/referenceGraph*.ts auf Basis von src/domain/referenceResolution.ts. Verbindlich: Die Formentscheidung ueber einen OSCAL-Referenz-href fuer diesen Graphen faellt einschliesslich der aufrufenden Schichten ausschliesslich in referenceResolution.ts — ein Fragmentvergleich (startsWith('#')), ein Protokollvergleich, eine URL-Normalisierung oder eine Pfadaufloesung ausserhalb dieses Moduls ist ein blockierender Befund. Die eigenstaendige Profile-Importkette fuer die About-Provenienz in src/domain/catalogLineage.mjs ist eine eng begrenzte Ausnahme: Sie prueft das lokale Importfragment gegen back-matter.resources und normalisiert einen relativen rlinks.href ausschliesslich ueber resolveRelativeRepoPath relativ zum Profilpfad; ein Treffer zaehlt nur fuer einen Pfad unter MONITORED_UPSTREAM_ROOTS, der als validiertes Katalogdokument desselben gepinnten BSI-Trees vorliegt. Absolute URIs, Wurzelpfade und Fragmente werden dort nie aufgeloest. Diese Projektion erlaubt keine Netzabrufe, keine weitere URL-Normalisierung und keine heuristische Zielsuche und ersetzt keine Stufe-5-Referenzaufloesung. Externe Ziele werden nie aufgeloest, und kein Ziel wird ueber Dateinamen, Titelaehnlichkeit oder Fremd-Namespace-props (etwa catalog_uuid) zugeordnet; eine solche Heuristik ist ein blockierender Befund. Dokumentuebergreifende Aufloesbarkeit entsteht nur durch eine ausdrueckliche Bindung des Aufrufers; der CI-Lauf uebergibt keine. Ein Knoten traegt immer Dokumentidentitaet plus lokale ID — eine kontextlose ID-Aufloesung oder ein Ausweichen auf einen anderen geladenen Katalog ist ein blockierender Befund, weil control/@id nur lokal eindeutig ist. Die vier Zustaende resolved, unresolvable, not-evaluable und die fachliche Aussage no-relationship bleiben getrennt; ein relatives oder externes Ziel darf nie als Referenzfehler gezaehlt werden, und no-relationship erzeugt nie eine Kante. Alle Befunde entstehen ueber createOscalDiagnostic mit stage 'reference'; ein zweites Diagnosemodell, eine eigene Severity-Skala oder ein href-, ID- oder sonstiger Dokumentwert in einer Diagnose oder CI-Ausgabe ist ein blockierender Befund. Die CI-Politik bleibt fail-closed fuer supported-Artefakte; preview, draft und blocked-by-upstream duerfen sichtbar, aber nicht blockierend sein und nie als abschliessend bewertet erscheinen. Allowlist-Eintraege binden an Diagnosesignatur UND Snapshot-Commit und laufen bei Aenderung von Snapshot oder Pfad aus; eine Aufweichung dieser Bindung ist ein blockierender Befund. erasableSyntaxOnly muss in tsconfig.app.json und tsconfig.node.json gesetzt bleiben und der Aliashook in scripts/oscal-domain-bridge.mjs auf src/ beschraenkt: Ohne beides bricht die CI-Lane oder laedt Code ausserhalb des Quellbaums.

### R21-dokumentierte-versionen

**Scope:** `docs/ARCHITECTURE.md`, `scripts/verify-documented-versions.mjs`, `.github/workflows/validate.yml`, `package.json`

Der Toolchain-Vertrag der Browser-Testlane in docs/ARCHITECTURE.md — die Pin-Tabelle mit der Kopfzeile "Abhängigkeit | Pin | Lizenz | Zweck" und der Absatz zur Chromium-Bindung — wird von scripts/verify-documented-versions.mjs am installierten Stand geprüft: exakte Pins in package.json, identische Pins für das Vitest-Trio, die von der playwright-Installation aufgelöste playwright-core-Version samt Chromium-Eintrag sowie die Abwesenheit von Versionsliteralen im Abschnitt; der Schritt läuft als npm run verify-documented-versions im Job validate (.github/workflows/validate.yml). Weder der geprüfte Abschnitt noch der Cache-Kommentar vor dem Schritt Restore Playwright browser cache in .github/workflows/validate.yml trägt ein aus den Manifesten abgeschriebenes Versionsliteral. Melde als blockierenden Befund, wenn ein Diff diesen Schritt entfernt, seinen Fehlschlag folgenlos macht, eine geprüfte Zusage ersatzlos aus der Dokumentation streicht oder ein Versionsliteral in den geprüften Abschnitt oder den Cache-Kommentar einführt. Der Guard ist fail-closed und schlägt auch fehl, wenn Überschrift, Kopfzeile, Tabellenzeile oder Satzform nicht mehr auffindbar sind; eine Umformulierung, die das auslöst, ist kein Befund, solange der Vertrag im selben Diff wieder prüfbar wird.

### R22-greptile-check-run

**Scope:** `.github/workflows/greptile-review-nudge.yml`, `scripts/greptile-review-nudge.mjs`, `docs/ARCHITECTURE.md`

Der Workflow .github/workflows/greptile-review-nudge.yml stellt den required status check "Greptile Review" auf Pull Requests her, die Greptile vor der Auslösung wegen leeren Reviewumfangs überspringt — der Regelfall bei einem Diff, der nur package-lock.json ändert. Er erzeugt diesen Check nie selbst, sondern setzt allein die Erwähnung, die Greptile zu einem echten Review bewegt. Ein Diff, der den Job so umbaut, dass er selbst einen Check-Run namens "Greptile Review" postet oder den Job so benennt, täuscht Reviewabdeckung vor und ist ein blockierender Befund. Ebenso blockierend: die Auslösebedingung von der Abwesenheit des Check-Runs auf dem Head-SHA auf den englischen Statustext von Greptile umzustellen (der Anbietertext ist undokumentiert und jederzeit änderbar), den Autorenfilter auf greptile-apps[bot] zu entfernen oder aufzuweiten, den Trigger von issue_comment auf pull_request_target zu wechseln, den PR-Head statt des Default-Branches auszuchecken, oder die Job-Berechtigungen über contents/checks/pull-requests lesend plus issues schreibend hinaus anzuheben. Die Markerbindung an den Head-SHA verhindert Mehrfacherwähnungen je Head und muss erhalten bleiben; ebenso das absteigende Sortieren beim Kommentarabruf, ohne das der eigene Marker bei mehr als hundert Kommentaren jenseits der ersten Seite läge. Dass der Workflow im einführenden Pull Request nicht läuft, ist kein Befund: issue_comment feuert nur von der Default-Branch-Fassung. Ob "Greptile Review" required bleibt, kannst du mit deinem Token nicht lesen (siehe G6); werte einen Diff, der das dokumentiert, nicht als Fehler, halte aber fest, dass du es nicht verifizieren konntest.

### R23-sonar-analysekonfiguration

**Scope:** `sonar-project.properties`, `.github/workflows/sonar.yml`, `.github/workflows/validate.yml`, `scripts/sonar-token-guard.mjs`

sonar-project.properties, .github/workflows/sonar.yml, .github/workflows/validate.yml und scripts/sonar-token-guard.mjs bestimmen aus dem PR-Head heraus, was SonarQube ueberhaupt misst — ein Pull Request kann sich darueber selbst eine Gate-Ausnahme erteilen. Alle vier Pfade brauchen deshalb ein Agenten-Cross-Review; ein Bot-Approval allein begruendet hier keine Merge-Faehigkeit. Die Analyse liegt seit GSPP-416 auf zwei Wegen: validate.yml traegt den Job sonarqube fuer Pull Requests, der den Coverage-Report des Jobs validate als Artefakt uebernimmt, sonar.yml den Push-Pfad fuer main und develop mit eigenem Coverage-Lauf. Verbindlich: sonar.coverage.exclusions bildet den Messbereich von vite.config.ts ab und geht nicht darueber hinaus — ein Muster, das von Vitest gemessene Quellen ausschliesst, ist ein blockierender Befund, weil es Zeilen aus dem new_coverage-Gate nimmt, fuer die die Coverage-Schwellen weiter gelten. Jede Aufweitung von sonar.cpd.exclusions oder sonar.coverage.exclusions nennt im Diff ihren Grund und bleibt so eng wie technisch moeglich. Blockierender Befund ist jeder Diff, der die Ausloeser eines der beiden Workflows einengt, die Analyse fuer eine Branch- oder Pull-Request-Klasse ueberspringt, den Scanner-Schritt entfernt, oder die Kette aus Coverage-Lauf, Artefakt-Upload in validate und Download im Job sonarqube unterbricht — ohne diesen Report misst SonarQube den neuen Code als vollstaendig ungedeckt. Ebenso blockierend: den Coverage-Lauf in validate auf npm run test ohne Schwellen zurueckzustellen. Das Ueberspringen mangels Secret bei Fork-Beitraegen ist die einzige zulaessige Ausnahme, bleibt an scripts/sonar-token-guard.mjs gebunden und muss im Lauf sichtbar gemeldet werden. Der Guard erhaelt ausschliesslich das Ergebnis des Vergleichs secrets.SONAR_CI != '' als SONAR_TOKEN_AVAILABLE, nie den Tokenwert: Er stammt bei einem Pull Request wie die Workflow-Datei aus dem PR-Head und ist damit vom Beitragenden bestimmbar. Ein Diff, der SONAR_TOKEN in die Umgebung eines Schritts legt, der Code aus dem Repository ausfuehrt, ist ein blockierender Befund; das Secret gehoert allein in den gepinnten Scanner-Schritt.

### R24-doku-ist-zustand

**Scope:** `docs/**`, `README.md`

Dokumentation unter docs/** und in README.md beschreibt ausschließlich den Ist-Zustand: Zulässig ist nur ein Satz, der einen aktuellen, gegen Code oder Konfiguration nachprüfbaren technischen Fakt nennt — Dateipfad, Verhalten, Konfigurationswert, Grenze oder Bedingung. Ein Satz, der Entstehungsgeschichte erzählt, eine verworfene Alternative darstellt oder eine Kontrastformulierung ohne eigenen Faktengehalt an dieser Stelle trägt, ist ein Befund. Eine Begründung ist nur zulässig, wenn sie einen nicht offensichtlichen Constraint trägt, und dann als knappe Tatsachenaussage, nicht als Erzählung. docs/REVIEW_INVARIANTS.md ist aus scripts/review-policy.rules.mjs erzeugt; ein Befund dort zeigt auf den Regeltext in scripts/review-policy.rules.mjs, nie auf die generierte Ausgabe.

### R25-gestaltungssystem

**Scope:** `src/components/**`, `src/features/**`, `src/app/**`, `src/index.css`

Rohwerte für Farbe, Schriftgröße, Laufweite, Radius, Schatten, Bewegung und Touchziel stehen nur in src/index.css (@theme); die ESLint-Regel design-system/no-off-system-classes prüft die Klassen in UI-Dateien. Prüfe im Review, was die Regel nicht messen kann. Bedeutungsregel: Eine Farbe ohne Datenbedeutung ist Schiefer; eine neue Statusfarbe ohne dokumentierte Datenbedeutung ist ein Befund. Dokument-, Prüf- und Migrationszustände sind ebenfalls Datenbedeutungen; ihre Farbe ersetzt weder Text noch zugängliche Kennzeichnung. Auswahlregel: Petrol heißt Auswahl, Neutral heißt Bedienung, Dunkel gehört der Kopfzeile; ein aktiver Umschalter ist ein Petrol-Glyph auf Petrol-Lasur, kein gefülltes Primärquadrat. Rechts steht genau ein Panel; Filter und Detail gleichzeitig rechts sind ein Befund. Panelköpfe ab md sind 51px hoch (h-panel-head), damit die Haarlinien über alle Panels durchlaufen. Flächen trennen sich durch 1-px-Haarlinien, nie durch Schatten oder farbige Seitenkanten. Kennungen (Control-IDs, UUIDs, Hashes) stehen in IBM Plex Mono (font-mono), Katalogwerte wie MUSS, normal-SdT oder ORP.1.A3 erscheinen exakt wie veröffentlicht, nie übersetzt, umgeschrieben oder abgekürzt. Jede Zahl, die Umfang beschreibt, steht in tabular-nums. Menüs und Umschalter tragen nur Beschriftung und Daten, keine Erklär- oder Herkunftsprosa. Farbe ist nie das einzige Signal: Status trägt immer Text oder ein zugängliches Label, Links im Fließtext sind unterstrichen. Hover ist Füllung, nie Deckkraft oder Skalierung. Der Fokusring bleibt auf jedem bedienbaren Element sichtbar.

### R26-datenklassen-vertrauen

**Scope:** `src/**`, `docs/INTEGRITY.md`, `docs/PERSISTENCE.md`

Bei Änderungen an Laden, Übernahme, Speicherung oder Vertrauensanzeigen bleiben Klasse 1 und Klasse 2 strukturell getrennt. Klasse-1-Inhalte erhalten im Arbeitsbereich weder Store noch Inhaltsindex oder Backup-Kopie; zulässig ist die artifactKey-Referenz. Eine Übernahme erfolgt ausschließlich nach dem Lifecycle- und Kopiervertrag in docs/PERSISTENCE.md als eigenes Klasse-2-Dokument; derivedFrom dokumentiert Herkunft, verleiht aber keine BSI-Verifikation. Schemavalidität, Herkunft, Ressourcenhash und menschliche Freigabe sind unterschiedliche Aussagen. Blockierend ist ein Pfad, der eigene oder lokal geänderte Dokumente als BSI-verifiziert anzeigt oder sie dem Klasse-1-Manifest-/Hashpfad unterstellt. Negativnachweis: Ein schemavalides, lokal geändertes Dokument bleibt Klasse 2 und unverifiziert; seine Herkunftsangabe bleibt davon getrennt.

### R27-klasse-2-egress

**Scope:** `src/**`, `index.html`, `vite.config.ts`, `docs/PERSISTENCE.md`, `docs/FILTERING.md`

Bei Änderungen an Suche, Filtern, Routing, Diagnosen oder Netzpfaden dürfen Klasse-2-Inhalte das Werkzeug ausschließlich über einen ausdrücklich vom Menschen ausgelösten Export verlassen. Klasse-2-Dokumentwerte, zugehöriger Freitext, Bearbeiternamen und Klasse-2-Suchbegriffe gelangen weder in URL-Pfad/Query/Fragment, Logs, Telemetrie, öffentliche Suchindizes noch in automatische Requests. Ein Request zur eigenen Origin mit solchen Werten verletzt die Grenze ebenfalls. Gemischte Filter serialisieren ausschließlich ausdrücklich freigegebene Klasse-1-Werte; Klasse-2-Suche und ihre Indizes bleiben getrennt und flüchtig im Arbeitsspeicher. Das Laden statischer App-, Schema- und Klasse-1-Daten ohne Nutzerdaten ist kein Egress-Befund. Blockierend ist jeder belegte Abflusspfad. Negativnachweis: Sentinelwerte in Klasse-2-Quelle, Suche und Filtern bleiben bei Navigation, Fehlern und Bereichswechseln aus URL, Logs und ausgehenden Requests fern; der Browsernachweis läuft unter dem Egress-Guard.

### R28-verbund-identitaet

**Scope:** `src/**`, `docs/PERSISTENCE.md`

Bei Änderungen an Referenzauflösung, Speicherung, Auswahl, Suche oder Caches gilt die Dokumentidentität zusammen mit ihrem Verbundkontext. localId ist der stabile, vom Werkzeug vergebene Speicherschlüssel; eine importierte Root-UUID oder gleiche Control-ID darf keine Ersetzung, Zusammenführung oder Bindung begründen. Dokumentübergreifende Referenzen benötigen ausdrückliche Bindungen nach docs/PERSISTENCE.md und R20; lokale Bindungen dürfen den Informationsverbund nicht verlassen. Ein Fallback auf das erste passende Dokument, einen anderen Verbund oder Katalog ist blockierend. Negativnachweis: Zwei Verbünde mit gleichen Control-IDs und kollidierenden importierten UUIDs bleiben bei Lesen, Bearbeiten, Löschen und Restore getrennt; Fremdzuordnungen werden vor dem Schreiben abgewiesen.

### R29-speicherung-wiederherstellung

**Scope:** `src/**`, `docs/PERSISTENCE.md`

Bei Änderungen an Schreiben, Autosave, Backup, Restore oder Speicher-Migration gilt der Transaktions- und Konfliktvertrag in docs/PERSISTENCE.md. Dokument, betroffener Entwurf und geänderte Bindungen werden atomar geschrieben; veraltete Dokument- und Entwurfsvergleichswerte überschreiben keine neuere Arbeit. Quota oder Abbruch hinterlässt den Vorzustand, niemals eine Teilübernahme. Ein erfolgreich erzeugter Backup-Export eines unterstützten Speicherschemas ist mit dem zugesagten Format und seinen Eingangsgrenzen wiederherstellbar. Der Gesamtexport aus einer Datenbank mit höherer storageSchemaVersion reicht nach docs/PERSISTENCE.md §10 unbekannte Felder und Stores ohne Interpretation durch; die ältere Anwendung lehnt seine Wiederherstellung nach §11 vollständig ab. Diese Ablehnung ist kein Befund gegen die Wiederherstellbarkeit. Die Meldung mit Handlungsempfehlung folgt §10. Speicher-Migrationen ändern weder OSCAL-source, OSCAL-Version noch Dokumentidentität oder localId; eine neuere Speicherversion wird nicht schreibend uminterpretiert. Jeder Bruch ist blockierend. Negativnachweise: Transaktionsabbruch, Quota und konkurrierende Tabs erhalten den gültigen Bestand; Export–Restore–Vergleich prüft auch Entwürfe und Bindungen; ein defekter Migrationsdatensatz rollt die gesamte Migration zurück.

### R30-entwurf-backup-export

**Scope:** `src/**`, `docs/PERSISTENCE.md`, `docs/OSCAL_VALIDATION.md`, `docs/OSCAL_ROUND_TRIP.md`

Bei Änderungen an Dokumentzuständen, Validierung oder Ausgabe bleiben importiertes Dokument, lokaler Entwurf und exportfähiges OSCAL getrennt. Ein unvollständiger Entwurf bleibt nach den Ressourcen- und Objektgraphgrenzen lokal speicherbar und im Workspace-Backup sicherbar; er wird nicht als valides OSCAL ausgegeben. Vor einem regulären OSCAL-Export wird das tatsächlich erzeugte Artefakt über die dafür verbindliche Kette geprüft, nicht lediglich sein Eingabedokument. Nicht verfügbare Constraint- oder Referenzprüfungen erscheinen als solche, niemals als bestanden; aus Schemavalidität folgt keine fachliche Freigabe. Envelope, lokale Bindungen und Werkzeugmetadaten gelangen nicht versehentlich in das OSCAL-Dokument. Blockierend sind Entwurfsverlust, ein Validierungsbypass oder eine falsche Prüfungsaussage. Negativnachweis: Ein unvollständiges Profil übersteht Backup/Restore, scheitert am regulären OSCAL-Export; ein durch den Exporter beschädigtes Artefakt wird trotz gültiger Eingabe abgewiesen.

### R31-fachliche-aussagegrenzen

**Scope:** `src/**`, `docs/PROJECT_PROPS.md`

Bei Änderungen an Zielobjekten, Parametern, Geltungsbereich oder Statusauswertung gelten getrennte Aussagen: außerhalb des Profils, keine Statusaussage, not-applicable für eine Komponente und begründete Abweichung dürfen nicht verschmelzen. Ein by-component-Status ist keine automatische Gesamtaussage über eine Anforderung. Organisationsweite Profilparameter und systembezogene SSP-Parameter behalten ihre unterschiedliche Reichweite; eine eingesetzte Arbeitsfassung ersetzt nicht den Originalwortlaut in source. Schutzbedarf nach dem Projektvertrag bleibt von CIAA-Anforderungsrelevanz getrennt. Automatische Kategorien-Eltern-Erweiterung und Anforderungsdeduplizierung begründen keine automatische Schutzbedarfsvererbung. Freitextkonflikte dürfen nicht still als sicherste Parametereinstellung entschieden werden. Eine solche Umdeutung ist blockierend. Negativnachweis: Dieselbe Anforderung mit widersprechenden Komponentenstatus behält beide Aussagen; widersprechende Parameterwerte bleiben als Konflikt sichtbar; mehrere Zielobjektkategorien verändern keinen manuell gesetzten Schutzbedarf.

### R32-projektsemantik-fremdinhalte

**Scope:** `src/**`, `docs/PROJECT_PROPS.md`

Bei Änderungen an Import, Property-Reader, Writer oder Export ist src/domain/projectProps.ts die einzige Runtime-Quelle der Projektsemantik; docs/PROJECT_PROPS.md definiert den zugehörigen Vertrag. Fremde Namespaces werden nicht nach Namensähnlichkeit interpretiert. Unbekannte Namen im Projektnamespace bleiben erhalten und sperren den betroffenen semantischen Schreibpfad; Lesen, No-op-Export und Backup reichen sie gemäß Vertrag durch. Offene OSCAL-Vokabulare rechtfertigen keine Umdeutung unbekannter Tokens in einen bekannten Standardstatus. Projektpflichten für lokal gesetzte Werte verschärfen nicht rückwirkend die NIST-Schemavalidität eines Fremdimports. Blockierend sind Inhaltsverlust, Namespace-Verwechslung und eine als Schemafehler ausgegebene reine Authoringpflicht. Negativnachweis: Ein schema- und importgültiges Fremddokument mit not-applicable ohne remarks bleibt lesbar, während lokales Setzen die Projekt-Begründungspflicht prüft; ein fremdes gleichnamiges Property erzeugt keine Projektsemantik.

### R33-nachweise-berichte

**Scope:** `src/**`, `index.html`, `docs/PERSISTENCE.md`

Bei Änderungen an Anhängen, Vorschauen, Freitext-Rendering oder Berichten bleiben Inhalte unvertraut. Eingebettetes base64, Markdown, HTML, SVG und Links dürfen weder aktive Fremdinhalte ausführen noch zur Vorschau automatisch Netzressourcen auflösen. Darstellung und Download verwenden sichere Ausgabegrenzen und die gemeinsamen Ressourcenlimits auch vor dem Dekodieren; Hashvergleich einer Ressource verleiht ihrem Inhalt keine Ausführungserlaubnis. Exportumfang und Nachweisbeigaben entsprechen der ausdrücklich gewählten Auswahl und dem aktiven Verbund; CSV-Zellen aus Nutzereingaben dürfen in Tabellenkalkulationen keine Formeln aktivieren. Blockierend sind Inhaltsausführung, ein durch Nachweisinhalte oder Berichtswerte ausgelöster automatischer Request oder ein Export fremder bzw. nicht ausgewählter Inhalte. Negativnachweise: präpariertes HTML/SVG, externe Bildreferenz, Formelpräfix und übergroßer Anhang; keine Skriptausführung, kein Netzbezug und keine Fremdverbunddaten im Ausgabeprodukt.

### R34-katalogwechsel-bewertungen

**Scope:** `src/**`, `docs/PROJECT_PROPS.md`, `docs/PERSISTENCE.md`

Bei Änderungen an Katalogbindung, Delta oder Bewertungsübernahme bleibt der Bezugsstand einer eigenen Bewertung nachvollziehbar. assessed-against-Properties werden nach dem Registry-Vertrag als vollständiges Paar behandelt; historische Bindungen werden nicht still auf den aktuellen Snapshot umgeschrieben. Gleiche ID oder alt-identifier allein beweist keine unveränderte Anforderung. Die Gleichheitsprüfung berücksichtigt die fachlich relevanten Inhalte und Parameter nach dem dokumentierten Migrationsvertrag. Geänderte, entfallene, nicht auflösbare und mehrdeutige Zuordnungen erhalten eigene Aussagen und eine sichtbare Prüfbedürftigkeit; sie werden weder gelöscht noch als aktuell bestätigt ausgegeben. Ein solcher Verlust oder eine stille Neubewertung ist blockierend. Negativnachweis: Gleiche Kennung mit geändertem Wortlaut/Parameter übernimmt keine Bewertung als aktuell bestätigt; eine entfallene Anforderung behält ihre eigene Dokumentation; Mehrdeutigkeit wählt keinen zufälligen Treffer.

### R35-pruefung-risiko-kennzahlen

**Scope:** `src/**`, `docs/PROJECT_PROPS.md`

Bei Änderungen an Prüfung, Risikoentscheidung, Historie oder Kennzahlen bleiben Prüfplan und Prüfergebnis getrennte Dokumente; geplant ist nicht geprüft, umgesetzt ist nicht wirksam nachgewiesen. Eine Risikoannahme oder Freigabe verlangt den ausdrücklichen menschlichen Entscheidungsvorgang mit den dafür vorgesehenen Angaben; Maßnahmenabschluss darf sie nicht automatisch erzeugen. Lokale Rollenansichten schützen vor unbeabsichtigtem Bearbeiten, behaupten aber keine technisch erzwungene Personenautorisierung oder unabhängige Vier-Augen-Prüfung ohne Konten. Lokale Historie belegt keine Manipulationssicherheit. Jede verdichtete Kennzahl nennt im selben Blick Umfang, Zähler/Nenner bzw. Berechnungsregel, fehlende/unbekannte Aussagen und Bezugszeitpunkt; Berichte führen die Regel mit. Eine automatische Compliance-, Reifegrad- oder SoA-Zusage ohne beschlossenen fachlichen Vertrag ist blockierend, ebenso eine falsch behauptete Governancekontrolle. Negativnachweis: Abgeschlossene Maßnahme setzt weder Risikoannahme noch Wirksamkeitsnachweis; fehlende Statuswerte oder ein leerer Nenner erzeugen keine unbegründete Erfüllungsquote. Eine Überfälligkeitsberechnung benötigt eine dokumentierte Zeit- und Zeitzonenregel und bleibt als Ableitung erkennbar.

### R36-bearbeitungskontext-loeschung

**Scope:** `src/**`, `docs/PERSISTENCE.md`

Bei Änderungen an Navigation, Mehrfachauswahl, Massenaktionen oder Löschung bleibt der Bearbeitungskontext eindeutig. Vor einer Massenänderung ist ihr tatsächlicher Umfang einschließlich ausgeblendeter ausgewählter Einträge erkennbar; ein Verbundwechsel überträgt weder Auswahl noch Eingabewerte auf fremde Dokumente. Noch ungespeicherte Änderungen bleiben bei Navigation erhalten oder werden ausdrücklich verworfen, niemals still verloren. Löschung folgt dem vollständigen Löschvertrag in docs/PERSISTENCE.md: betroffene Entwürfe, ein- und ausgehende Bindungen, Indizes, Caches, Suchindex und vorhandene Werkzeughistorie werden mitbereinigt; optionale Feldhistorie benötigt eine dokumentierte Aufbewahrungs- und Schwärzungsregel. Die App verspricht weder die Löschung bereits exportierter Dateien noch eine sichere physische Löschung von Datenträgerbytes. Ein Verlust, eine falsche Massenänderung oder eine appinterne Restkopie nach zugesagter Löschung ist blockierend. Negativnachweise: Auswahl unter geändertem Filter und nach Verbundwechsel; Sentinel-Suche nach Löschung über alle appinternen Ablagen bei erhaltenem Kontrolldokument. Tastaturbedienung und sichtbarer Fokus erreichen auch Auswahlumfang, Bestätigung und Verwerfen.

## Datei-Kontexte

Dokumente, die beim Review der genannten Pfade als Kontext heranzuziehen sind.

| Datei | Inhalt | Scope |
| --- | --- | --- |
| `docs/ARCHITECTURE.md` | Schichten, Datenfluss von BSI-Upstream bis UI, Verzeichnisverantwortung | global |
| `docs/OSCAL_VERSION_MATRIX.md` | Verbindliche Root-Typ-mal-Version-Matrix, Schema-Pins, Migrationspolitik | `src/domain/**`, `src/adapters/**`, `scripts/**` |
| `docs/OSCAL_VALIDATION.md` | Validierungsvertrag: womit und wo geprüft wird | `src/domain/**`, `src/adapters/**`, `scripts/**` |
| `docs/INTEGRITY.md` | SHA-256-Verifikation, Provenance, Manifest v2, SLSA | `src/domain/integrity.ts`, `src/state/**`, `scripts/**`, `.github/workflows/**` |
| `docs/DOMAIN_MODELS.md` | Rohe OSCAL-Typen gegen angereicherte Domänentypen | `src/domain/**`, `src/adapters/**`, `src/features/**` |
| `docs/FILTERING.md` | Filterlogik und URL-Parameter-Synchronisation | `src/hooks/**`, `src/features/**` |
| `docs/VOCABULARY.md` | BSI-Vokabulare, Namespaces, Taxonomie-Abdeckung | `src/domain/vocabulary*.ts`, `src/features/vocabular*/**`, `scripts/**` |
| `README.md` | Projektzweck, Setup, Kommandos | global |
| `docs/PERSISTENCE.md` | Datenklassen, Verbundidentität, Transaktionen, Konflikte, Entwürfe, Backup, Migration und Löschung | `src/**` |
| `docs/PROJECT_PROPS.md` | Projektsemantik, Namespace-Grenze, Werteräume, Träger und Katalogreferenzpaare | `src/**` |
| `docs/OSCAL_ROUND_TRIP.md` | Verlustfreiheit, No-op-Identität, Ausgabeprüfung und Grenzen des Round-trip-Nachweises | `src/**` |
