# Architektur — Grundschutz++ Navigator

Überblick über die Software-Architektur der Anwendung.

## Überblick

Bei der Anwendung handelt es sich um eine **Client-Side Single-Page Application (SPA)** für das Durchsuchen und Filtern des BSI IT-Grundschutzutz-Kontrollkatalogs (Grundschutz++). Die Anwendung wird vollständig im Browser ausgeführt und deployed auf GitHub Pages.

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
│   ├── controlRelationships.ts   # Steuerungsbeziehungen
│   └── vocabularies.ts            # Vokabular-Dateihandling
├── adapters/         # Datentransformationen
│   └── oscalAdapter.ts            # OSCAL → Domain Model Parser
├── state/            # Globaler Anwendungszustand
│   └── CatalogContext.tsx          # Katalog-Kontextprovider
├── hooks/            # Wiederverwendbare React Hooks
│   ├── useCatalog.ts               # Katalog-Daten
│   ├── useFilteredControls.ts     # Filterlogik
│   ├── useFilterParams.ts         # URL-Parameter-Sync
│   ├── useFocusTrap.ts           # Barrierefreiheit
│   └── useMediaQuery.ts           # Responsive Design
├── features/        # Feature-Module (Seite + Komponenten)
│   ├── home/
│   ├── catalog/
│   ├── vocabularies/
│   ├── search/
│   ├── export/
│   └── pages/
├── components/      # Wiederverwendbare UI-Komponenten
│   ├── HeaderBar.tsx
│   ├── Footer.tsx
│   ├── TreeNav.tsx
│   ├── FilterSection.tsx
│   └── ...
├── app/            # Anwendungshell
│   └── AppShell.tsx                # Routing-Konfiguration
└── main.tsx       # Einstiegspunkt

public/data/        # Generierte Katalog-Daten (nicht im Repo)
scripts/           # Build-Skripte
  ├── fetch-catalog.sh             # BSI-Katalog-Abruf
  ├── fetch-catalog.mjs            # Node.js Katalog-Parser
  └── sync-upstream-manifest.mjs   # Provenance-Metadaten

.github/workflows/
  ├── deploy.yml                  # GitHub Pages Deployment
  ├── ci.yml                      # CI Pipeline
  └── update-catalog.yml          # Katalog-Update-Workflow
```

## Datenfluss

```
BSI GitHub Repository
(bsi-fuer_it_sicherheit/Grundschutz)
        │
        ▼
scripts/fetch-catalog.sh
• Clone BSI repo
• Copy catalog.json → public/data/
• Generate provenance metadata
• Compute SHA-256 hash
        │
        ▼
public/data/
• catalog.json           (OSCAL 1.1.3 JSON)
• catalog-metadata.json (Provenance + Integrity)
• vocabularies.json     (Official BSI vocabularies)
• vocabularies-metadata.json
• upstream-sources-metadata.json
        │
        ▼
CatalogContext (useEffect on mount)
• fetchCatalogWithBuffer()  → ArrayBuffer
• parseCatalog()          → enriched Catalog
• verifyCatalogIntegrity() → VerificationResult
• buildVocabularyRegistry()
        │
        ▼
Feature-Komponenten und Hooks
• useFilteredControls()   → gefilterte Steuerungen
• useSearch()             → FlexSearch-Volltextsuche
• VocabularyNamespace    → Vokabular-Auflösung
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

Die Anwendung verwendet React Router mit hashbasierten URLs für GitHub Pages Kompatibilität:

| Route | Komponente | Beschreibung |
|-------|------------|--------------|
| `/` | HomePage | Startseite |
| `/catalog` | CatalogBrowser | Katalog-Browser |
| `/catalog/:practiceId` | CatalogBrowser | Practice-Filter |
| `/catalog/:practiceId/:controlId` | ControlDetail | Steuerungsdetail |
| `/search` | SearchPage | Volltextsuche |
| `/glossar` | VocabularyOverviewPage | Vokabular-Übersicht |
| `/glossar/:namespace` | VocabularyNamespacePage | Vokabular-Namensraum |
| `/impressum` | ImpressumPage | Impressum |
| `/datenschutz` | DatenschutzPage | Datenschutzerklärung |
| `/lizenzen` | LizenzenPage | Lizenzen |

## Filter-System

Filter werden bidirektional mit URL-Suchparametern synchronisiert:

- `practice` — Practice-ID(s)
- `topic` — Topic-ID(s)
- `sec_level` — Sicherheitsniveau (normal-SdT, erhöht)
- `effort` — Aufwandsstufe (0-5)
- `modalverb` — Verpflichtungsgrad (MUSS, SOLLTE, KANN)
- `tags` — Tags
- `zielobjekt` — Zielobjekt-Kategorien
- `handlungswort` — Handlungswort
- `dokumentation` — Dokumentationstyp
- `link` — Link-Beziehungen (related, required)
- `q` — Freitextsuche
- `sort` — Sortierfeld + Richtung

Siehe [FILTERING.md](./FILTERING.md) für Details.

## Integritätsprüfung

Jeder Katalog wird zum Build-Zeitpunkt mit einem SHA-256 Hash versehen. Zur Laufzeit wird der Hash erneut berechnet und mit den gespeicherten Metadaten verglichen. Abweichungen werden der Benutzerin / dem Benutzer in der UI angezeigt.

Siehe [INTEGRITY.md](./INTEGRITY.md) für Details.

## Import-Alias

Das Projekt verwendet den `@/` Alias für projektinterne Importe:

```typescript
import { Control } from '@/domain/models';
import { parseCatalog } from '@/adapters/oscalAdapter';
```

Konfiguration in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

## Umgebungsvariablen

| Variable | Beschreibung |
|----------|---------------|
| `VITE_APP_TITLE` | Anwendungstitel |
| `VITE_BSI_REPO` | BSI GitHub Repository |
| `VITE_BSI_CATALOG_PATH` | Pfad zur OSCAL-Datei |
| `VITE_IMPRESSUM_NAME` | Impressum Name |
| `VITE_IMPRESSUM_EMAIL` | Impressum E-Mail |
| `BASE_URL` | Basis-URL für GitHub Pages Deployment |

## Deployment

Das Deployment erfolgt automatisch via GitHub Actions bei Push auf `main`:

1. Katalog wird von BSI GitHub abgerufen
2. Tests werden ausgeführt
3. App wird gebaut mit Impressum-Secrets
4. SLSA Provenance wird generiert
5. Deployment auf GitHub Pages

Der Katalog wird **nie** im Repository committet — er wird immer frisch zum Build-Zeitpunkt von BSI abgerufen.

## Siehe auch

- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [FILTERING.md](./FILTERING.md) — Filter-System
- [INTEGRITY.md](./INTEGRITY.md) — Integritätsprüfung
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System