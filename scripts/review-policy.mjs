#!/usr/bin/env node

/**
 * Autorenquelle der repo-internen Review-Policy (GSPP-374).
 *
 * Gitar und Greptile prüfen dieses Repository parallel. Ihre gemeinsamen
 * Reviewregeln lagen bis hierher ausschließlich außerhalb des versionierten
 * Repositoriums: in gitignorierten Dateien und in Dashboard-Einstellungen der
 * beiden Anbieter. Für Gitar hatte das eine harte Folge — es liest laut
 * Hersteller `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*`,
 * `.gitar/**`, `.claude/skills/` und `.github/skills/`, und `.gitignore`
 * schließt in diesem Repository jede einzelne dieser Quellen aus. Gitar hat
 * also ohne jede repo-seitige Anweisung gereviewt.
 *
 * Diese Datei ist deshalb die **einzige** Autorenquelle für Regel-ID,
 * Regeltext, Scope und Zielzuordnung. Alles Weitere wird daraus deterministisch
 * erzeugt:
 *
 *   - `docs/REVIEW_INVARIANTS.md`   menschenlesbar, versioniert, reviewbar
 *   - `.gitar/review/invarianten.md` dünner Adapter, bindet die Doku per
 *                                    `@`-Include ein
 *
 * Der Greptile-Zweig (`.greptile/`) folgt im blockierten Folgeslice GSPP-383;
 * bis dahin bleibt der bestehende Dashboard-Importzyklus über
 * `.claude/greptile/contexts.mjs` aktiv. Jene Datei ist gitignored und bezieht
 * ihre Texte seit GSPP-374 aus **dieser** Datei — die Abhängigkeit läuft
 * ausschließlich von der gitignorierten zur versionierten Seite, nie umgekehrt.
 *
 * Aufruf:
 *
 *   node scripts/review-policy.mjs --check   # Drift-Prüfung (Standard), CI-Gate
 *   node scripts/review-policy.mjs --write   # abgeleitete Dateien neu erzeugen
 *
 * Ohne Flag wird geprüft, nicht geschrieben: ein versehentlicher Aufruf darf
 * eine Abweichung nie stillschweigend wegschreiben.
 *
 * Regeltexte werden hier **ohne** den `<key>: `-Präfix geführt. Der Präfix ist
 * eine Krücke des Greptile-Importpfads (GSPP-354, fehlende Update-API) und
 * gehört dorthin, nicht in die Autorenquelle.
 */

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repository-Wurzel, unabhängig vom Arbeitsverzeichnis des Aufrufers. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @typedef {{ key: string, scopes: string[], body: string }} ReviewRule */
/** @typedef {{ path: string, description: string, scopes: string[] }} FileContext */

/** Rahmenregeln ohne Datei-Scope — gelten für jeden Review. @type {ReviewRule[]} */
export const globalRules = [
  {
    key: 'G1-sprache',
    scopes: [],
    body:
      `Verfasse Zusammenfassung und alle Reviewkommentare auf Deutsch. Fachbegriffe und Code-Bezeichner bleiben englisch.`,
  },
  {
    key: 'G2-anwendungskontext',
    scopes: [],
    body:
      `Diese Anwendung ist ein rein clientseitiger Browser für die unterstützten BSI-Kataloge "Stand der Technik" und "WLAN" im OSCAL-Format. Sie wird auf GitHub Pages unter dem Basispfad /Grundschutz-Navigator/ ausgeliefert. Es gibt kein Backend, keine Datenbank, keine Serverlaufzeit, kein Nutzerkonto und keine personenbezogenen Daten außer den Impressumsfeldern. Melde keinen Befund, der eine Serverkomponente, eine Session oder eine Datenbank voraussetzt. Die BSI-Kataloge werden zur Build-Zeit aus einem gepinnten Upstream-Commit geholt; die Dateien unter public/data/ sind gitignored und tauchen in keinem Diff auf. Die einzigen Vertrauensanker sind gepinnter Upstream-Commit, Allowlist beim Abruf, SHA-256-Provenance und SLSA-Attestation.`,
  },
  {
    key: 'G3-nicht-melden',
    scopes: [],
    body:
      `Lint, Typprüfung, Tests, Coverage-Schwellen, Actions-SHA-Pinning und der PR-Dokumentationsvertrag laufen bereits als CI-Checks. Melde nichts, was eslint.config.js, tsc oder die Guards unter scripts/ ohnehin abfangen. Melde ebenso keine Geschmacksfragen und keine alternativen Formulierungen gleichwertiger Logik. Konzentriere dich auf Logikfehler, gebrochene Invarianten, Sicherheitsauswirkungen und Dokumentation, die nicht mehr zum Code passt.`,
  },
  {
    key: 'G4-befundqualitaet',
    scopes: [],
    body:
      `Jeder Befund nennt den konkreten Fehlerfall: welcher Input, welcher Zustand, welches falsche Ergebnis. Ein Befund ohne benennbaren Fehlerfall ist eine Vermutung und gehört nicht in den Review, sondern allenfalls als Frage formuliert.`,
  },
  {
    key: 'G5-priorisierung',
    scopes: [],
    body:
      `Priorisiere Befunde in dieser Reihenfolge:
1. Gebrochene Invarianten — Integritätsprüfung, Quellregister, Versionsmatrix, Upstream-Allowlist. Diese vier tragen die Sicherheitsaussage der Anwendung; ein Bruch hier schlägt jede Stilfrage.
2. Verlust von Quelldaten beim Parsen.
3. Undefinierte Fehlerpfade bei Netzwerk- und Parse-Operationen.
4. Dokumentation, die dem Code widerspricht.`,
  },
  {
    key: 'G6-pruefgrenzen',
    scopes: [],
    body:
      `Repository-Einstellungen wie Rulesets, Branch Protection und Actions-Policies kannst du mit deinem Token nicht lesen. Dokumentiert ein Diff so etwas, halte fest, dass du es nicht verifizieren konntest. Werte es nicht als Fehler und senke dafür nicht den Confidence Score.`,
  },
];

