# Grundschutz++ Navigator

Inoffizielles Werkzeug zum Durchsuchen, Filtern und Exportieren des offiziellen Grundschutz++-Anwenderkatalogs des BSI. Kein Angebot des BSI.

[![CI](https://github.com/dfurater/Grundschutz-Navigator/actions/workflows/ci.yml/badge.svg)](https://github.com/dfurater/Grundschutz-Navigator/actions/workflows/ci.yml)
[![Deploy](https://github.com/dfurater/Grundschutz-Navigator/actions/workflows/deploy.yml/badge.svg)](https://github.com/dfurater/Grundschutz-Navigator/actions/workflows/deploy.yml)
[![Katalogdaten: CC BY-SA 4.0](https://img.shields.io/badge/Katalogdaten-CC%20BY--SA%204.0-blue)](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek)

> ⚠️ **Inoffizielles Community-Projekt, kein Angebot des BSI.** Keine Rechtsberatung, keine Gewähr. Für offizielle Informationen → [BSI Grundschutz++](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek).

## Live-Demo

**→ https://dfurater.github.io/Grundschutz-Navigator/**

Die App läuft vollständig im Browser. Keine Anmeldung, keine Installation.

## Was kann die App?

- **Katalog browsen** — Hierarchische Navigation durch Praktiken, Themen und Kontrollen in einem ergonomischen 3-Panel-Layout (Tree, Tabelle, Detail). Route `/katalog`.
- **Volltextsuche** — Schnelle, relevanzbasierte Suche über alle Kontrollen (FlexSearch) mit Lazy-Loading. Route `/suche`.
- **Vokabulare nachschlagen** — Alle offiziellen BSI-Namespaces (Modalverben, Handlungswörter, Sicherheitsniveaus, Aufwandsstufen, Tags, Zielobjekte u. a.) als eigenständige Übersichten. Route `/vokabular`.
- **Multi-Filter** — Kombinierbar: Sicherheitsniveau, Aufwandsstufe, Modalverb, Tags, Zielobjekt, Handlungswort, Dokumentationstyp, Link-Relation. Der gesamte Filterzustand wird in der URL gespiegelt und ist damit **teil- und bookmarkbar**.
- **CSV-Export** — Gefilterte Tabelle oder manuelle Auswahl als CSV exportieren (semikolon-getrennt, Excel-freundlich).
- **Integritätsprüfung** — Zur Laufzeit wird die SHA-256 des geladenen Katalogs gegen einen beim Build gepinnten Wert verglichen. Ergebnis sichtbar auf der Startseite.
- **Responsive** — Desktop mit verschiebbaren Panels, Mobile mit Drawer und Touch-Gesten.

## Zielgruppe

IT-Sicherheitsbeauftragte, Berater:innen, Auditor:innen, Studierende und alle, die den Grundschutz++-Anwenderkatalog **ohne Download und ohne Installation** durchsuchen, filtern und exportieren möchten.

## Datenquelle und Lizenz des Katalogs

- **Quelle:** [`BSI-Bund/Stand-der-Technik-Bibliothek`](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek) (OSCAL 1.1.3)
- **Lizenz der Katalogdaten:** [Creative Commons BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.de)
- **Datenhaltung:** Die Katalogdaten werden **beim Build** aus dem BSI-Repository geladen. Im App-Repository wird keine Kopie gehalten.
- **Integrität:** Ein fixierter Upstream-Commit (`upstream-manifest.json`) plus SHA-256-Verify zur Laufzeit macht nachvollziehbar, welche Katalogversion angezeigt wird. Details: [`docs/INTEGRITY.md`](docs/INTEGRITY.md).
- **Aktualität:** Ein täglicher Workflow um 06:00 UTC prüft auf Upstream-Änderungen und öffnet bei Bedarf einen Pull Request.

## Datenschutz

- Kein Tracking, keine Analytics, keine Cookies.
- Nach dem initialen Laden findet keine weitere Backend-Kommunikation statt. Alle Berechnungen (Filter, Suche, Export) laufen **clientseitig** im Browser.

## Für Entwickler:innen — lokal starten

### Voraussetzungen

- **Node.js 22**
- Optional ein **GitHub Token** in `GH_TOKEN`, um beim Katalog-Fetch höhere API-Rate-Limits zu nutzen

### Quickstart

```bash
git clone https://github.com/dfurater/Grundschutz-Navigator.git
cd Grundschutz-Navigator
npm ci
cp .env.local.example .env.local   # Impressum-Platzhalter, für lokale Dev optional
npm run fetch-catalog              # BSI-Daten nach public/data/
npm run dev                        # http://localhost:5173
```

`.env.local` wird **nicht** eingecheckt und enthält Impressum-Felder nach § 5 DDG.

### Weitere Skripte

| Befehl | Zweck |
|---|---|
| `npm run dev` | Dev-Server mit HMR |
| `npm run build` | Production-Build (GitHub-Pages-Base `/Grundschutz-Navigator/`) |
| `npm run build:local` | Production-Build ohne Pages-Präfix (`BUILD_BASE=/`) |
| `npm run preview` | gebauten Bundle lokal servieren |
| `npm run preview:local` | `build:local` + lokaler Preview |
| `npm run test` | Vitest (Single-Run) |
| `npm run test:watch` | Vitest (Watch-Mode) |
| `npm run test:coverage` | Vitest mit V8-Coverage |
| `npm run lint` | ESLint |
| `npm run fetch-catalog` | BSI-Katalog nach `public/data/` ziehen |

## Architektur (Kurzfassung)

Single-Page-App mit **Zwei-Schichten-Datenmodell**: Raw-OSCAL-Typen werden im Adapter-Layer in enrichte Domain-Typen überführt (`Control`, `Topic`, `Practice`, `Catalog`). Globaler Zustand via React Context; Filter werden bidirektional mit URL-Parametern synchronisiert und überleben Navigation. Die Katalog-Integrität wird per SHA-256 zur Laufzeit überprüft.

Tiefe:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Schichten, Daten­fluss, Kopplung
- [`docs/DOMAIN_MODELS.md`](docs/DOMAIN_MODELS.md) — Typen, Anreicherung, OSCAL-Mapping
- [`docs/INTEGRITY.md`](docs/INTEGRITY.md) — SHA-256-Pinning und Verify
- [`docs/FILTERING.md`](docs/FILTERING.md) — Filter-Parameter, URL-Sync, Reihenfolge
- [`docs/VOCABULARY.md`](docs/VOCABULARY.md) — Namespace-Modell für BSI-Vokabulare

## Deployment

Pushes nach `main` triggern den Deploy-Workflow: Katalog ziehen → Tests → Build → [SLSA-Provenance-Attestation](https://slsa.dev/) → GitHub Pages. Zusätzlich läuft täglich um 06:00 UTC ein Upstream-Sync, der bei Änderungen am BSI-Katalog automatisch einen Pull Request öffnet.

## Beitragen

Issues und Pull Requests sind willkommen. Bitte vor dem Einreichen:

```bash
npm run lint
npm run test
```

Tech-Hintergrund und Architektur-Entscheidungen findest du in [`docs/`](docs/).

## Haftungsausschluss

Dieses Projekt ist ein inoffizielles Community-Werkzeug. Es ersetzt weder eine offizielle Quelle noch eine Rechts- oder Sicherheits­beratung. Für verbindliche Auskünfte nutze bitte die originalen Veröffentlichungen des BSI. Die Bereitstellung erfolgt ohne Gewähr auf Vollständigkeit oder Richtigkeit.

## Lizenz

<!-- TODO: Lizenz für den App-Code final festlegen (MIT, Apache 2.0, AGPL, …) -->

- **App-Code:** Lizenz wird vor dem 1.0-Release final festgelegt. Bis dahin gilt: Keine automatisch gewährte Nachnutzungs­lizenz. Bei konkretem Bedarf bitte via Issue anfragen.
- **Katalogdaten:** [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.de) — Urheber: [`BSI-Bund/Stand-der-Technik-Bibliothek`](https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek). Bei Weitergabe der Daten sind Namensnennung und Weitergabe unter gleichen Bedingungen zu beachten.
