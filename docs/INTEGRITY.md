# Integritätsprüfung — Grundschutz++ Navigator

Beschreibung der SHA-256 Hash-Verifikation und des Provenance-Metadaten-Systems.

## Überblick

Die Anwendung verwendet ein **Integrity-Verification-System**, das:

1. **Zum Build-Zeitpunkt**: SHA-256 Hash der Artefakte berechnet und in Metadaten speichert
2. **Zur Laufzeit**: Hash erneut berechnet und mit dem gespeicherten Wert vergleicht
3. **In der UI**: Prüfungsergebnis anzeigt

Das System prüft, ob die geladenen Artefakte zu den gemeinsam ausgelieferten Integritätsmetadaten passen. Da Artefakt und Metadaten aus demselben Deployment stammen, erkennt die Prüfung Inkonsistenzen zwischen beiden (z.B. beschädigte oder unvollständige Deployments) — sie ist aber kein unabhängiger Herkunftsnachweis. Den liefert die extern bei GitHub gespeicherte Artifact Attestation (siehe [SLSA Provenance](#slsa-provenance)); die Upstream-Authentizität wird zur Fetch-Zeit über Snapshot-Pinning und die Upstream-Allowlist verankert.

### Abgrenzung: gebündelte OSCAL-Schemas werden zur Bauzeit geprüft, nicht zur Laufzeit

Die 30 gepinnten NIST-JSON-Schemas unter `schemas/oscal/` gehören **nicht** zu
diesem Laufzeitmechanismus. Der Unterschied ist keine Nachlässigkeit, sondern
folgt aus dem Auslieferungsweg:

| | `public/data/`-Artefakte | `schemas/oscal/`-Schemas |
| --- | --- | --- |
| Auslieferung | zur Laufzeit über `fetch` nachgeladen | zur Bauzeit in je eigene Chunks gebaut; der Chunk der ausgewählten Zelle wird zur Laufzeit als Modul derselben Origin nachgeladen |
| Bytes beim Prüfen | exakt die Bytes der Quelldatei | vom Bundler transformiert |
| Prüfort | `src/domain/integrity.ts`, im Browser | `npm run verify-oscal-schemas`, in CI |

Ein zur Laufzeit im selben Bundle mitgelieferter Sollhash würde sich selbst
bestätigen und nichts beweisen: Wer die gebündelten Schemabytes ändern kann,
ändert den mitgelieferten Sollwert gleich mit. Deshalb trägt die
Integritätszusage für die Schemas ausschließlich der CI-Schritt
`npm run verify-oscal-schemas` — netzfrei, gegen SHA-256, `$id` und die
draft-07-Zusage aus `src/domain/oscalVersionMatrix.mjs`, und zusätzlich gegen
jede Datei unter `schemas/oscal/`, die zu keinem Pin gehört. Details in
[OSCAL_VERSION_MATRIX.md](./OSCAL_VERSION_MATRIX.md#schema-provenienz).

**Gegenstand der Hashprüfung ist die ausgelieferte Datei, nicht das Parse-Ergebnis.** Der Hash wird über den rohen `ArrayBuffer` von `catalog.json` beziehungsweise `vocabularies.json` berechnet — vor jeder Interpretation und unabhängig davon, wie die Anwendung den Inhalt anschließend repräsentiert. Das verlustfreie Dokumentmodell ([ADR-2](https://linear.app/grundschutz-plus-plus/issue/ADR-2)) hält den Quellgraphen zwar zusätzlich im Speicher, ist aber kein Bezugspunkt der Prüfung: Ein wiederhergestelltes `JSON.stringify(source)` wäre schon wegen Formatierung und Einrückung nicht byteidentisch zur Quelldatei und taugt deshalb grundsätzlich nicht als Hashbasis.

## Build-Zeitpunkt (scripts/fetch-catalog.mjs)

`npm run fetch-catalog` startet `scripts/fetch-catalog.mjs`. Das Skript ruft die Upstream-Daten ab, validiert den vollständigen Output-Vertrag und schreibt ausschließlich die aus dem Quellregister abgeleiteten Dateien nach `public/data/`.

### Artefaktvertrag je Katalog

Seit [GSPP-284](https://linear.app/grundschutz-plus-plus/issue/GSPP-284) kann die Lane mehrere `supported`-Kataloge tragen. Die Ausgabemenge wird deshalb nicht mehr als Festliste gepflegt, sondern aus dem Register abgeleitet (`listCatalogArtifactFileNames` in `src/domain/sourceRegistry.mjs`, `listOutputArtifactFileNames` in `scripts/fetch-catalog.mjs`):

| Registereintrag | Datenartefakt | Metadatenartefakt |
| --- | --- | --- |
| Einstiegskatalog (`entryCatalog: true`) | `catalog.json` | `catalog-metadata.json` |
| jeder weitere `supported`-Katalog | `catalog-<catalogKey>.json` | `catalog-<catalogKey>-metadata.json` |

Der Einstiegskatalog behält seine Dateinamen bewusst unverändert: Deploy- und Cache-Vertrag der ausgelieferten App bleiben damit stabil, und bei genau einem ausgelieferten Katalog ist die Dateimenge byteweise dieselbe wie zuvor. Genau ein `supported`-Katalog trägt die Auszeichnung `entryCatalog: true`; ein Register ohne ausgelieferten Katalog oder ohne genau einen ausgezeichneten Einstieg schlägt beim Import fehl.

Dazu kommen unverändert die beiden generierten Sammelartefakte:

- `vocabularies.json` — offizielle BSI-Vokabulare (aus CSV konvertiert)
- `upstream-sources-metadata.json` — Vokabular-Provenance + Upstream-Manifest

Bei genau einem ausgelieferten Katalog ist die Ausgabemenge damit weiterhin `catalog.json`, `catalog-metadata.json`, `vocabularies.json`, `upstream-sources-metadata.json`. Eine Ausgabedatei, die sich nicht aus dem Register ableiten lässt, wird von `writeArtifacts` abgelehnt.

`fetch-catalog.mjs` führt den eigentlichen Abruf durch:

1. **Quellregister als Vertrag**: `src/domain/sourceRegistry.mjs` ist die einzige Ingestion-Quelle für Artefaktschlüssel, Pfade, erwartete OSCAL-Root-Typen, Katalogschlüssel und Lifecycle. `scripts/security-guards.mjs` leitet daraus die Allowlist ab und begrenzt zusätzlich Repository, Hosts, Pfade und Refs.
2. **Snapshot-Pinning**: Ist `BSI_SNAPSHOT_SHA` gesetzt (in CI aus `upstream-manifest.json` gelesen), wird exakt dieser Commit abgerufen statt `main`.
3. **Vollständiger Tree vor Blob-Abruf**: Der rekursive GitHub-Tree der überwachten Wurzeln muss vollständig und darf weder Symlinks noch andere nicht reguläre Dateien enthalten. Erst danach werden registrierte Pfade materialisiert.
4. **Lifecycle-getrennte Verarbeitung**: `preview`- und `draft`-Artefakte werden transient auf Pfad, Blob, Inhalt und Root-Typ geprüft. Nur `supported`-Artefakte werden als App-Daten ausgeliefert; die Namespace-Collection materialisiert alle regulären `.csv`-Dateien direkt aus ihrem registrierten Verzeichnis. `ns`-Referenzen des unterstützten Katalogs werden separat als zulässige fachliche Auflösungsquellen validiert.
5. **Abruf über erlaubte GitHub-Endpunkte** mit Retry und Backoff bei transienten Fehlern; optional authentifiziert über `GH_TOKEN`/`GITHUB_TOKEN`.
6. **Integritätsdaten**: SHA-256, Dateigröße, Git-Blob-SHA und Commit-Informationen werden je ausgeliefertem Artefakt erfasst. Jeder ausgelieferte Katalog erhält dabei eigene Werte samt seiner deklarierten `metadata.oscal-version` — eine gemeinsame Versionsannahme über mehrere Kataloge gibt es bewusst nicht ([GSPP-283](https://linear.app/grundschutz-plus-plus/issue/GSPP-283)). Das vollständige Manifest v2 enthält zusätzlich für jede materialisierte Registry-Datei Root-Typ und Lifecycle.

### Lokale Snapshot-Freshness

`public/data/` ist gitignoriert und kann nach einem Pull deshalb noch zu einem
älteren oder neueren Snapshot gehören als das eingecheckte
`upstream-manifest.json`. `scripts/check-catalog-freshness.mjs` vergleicht vor
jedem Vitest-Lauf die kanonische `signatureSha256` des eingecheckten Manifests
mit dem in `public/data/upstream-sources-metadata.json` eingebetteten Manifest.
Damit wird auch ein geänderter Registry-Vertrag bei unverändertem
Upstream-Commit erkannt; ein reiner Commit-SHA-Vergleich würde diesen Fall
übersehen.

Jede Abweichung, unabhängig von ihrer zeitlichen Richtung, bricht Tests über
Vitests `globalSetup` mit erwarteter und gefundener 12-Zeichen-SHA ab. Beim
lokalen Dev-Server bleibt dieselbe Diagnose bewusst nicht blockierend, wird
aber über den Vite-Hook `catalog-freshness-diagnostic` als deutliches
Terminal-Banner ausgegeben. Fehlende oder ungültige lokale Metadaten werden
getrennt von einem fehlenden beziehungsweise ungültigen eingecheckten Manifest
gemeldet. Für lokale Drift oder fehlende lokale Daten lautet die Reparatur:

```bash
npm run fetch-catalog
```

CI liest `snapshotCommitSha` aus dem eingecheckten Manifest und setzt ihn als
`BSI_SNAPSHOT_SHA`, bevor `npm run fetch-catalog` läuft. Die dort erzeugten
Metadaten tragen daher dieselbe Signatur und lösen keinen Freshness-Fehler aus.

### Semantisches Control-Identitätsdelta

Bei einem Snapshot-Wechsel ergänzt `scripts/sync-upstream-manifest.mjs` das
reine Datei-Delta um einen semantischen Vergleich aller Manifest-Einträge mit
`rootType: catalog` — unabhängig davon, ob ihr Lifecycle `supported`,
`preview`, `draft` oder `blocked-by-upstream` ist. Das Skript lädt die alte und
die neue Katalogfassung über ihre im jeweiligen Manifest gebundenen
Git-Blob-SHAs. Vor der Interpretation müssen sowohl die SHA-1 im Git-Blob-Format
als auch der SHA-256-Inhaltshash zum Manifest passen.

`scripts/control-identity-delta.mjs` rekursiert durch Gruppen und verschachtelte
Controls und klassifiziert Änderungen anhand der kataloginternen
`alt-identifier`-Identität:

- `added` und `removed`: Identität kommt nur in einem Snapshot vor
- `moved`: gleicher `alt-identifier`, aber eine andere Control-ID
- `id-rebound`: eine weiterverwendete Control-ID bezeichnet eine neu
  hinzugekommene Identität
- `identifier-changed`: genau ein alter und ein neuer Kandidat haben denselben
  Titel, aber verschiedene `alt-identifier`
- `ambiguous`: insbesondere doppelte `alt-identifier` oder nicht eindeutige
  Titelkandidaten

Die Titelgleichheit bei `identifier-changed` ist ausdrücklich nur
nicht-kryptographische Evidenz; mehrdeutige Kandidaten werden nicht geraten.
Der vollständige maschinenlesbare Befund wird als generierte, gitignorierte
Datei `public/data/control-identity-delta.json` geschrieben. Jeder Eintrag enthält
Artefaktschlüssel, beide Snapshot-SHAs, alte und neue Control-ID, alte und neue
`alt-identifier`, Titel und Klassifikation. Der Sync-PR erhält zusätzlich eine
menschenlesbare Zusammenfassung mit den alten und neuen Control-Zahlen und den
Klassifikationssummen je Katalog.

Der Vergleich ist bewusst diagnostisch: Fehler beim Blob-Abruf, bei der
Hashprüfung, beim Parse oder beim Schreiben werden im Sync-Output sichtbar,
ändern aber weder die `changed`-Entscheidung noch die Manifest-Aktualisierung
oder den Exit-Code des ansonsten erfolgreichen Syncs. Die bestehenden harten
Manifest-, Tree- und Catalog-Sync-Guards bleiben davon unberührt.

### Provenance-Metadaten (catalog-metadata.json)

```json
{
  "artifactKey": "catalog-gspp",
  "source": {
    "repository": "https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek",
    "file": "control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json",
    "commit_sha": "<snapshot-commit-sha>",
    "commit_date": "<snapshot-commit-date>",
    "git_blob_sha": "<git-blob-sha>",
    "upstream_sha256": "<sha256>",
    "upstream_size_bytes": 5389844
  },
  "integrity": {
    "sha256": "<sha256>",
    "size_bytes": 5389844,
    "fetched_at": "<fetch-timestamp>"
  },
  "build": {
    "workflow_run_id": "…",
    "workflow_run_url": "…",
    "runner_environment": "…"
  }
}
```

## Laufzeit-Prüfung (src/domain/integrity.ts)

### SHA-256 Berechnung mit Web Crypto API

```typescript
export async function computeSHA256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

### Artefakt-Verifikation

Eine gemeinsame Funktion prüft Katalog und Vokabulare; der Metadaten-Typ ist eine Union:

```typescript
type IntegrityMetadata = CatalogProvenance | VocabularyProvenance;

export async function verifyArtifactIntegrity(
  artifactBuffer: ArrayBuffer,
  metadata: IntegrityMetadata,
): Promise<VerificationResult> {
  const computedHash = await computeSHA256(artifactBuffer);
  const sourceCommit =
    'commit_sha' in metadata.source
      ? metadata.source.commit_sha
      : metadata.source.snapshotCommitSha;

  return {
    valid: computedHash === metadata.integrity.sha256,
    computedHash,
    expectedHash: metadata.integrity.sha256,
    sourceCommit,
    fetchedAt: metadata.integrity.fetched_at,
  };
}
```

### Zeitlimit je Artefakt-Fetch

Jeder Artefakt-Fetch (Antwort **und** Body-Lesen) ist auf ein Zeitlimit begrenzt. Ohne dieses Limit hält ein hängender Request — eine Verbindung, die weder antwortet noch fehlschlägt — den Ladepfad dauerhaft im Ladezustand, weil kein `catch`-Zweig je erreicht wird ([GSPP-331](https://linear.app/grundschutz-plus-plus/issue/GSPP-331/fixruntime-hangender-artefakt-fetch-lasst-den-katalog-dauerhaft-im)):

```typescript
export const ARTIFACT_FETCH_TIMEOUT_MS = 60_000;
```

Umgesetzt mit `AbortController` + `setTimeout`, nicht mit `AbortSignal.timeout()` — Letzteres lässt sich unter Vitest nicht mit `vi.useFakeTimers()` vorspulen, wodurch die Akzeptanztests nur mit echten Wartezeiten schreibbar wären. Der Timer wird in einem `finally` aufgeräumt, damit ein erfolgreicher Fetch keinen offenen Timer hinterlässt.

### Provenance-Abruf

```typescript
export async function fetchProvenance(
  metadataUrl: string,
): Promise<CatalogProvenance> {
  return fetchJsonDocument<CatalogProvenance>(metadataUrl, 'catalog metadata');
}

export async function fetchVocabularyProvenance(
  metadataUrl: string,
): Promise<VocabularyProvenance> {
  return fetchJsonDocument<VocabularyProvenance>(metadataUrl, 'vocabulary metadata');
}

export async function fetchJsonDocument<T>(
  url: string,
  label = 'JSON document',
  timeoutMs = ARTIFACT_FETCH_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timed out loading ${label} after ${timeoutMs}ms`)),
    timeoutMs,
  );
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `Failed to load ${label}: ${response.status} ${response.statusText}`,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
```

### Katalog mit Buffer laden

```typescript
export async function fetchCatalogWithBuffer(
  catalogUrl: string,
  timeoutMs = ARTIFACT_FETCH_TIMEOUT_MS,
): Promise<{ buffer: ArrayBuffer; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timed out loading catalog after ${timeoutMs}ms`)),
    timeoutMs,
  );
  try {
    const response = await fetch(catalogUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `Failed to load catalog: ${response.status} ${response.statusText}`,
      );
    }
    const buffer = await response.arrayBuffer();
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(buffer);
    return { buffer, text };
  } finally {
    clearTimeout(timer);
  }
}
```

## CatalogContext Integration

`src/state/CatalogContext.tsx` orchestriert den Ladevorgang:

1. `catalog.json` (der Einstiegskatalog) und `vocabularies.json` werden **parallel** als ArrayBuffer geladen (Startlatenz). Fehlt `catalog.json`, ist das ein harter Ladefehler; fehlt nur `vocabularies.json`, läuft die App ohne Vokabular-Registry weiter.
2. Die Vokabular-Registry wird gebaut (`buildVocabularyRegistry`).
3. Für den Katalog wird `catalog-metadata.json` geladen und `verifyArtifactIntegrity` ausgeführt; für die Vokabulare analog `upstream-sources-metadata.json` (siehe [Vocabulary Integrity](#vocabulary-integrity)).
3a. Erst danach wird der Katalog als verlustfreies Dokument geparst (`parseCatalogDocument`, siehe [DOMAIN_MODELS.md](./DOMAIN_MODELS.md#verlustfreies-dokumentmodell)). Die Reihenfolge ist bewusst: Die Vertrauensklasse `class-1-verified-public` schließt die bestandene Hashprüfung ein und darf deshalb nicht vergeben werden, bevor sie gelaufen ist. Ohne Metadaten oder bei abweichendem Hash trägt das Dokument `class-1-unverified-public`.
4. Fehlen zu einem vorhandenen Datenartefakt nur die Metadaten, bleibt das Artefakt nutzbar. Provenance und Verifikation bleiben `null`, die App protokolliert eine Warnung in der Konsole und überspringt die Prüfung.
5. Ein `cancelled`-Flag verhindert State-Updates nach Unmount.
6. Alle Start-Fetches (`catalog.json`, `vocabularies.json`, `catalog-metadata.json`, `upstream-sources-metadata.json`) sind einzeln auf [`ARTIFACT_FETCH_TIMEOUT_MS`](#zeitlimit-je-artefakt-fetch) begrenzt. Läuft ein optionales Artefakt (Vokabulare oder eine der beiden Provenance-Dateien) ins Zeitlimit, greift derselbe `error`- bzw. `catch`-Zweig wie bei einem 404 — die App startet mit dem betroffenen Feld auf `null`. Läuft `catalog.json` selbst ins Zeitlimit, führt der äußere `catch` zu einem Fehlerzustand mit Meldung statt zu einem dauerhaft hängenden Ladezustand.

### Mehrere Kataloge — Isolation der Prüfung

Der Kontext hält eine Katalogsammlung (`catalogs: ReadonlyMap<CatalogKey, LoadedCatalogState>`). Der Einstiegskatalog wird eager geladen; jeder weitere erst, wenn eine Route ihn über `selectCatalog(catalogKey)` auswählt. Der Initial-Load wächst dadurch nicht mit der Zahl ausgelieferter Kataloge.

Jeder Katalog durchläuft `verifyArtifactIntegrity` gegen **seine eigenen** Metadaten. Provenance, Verifikationsergebnis, Vertrauensklasse und Fehlerzustand hängen deshalb am einzelnen Katalog statt global am Zustand:

- Ein Katalog mit abweichendem Hash oder fehlenden Metadaten trägt `class-1-unverified-public` und bleibt sichtbar — die unveränderte Bestandssemantik.
- Kein anderer geladener Katalog verliert dadurch seine Vertrauensklasse, und kein Katalog wird still als verifiziert dargestellt.
- Ein fehlender oder beschädigter Katalog erzeugt einen Fehlerzustand für genau diesen Katalog; die übrigen bleiben nutzbar.

Die Projektionen `catalog`, `provenance`, `verification`, `loading` und `error` aus `useCatalog()` beziehen sich unverändert auf **einen** Katalog — jetzt auf den per Route aktiven statt auf den einzigen.

## VerificationResult Typ

```typescript
interface VerificationResult {
  valid: boolean;
  computedHash: string;
  expectedHash: string;
  sourceCommit: string;
  fetchedAt: string;
}
```

## UI-Anzeige

Provenance und Verifikationsergebnis werden auf der Seite **„Über das Projekt"** (`/about`, `src/features/pages/AboutPage.tsx`) angezeigt — jeweils für den Katalog und für die Vokabulare:

- **Gültig**: Erfolgs-Banner mit Hash-Bestätigung
- **Ungültig**: Warn-Banner mit Details

Dazu kommen Quell-Repository, Commit-SHA und Abrufzeitpunkt mit Link auf den exakten Upstream-Stand; für die Vokabulare Abrufzeitpunkt, Anzahl der Namespace-Dateien und Snapshot-Commit. Fehlen die jeweiligen Metadaten, wird für dieses Artefakt kein Provenance-/Verifikationsblock angezeigt. Der Text „Verifikation ausstehend“ erscheint nur, wenn Provenance vorhanden ist, aber das Prüfergebnis noch nicht vorliegt.

## Vocabulary Integrity

Für das Vokabular-Artefakt `vocabularies.json` ruft der Ladepfad dieselbe Funktion `verifyArtifactIntegrity` auf (die `IntegrityMetadata`-Union deckt beide Provenance-Typen ab). Die zugehörigen Metadaten stehen in `upstream-sources-metadata.json`. Darin umfasst `manifest` alle materialisierten Registry-Artefakte; das separate Top-Level-Feld `files` enthält ausschließlich die Datei-Provenance der ausgelieferten Namespace-CSVs. `dataQualityFindings` hält nicht blockierende fachliche Befunde zum unterstützten Katalog fest. `taxonomyCoverage.topics` protokolliert die gemessene UUID-Deckung zwischen Katalogthemen und `topics.csv`; `taxonomyCoverage.practices` hält symmetrisch die Practice-Deckung einschließlich der namentlich geduldeten `EXMP`-Ausnahme fest. Fetch und Catalog-Sync-Guard verlangen `practices.csv` und blockieren für jeden Snapshot fehlende oder doppelte Practice-UUIDs sowie Practice-Katalog- oder CSV-Orphans. Entsprechend blockieren sie leere Topic-Taxonomiedaten, fehlende oder doppelte Topic-UUIDs und Topic-Katalog- oder CSV-Orphans.

### Provenance-Metadaten (upstream-sources-metadata.json)

```json
{
  "artifactKey": "namespaces-bsi",
  "source": {
    "repository": "https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek",
    "catalogPath": "control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json",
    "snapshotCommitSha": "<snapshot-commit-sha>",
    "snapshotCommitDate": "<snapshot-commit-date>"
  },
  "manifest": {
    "schemaVersion": 2,
    "repository": "https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek",
    "snapshotCommitSha": "<snapshot-commit-sha>",
    "files": [
      {
        "artifactKey": "catalog-gspp",
        "rootType": "catalog",
        "lifecycle": "supported",
        "path": "control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json",
        "gitBlobSha": "<git-blob-sha>",
        "contentSha256": "<sha256>"
      },
      {
        "artifactKey": "catalog-lieferkette",
        "rootType": "catalog",
        "lifecycle": "preview",
        "path": "control_layer/Lieferkettensicherheit/Lieferkettensicherheit-resolved_catalog.json",
        "gitBlobSha": "<git-blob-sha>",
        "contentSha256": "<sha256>"
      }
    ],
    "signatureSha256": "<sha256>"
  },
  "files": [
    {
      "namespace": "https://github.com/…/tree/main/documentation/namespaces/modal_verbs.csv",
      "path": "documentation/namespaces/modal_verbs.csv",
      "fileName": "modal_verbs.csv",
      "routeId": "documentation-namespaces-modal-verbs",
      "gitBlobSha": "<git-blob-sha>",
      "sha256": "<sha256>",
      "sizeBytes": 959
    }
  ],
  "dataQualityFindings": [],
  "taxonomyCoverage": {
    "topics": {
      "catalogTopicCount": 140,
      "distinctCatalogUuidCount": 120,
      "csvEntryCount": 120,
      "matchedCatalogTopicCount": 140,
      "unmatchedCatalogTopicCount": 0,
      "orphanCsvEntryCount": 0,
      "missingCatalogUuidCount": 0,
      "duplicateCsvUuidCount": 0,
      "unmatchedCatalogTopics": [],
      "orphanCsvEntries": [],
      "duplicateCsvUuids": []
    },
    "practices": {
      "catalogPracticeCount": 20,
      "distinctCatalogUuidCount": 20,
      "csvEntryCount": 21,
      "matchedCatalogPracticeCount": 20,
      "unmatchedCatalogPracticeCount": 0,
      "orphanCsvEntryCount": 0,
      "toleratedOrphanCsvEntryCount": 1,
      "missingCatalogUuidCount": 0,
      "missingUuidCount": 0,
      "duplicateCatalogUuidCount": 0,
      "duplicateUuidCount": 0,
      "unmatchedCatalogPractices": [],
      "orphanCsvEntries": [],
      "toleratedOrphanCsvEntries": [
        {
          "value": "EXMP",
          "uuid": "9d330062-5c39-4bb0-bef2-62ab66414aa5"
        }
      ],
      "entriesWithoutUuid": [],
      "duplicateCatalogUuids": [],
      "duplicateUuids": []
    }
  },
  "integrity": {
    "sha256": "<sha256>",
    "size_bytes": 438298,
    "fetched_at": "<fetch-timestamp>"
  },
  "build": {
    "workflow_run_id": "…",
    "workflow_run_url": "…",
    "runner_environment": "…"
  }
}
```

`integrity.sha256` ist der SHA-256 über das generierte `vocabularies.json`-Artefakt; der Laufzeit-Abgleich (`vocabularyVerification`) funktioniert damit identisch zur Katalog-Prüfung und wird auf `/about` angezeigt. Das Manifest v2 ist zugleich die Signatur-Basis für den `update-catalog`-Workflow (`scripts/sync-upstream-manifest.mjs` liest `metadata.manifest`). Zusätzlich bleibt die Upstream-Integrität zur Fetch-Zeit verankert: gepinnter Snapshot-Commit, Registry-Vertrag, Git-Blob-SHAs, Content-Hashes und Manifest-Signatur in `upstream-manifest.json`.

## Typen (src/domain/models.ts)

```typescript
interface ArtifactIntegrity {
  sha256: string;
  size_bytes: number;
  fetched_at: string;
}

interface ArtifactBuildInfo {
  workflow_run_id: string;
  workflow_run_url: string | null;
  runner_environment: string;
}

interface UpstreamManifestFile {
  artifactKey: string;
  rootType: ManifestRootType;
  lifecycle: ArtifactLifecycle;
  path: string;
  gitBlobSha: string;
  contentSha256: string;
}

interface UpstreamManifest {
  schemaVersion: 2;
  repository: string;
  snapshotCommitSha: string;
  files: UpstreamManifestFile[];
  signatureSha256: string;
}

interface CatalogProvenance {
  artifactKey?: string;
  source: {
    repository: string;
    file: string;
    commit_sha: string;
    commit_date?: string;
    git_blob_sha: string;
    upstream_sha256?: string;
    upstream_size_bytes?: number;
  };
  integrity: ArtifactIntegrity;
  build: ArtifactBuildInfo;
}

interface VocabularyFileProvenance {
  namespace: string;
  path: string;
  fileName: string;
  routeId: string;
  gitBlobSha: string;
  sha256: string;
  sizeBytes: number;
}

interface TopicVocabularyCoverage {
  catalogTopicCount: number;
  distinctCatalogUuidCount: number;
  csvEntryCount: number;
  matchedCatalogTopicCount: number;
  unmatchedCatalogTopicCount: number;
  orphanCsvEntryCount: number;
  missingCatalogUuidCount: number;
  duplicateCsvUuidCount: number;
  unmatchedCatalogTopics: Array<{
    id?: string;
    practiceId?: string;
    uuid?: string;
  }>;
  orphanCsvEntries: Array<{ value?: string; uuid?: string }>;
  duplicateCsvUuids: Array<{ value: string; count: number }>;
}

interface PracticeVocabularyIntegrity {
  catalogPracticeCount: number;
  distinctCatalogUuidCount: number;
  csvEntryCount: number;
  matchedCatalogPracticeCount: number;
  unmatchedCatalogPracticeCount: number;
  orphanCsvEntryCount: number;
  toleratedOrphanCsvEntryCount: number;
  missingCatalogUuidCount: number;
  missingUuidCount: number;
  duplicateCatalogUuidCount: number;
  duplicateUuidCount: number;
  unmatchedCatalogPractices: Array<{ id?: string; uuid?: string }>;
  orphanCsvEntries: Array<{ value?: string; uuid?: string }>;
  toleratedOrphanCsvEntries: Array<{ value?: string; uuid?: string }>;
  entriesWithoutUuid: string[];
  duplicateCatalogUuids: Array<{ value: string; count: number }>;
  duplicateUuids: Array<{ value: string; count: number }>;
}

interface VocabularyProvenance {
  artifactKey?: string;
  source: {
    repository: string;
    catalogPath: string;
    snapshotCommitSha: string;
    snapshotCommitDate?: string;
  };
  manifest: UpstreamManifest;
  files: VocabularyFileProvenance[];
  dataQualityFindings?: string[];
  taxonomyCoverage?: {
    topics: TopicVocabularyCoverage | null;
    practices: PracticeVocabularyIntegrity | null;
  };
  integrity: ArtifactIntegrity;
  build: ArtifactBuildInfo;
}
```

## Ausnahmen

Die Integritätsprüfung kann in folgenden Fällen nicht durchgeführt werden, obwohl das zugehörige Datenartefakt vorhanden ist:

1. **Lokale Entwicklung**: Datenartefakt vorhanden, Metadaten-Datei fehlt
2. **Abruf-Fehler**: Wenn die Metadaten nicht geladen werden können

In diesen Fällen wird:

- das vorhandene Artefakt trotzdem verwendet,
- eine Warnung in der Konsole protokolliert,
- kein Provenance-/Verifikationsblock für dieses Artefakt angezeigt.

Ein fehlendes oder nicht parsebares `catalog.json` bleibt dagegen ein harter Ladefehler für den Einstiegskatalog. Ein fehlendes `vocabularies.json` ist optional und führt zu einer App ohne Vokabular-Registry. Fehlt ein **weiterer** Katalog, bleibt der Fehler auf diesen Katalog beschränkt.

## Referenzbefunde und ihre Allowlist

Die Referenzprüfung (Stufe 5 des
[Validierungsvertrags](OSCAL_VALIDATION.md#stufe-5--referenzgraph)) ist von der
Hashprüfung getrennt: SHA-256 belegt, dass ein ausgeliefertes Artefakt seinen
Build-Metadaten entspricht; der Referenzgraph prüft, ob die Verweise zwischen
Artefakten tragen. Keine der beiden Prüfungen ist allein ein Herkunfts-,
Vertrauens- oder Compliance-Nachweis.

### Blockierend und nicht blockierend

Ein Referenzfehler an einem `supported`-Artefakt lässt
`npm run verify-upstream-oscal` fehlschlagen. Befunde an `preview`, `draft` und
`blocked-by-upstream` werden in der CI-Zusammenfassung und im maschinenlesbaren
Bericht ausgewiesen, blockieren aber nicht — sie zu verstecken wäre die
schlechtere Alternative. Ein Artefakt außerhalb von `supported` wird in keiner
Ausgabe als abschließend bewertet dargestellt, auch nicht bei null Befunden.

Ein Befund, dessen Artefaktschlüssel keinem bekannten Lifecycle zugeordnet
werden kann, gilt fail-closed als blockierend.

### Allowlist mit Auslaufregel

Ein bewusst akzeptierter Befund wird in `REFERENCE_GRAPH_ALLOWLIST` in
[`verify-upstream-oscal.mjs`](../scripts/verify-upstream-oscal.mjs) eingetragen:

```js
{
  signature: 'reference-graph@1|OSCAL_GRAPH_TARGET_NOT_FOUND|/catalog/groups/0/controls/1/links/0/href',
  snapshotCommitSha: '8213e3a087976f0ba8019f2ef081924d9ce49666',
  reason: 'Upstream gemeldet unter <Issue-Link>',
}
```

Der Matchschlüssel ist die Diagnosesignatur (`name@version|code|path`) **und**
der Snapshot-Commit — nicht der Artefaktschlüssel. Ein Eintrag deckt damit genau
den Befund, den jemand geprüft hat, und nicht jeden späteren am selben Artefakt.

**Ein Eintrag läuft aus, statt zu wandern.** Ändert sich der Snapshot oder der
strukturelle Pfad des Befunds, greift er nicht mehr; der Befund wird wieder
blockierend und der Eintrag erscheint in der Zusammenfassung unter
„Abgelaufene Allowlist-Einträge". Abgelaufene Einträge gehören entfernt, nicht
auf den neuen Snapshot fortgeschrieben — die erneute Prüfung ist der Zweck der
Regel.

### Recovery

Blockiert ein Befund den Lauf, sind das die Wege in dieser Reihenfolge:

1. **Fehler im Graphen oder in den Erwartungen**: Test ergänzen und den Code
   korrigieren. Ein neuer Befund an einem produktiven Artefakt ist zuerst ein
   Verdacht gegen die eigene Auswertung.
2. **Echter Upstream-Defekt**: beim BSI melden, das Issue verlinken und den
   Befund mit Signatur, Snapshot und Begründung in die Allowlist aufnehmen.
   Betrifft der Defekt das Artefakt als Ganzes, ist stattdessen der Lifecycle
   `blocked-by-upstream` das richtige Mittel (ADR-7).
3. **Absicht des Upstreams**: Wenn die Referenz gar kein Fehler ist, gehört die
   Regel korrigiert — nicht der Befund unterdrückt.

Ein Artefakt, das Stufe 3 nicht besteht, geht nicht in den Graphen ein; ein
Artefakt, dessen Projektion nicht ableitbar ist, wird als eigener, redigierter
Befund gemeldet und blockiert nur bei `supported`.

## SLSA Provenance

Zusätzlich zur internen Integritätsprüfung generiert `.github/workflows/deploy.yml` Build-Provenance über GitHub Artifact Attestations (`actions/attest` mit `subject-path: dist/**`). Die Attestierung wird OIDC-signiert und bei GitHub gespeichert; sie belegt, welcher Workflow-Lauf die deployten Artefakte gebaut hat.

Damit die Aussage über den Build-Prozess trägt, ist auch der Build-Prozess selbst festgeschrieben: Alle Actions in `.github/workflows/` sind auf 40-stellige Commit-SHAs gepinnt statt auf verschiebbare Versions-Tags.

## Sicherheitshinweise

- **SHA-256** ist kollisionsresistent (praktisch)
- **Git Blob SHA** wird zusätzlich verwendet für Git-Integration
- **Workflow Run ID** ermöglicht Rückverfolgung zum Build-Prozess
- **Runner Environment** identifiziert die Build-Plattform
- **SHA-Pinning der Workflow-Actions** (`.github/workflows/**`) macht jede Action-Referenz unveränderlich: Ein Tag lässt sich bei einer Übernahme des Action-Repositories auf beliebigen Code umbiegen, ein Commit-SHA nicht. Der Guard `scripts/workflow-action-pinning.test.ts` liest das Workflow-Verzeichnis dynamisch ein und lässt `npm run test` fehlschlagen, sobald eine `uses:`-Zeile ohne 40-stelligen SHA oder ohne versionsförmigen Kommentar hinzukommt; Platzhalter wie `# pinned` genügen nicht. Da GitHub für SHA-gepinnte Actions keine Dependabot-Security-Alerts mehr erzeugt, läuft der `github-actions`-Eintrag in `.github/dependabot.yml` als Ausgleich täglich statt wöchentlich. Dieser Guard prüft nur den Dateiinhalt zum PR-Zeitpunkt; er verhindert nicht, dass ein Workflow-Lauf eine tag-gepinnte Action ausführt, falls der Guard entfernt oder umgangen wird. Ergänzend dazu ist die GitHub-Repository-Policy „Require actions to be pinned to a full-length commit SHA" aktiviert (`sha_pinning_required: true` unter `Settings → Actions → General`, bzw. `GET /repos/{owner}/{repo}/actions/permissions`): Sie greift zur Laufzeit jedes Workflow-Laufs und lässt ihn fehlschlagen, sobald eine Action nicht per vollständigem Commit-SHA referenziert ist — unabhängig vom PR-Zeit-Guard.
- **Quellregister und Upstream-Grenzen** (`src/domain/sourceRegistry.mjs`, `scripts/security-guards.mjs`) verhindern, dass der Fetch auf fremde Repositories, externe Hosts, nicht registrierte Pfade oder unzulässige Refs umgelenkt wird. Pfad-Traversal, Symlinks bzw. andere nicht reguläre Tree-Einträge und ein OSCAL-Root-Type-Mismatch führen geschlossen zum Abbruch.
- **Vollständiger Read-only-Tree-Diff** (`scripts/upstream-artifacts.mjs`) klassifiziert Änderungen unter allen überwachten Wurzeln als `added`, `modified` oder `removed`. Neue nicht registrierte Pfade werden als `unclassified` gemeldet, ohne ihren Blob zu laden oder sie auszuliefern. Unvollständige Trees und doppelte bzw. unsichere Pfade werden abgelehnt.
- **Catalog-Sync-Guard** (`scripts/catalog-sync-guard.mjs`) prüft bei Sync-PRs Branch und Titel, einen exakt auf `upstream-manifest.json` begrenzten Diff, das strikte Manifest-v2-Schema für das bisherige und das neue Manifest, Registry-Metadaten, kanonische Dateireihenfolge und Signatur. Der neue BSI-Snapshot muss per GitHub Compare API ausnahmslos `ahead` sein; `scripts/sync-upstream-manifest.mjs` blockiert eine Signaturänderung bei unverändertem Snapshot bereits vor jedem Schreibzugriff. Git-Blob-SHAs und Content-Hashes werden gegen den vollständigen Snapshot gebunden; die Namespace-Inventur muss exakt allen direkten `.csv`-Mitgliedern des registrierten Verzeichnisses entsprechen, während externe oder anderweitig unzulässige `ns`-Referenzen weiterhin blockieren. API- und Netzwerkfehler sowie `identical`, `behind` und `diverged` blockieren.
- **Ruleset-Preflight** (`scripts/catalog-sync-policy.mjs`) prüft vor schreibenden Sync-Aktionen Auto-Merge, Branch-Löschung, erwartete Required Checks, CodeQL und den Audit-Pin der Ruleset-Version. GitHub gibt `bypass_actors` nur mit Ruleset-Schreibzugriff zurück; deshalb attestiert der Agent nach vollständigem Audit die bypass-freie Ruleset-Version über `CATALOG_SYNC_RULESET_UPDATED_AT`. Zusätzlich wird der Ref-Scope geschlossen geprüft: `conditions.ref_name.include` muss `main` über `~DEFAULT_BRANCH`, `~ALL` oder `refs/heads/main` abdecken, `exclude` muss leer sein, und der Default-Branch des Repositories muss `main` sein. fnmatch-Globs gelten bewusst nicht als Nachweis, damit jede Scope-Drift den Preflight blockiert statt still fail-open zu laufen.
- **Keine Integritätskette für Klasse 2**: Lokale Nutzerdokumente durchlaufen den hier beschriebenen Manifest-/Hash-Mechanismus nie und erben keine Provenienzindikatoren. Das ist nicht nur Policy, sondern eine Modelltatsache: `hash` existiert im OSCAL-Modell ausschließlich unter `back-matter/resource/rlinks/hashes` und beschreibt dort eine *referenzierte* Ressource — einen Dokument-Selbsthash gibt es nicht. Ein Verifikationsindikator im Sinne von Klasse 1 ist für ein lokales Dokument deshalb prinzipiell unmöglich. Übernimmt ein Nutzer ein ausgeliefertes Artefakt als Ausgangspunkt für ein eigenes Dokument, hält der [Persistenzvertrag](./PERSISTENCE.md) die Herkunft als `derivedFrom` mit `contentSha256` fest; das ist eine Herkunftsangabe und hebt die Vertrauensklasse nicht an. Referenzier- und übernehmbar sind dabei ausschließlich Artefakte mit `lifecycle: 'supported'`, weil nur sie materialisiert werden und die Laufzeitprüfung durchlaufen.
- **CodeQL-Abgrenzung**: CodeQL schützt Anwendungscode und Workflows, bewertet aber nicht die fachliche Richtigkeit des BSI-Kataloginhalts. Der BSI-Upstream wird als Datenquelle akzeptiert; Two-Source-Verifikation ist bewusst nicht Bestandteil dieser Automatisierung.

## Siehe auch

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Gesamtarchitektur
- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [FILTERING.md](./FILTERING.md) — Filter-System
- [PERSISTENCE.md](./PERSISTENCE.md) — Persistenzvertrag für lokale Arbeitsbereiche
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
- `src/domain/integrity.ts` — Integrity-Implementierung
- `src/state/CatalogContext.tsx` — Context-Integration
- `scripts/fetch-catalog.mjs` — Build-Skript
- `.github/workflows/deploy.yml` — Deployment mit SLSA