/** Invariantenregeln, die nur bei berührtem Scope greifen. @type {ReviewRule[]} */
export const scopedRules = [
  {
    key: 'R1-integritaet',
    scopes: [
      'src/domain/integrity.ts',
      'src/state/CatalogContext.tsx',
      'src/adapters/**',
      'scripts/fetch-catalog.mjs',
    ],
    body:
      `Die SHA-256-Prüfung bezieht sich auf den rohen ArrayBuffer der ausgelieferten Datei, nicht auf das Parse-Ergebnis. Änderungen dürfen die Hash-Berechnung nicht auf serialisierte oder rekonstruierte Objekte umstellen, die Prüfung nicht überspringen und ihren Fehlerfall nicht stillschweigend schlucken. Ein Verstoß ist ein blockierender Befund.`,
  },
  {
    key: 'R2-quellregister',
    scopes: [
      'src/**',
      'scripts/**',
      'upstream-manifest.json',
    ],
    body:
      `Repository, Upstream-Pfade, Katalogschlüssel, erwartete OSCAL-Root-Typen und Lifecycle kommen ausschließlich aus src/domain/sourceRegistry.mjs. artifactKey und vorhandene catalogKey beginnen mit einem kleingeschriebenen ASCII-Buchstaben; danach sind nur kleingeschriebene ASCII-Buchstaben, Ziffern und Bindestriche erlaubt, das letzte Zeichen ist alphanumerisch. Melde jede Aufweitung dieser Grammatik, insbesondere eine führende Ziffer. Melde jede hartcodierte BSI-Repo-Angabe, jeden hartcodierten Upstream-Pfad und jede zusätzliche Fetch-Quelle außerhalb von sourceRegistry.mjs und scripts/security-guards.mjs. Ein Verstoß ist ein blockierender Befund. Eine Fetch-Quelle im Sinne dieser Regel ist ein Endpunkt, aus dem Anwendung oder Build-Pipeline Daten beziehen, die in das Produkt eingehen. Testcode fällt nicht darunter, solange die Anfrage das Testsystem nachweislich nicht verlässt: Der Egress-Guard in src/test/browser/browserEgressGuard.ts fängt in der Browser-Testlane jede Anfrage auf Playwright-Context-Ebene ab und bricht sie vor jeder Namens- oder Netzauflösung ab. Eine URL, die ausschließlich als Ziel eines absichtlich blockierten Egress-Nachweises dient, ist deshalb kein Befund — unabhängig davon, ob sie über eine Loopback-Adresse, einen abweichenden Port oder einen testinternen Canary-Header realisiert ist. Melde sie nur, wenn der Guard sie passieren lässt oder wenn Produktions- oder Build-Code sie benutzt. Verlange nicht, dass solche Nachweise gleichoriginig bleiben; ein Nachweis, der den Cross-Origin-Pfad des Guards ausführt, ist der stärkere und ausdrücklich gewollte. Ein Issue-PR darf einen neuen Snapshot nur zusammen mit einer registrierten Registry-Migration führen — entweder als atomare Snapshot-Sperrmigration (mindestens ein Lifecycle-Wechsel nach blocked-by-upstream) oder als atomare OSCAL-Versionsmigration (isRegistryOscalVersionMigration, GSPP-283-Folgefall: BSI hebt metadata.oscal-version eines bereits registrierten Artefakts an, der reguläre manifest-only Sync-Pfad kann sourceRegistry.mjs nicht mitführen und beide Seiten blockieren sich sonst gegenseitig am required validate-Check). Bei beiden gilt: Manifest und sourceRegistry.mjs müssen gemeinsam geändert sein; Pfadmenge, artifactKey und Root-Typ bleiben unverändert. Bei der Versionsmigration darf zusätzlich einzig oscalVersion je Artefakt abweichen — lifecycle, upstreamPath und jedes andere Feld bleiben exakt gleich, unabhängig vom Lifecycle-Wert (auch preview darf seine Version anheben, ohne nach blocked-by-upstream zu wechseln: ein Versionssprung ist kein Defekt). Der Diff der Versionsmigration trägt neben upstream-manifest.json und sourceRegistry.mjs ausschließlich Pfade unter src/ und docs/ — eine Positivliste, kein Verbot: jeder Pfad unter scripts/ oder .github/ sowie jede Wurzeldatei lässt das Prädikat fail-closed auf den regulären Sync-Pfad zurückfallen, weil die Beweiskette der Lane selbst (Fetch, Manifest-Erzeugung, Policy, Guard, Workflows) dort liegt. Ein dauerhaft aus dem gepinnten BSI-Tree entferntes, zuvor blocked-by-upstream geführtes Artefakt darf ohne Manifeständerung als Cleanup aus dem Register entfernt werden, wenn der Tree die Abwesenheit bestätigt und Tests, Typunion sowie Dokumentation die Entfernung vollständig nachvollziehen; davon unabhängige Mapping-Artefakte bleiben unverändert. Der Registervergleich läuft über den vollständigen Bestand einschließlich der Nicht-oscal-Einträge und strukturell statt per Referenz, damit ein künftiges Objektfeld die Ausnahme nicht still verschließt. Der Registerstand am Base-SHA wird ausserhalb des Quellbaums geladen; ein temporäres Modul unter src/ ist ein blockierender Befund. Der Guard validiert in beiden Fällen Register, signiertes Manifest, ausschließlich vorwärts gerichteten Snapshot und sämtliche Pins gegen den offiziellen BSI-Tree (volle verifySnapshotFiles-Prüfung, keine Kürzung gegenüber dem regulären Sync-Pfad). Entsperrung, Re-Keying, Root-Typ-Umdeutung, jede andere Bestandsänderung, Registry-/Manifest-Drift und jeder andere Snapshotstatus als ahead müssen fail-closed bleiben.`,
  },
  {
    key: 'R3-versionsautoritaet',
    scopes: [
      'src/domain/**',
      'src/adapters/**',
      'scripts/**',
    ],
    body:
      `metadata.oscal-version ist die einzige Versionsautorität. $schema darf gelesen, aber niemals zur Auswahl eines Schemas oder eines Codepfads benutzt werden. Schema-Pins (Asset-Name, Release-Tag, $id, SHA-256, Ablageort) leben nur in src/domain/oscalVersionMatrix.mjs. Ein Verstoß ist ein blockierender Befund.`,
  },
  {
    key: 'R4-keine-doppelten-registerfakten',
    scopes: [
      'src/domain/**',
      'src/adapters/**',
      'scripts/**',
    ],
    body:
      `Jeder Fakt hat genau einen Ort: Root-Typ mal Version und Schema-Pin in oscalVersionMatrix.mjs, Artefaktpfade und Lifecycle in sourceRegistry.mjs. Melde jede Kopie dieser Tabellen in Konstanten, Tests oder Skripten.`,
  },
  {
    key: 'R5-generierte-daten',
    scopes: [
      'public/**',
      '.gitignore',
      '.github/workflows/**',
    ],
    body:
      `catalog.json, catalog-wlan.json, catalog-metadata.json, catalog-wlan-metadata.json, vocabularies.json, vocabularies-metadata.json und upstream-sources-metadata.json unter public/data/ werden zur Build-Zeit erzeugt und dürfen nie eingecheckt werden. Melde jede Änderung an .gitignore, die diese Einträge entfernt oder aufweicht. Ein Verstoß ist ein blockierender Befund.`,
  },
  {
    key: 'R6-coverage-schwellen',
    scopes: ['vite.config.ts'],
    body:
      `Die Coverage-Schwellen in vite.config.ts (lines, branches, functions, statements) dürfen nicht gesenkt werden. Ein Diff, der einen dieser Werte herabsetzt, ist ein blockierender Befund — auch wenn die CI grün ist.`,
  },
  {
    key: 'R7-kolokierte-tests',
    scopes: [
      'src/domain/**',
      'src/adapters/**',
      'scripts/**',
    ],
    body:
      `Logik in src/domain/, src/adapters/ und scripts/ braucht kolokierte Tests in einer *.test.ts neben der Datei. Neue oder geänderte Verzweigungen ohne Testabdeckung sind ein Befund; benenne die konkrete unabgedeckte Verzweigung.`,
  },
  {
    key: 'R8-actions-pinning',
    scopes: ['.github/workflows/**', '.github/actions/**'],
    body:
      `Jede GitHub Action wird auf einen vollständigen 40-stelligen Commit-SHA gepinnt, mit der Version als nachgestelltem Kommentar. Tag- oder Branch-Referenzen sind ein blockierender Befund. Workflow-Berechtigungen bleiben minimal, und Checkout-Schritte ohne Push-Bedarf setzen persist-credentials: false.`,
  },
  {
    key: 'R9-vite-env-oeffentlich',
    scopes: [
      'src/**',
      'vite.config.ts',
      '.github/workflows/**',
      '.env.local.example',
    ],
    body:
      `Alles mit VITE_-Präfix landet im ausgelieferten Bundle und ist damit öffentlich. Melde jeden Versuch, ein Secret, einen Token oder einen API-Schlüssel über eine VITE_-Variable zu führen. Die VITE_IMPRESSUM_*-Felder sind bewusst öffentlich. Ein Verstoß ist ein blockierender Befund.`,
  },
  {
    key: 'R10-basispfad',
    scopes: ['src/**', 'index.html'],
    body:
      `Die App läuft unter dem GitHub-Pages-Basispfad /Grundschutz-Navigator/. Asset-, Daten- und Routenpfade werden über import.meta.env.BASE_URL gebildet. Ein absoluter Pfad, der mit / beginnt, bricht das Deployment und ist ein Befund.`,
  },
  {
    key: 'R11-tailwind-ohne-postcss',
    scopes: [
      'postcss.config.*',
      'tailwind.config.*',
      'package.json',
      'vite.config.ts',
    ],
    body:
      `Tailwind CSS v4 läuft ausschließlich über das Vite-Plugin @tailwindcss/vite. Eine PostCSS-Konfiguration oder eine tailwind.config.js ist ein blockierender Befund, kein Stilthema.`,
  },
  {
    key: 'R12-importalias',
    scopes: ['src/**/*.ts', 'src/**/*.tsx'],
    body:
      `Projektinterne Imports nutzen den Alias @/. Melde relative Importpfade, die das eigene Verzeichnis verlassen.`,
  },
  {
    key: 'R13-deutsche-oberflaeche',
    scopes: [
      'src/features/**',
      'src/components/**',
      'src/app/**',
      'index.html',
    ],
    body:
      `Die Oberfläche und alle sichtbaren Texte sind deutsch, mit korrekten Umlauten und ß. Melde englische UI-Strings und ASCII-Ersatzschreibweisen wie "fuer" oder "Loeschen".`,
  },
  {
    key: 'R14-doku-folgt-verhalten',
    scopes: ['src/**', 'scripts/**'],
    body:
      `Ändert der Diff dokumentiertes Verhalten, muss die betroffene Datei unter docs/ oder README.md mitgeändert werden. Prüfe die inhaltliche Richtigkeit der Doku-Änderung, nicht nur ihr Vorhandensein. Fehlt sie, benenne konkret den Abschnitt, der jetzt falsch ist.`,
  },
  {
    key: 'R15-verlustfreies-dokumentmodell',
    scopes: ['src/adapters/**', 'src/domain/**'],
    body:
      `Der Adapter reichert die OSCAL-Quelle an, er wirft nichts weg. Ein Diff, der beim Parsen OSCAL-Felder verliert, zusammenfasst oder normalisiert, ist ein blockierender Befund — auch wenn die Oberfläche davon nichts merkt.`,
  },
  {
    key: 'R16-fehlerpfade',
    scopes: [
      'src/state/**',
      'src/domain/integrity.ts',
      'src/adapters/**',
      'src/hooks/**',
    ],
    body:
      `Der Katalog wird über das Netz geladen. Jeder neue Netzwerk- oder Parse-Pfad braucht einen definierten Fehlerzustand. Ein Pfad, der im Fehlerfall in einem hängenden Ladezustand endet, ist ein Bug, kein Randfall.`,
  },
  {
    key: 'R17-oscal-belegen',
    scopes: [
      'src/domain/**',
      'src/adapters/**',
      'scripts/**',
      'docs/**',
    ],
    body:
      `Normative Aussagen über OSCAL werden gegen usnistgov/OSCAL belegt, gepinnt auf Tag oder Commit. Die vendorten, SHA-256-gepinnten Schemata und src/domain/oscalVersionMatrix.mjs sind für Struktur- und Versionsfragen maßgeblich. Behaupte nichts über OSCAL aus dem Gedächtnis; was du nicht gegen diese Quellen belegen kannst, formulierst du als Frage statt als Befund.`,
  },
  {
    key: 'R18-go-oscal-korpus',
    scopes: [
      'scripts/verify-upstream-oscal.mjs',
      'scripts/verify-upstream-oscal.test.ts',
      'src/domain/sourceRegistry.mjs',
      'upstream-manifest.json',
      '.github/workflows/ci.yml',
      'docs/OSCAL_VALIDATION.md',
    ],
    body:
      `Der unabhängige go-oscal-Korpuslauf nutzt ausschließlich statisch gepinnte Release-Artefakte, den gepinnten BSI-Snapshot und Registry-Fakten. Alle nicht gesperrten Artefakte müssen die Schema-Prüfung bestehen; blocked-by-upstream muss scheitern, ein bestandener Sperreintrag ist ein Entsperrungskandidat. Es gibt keine Diagnosesignatur-Policy, keine Aggregat-Zerlegung und keine Fortsetzung durch einen Schemafehler. Fehlendes oder nicht auswertbares Werkzeugergebnis ist ein redigierter Werkzeugfehler, nie ein Schemaergebnis. Eine temporäre Werkzeugkopie darf allein eine stringförmige Top-Level-$schema-Direktive entfernen, um den bestätigten go-oscal-Modelldetektor-Defekt zu umgehen; die verifizierten Upstream-Bytes und metadata.oscal-version bleiben unverändert.`,
  },
  {
    key: 'R19-stufe-3-schemavalidierung',
    scopes: [
      'src/domain/oscalSchemaBundle.ts',
      'src/domain/oscalSchemaValidation.ts',
      'src/domain/oscalClass2Import.ts',
      'src/workers/**',
      'scripts/verify-oscal-schemas.mjs',
      'scripts/sync-oscal-schemas.mjs',
      'schemas/**',
      '.gitattributes',
      'vite.config.ts',
      '.github/workflows/ci.yml',
    ],
    body:
      `Stufe 3 validiert im Modul-Worker mit ajv 8.20.0 gegen die eingecheckten NIST-Schemas unter schemas/oscal/. Verbindlich: Die Zelle kommt ausschließlich aus dem Schema-Pin der Stufe 2, nie aus Dokumentinhalt, und es gibt keinen Fallback auf eine Nachbarversion. src/domain/oscalSchemaBundle.ts führt je Zelle ein ausgeschriebenes import()-Literal; ein aus Daten oder Template zusammengesetzter Importpfad ist ein blockierender Befund. Zum Laufzeitbezug gilt die Grenze genau so: Ein Schema-, Validator- oder Constraint-Bezug von einer FREMDEN Origin zur Laufzeit ist ein blockierender Befund — insbesondere github.com (Release-Asset) und csrc.nist.gov (die $id der Schemas). Der lazy import() des ausgewählten Schema-Chunks von DERSELBEN Origin ist dagegen der vorgesehene Weg und kein Befund; er ist die Voraussetzung dafür, dass nicht alle 30 Schemas im Worker liegen. Eine Dokumentations- oder Kommentaraussage, die jeden Laufzeit-Netzbezug ausschließt statt nur den fremd-originbezogenen, ist ihrerseits ein Befund. validateFormats bleibt false, allErrors bleibt false, unicodeRegExp wird nicht gesetzt — ein Abschalten von unicodeRegExp lässt jedes OSCAL-Dokument am TokenDatatype-Muster scheitern und ist ein blockierender Befund. Ajvs message und params dürfen keine Diagnose erreichen; übernommen werden nur der Keyword-abgeleitete projekteigene Code und der redigierte instancePath, unbekannte Segmente werden zum Platzhalter. Ein nicht in der Keyword-Positivliste geführter Befund wird OSCAL_VALIDATOR_OUTPUT_UNRECOGNIZED, eine nicht ladbare oder nicht kompilierbare Zelle OSCAL_SCHEMA_UNAVAILABLE; Stufe 3 darf nie übersprungen oder als bestanden ausgewiesen werden. npm run verify-oscal-schemas ist das netzfreie CI-Gate über SHA-256, $id, draft-07 und die Abwesenheit ungepinnter Dateien unter schemas/oscal/; ein fetch in scripts/verify-oscal-schemas.mjs, ein Entfernen dieses CI-Schritts, ein Entfernen von worker.format: 'es' aus vite.config.ts oder ein Aufweichen von .gitattributes (schemas/oscal/** -text) ist jeweils ein blockierender Befund. Eine Laufzeit-Hashprüfung der gebündelten Schemas wird nicht verlangt: Der Bundler transformiert die Bytes, ein mitgeliefertes Soll würde sich selbst bestätigen.`,
  },
  {
    key: 'R20-stufe-5-referenzgraph',
    scopes: [
      'src/domain/referenceGraph*.ts',
      'src/domain/referenceResolution.ts',
      'scripts/verify-upstream-oscal.mjs',
      'scripts/oscal-domain-bridge.mjs',
      'tsconfig.app.json',
      'tsconfig.node.json',
      'docs/OSCAL_VALIDATION.md',
      'docs/INTEGRITY.md',
    ],
    body:
      `Stufe 5 ist der Referenzgraph in src/domain/referenceGraph*.ts auf Basis von src/domain/referenceResolution.ts. Verbindlich: Die Formentscheidung ueber einen href faellt ausschliesslich in referenceResolution.ts — ein Fragmentvergleich (startsWith('#')), ein Protokollvergleich, eine URL-Normalisierung oder eine Pfadaufloesung ausserhalb dieses Moduls ist ein blockierender Befund. Relative und externe Ziele werden nie aufgeloest, auch nicht ueber Dateinamen, Titelaehnlichkeit oder Fremd-Namespace-props (etwa catalog_uuid); eine solche Heuristik ist ein blockierender Befund. Dokumentuebergreifende Aufloesbarkeit entsteht nur durch eine ausdrueckliche Bindung des Aufrufers; der CI-Lauf uebergibt keine. Ein Knoten traegt immer Dokumentidentitaet plus lokale ID — eine kontextlose ID-Aufloesung oder ein Ausweichen auf einen anderen geladenen Katalog ist ein blockierender Befund, weil control/@id nur lokal eindeutig ist. Die vier Zustaende resolved, unresolvable, not-evaluable und die fachliche Aussage no-relationship bleiben getrennt; ein relatives oder externes Ziel darf nie als Referenzfehler gezaehlt werden, und no-relationship erzeugt nie eine Kante. Alle Befunde entstehen ueber createOscalDiagnostic mit stage 'reference'; ein zweites Diagnosemodell, eine eigene Severity-Skala oder ein href-, ID- oder sonstiger Dokumentwert in einer Diagnose oder CI-Ausgabe ist ein blockierender Befund. Die CI-Politik bleibt fail-closed fuer supported-Artefakte; preview, draft und blocked-by-upstream duerfen sichtbar, aber nicht blockierend sein und nie als abschliessend bewertet erscheinen. Allowlist-Eintraege binden an Diagnosesignatur UND Snapshot-Commit und laufen bei Aenderung von Snapshot oder Pfad aus; eine Aufweichung dieser Bindung ist ein blockierender Befund. erasableSyntaxOnly muss in tsconfig.app.json und tsconfig.node.json gesetzt bleiben und der Aliashook in scripts/oscal-domain-bridge.mjs auf src/ beschraenkt: Ohne beides bricht die CI-Lane oder laedt Code ausserhalb des Quellbaums.`,
  },
];

