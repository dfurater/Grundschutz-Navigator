# Grundschutz++ Navigator

Inoffizielles Werkzeug zum Durchsuchen, Filtern und Exportieren des offiziellen Grundschutz++-Anwenderkatalogs des BSI. Kein Angebot des BSI.

[![CI](https://github.com/dfurater/Grundschutz-Navigator/actions/workflows/ci.yml/badge.svg)](https://github.com/dfurater/Grundschutz-Navigator/actions/workflows/ci.yml)
[![Validate](https://github.com/dfurater/Grundschutz-Navigator/actions/workflows/validate.yml/badge.svg)](https://github.com/dfurater/Grundschutz-Navigator/actions/workflows/validate.yml)
[![Deploy](https://github.com/dfurater/Grundschutz-Navigator/actions/workflows/deploy.yml/badge.svg)](https://github.com/dfurater/Grundschutz-Navigator/actions/workflows/deploy.yml)
[![Katalogdaten: CC BY-SA 4.0](https://img.shields.io/badge/Katalogdaten-CC%20BY--SA%204.0-blue)](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek)
[![App-Code: AGPL v3](https://img.shields.io/badge/App--Code-AGPL%20v3-green)](LICENSE)

> ⚠️ **Inoffizielles Community-Projekt, kein Angebot des BSI.** Keine Rechtsberatung, keine Gewähr. Für offizielle Informationen → [BSI Grundschutz++](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek).

## Live-Demo

**→ https://dfurater.github.io/Grundschutz-Navigator/**

Die App läuft vollständig im Browser. Keine Anmeldung, keine Installation.

## Code Quality:
[![Quality gate status](https://sonarcloud.io/api/project_badges/measure?project=gspp&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=gspp)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=gspp&metric=bugs)](https://sonarcloud.io/summary/new_code?id=gspp)
[![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=gspp&metric=code_smells)](https://sonarcloud.io/summary/new_code?id=gspp)

## Was kann die App?

- **Kataloge browsen** — Grundschutz++-, Lieferketten- und WLAN-Katalog, getrennt über ihren `catalogKey`; Routen beginnen mit `/katalog/:catalogKey`.
- **Volltextsuche** — Relevanzbasierte Suche über alle Kontrollen einschließlich Praktik-Aliase; Treffer erscheinen in 50er-Portionen. Route `/suche`.
- **Vokabulare nachschlagen** — Die 13 BSI-Namespace-CSVs als eigenständige Übersichten; Praktik- und Themen-Definitionen sind per UUID angebunden, Schutzziel-Relevanzstufen `0`–`2` werden getrennt erklärt. Route `/vokabular`.
- **Multi-Filter** — Sicherheitsniveau, Aufwandsstufe, Modalverb, Tags, Zielobjekt, Handlungswort, Dokumentationstyp, Link-Relation. Der Filterzustand steht in der URL und ist damit **teil- und bookmarkbar**.
- **CSV-Export** — Gefilterte Tabelle, Suchtreffer oder manuelle Auswahl als semikolon-getrennte CSV; WLAN-Taxonomiewerte L1–L4 werden separat mit optionalem Original-Namensraum exportiert. Der Alt-Identifier ist im aktuellen Katalog eindeutig, aber nicht garantiert versionsstabil.
- **Integritätsprüfung** — SHA-256 der ausgelieferten Katalog- und Vokabular-Artefakte wird zur Laufzeit gegen beim Build gepinnte Werte verglichen; Details stehen unter `/about`.
- **Responsive** — Desktop- und Mobile-Layouts.

## Zielgruppe

IT-Sicherheitsbeauftragte, Berater:innen, Auditor:innen, Studierende und alle, die den Grundschutz++-Anwenderkatalog **ohne Download und ohne Installation** durchsuchen, filtern und exportieren möchten.

## Datenquelle und Lizenz des Katalogs

- **Quelle:** [`BSI-Bund/Stand-der-Technik-Bibliothek`](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek). Die ausgelieferten Kataloge deklarieren OSCAL 1.1.3; die gepinnte Versionsmatrix trägt 1.1.2, 1.1.3, 1.2.1 und 1.2.2. Versionsautorität ist `metadata.oscal-version`, nie `$schema`.
- **Lizenz der Katalogdaten:** [Creative Commons BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.de)
- **Datenhaltung:** Die Katalogdaten werden **beim Build** aus dem BSI-Repository geladen. Im App-Repository wird keine Kopie gehalten.
- **Integrität:** Fixierter Upstream-Commit (`upstream-manifest.json`) plus SHA-256-Verify zur Laufzeit. Details: [`docs/INTEGRITY.md`](docs/INTEGRITY.md).
- **Aktualität:** Der Sync-Workflow läuft werktags 07:30 und 17:30 Uhr (Europe/Berlin) sowie bei Push auf `main` und manuell; bei einem Delta erstellt er einen Manifest-PR mit Auto-Squash und Branch-Löschung. Eine Post-Merge-Lane prüft danach den Stand auf `main` und dispatcht einen Fallback-Deploy nur nach erneuter Zustandsprüfung.

## Datenschutz

- Kein Tracking, keine Analytics, keine Cookies.
- Alle Berechnungen (Filter, Suche, Export) laufen **clientseitig** im Browser.

## Für Entwickler:innen — lokal starten

### Voraussetzungen

- **Node.js >= 22.22.0** (in `package.json` als `engines.node` deklariert)
- Optional ein **GitHub Token** in `GH_TOKEN` für höhere API-Rate-Limits beim Katalog-Fetch

### Quickstart

```bash
git clone https://github.com/dfurater/Grundschutz-Navigator.git
cd Grundschutz-Navigator
npm run setup                      # npm ci, Schema-Verifikation, Katalog-Fetch, Frische-Check
npm run dev                        # http://localhost:5173
```

`npm run setup` bootstrapt ein frisches Checkout (`npm ci --ignore-scripts`, offline Schema-Verifikation, Fetch gegen die gepinnte Snapshot-SHA, Frische-Check); aktuelle Daten werden übersprungen, `--force` erzwingt den Fetch. Optional `cp .env.local.example .env.local` für die Impressum-Platzhalter — ohne sie laufen `npm run test` und `npm run build` unberührt. `.env.local` wird **nicht** eingecheckt und enthält Impressum-Felder nach § 5 DDG.

### Weitere Skripte

| Befehl | Zweck |
|---|---|
| `npm run dev` | Dev-Server mit HMR |
| `npm run build` | Production-Build (GitHub-Pages-Base `/Grundschutz-Navigator/`) |
| `npm run build:local` | Production-Build ohne Pages-Präfix (`BUILD_BASE=/`) |
| `npm run preview` | gebauten Bundle lokal servieren |
| `npm run test` | Vitest (Single-Run) |
| `npm run test:watch` | Vitest (Watch-Mode) |
| `npm run test:coverage` | Vitest mit V8-Coverage |
| `npm run lint` | ESLint |
| `npm run fetch-catalog` | registrierte BSI-Artefakte validieren und unterstützte Daten nach `public/data/` ausliefern (erfordert `BSI_SNAPSHOT_SHA` oder Manifest-Pin) |

Coverage-Gates in `vite.config.ts`: Lines 87 %, Branches 77 %, Functions 88 %, Statements 85 %. Sie werden nicht ohne neue Baseline-Messung gesenkt.

## Architektur (Kurzfassung)

Single-Page-App: Der Adapter-Layer überführt Raw-OSCAL-Typen in Domain-Typen (`Control`, `Topic`, `Practice`, `Catalog`). Globaler Zustand via React Context; Filter sind bidirektional mit URL-Parametern synchronisiert; die Katalog-Integrität wird per SHA-256 zur Laufzeit überprüft.

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Schichten, Daten­fluss, Kopplung
- [`docs/DOMAIN_MODELS.md`](docs/DOMAIN_MODELS.md) — Typen, Anreicherung, OSCAL-Mapping
- [`docs/INTEGRITY.md`](docs/INTEGRITY.md) — SHA-256-Pinning und Verify
- [`docs/OSCAL_VALIDATION.md`](docs/OSCAL_VALIDATION.md) — fail-closed OSCAL-Prüf- und Lieferkette (Stufen 1–3 für Klasse 2 umgesetzt, unabhängiger CI-Schema-Korpuslauf)
- [`docs/OSCAL_ROUND_TRIP.md`](docs/OSCAL_ROUND_TRIP.md) — No-op-Round-trip-Harnisch je OSCAL-Modell
- [`docs/FILTERING.md`](docs/FILTERING.md) — Filter-Parameter, URL-Sync, Reihenfolge
- [`docs/VOCABULARY.md`](docs/VOCABULARY.md) — Namespace-Modell für BSI-Vokabulare

## Deployment

Pushes nach `main` triggern den Deploy-Workflow: BSI-Katalog fetch → Tests mit Coverage → Build → CycloneDX-App-SBOM und [SLSA-Provenance-Attestation](https://slsa.dev/) (zwei getrennte Attestierungen über `dist/**`; die SBOM-Datei selbst liegt unter `$RUNNER_TEMP` und wird nicht über Pages ausgeliefert) → GitHub Pages.

## Beitragen

Issues und Pull Requests sind willkommen. Bitte vor dem Einreichen:

```bash
npm run lint
npm run test
```

## Haftungsausschluss

Dieses Projekt ist ein inoffizielles Community-Werkzeug. Es ersetzt weder eine offizielle Quelle noch eine Rechts- oder Sicherheits­beratung. Für verbindliche Auskünfte nutze bitte die originalen Veröffentlichungen des BSI. Die Bereitstellung erfolgt ohne Gewähr auf Vollständigkeit oder Richtigkeit.

## Lizenz

- **App-Code:** [GNU Affero General Public License v3.0 (or later)](LICENSE) — © 2026 Deniz Furater. Wer den Code weitergibt **oder als Netzwerkdienst anbietet**, muss den vollständigen Quellcode inkl. eigener Änderungen unter der AGPL verfügbar machen. Drittkomponenten behalten ihre eigenen Lizenzen (siehe `NOTICE` und die „Lizenzen"-Seite der App).
- **Katalogdaten:** [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.de) — Urheber: [`BSI-Bund/Stand-der-Technik-Bibliothek`](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek). Die Katalogdaten sind nicht Teil dieses Repositorys und fallen nicht unter die AGPL des App-Codes.
