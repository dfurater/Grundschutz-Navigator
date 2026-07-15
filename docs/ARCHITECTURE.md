# Architektur — Grundschutz++ Navigator

Überblick über die Software-Architektur der Anwendung.

## Überblick

Bei der Anwendung handelt es sich um eine **Client-Side Single-Page Application (SPA)** für das Durchsuchen und Filtern des BSI IT-Grundschutz-Kontrollkatalogs (Grundschutz++). Die Anwendung wird vollständig im Browser ausgeführt und deployed auf GitHub Pages.

## Technologie-Stack

| Schicht | Technologie |
|---------|-------------|
| Framework | React 19 + TypeScript |
| Build-Tool | Vite 6 |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite` Plugin) |
| Routing | React Router v7 |
| Volltextsuche | FlexSearch |
| Testing | Vitest + @testing-library/react + jsdom |
| Deployment | GitHub Pages (via GitHub Actions) |

## Verzeichnisstruktur

```
src/
├── domain/           # Domänenmodelle und Geschäftslogik
│   ├── models.ts                 # Zwei-Schichten-Datentypen
│   ├── integrity.ts              # SHA-256 Integritätsprüfung
│   ├── vocabulary.ts             # BSI-Vokabular-Auflösung
│   └── controlRelationships.ts   # Steuerungsbeziehungen
├── adapters/         # Datentransformationen
│   └── oscalAdapter.ts           # OSCAL → Domain Model Parser
├── state/            # Globaler Anwendungszustand
│   └── CatalogContext.tsx        # Katalog-Kontextprovider
├── hooks/            # Wiederverwendbare React Hooks
│   ├── useCatalog.ts             # Katalog-Daten
│   ├── useFilteredControls.ts    # Filterlogik
│   ├── useFilterParams.ts        # URL-Parameter-Sync
│   ├── useFocusTrap.ts           # Barrierefreiheit
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
│   └── AppShell.tsx              # Routing-Konfiguration
└── main.tsx          # Einstiegspunkt

public/data/          # Generierte Katalog-Daten (nicht im Repo)
scripts/              # Build-Skripte
  ├── fetch-catalog.sh            # Einstiegspunkt: delegiert an fetch-catalog.mjs
  ├── fetch-catalog.mjs           # Katalog-/Vokabular-Abruf via GitHub-API
  ├── security-guards.mjs         # Upstream-Allowlist (Repo, Pfade, Refs)
  ├── vocabulary-utils.mjs        # CSV-Parsing, Manifest-Aufbau
  └── sync-upstream-manifest.mjs  # Manifest-Sync für update-catalog.yml

upstream-manifest.json            # Gepinnter Upstream-Snapshot (Commit-SHA + Datei-Blobs)

.github/workflows/
  ├── deploy.yml                  # GitHub Pages Deployment
  ├── ci.yml                      # CI Pipeline
  └── update-catalog.yml          # Automatischer Katalog-Sync