/** Dokumente, die beim Review der genannten Pfade als Kontext gelten. @type {FileContext[]} */
export const fileContexts = [
  {
    path: 'docs/ARCHITECTURE.md',
    description: 'Schichten, Datenfluss von BSI-Upstream bis UI, Verzeichnisverantwortung',
    scopes: [],
  },
  {
    path: 'docs/OSCAL_VERSION_MATRIX.md',
    description: 'Verbindliche Root-Typ-mal-Version-Matrix, Schema-Pins, Migrationspolitik',
    scopes: [
      'src/domain/**',
      'src/adapters/**',
      'scripts/**',
    ],
  },
  {
    path: 'docs/OSCAL_VALIDATION.md',
    description: 'Validierungsvertrag: womit und wo geprüft wird',
    scopes: [
      'src/domain/**',
      'src/adapters/**',
      'scripts/**',
    ],
  },
  {
    path: 'docs/INTEGRITY.md',
    description: 'SHA-256-Verifikation, Provenance, Manifest v2, SLSA',
    scopes: [
      'src/domain/integrity.ts',
      'src/state/**',
      'scripts/**',
      '.github/workflows/**',
    ],
  },
  {
    path: 'docs/DOMAIN_MODELS.md',
    description: 'Rohe OSCAL-Typen gegen angereicherte Domänentypen',
    scopes: [
      'src/domain/**',
      'src/adapters/**',
      'src/features/**',
    ],
  },
  {
    path: 'docs/FILTERING.md',
    description: 'Filterlogik und URL-Parameter-Synchronisation',
    scopes: ['src/hooks/**', 'src/features/**'],
  },
  {
    path: 'docs/VOCABULARY.md',
    description: 'BSI-Vokabulare, Namespaces, Taxonomie-Abdeckung',
    scopes: [
      'src/domain/vocabulary*.ts',
      'src/features/vocabular*/**',
      'scripts/**',
    ],
  },
  {
    path: 'README.md',
    description: 'Projektzweck, Setup, Kommandos',
    scopes: [],
  },
];

