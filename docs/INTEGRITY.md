# Integritätsprüfung — Grundschutz++ Navigator

SHA-256-Verifikation der ausgelieferten Artefakte, Provenance-Metadaten (Manifest v2) und Build-Provenance (SLSA).

## Überblick

1. **Build-Zeit**: `npm run fetch-catalog` berechnet je Artefakt SHA-256, Größe, Git-Blob-SHA und Commit-Bindung und schreibt sie in Metadaten (`scripts/fetch-catalog.mjs`).
2. **Laufzeit**: `src/domain/integrity.ts` berechnet den Hash erneut und vergleicht ihn mit dem gespeicherten Wert.
3. **UI**: Das Ergebnis steht auf `/about` (`src/features/pages/AboutPage.tsx`).

Die Prüfung erkennt Inkonsistenzen zwischen Artefakt und mitgelieferten Metadaten (beschädigte oder unvollständige Deployments). Sie ist kein unabhängiger Herkunftsnachweis: Den liefert die extern bei GitHub gespeicherte Artifact Attestation (siehe [SLSA Provenance](#slsa-provenance)). Die Upstream-Authentizität ist zur Fetch-Zeit über Snapshot-Pinning und die Upstream-Allowlist verankert.

### Schemas: Bauzeit statt Laufzeit

Die gepinnten NIST-JSON-Schemas unter `schemas/oscal/` gehören **nicht** zu diesem Laufzeitmechanismus:

| | `public/data/`-Artefakte | `schemas/oscal/`-Schemas |
| --- | --- | --- |
| Auslieferung | zur Laufzeit über `fetch` nachgeladen | zur Bauzeit in je eigene Chunks gebaut; der Chunk der ausgewählten Zelle wird zur Laufzeit als Modul derselben Origin nachgeladen |
| Bytes beim Prüfen | exakt die Bytes der Quelldatei | vom Bundler transformiert |
| Prüfort | `src/domain/integrity.ts`, im Browser | `npm run verify-oscal-schemas`, in CI |

Ein im selben Bundle mitgelieferter Sollhash bewiese nichts: Wer die Schemabytes ändern kann, ändert den Sollwert gleich mit. Die Integritätszusage trägt deshalb `npm run verify-oscal-schemas` in CI — netzfrei, gegen SHA-256, `$id` und die draft-07-Zusage aus `src/domain/oscalVersionMatrix.mjs`, mit Ablehnung jeder Datei ohne Pin. Details in [OSCAL_VERSION_MATRIX.md](./OSCAL_VERSION_MATRIX.md#schema-provenienz).

**Hashgegenstand ist die ausgelieferte Datei, nicht das Parse-Ergebnis.** Der Hash läuft über den rohen `ArrayBuffer` von `catalog.json` beziehungsweise `vocabularies.json` — vor jeder Interpretation. Ein rekonstruiertes `JSON.stringify(source)` wäre schon durch Formatierung nicht byteidentisch zur Quelldatei und taugt nicht als Hashbasis.

## Build-Zeitpunkt (scripts/fetch-catalog.mjs)

`npm run fetch-catalog` startet `scripts/fetch-catalog.mjs`. Das Skript ruft die Upstream-Daten ab, validiert den vollständigen Output-Vertrag und schreibt ausschließlich die aus dem Quellregister abgeleiteten Dateien nach `public/data/`.

### Artefaktvertrag je Katalog

Die Ausgabemenge wird aus dem Register abgeleitet (`listCatalogArtifactFileNames` in `src/domain/sourceRegistry.mjs`, `listOutputArtifactFileNames` in `scripts/fetch-catalog.mjs`):

| Registereintrag | Datenartefakt | Metadatenartefakt |
| --- | --- | --- |
| Einstiegskatalog (`entryCatalog: true`) | `catalog.json` | `catalog-metadata.json` |
| jeder weitere `supported`-Katalog | `catalog-<catalogKey>.json` | `catalog-<catalogKey>-metadata.json` |

Der Einstiegskatalog behält seine Dateinamen bei; Deploy- und Cache-Vertrag bleiben stabil. Genau ein `supported`-Katalog trägt `entryCatalog: true`; ein Register ohne ausgelieferten Katalog oder ohne genau einen Einstieg schlägt beim Import fail-closed fehl.

Der aktuelle Registerstand liefert drei Kataloge: `catalog-gspp` als Einstieg sowie `catalog-lieferkette` und `catalog-wlan` als bedarfsgerecht geladene Sekundärkataloge. Dazu kommen die beiden generierten Sammelartefakte:

- `vocabularies.json` — offizielle BSI-Vokabulare (aus CSV konvertiert)
- `upstream-sources-metadata.json` — Vokabular-Provenance + Upstream-Manifest + rein lesende Katalog-Lineage

Bei genau einem ausgelieferten Katalog ist die Ausgabemenge `catalog.json`, `catalog-metadata.json`, `vocabularies.json`, `upstream-sources-metadata.json`. Eine Ausgabedatei, die sich nicht aus dem Register ableiten lässt, lehnt `writeArtifacts` ab.

### Fetch-Vertrag

1. **Quellregister als Vertrag**: `src/domain/sourceRegistry.mjs` ist die einzige Ingestion-Quelle für Artefaktschlüssel, Pfade, erwartete OSCAL-Root-Typen, Katalogschlüssel und Lifecycle. `scripts/security-guards.mjs` leitet daraus die Allowlist ab und begrenzt zusätzlich Repository, Hosts, Pfade und Refs.
2. **Snapshot-Pinning**: `BSI_SNAPSHOT_SHA` muss die vollständige Commit-SHA des BSI-Datenstands oder ausdrücklich `latest` enthalten. `latest` verwendet nur der Catalog-Sync zur Erkennung eines neuen Datenstands. Andere Werte werden abgelehnt.
3. **Vollständiger Tree vor Blob-Abruf**: Der rekursive GitHub-Tree der überwachten Wurzeln muss vollständig sein und darf weder Symlinks noch andere nicht reguläre Dateien enthalten. Erst danach werden registrierte Pfade materialisiert.
4. **Lifecycle-getrennte Verarbeitung**: `preview`- und `draft`-Artefakte werden transient auf Pfad, Blob, Inhalt und Root-Typ geprüft. Nur `supported`-Artefakte werden als App-Daten ausgeliefert; die Namespace-Collection materialisiert alle regulären `.csv`-Dateien direkt aus ihrem registrierten Verzeichnis. Eine Lifecycle-Promotion ändert den kanonischen Manifest-v2-Payload und seine `signatureSha256`; Registry und Manifest mit abweichendem Lifecycle werden fail-closed abgelehnt.
5. **Katalog-Lineage**: Nach der Versions- und Root-Typ-Prüfung der Quellkataloge und des Profils folgt `catalogLineage.mjs` ausschließlich die belegte Dreifachkante `profile.import.href` (Fragment) → genau eine `back-matter.resource` → exakter `rlinks.href`-String → expliziter Registry-Eintrag. Fehlende konfigurierte Importe sowie fehlende oder mehrdeutige Ressourcen bleiben benannte, nicht vollständige Zustände. Relative Pfade werden weder normalisiert noch über Netzwerk, Dateisystem oder den generischen Referenzresolver aufgelöst. Nur die serialisierte Projektion steht im Sidecar; die Quellkatalog-Bytes werden nicht ausgeliefert.
6. **Abruf über erlaubte GitHub-Endpunkte** mit Retry bei transienten Fehlern — Transportfehler und HTTP 500–599, höchstens zwei Wiederholungen nach 1 s und 3 s, über denselben Helfer `scripts/transientRetry.mjs` wie der go-oscal-Korpuslauf; optional authentifiziert über `GH_TOKEN`/`GITHUB_TOKEN`.
7. **Integritätsdaten**: SHA-256, Dateigröße, Git-Blob-SHA und Commit-Informationen werden je ausgeliefertem Artefakt erfasst. Jeder ausgelieferte Katalog erhält eigene Werte samt seiner deklarierten `metadata.oscal-version`; eine gemeinsame Versionsannahme über mehrere Kataloge gibt es nicht. Das Manifest v2 enthält zusätzlich für jede materialisierte Registry-Datei Root-Typ und Lifecycle.

## Manifest v2

Das Manifest wird von `scripts/upstream-artifacts.mjs` gebaut und von `validateManifestV2Shape` strikt geprüft. Top-Level-Felder (exakt diese fünf):

- `schemaVersion`: `2`
- `repository`: kanonische HTTPS-GitHub-URL (`normalizeRepositoryUrl` lehnt alles andere ab)
- `snapshotCommitSha`: 40-stellige kleingeschriebene Git-SHA
- `files`: nicht-leeres Array in kanonischer Pfadordnung
- `signatureSha256`: kleingeschriebener SHA-256-Hexwert

**`snapshotCommitSha` ist Bestandteil der Manifest-Signatur.** `signatureSha256` ist der SHA-256 über das JSON des kanonischen Payloads `{ schemaVersion, repository, snapshotCommitSha, files }` (`buildSignaturePayload`, `computeManifestSignature`). Jede Änderung — einschließlich einer Lifecycle-Promotion — ändert die Signatur; eine Abweichung schlägt mit `Manifest signatureSha256 does not match the canonical payload` fail-closed fehl.

Jeder Dateieintrag trägt exakt diese sechs Felder:

- `artifactKey` (Register-Grammatik: kleingeschriebener ASCII-Anfangsbuchstabe, danach Kleinbuchstaben, Ziffern, Bindestriche, alphanumerisches Ende)
- erwarteter `rootType`
- `lifecycle` (`supported`, `preview`, `draft` oder `blocked-by-upstream`)
- `path` (sicherer Repo-Pfad, kein Traversal)
- `gitBlobSha` (40-stellige Git-SHA)
- `contentSha256` (64-stelliger SHA-256)

Unbekannter Lifecycle, Doppelpfade, nicht-kanonische Dateireihenfolge oder Repository-URL, Zusatzfelder und jede Signaturabweichung werden abgelehnt.

Das Manifest v2 ist zugleich die Signatur-Basis für den `update-catalog`-Workflow (`scripts/sync-upstream-manifest.mjs` liest `metadata.manifest`). Die Upstream-Integrität bleibt zur Fetch-Zeit verankert: gepinnter Snapshot-Commit, Registry-Vertrag, Git-Blob-SHAs, Content-Hashes und Manifest-Signatur in `upstream-manifest.json`.

## Lokale Snapshot-Freshness

`public/data/` ist gitignoriert und kann nach einem Pull zu einem anderen Snapshot gehören als das eingecheckte `upstream-manifest.json`. `scripts/check-catalog-freshness.mjs` vergleicht die kanonische `signatureSha256` des eingecheckten Manifests mit dem in `public/data/upstream-sources-metadata.json` eingebetteten Manifest. Damit wird auch ein geänderter Registry-Vertrag bei unverändertem Upstream-Commit erkannt.

Mögliche Zustände sind `fresh`, `stale`, `missing` und `malformed` — getrennt für das eingecheckte Manifest und die lokalen Metadaten. Jeder nicht frische Zustand bricht Tests über das `globalSetup` in `vite.config.ts` mit erwarteter und gefundener 12-Zeichen-SHA ab. Beim lokalen Dev-Server warnt stattdessen das serve-beschränkte Vite-Plugin `catalog-freshness-diagnostic` im Terminal. Reparatur in beiden Fällen:

```bash
npm run setup
```

CI setzt `BSI_SNAPSHOT_SHA` aus dem eingecheckten Manifest; die erzeugten Metadaten tragen dieselbe Signatur und lösen keinen Freshness-Fehler aus.

## Semantisches Control-Identitätsdelta

Bei einem Snapshot-Wechsel ergänzt `scripts/sync-upstream-manifest.mjs` das Datei-Delta um einen semantischen Vergleich aller Manifest-Einträge mit `rootType: catalog` — unabhängig vom Lifecycle. Beide Katalogfassungen werden über ihre im jeweiligen Manifest gebundenen Git-Blob-SHAs geladen; SHA-1 im Git-Blob-Format und SHA-256-Inhaltshash müssen zum Manifest passen.

`scripts/control-identity-delta.mjs` klassifiziert anhand der kataloginternen `alt-identifier`-Identität: `added`, `removed`, `moved` (gleicher `alt-identifier`, andere Control-ID), `id-rebound` (wiederverwendete Control-ID für eine neue Identität), `identifier-changed` (gleicher Titel, verschiedene `alt-identifier`) und `ambiguous` (insbesondere doppelte `alt-identifier` oder nicht eindeutige Titelkandidaten; Titelgleichheit ist nur nicht-kryptographische Evidenz, mehrdeutige Kandidaten werden nicht geraten).

Der Befund steht maschinenlesbar in `public/data/control-identity-delta.json` (gitignoriert; je Eintrag Artefaktschlüssel, beide Snapshot-SHAs, alte und neue Control-ID, alte und neue `alt-identifier`, Titel, Klassifikation); der Sync-PR erhält eine Zusammenfassung mit Control-Zahlen und Klassifikationssummen je Katalog. Der Vergleich ist diagnostisch: Fehler bei Blob-Abruf, Hashprüfung, Parse oder Schreiben ändern weder die `changed`-Entscheidung noch die Manifest-Aktualisierung noch den Exit-Code. Die Manifest-, Tree- und Catalog-Sync-Guards bleiben unberührt.

## Provenance-Metadaten (catalog-metadata.json)

Beispiel; alle Werte Platzhalter:

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
    "upstream_size_bytes": "<anzahl>"
  },
  "integrity": {
    "sha256": "<sha256>",
    "size_bytes": "<anzahl>",
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

Eine gemeinsame Funktion prüft Katalog und Vokabulare über die Union `CatalogProvenance | VocabularyProvenance`:

```typescript
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

```typescript
export const ARTIFACT_FETCH_TIMEOUT_MS = 60_000;
```

Das Limit gilt für Antwort und Body-Lesen jedes Artefakt-Fetch. Ohne Limit hielte ein hängender Request den Ladepfad dauerhaft im Ladezustand, weil kein `catch`-Zweig je erreicht würde. Umgesetzt mit `AbortController` + `setTimeout` (nicht `AbortSignal.timeout()`, das sich unter Vitest-Fake-Timern nicht vorspulen lässt); der Timer wird in einem `finally` aufgeräumt.

### Provenance- und Buffer-Abruf

`fetchProvenance` und `fetchVocabularyProvenance` laden die jeweilige Metadatendatei über `fetchJsonDocument` (Default-Timeout `ARTIFACT_FETCH_TIMEOUT_MS`; Fehlertext `Failed to load {label}: {status} {statusText}`). `fetchCatalogBuffer` lädt eine Katalogdatei als `ArrayBuffer` (Fehlertext `Failed to load catalog: …`). `fetchCatalogWithBuffer` liefert zusätzlich den UTF-8-Text; es versorgt die Vokabular-Registry, während der Katalogpfad den Buffer an den Parser-Worker übergibt und erst dort dekodiert.

## CatalogContext Integration

`src/state/catalogArtifacts.ts` lädt genau einen Katalog gegen **seine eigenen** Metadaten (`loadCatalogArtifacts`): Katalogbuffer laden, dann `fetchProvenance` + `verifyArtifactIntegrity` in einem `try/catch` — fehlen die Metadaten, protokolliert die App eine Konsolenwarnung und überspringt die Prüfung. Erst danach wird der Buffer ohne Kopie (Transferable) an den Modul-Worker übergeben; das Dokument trägt die Vertrauensklasse aus dem Prüfergebnis (`class-1-verified-public` nur bei bestandener Prüfung, sonst `class-1-unverified-public`). Die Reihenfolge ist tragend: Ohne sie behauptete das Dokument „verifiziert", bevor geprüft wurde.

`src/state/CatalogContext.tsx` startet Einstiegskatalog und Vokabulare gemeinsam (Startlatenz). Die Vokabulare laufen über `fetchCatalogWithBuffer` + `buildVocabularyRegistry`; ihre Provenance (`fetchVocabularyProvenance`) und Verifikation gegen denselben Buffer folgen in einem eigenen `try/catch` mit Konsolenwarnung. Fehlt `catalog.json`, ist das ein harter Ladefehler des Einstiegskatalogs; fehlt nur `vocabularies.json`, läuft die App ohne Vokabular-Registry weiter. Ein `cancelled`-Flag verhindert State-Updates nach Unmount; ein Auffangnetz um den gesamten eager Ladepfad führt jeden Wurf in einen sichtbaren Ladefehler statt in einen hängenden Ladezustand.

Jeder optionale Fetch (`vocabularies.json`, beide Provenance-Dateien) ist einzeln auf `ARTIFACT_FETCH_TIMEOUT_MS` begrenzt; ein Timeout wirkt wie ein 404 — das betroffene Feld bleibt `null`. Ein Timeout von `catalog.json` selbst führt über den äußeren `catch` in den Fehlerzustand.

### Mehrere Kataloge — Isolation der Prüfung

Der Kontext hält eine Katalogsammlung (`catalogs: ReadonlyMap<CatalogKey, LoadedCatalogState>`). Der Einstiegskatalog wird eager geladen; jeder weitere erst bei Auswahl über `selectCatalog(catalogKey)`. Jeder Katalog durchläuft `verifyArtifactIntegrity` gegen seine eigenen Metadaten; Provenance, Verifikationsergebnis, Vertrauensklasse und Fehlerzustand hängen am einzelnen Katalog:

- Ein Katalog mit abweichendem Hash oder fehlenden Metadaten trägt `class-1-unverified-public` und bleibt sichtbar.
- Kein anderer geladener Katalog verliert dadurch seine Vertrauensklasse; kein Katalog wird still als verifiziert dargestellt.
- Ein fehlender oder beschädigter Katalog erzeugt einen Fehlerzustand für genau diesen Katalog; die übrigen bleiben nutzbar.

Die Projektionen `catalog`, `provenance`, `verification`, `loading` und `error` aus `useCatalog()` beziehen sich auf den per Route aktiven Katalog.

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

Provenance und Verifikationsergebnis stehen auf **„Über das Projekt"** (`/about`) — jeweils für den Katalog und für die Vokabulare: Erfolgs-Banner bei gültiger, Warn-Banner bei ungültiger Prüfung. Dazu Quell-Repository, Commit-SHA (12-stellig, mit Link auf den Upstream-Stand) und Abrufzeitpunkt; für die Vokabulare Abrufzeitpunkt, Anzahl der Namespace-Dateien und Snapshot-Commit. Fehlen die Metadaten, erscheint für dieses Artefakt kein Block. „Verifikation ausstehend…" steht nur, wenn Provenance vorhanden ist, das Prüfergebnis aber noch nicht vorliegt.

Für den Grundschutz++-Katalog zeigt die Fläche zusätzlich die OSCAL-Ableitungsmarker (`resolution-tool`, `link[@rel='source-profile']`), die profilbasierte Dokumentkette aus dem Sidecar und die Projekt-Build-Provenienz. Die Ansicht trifft keine Control-genaue Herkunftsaussage. `back-matter.resource.rlinks.hashes` beschreibt referenzierte Ressourcen; einen Hash eines Dokuments über sich selbst kennt OSCAL nicht.

## Vocabulary Integrity

Das Vokabular-Artefakt `vocabularies.json` durchläuft dieselbe `verifyArtifactIntegrity`-Funktion; seine Metadaten stehen in `upstream-sources-metadata.json`. Darin umfasst `manifest` alle materialisierten Registry-Artefakte; das Top-Level-Feld `files` enthält ausschließlich die Datei-Provenance der ausgelieferten Namespace-CSVs (`namespace`, `path`, `fileName`, `routeId`, `gitBlobSha`, `sha256`, `sizeBytes`). `dataQualityFindings` hält nicht blockierende fachliche Befunde fest. `taxonomyCoverage.topics` und `.practices` messen die UUID-Deckung zwischen Katalog und CSVs einschließlich Orphan- und Duplikat-Zählern; `scripts/taxonomy-coverage.mjs` duldet namentlich genau eine Ausnahme (`TOLERATED_ORPHAN_PRACTICE_UUIDS`: die BSI-Beispielpraktik `EXMP`), jede andere verwaiste CSV-Zeile lässt den Guard fehlschlagen. Die Coverage-Baselines fordern `orphanCsvEntryCount === 0`; fehlende oder doppelte Topic-/Practice-UUIDs sowie Katalog- oder CSV-Orphans blockieren Fetch und Catalog-Sync.

Beispiel (Werte Platzhalter; alle drei Sekundärkataloge tragen ihren aktuellen Lifecycle):

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
        "lifecycle": "supported",
        "path": "control_layer/Lieferkettensicherheit/Lieferkettensicherheit-resolved_catalog.json",
        "gitBlobSha": "<git-blob-sha>",
        "contentSha256": "<sha256>"
      },
      {
        "artifactKey": "catalog-wlan",
        "rootType": "catalog",
        "lifecycle": "supported",
        "path": "control_layer/WLAN/WLAN-resolved_catalog.json",
        "gitBlobSha": "<git-blob-sha>",
        "contentSha256": "<sha256>"
      }
    ],
    "signatureSha256": "<sha256>"
  },
  "catalogLineages": [
    {
      "catalogKey": "gspp",
      "profile": { "artifactKey": "profile-gspp", "documentUuid": "<uuid>" },
      "imports": [
        {
          "state": "complete",
          "importHref": "#<resource-uuid>",
          "rlinkHref": "../catalogs/...",
          "source": { "artifactKey": "catalog-source-gspp-kernel-g0" }
        }
      ]
    }
  ],
  "files": [
    {
      "namespace": "https://github.com/…/tree/main/documentation/namespaces/modal_verbs.csv",
      "path": "documentation/namespaces/modal_verbs.csv",
      "fileName": "modal_verbs.csv",
      "routeId": "documentation-namespaces-modal-verbs",
      "gitBlobSha": "<git-blob-sha>",
      "sha256": "<sha256>",
      "sizeBytes": "<anzahl>"
    }
  ],
  "dataQualityFindings": [],
  "taxonomyCoverage": {
    "topics": "<Deckungszähler Katalog ↔ topics.csv>",
    "practices": "<Deckungszähler Katalog ↔ practices.csv>"
  },
  "integrity": {
    "sha256": "<sha256>",
    "size_bytes": "<anzahl>",
    "fetched_at": "<fetch-timestamp>"
  },
  "build": {
    "workflow_run_id": "…",
    "workflow_run_url": "…",
    "runner_environment": "…"
  }
}
```

`integrity.sha256` ist der SHA-256 über das generierte `vocabularies.json`-Artefakt; der Laufzeit-Abgleich (`vocabularyVerification`) funktioniert identisch zur Katalog-Prüfung und erscheint auf `/about`.

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

interface VocabularyProvenance {
  artifactKey?: string;
  source: {
    repository: string;
    catalogPath: string;
    snapshotCommitSha: string;
    snapshotCommitDate?: string;
  };
  manifest: UpstreamManifest;
  catalogLineages?: readonly CatalogLineageProjection[];
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

Die Coverage-Interfaces (`TopicVocabularyCoverage`, `PracticeVocabularyIntegrity` in `src/domain/models.ts`) führen je Seite Katalog-, CSV- und Deckungszähler sowie Orphan-, Duplikat- und Toleranzlisten; maßgeblich für die Guard-Aussage ist der Abschnitt [Vocabulary Integrity](#vocabulary-integrity).

## Ausnahmen

Fehlen zu einem vorhandenen Datenartefakt nur die Metadaten (lokale Entwicklung ohne Fetch, Abruf-Fehler), bleibt das Artefakt nutzbar: Provenance und Verifikation bleiben `null`, die App protokolliert eine Konsolenwarnung und überspringt die Prüfung. Für dieses Artefakt erscheint kein Provenance-/Verifikationsblock.

Dagegen bleibt ein fehlendes oder nicht parsebares `catalog.json` ein harter Ladefehler für den Einstiegskatalog. Ein fehlendes `vocabularies.json` ist optional und führt zu einer App ohne Vokabular-Registry. Fehlt ein **weiterer** Katalog, bleibt der Fehler auf diesen Katalog beschränkt.

## Referenzbefunde und ihre Allowlist

Die Referenzprüfung (Stufe 5 des [Validierungsvertrags](OSCAL_VALIDATION.md#stufe-5--referenzgraph)) ist von der Hashprüfung getrennt: SHA-256 belegt, dass ein ausgeliefertes Artefakt seinen Build-Metadaten entspricht; der Referenzgraph prüft, ob die Verweise zwischen Artefakten tragen. Keine der beiden Prüfungen ist allein ein Herkunfts-, Vertrauens- oder Compliance-Nachweis. Stufe 5 läuft nur über Artefakte, die Stufe 3 bestanden haben.

### Blockierend und nicht blockierend

Ein Referenzfehler an einem `supported`-Artefakt lässt `npm run verify-upstream-oscal` fehlschlagen. Befunde an `preview`, `draft` und `blocked-by-upstream` erscheinen in der CI-Zusammenfassung und im maschinenlesbaren Bericht, blockieren aber nicht. Ein Artefakt außerhalb von `supported` wird in keiner Ausgabe als abschließend bewertet dargestellt, auch nicht bei null Befunden. Ein Befund, dessen Artefaktschlüssel keinem bekannten Lifecycle zugeordnet werden kann, gilt fail-closed als blockierend.

### Allowlist mit Auslaufregel

Ein bewusst akzeptierter Befund steht in `REFERENCE_GRAPH_ALLOWLIST` in [`verify-upstream-oscal.mjs`](../scripts/verify-upstream-oscal.mjs):

```js
{
  signature: 'reference-graph@1|OSCAL_GRAPH_TARGET_NOT_FOUND|/catalog/groups/0/controls/1/links/0/href',
  snapshotCommitSha: '8213e3a087976f0ba8019f2ef081924d9ce49666',
  reason: 'Upstream gemeldet unter <Issue-Link>',
}
```

Der Matchschlüssel ist die Diagnosesignatur (`name@version|code|path`) **und** der Snapshot-Commit — nicht der Artefaktschlüssel. **Ein Eintrag läuft aus, statt zu wandern:** Ändert sich Snapshot oder struktureller Pfad, greift er nicht mehr; der Befund wird wieder blockierend und der ausgelaufene Eintrag in der Zusammenfassung gemeldet. Ausgelaufene Einträge gehören entfernt, nicht auf den neuen Snapshot fortgeschrieben.

### Recovery

1. **Fehler im Graphen oder in den Erwartungen**: Test ergänzen, Code korrigieren. Ein neuer Befund an einem produktiven Artefakt ist zuerst ein Verdacht gegen die eigene Auswertung.
2. **Echter Upstream-Defekt**: beim BSI melden, Issue verlinken, Befund mit Signatur, Snapshot und Begründung in die Allowlist aufnehmen. Betrifft der Defekt das Artefakt als Ganzes, ist der Lifecycle `blocked-by-upstream` das Mittel (ADR-7).
3. **Absicht des Upstreams**: Die Regel gehört korrigiert, nicht der Befund unterdrückt.

Ein Artefakt, das Stufe 3 nicht besteht, geht nicht in den Graphen ein; ein Artefakt, dessen Projektion nicht ableitbar ist, wird als eigener, redigierter Befund gemeldet und blockiert nur bei `supported`.

## SLSA Provenance

`.github/workflows/deploy.yml` generiert Build-Provenance über GitHub Artifact Attestations (`actions/attest` mit `subject-path: dist/**`). Die Attestierung wird OIDC-signiert und bei GitHub gespeichert; sie belegt, welcher Workflow-Lauf die deployten Artefakte gebaut hat.

Alle Actions in `.github/workflows/` sind auf 40-stellige Commit-SHAs statt auf verschiebbare Versions-Tags gepinnt.

## Sicherheitshinweise

- **Quellregister und Upstream-Grenzen** (`src/domain/sourceRegistry.mjs`, `scripts/security-guards.mjs`) verhindern, dass der Fetch auf fremde Repositories, externe Hosts, nicht registrierte Pfade oder unzulässige Refs umgelenkt wird. Pfad-Traversal, Symlinks bzw. andere nicht reguläre Tree-Einträge und ein OSCAL-Root-Type-Mismatch führen geschlossen zum Abbruch.
- **Vollständiger Read-only-Tree-Diff** (`scripts/upstream-artifacts.mjs`) klassifiziert Änderungen unter allen überwachten Wurzeln als `added`, `modified` oder `removed`. Neue nicht registrierte Pfade werden als `unclassified` gemeldet, ohne ihren Blob zu laden oder sie auszuliefern. Unvollständige Trees sowie doppelte oder unsichere Pfade werden abgelehnt.
- **Catalog-Sync-Guard** (`scripts/catalog-sync-guard.mjs`) prüft bei Sync-PRs Branch und Titel, einen exakt auf `upstream-manifest.json` begrenzten Diff gegen die Merge-Basis, das strikte Manifest-v2-Schema für altes und neues Manifest, Registry-Metadaten, kanonische Dateireihenfolge und Signatur. Der neue Snapshot muss per GitHub Compare API ausnahmslos `ahead` sein; `scripts/sync-upstream-manifest.mjs` blockiert eine Signaturänderung bei unverändertem Snapshot vor jedem Schreibzugriff. Ausnahmen nur außerhalb des autonomen Syncs: ein Lifecycle-Wechsel ohne neue Bytes, die Ergänzung nicht auslieferbarer `preview`-Katalogquellen ohne `catalogKey` im selben Snapshot (bei unveränderten Pins aller bestehenden Dateien und vollständiger Tree-, Blob- und Content-Prüfung) sowie die Manifest-Übernahme von der Freigabe- auf die Integrationslinie (`isCatalogImportToDevelop`: Base `develop`, Branch exakt `chore/catalog-import-to-develop`, genau ein Diff-Eintrag `M upstream-manifest.json`, Head-Manifest byte-identisch mit `origin/main`). Jede nicht erfüllte Bedingung fällt fail-closed auf den regulären Sync-Pfad zurück. Die Namespace-Inventur muss exakt allen direkten `.csv`-Mitgliedern des registrierten Verzeichnisses entsprechen; externe oder anderweitig unzulässige `ns`-Referenzen blockieren.
- **Ruleset-Preflight** (`scripts/catalog-sync-policy.mjs`) prüft vor schreibenden Sync-Aktionen Auto-Merge, Branch-Löschung, erwartete Required Checks, CodeQL und den Audit-Pin der Ruleset-Version. Der Ref-Scope muss `main` unabhängig vom Repository-Default-Branch über `~ALL` oder `refs/heads/main` abdecken; `exclude` muss leer sein. `~DEFAULT_BRANCH` und fnmatch-Globs gelten nicht als Nachweis.
- **Keine Integritätskette für Klasse 2**: Lokale Nutzerdokumente durchlaufen den Manifest-/Hash-Mechanismus nie und erben keine Provenienzindikatoren: `hash` existiert im OSCAL-Modell ausschließlich unter `back-matter/resource/rlinks/hashes` und beschreibt dort eine *referenzierte* Ressource — einen Dokument-Selbsthash gibt es nicht. Ein Verifikationsindikator im Sinne von Klasse 1 ist für ein lokales Dokument deshalb prinzipiell unmöglich. Für die Übernahme eines ausgelieferten Artefakts als Ausgangspunkt sieht der [Persistenzvertrag](./PERSISTENCE.md) eine Herkunftsangabe `derivedFrom` mit `contentSha256` im Envelope vor (bislang Vorgabe ohne Umsetzung); sie hebt die Vertrauensklasse nicht an. Referenzier- und übernehmbar sind ausschließlich Artefakte mit `lifecycle: 'supported'`, weil nur sie materialisiert werden und die Laufzeitprüfung durchlaufen.
- **CodeQL-Abgrenzung**: CodeQL schützt Anwendungscode und Workflows, bewertet aber nicht die fachliche Richtigkeit des BSI-Kataloginhalts. Der BSI-Upstream wird als Datenquelle akzeptiert.

## Siehe auch

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Gesamtarchitektur
- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [FILTERING.md](./FILTERING.md) — Filter-System
- [PERSISTENCE.md](./PERSISTENCE.md) — Persistenzvertrag für lokale Arbeitsbereiche
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
- `src/domain/integrity.ts` — Integrity-Implementierung
- `src/state/CatalogContext.tsx`, `src/state/catalogArtifacts.ts` — Lade- und Prüfpfad
- `scripts/fetch-catalog.mjs` — Build-Skript
- `.github/workflows/deploy.yml` — Deployment mit SLSA
