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
│   ├── sourceRegistry.{mjs,ts}   # Verbindlicher Upstream-/Katalogvertrag
│   ├── sourceRegistry.d.mts      # Typen des Quellregisters
│   ├── controlRef.ts             # Kataloggescopte interne Control-Referenzen
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
│   ├── AppShell.tsx              # Routing-Konfiguration
│   └── routes.ts                 # Kanonische URL-Builder und Resolver
└── main.tsx          # Einstiegspunkt

public/data/          # Generierte Katalog-Daten (nicht im Repo)
scripts/              # Build-Skripte
  ├── fetch-catalog.sh            # Einstiegspunkt: delegiert an fetch-catalog.mjs
  ├── fetch-catalog.mjs           # Registry-gesteuerter Abruf und Ausgabe
  ├── security-guards.mjs         # Upstream-Allowlist (Repo, Pfade, Refs)
  ├── upstream-artifacts.mjs      # Tree-Diff, Manifest v2 und Root-Prüfung
  ├── vocabulary-utils.mjs        # CSV-/Namespace-Hilfsfunktionen
  ├── catalog-sync-guard.mjs      # Fail-closed Prüfung von Sync-PRs
  ├── catalog-sync-policy.mjs     # Prüfung der Repository-Policy
  └── sync-upstream-manifest.mjs  # Manifest-Sync für update-catalog.yml

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
  • vom unterstützten Katalog referenzierte Namespace-CSVs
  • vollständige Read-only-Trees der überwachten Upstream-Wurzeln
        │
        ▼
scripts/fetch-catalog.sh → scripts/fetch-catalog.mjs
• Abruf über die GitHub-API (Retry mit Backoff bei transienten Fehlern)
• Snapshot-Pinning: BSI_SNAPSHOT_SHA aus upstream-manifest.json
• sourceRegistry: einzige Ingestion-Quelle für Pfad, Root-Typ und Lifecycle
• Security-Guards: nur erlaubtes Repo, erlaubte Hosts, Pfade und Refs
• registrierte preview-/draft-Artefakte werden transient geprüft, nicht ausgeliefert
• nur supported Katalog und referenzierte Vokabulare → JSON + Provenance
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
• parseCatalog()             → kataloggescopter, angereicherter Catalog
• verifyArtifactIntegrity()  → VerificationResult (Katalog + Vokabulare)
• buildVocabularyRegistry()
        │
        ▼
Feature-Komponenten und Hooks
• useFilteredControls()      → gefilterte Steuerungen
• useSearch()                → FlexSearch-Volltextsuche
• resolveControlVocabularies() → Vokabular-Auflösung
```

Der separate Sync-Pfad (`scripts/sync-upstream-manifest.mjs` mit `scripts/upstream-artifacts.mjs`) vergleicht die vollständigen normalisierten Trees des bisherigen und des neuen Snapshots. Erst dort entstehen die Status `added`, `modified` und `removed`; neue nicht registrierte Pfade werden als `unclassified` gemeldet, ohne ihren Blob zu fetchen oder sie auszuliefern. Weil `snapshotCommitSha` Bestandteil der Manifest-Signatur ist, löst auch ein neuer Snapshot, dessen einziges Delta eine unregistrierte Datei ist, diesen Vergleich aus.

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

Practice- und Topic-Auswahl laufen über die kataloggescopte Route (`/katalog/:catalogKey/:groupId`), nicht über Query-Parameter. Die kanonische Control-URL verwendet ausschließlich `catalogKey + altIdentifier`; die OSCAL-Control-ID bleibt eine interne Referenzidentität. Unbekannte oder nicht geladene Katalogschlüssel und unbekannte Alt-Identifier führen ohne globalen Fallback, Control-ID-Auflösung, Redirect oder Legacy-Route zur Not-found-Ansicht.

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

Bei fehlender oder abweichender vom Preflight geprüfter Policy, einem API-Fehler, unerwartetem Diff oder fehlendem `autoMergeRequest` bricht der Workflow ab. Der Preflight prüft die Bindung der Ruleset-Conditions an `main` fail-closed mit. Der BSI-Upstream bleibt als Datenquelle grundsätzlich vertraut; eine fachliche Two-Source-Verifikation ist nicht Teil dieser Merge-Lane.

## Siehe auch

- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [FILTERING.md](./FILTERING.md) — Filter-System
- [INTEGRITY.md](./INTEGRITY.md) — Integritätsprüfung
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