/** Globale und gescopte Regeln in stabiler Reihenfolge. @type {ReviewRule[]} */
export const allRules = [...globalRules, ...scopedRules];

/**
 * Der Schlüssel ist die stabile Kennung einer Regel über Gitar, Greptile und
 * Dokumentation hinweg. Er wird in Reviewkommentaren zitiert und darf sich
 * deshalb nicht ändern, wenn nur der Text geschärft wird.
 */
const RULE_KEY_PATTERN = /^[GR][1-9][0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ReviewPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReviewPolicyError';
  }
}

/**
 * Prüft die Autorenquelle selbst, bevor irgendetwas aus ihr erzeugt wird.
 * Fail-closed: ein doppelter Schlüssel oder eine gescopte Regel ohne Scope
 * würde sonst als still fehlerhafte Regel in beide Adapter wandern.
 */
export function assertPolicyIsWellFormed({ global = globalRules, scoped = scopedRules, files = fileContexts } = {}) {
  const seen = new Set();
  for (const rule of [...global, ...scoped]) {
    if (!RULE_KEY_PATTERN.test(rule.key)) {
      throw new ReviewPolicyError(`Ungültiger Regelschlüssel: ${rule.key}`);
    }
    if (seen.has(rule.key)) {
      throw new ReviewPolicyError(`Doppelter Regelschlüssel: ${rule.key}`);
    }
    seen.add(rule.key);
    if (rule.body.trim().length === 0) {
      throw new ReviewPolicyError(`Regel ohne Text: ${rule.key}`);
    }
    if (rule.body.startsWith(`${rule.key}: `)) {
      throw new ReviewPolicyError(
        `Regeltext trägt den Greptile-Importpräfix: ${rule.key}. ` +
        'Der Präfix gehört in .claude/greptile/contexts.mjs, nicht in die Autorenquelle.',
      );
    }
  }

  for (const rule of global) {
    if (rule.scopes.length > 0) {
      throw new ReviewPolicyError(`Globale Regel mit Datei-Scope: ${rule.key}`);
    }
  }

  for (const rule of scoped) {
    if (rule.scopes.length === 0) {
      throw new ReviewPolicyError(`Gescopte Regel ohne Datei-Scope: ${rule.key}`);
    }
  }

  const seenPaths = new Set();
  for (const context of files) {
    if (seenPaths.has(context.path)) {
      throw new ReviewPolicyError(`Doppelter Datei-Kontext: ${context.path}`);
    }
    seenPaths.add(context.path);
  }
}