```

## Datenfluss

```
BSI GitHub Repository
(BSI-Bund/Stand-der-Technik-Bibliothek)
  Katalog: Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json
  Vokabulare: Dokumentation/namespaces/*.csv
        │
        ▼
scripts/fetch-catalog.sh → scripts/fetch-catalog.mjs
• Abruf über die GitHub-API (Retry mit Backoff bei transienten Fehlern)
• Snapshot-Pinning: BSI_SNAPSHOT_SHA aus upstream-manifest.json
• Security-Guards: nur erlaubtes Repo, erlaubte Pfade, erlaubte Refs
• Vokabular-CSVs → JSON, Provenance-Metadaten, SHA-256-Hashes
        │
        ▼
public/data/
• catalog.json                    (OSCAL 1.1.3 JSON)
• catalog-metadata.json           (Provenance + Integrity)
• vocabularies.json               (Offizielle BSI-Vokabulare)
• upstream-sources-metadata.json  (Vokabular-Provenance + Manifest)
        │
        ▼
CatalogContext (useEffect on mount)
• fetchCatalogWithBuffer()   → ArrayBuffer (Katalog + Vokabulare parallel)
• parseCatalog()             → angereicherter Catalog
• verifyArtifactIntegrity()  → VerificationResult (Katalog + Vokabulare)
• buildVocabularyRegistry()
        │
        ▼
Feature-Komponenten und Hooks
• useFilteredControls()      → gefilterte Steuerungen
• useSearch()                → FlexSearch-Volltextsuche
• resolveControlVocabularies() → Vokabular-Auflösung
```

## Zustandsverwaltung

Die Anwendung verwendet React Context für den globalen Zustand:

### CatalogContext (`src/state/CatalogContext.tsx`)

Zentraler Provider, der folgende Daten bereitstellt:

- `catalog` — Angereicherter Katalog (Practices, Topics, Controls)
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
| `/katalog` | CatalogBrowser | Katalog-Browser (Liste + Detail) |
| `/katalog/:groupId` | CatalogBrowser | Practice-, Topic- oder Control-Auswahl |
| `/suche` | SearchPage | Volltextsuche |
| `/vokabular` | VocabularyOverviewPage | Vokabular-Übersicht |
| `/vokabular/:namespaceId` | VocabularyNamespacePage | Vokabular-Namensraum |
| `/about` | AboutPage | Über das Projekt (inkl. Provenance/Integrität) |
| `/datenschutz` | DatenschutzPage | Datenschutzerklärung |
| `/impressum` | ImpressumPage | Impressum |
| `/lizenzen` | LizenzenPage | Lizenzen |
| `/mehr` | — | Redirect auf `/about` |
| `*` | — | 404-Seite |

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
- `q` — Freitextsuche
- `sort` — Sortierfeld + Richtung

Practice- und Topic-Auswahl laufen über die Route (`/katalog/:groupId`), nicht über Query-Parameter.

Siehe [FILTERING.md](./FILTERING.md) für Details.

## Integritätsprüfung

Jeder Katalog wird zum Build-Zeitpunkt mit einem SHA-256 Hash versehen. Zur Laufzeit wird der Hash erneut berechnet und mit den gespeicherten Metadaten verglichen. Abweichungen werden der Benutzerin / dem Benutzer in der UI angezeigt.

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
import { Control } from '@/domain/models';
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
| `BASE_URL` | App (Vite) | Basis-URL, von Vite aus `base` abgeleitet |
| `BUILD_BASE` | Build | Überschreibt die GitHub-Pages-Base (`vite.config.ts`) |
| `BSI_SNAPSHOT_SHA` | fetch-catalog | Pinnt den Upstream-Abruf auf einen Commit |
| `GH_TOKEN` / `GITHUB_TOKEN` | fetch-catalog | Token für die GitHub-API (optional lokal, gesetzt in CI) |

Die Impressum-Werte kommen lokal aus `.env.local` (nicht committet, siehe `.env.local.example`) und in CI aus GitHub Actions Secrets.

## Deployment

Das Deployment erfolgt automatisch via GitHub Actions bei Push auf `main` (`.github/workflows/deploy.yml`):

1. Gepinnter Snapshot-Commit wird aus `upstream-manifest.json` gelesen
2. Katalog und Vokabulare werden von BSI GitHub abgerufen (`npm run fetch-catalog`)
3. Tests laufen mit Coverage
4. App wird gebaut mit Impressum-Secrets
5. SLSA-Provenance wird generiert (`actions/attest` über `dist/**`)
6. Deployment auf GitHub Pages

Der Katalog wird **nie** im Repository committet — er wird immer frisch zum Build-Zeitpunkt von BSI abgerufen. Der Workflow `.github/workflows/update-catalog.yml` überwacht das Upstream-Repository und aktualisiert `upstream-manifest.json` automatisch, wenn sich Katalog oder Namespace-Dateien ändern.

## Siehe auch

- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [FILTERING.md](./FILTERING.md) — Filter-System
- [INTEGRITY.md](./INTEGRITY.md) — Integritätsprüfung
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