/** Kopfzeile jeder erzeugten Datei — sie sagt, wo bearbeitet wird. */
function generatedBanner() {
  return [
    '<!--',
    '  GENERIERT — nicht von Hand bearbeiten.',
    '  Autorenquelle: scripts/review-policy.mjs',
    '  Neu erzeugen:  npm run review-policy',
    '  Drift prüfen:  npm run review-policy:check',
    '-->',
  ].join('\n');
}

const formatScopes = (scopes) =>
  scopes.length === 0 ? 'global' : scopes.map((scope) => `\`${scope}\``).join(', ');

/** Menschenlesbare, reviewbare Fassung der vollständigen Policy. */
export function renderInvariantsDocument({ global = globalRules, scoped = scopedRules, files = fileContexts } = {}) {
  const lines = [
    generatedBanner(),
    '',
    '# Review-Invarianten',
    '',
    'Der verbindliche Reviewvertrag dieses Repositoriums. Er gilt gleichrangig für',
    'Gitar, für Greptile und für jeden Agenten-Cross-Review.',
    '',
    'Diese Datei wird aus `scripts/review-policy.mjs` erzeugt. Änderungen gehören',
    'dorthin; `npm run review-policy:check` läuft im CI-Job `validate` und schlägt',
    'bei jeder manuellen Abweichung fehl.',
    '',
    '## Globale Regeln',
    '',
    'Gelten für jeden Review, unabhängig von den geänderten Dateien.',
    '',
  ];

  for (const rule of global) {
    lines.push(`### ${rule.key}`, '', rule.body, '');
  }

  lines.push(
    '## Gescopte Invariantenregeln',
    '',
    'Gelten, sobald der Diff mindestens einen Pfad des jeweiligen Scopes berührt.',
    '',
  );

  for (const rule of scoped) {
    lines.push(`### ${rule.key}`, '', `**Scope:** ${formatScopes(rule.scopes)}`, '', rule.body, '');
  }

  lines.push(
    '## Datei-Kontexte',
    '',
    'Dokumente, die beim Review der genannten Pfade als Kontext heranzuziehen sind.',
    '',
    '| Datei | Inhalt | Scope |',
    '| --- | --- | --- |',
  );

  for (const context of files) {
    lines.push(`| \`${context.path}\` | ${context.description} | ${formatScopes(context.scopes)} |`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Gitar-Adapter. Bewusst dünn: Gitar liest jede Markdown-Datei unter
 * `.gitar/review/` und löst `@pfad`-Includes zuerst relativ zur Quelldatei und
 * ersatzweise gegen die Repository-Wurzel auf. Der Regeltext bleibt damit an
 * genau einer Stelle und wird hier nur eingebunden, nicht kopiert.
 */
export function renderGitarAdapter() {
  return [
    generatedBanner(),
    '',
    '# Review-Invarianten (Gitar)',
    '',
    'Verbindlich für jeden Review in diesem Repository. Der vollständige Regeltext',
    'steht in der versionierten Autorenquelle und wird hier eingebunden:',
    '',
    '@docs/REVIEW_INVARIANTS.md',
    '',
  ].join('\n');
}

/**
 * Verzeichnis der Gitar-Reviewregeln. Alles darin wird von Gitar gelesen —
 * eine zusätzliche, von Hand angelegte Datei wäre eine Regel an der
 * Autorenquelle vorbei und wird deshalb als Drift gewertet.
 */
export const GITAR_REVIEW_DIRECTORY = '.gitar/review';

/** Die erzeugten Dateien, relativ zur Repository-Wurzel. */
export const REVIEW_POLICY_TARGETS = [
  { path: 'docs/REVIEW_INVARIANTS.md', render: renderInvariantsDocument },
  { path: `${GITAR_REVIEW_DIRECTORY}/invarianten.md`, render: renderGitarAdapter },
];

/** Soll-Inhalt aller Ziele. Rein funktional, ohne Zeitstempel — zweimal aufgerufen identisch. */
export function renderReviewPolicy(policy = {}) {
  assertPolicyIsWellFormed(policy);
  return REVIEW_POLICY_TARGETS.map((target) => ({
    path: target.path,
    content: target.render(policy),
  }));
}

/** Dateien unter `.gitar/review/`, die zu keinem Ziel gehören. */
async function listUnexpectedGitarFiles(repoRoot, expected) {
  const directory = path.join(repoRoot, GITAR_REVIEW_DIRECTORY);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true, recursive: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(repoRoot, path.join(entry.parentPath, entry.name)))
    .filter((relative) => !expected.has(relative))
    .sort();
}

/**
 * Vergleicht die abgeleiteten Dateien mit der Autorenquelle.
 *
 * Fail-closed: fehlende Datei, abweichender Inhalt und überzählige Datei unter
 * `.gitar/review/` sind je ein Fehler, kein Hinweis.
 */
export async function checkReviewPolicy({ repoRoot = REPO_ROOT, policy = {} } = {}) {
  const rendered = renderReviewPolicy(policy);
  const problems = [];

  for (const target of rendered) {
    const absolute = path.join(repoRoot, target.path);
    let actual;
    try {
      actual = await readFile(absolute, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        problems.push(`fehlt: ${target.path}`);
        continue;
      }
      throw error;
    }
    if (actual !== target.content) {
      problems.push(`weicht von der Autorenquelle ab: ${target.path}`);
    }
  }

  const expected = new Set(rendered.map((target) => target.path));
  for (const unexpected of await listUnexpectedGitarFiles(repoRoot, expected)) {
    problems.push(`nicht aus der Autorenquelle erzeugt: ${unexpected}`);
  }

  if (problems.length > 0) {
    throw new ReviewPolicyError(
      `Review-Policy-Drift:\n  - ${problems.join('\n  - ')}\n\n` +
      'Autorenquelle ist scripts/review-policy.mjs. Mit `npm run review-policy` neu erzeugen.',
    );
  }

  return rendered;
}

/** Schreibt die abgeleiteten Dateien. Einziger Pfad, der etwas verändert. */
export async function writeReviewPolicy({ repoRoot = REPO_ROOT, policy = {} } = {}) {
  const rendered = renderReviewPolicy(policy);
  for (const target of rendered) {
    const absolute = path.join(repoRoot, target.path);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, target.content, 'utf8');
  }
  return rendered;
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const flags = process.argv.slice(2);
  const unknown = flags.filter((flag) => flag !== '--check' && flag !== '--write');
  if (unknown.length > 0) {
    console.error(`Unbekannte Option: ${unknown.join(', ')} — erlaubt sind --check und --write.`);
    process.exit(2);
  }

  const write = flags.includes('--write');
  try {
    if (write) {
      const rendered = await writeReviewPolicy();
      console.log(`Review-Policy erzeugt: ${rendered.map((target) => target.path).join(', ')}`);
    } else {
      const rendered = await checkReviewPolicy();
      console.log(
        `Review-Policy deckungsgleich (${allRules.length} Regeln, ${fileContexts.length} Datei-Kontexte, ` +
        `${rendered.length} abgeleitete Dateien).`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
