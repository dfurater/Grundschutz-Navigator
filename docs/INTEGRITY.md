# Integritätsprüfung — Grundschutz++ Navigator

Beschreibung der SHA-256 Hash-Verifikation und des Provenance-Metadaten-Systems.

## Überblick

Die Anwendung verwendet ein **Integrity-Verification-System**, das:

1. **Zum Build-Zeitpunkt**: SHA-256 Hash der Artefakte berechnet und in Metadaten speichert
2. **Zur Laufzeit**: Hash erneut berechnet und mit dem gespeicherten Wert vergleicht
3. **In der UI**: Prüfungsergebnis anzeigt

Das System prüft, ob die geladenen Artefakte zu den gemeinsam ausgelieferten Integritätsmetadaten passen. Da Artefakt und Metadaten aus demselben Deployment stammen, erkennt die Prüfung Inkonsistenzen zwischen beiden (z.B. beschädigte oder unvollständige Deployments) — sie ist aber kein unabhängiger Herkunftsnachweis. Den liefert die extern bei GitHub gespeicherte Artifact Attestation (siehe [SLSA Provenance](#slsa-provenance)); die Upstream-Authentizität wird zur Fetch-Zeit über Snapshot-Pinning und die Upstream-Allowlist verankert.

**Gegenstand der Hashprüfung ist die ausgelieferte Datei, nicht das Parse-Ergebnis.** Der Hash wird über den rohen `ArrayBuffer` von `catalog.json` beziehungsweise `vocabularies.json` berechnet — vor jeder Interpretation und unabhängig davon, wie die Anwendung den Inhalt anschließend repräsentiert. Das verlustfreie Dokumentmodell (ADR-0002) hält den Quellgraphen zwar zusätzlich im Speicher, ist aber kein Bezugspunkt der Prüfung: Ein wiederhergestelltes `JSON.stringify(source)` wäre schon wegen Formatierung und Einrückung nicht byteidentisch zur Quelldatei und taugt deshalb grundsätzlich nicht als Hashbasis.

## Build-Zeitpunkt (scripts/fetch-catalog.mjs)

`npm run fetch-catalog` startet `scripts/fetch-catalog.mjs`. Das Skript ruft die Upstream-Daten ab, validiert den vollständigen Output-Vertrag und schreibt ausschließlich diese vier generierten Dateien nach `public/data/`:

- `catalog.json` — der OSCAL-Katalog
- `catalog-metadata.json` — Katalog-Provenance + Integrity
- `vocabularies.json` — offizielle BSI-Vokabulare (aus CSV konvertiert)
- `upstream-sources-metadata.json` — Vokabular-Provenance + Upstream-Manifest

`fetch-catalog.mjs` führt den eigentlichen Abruf durch:

1. **Quellregister als Vertrag**: `src/domain/sourceRegistry.mjs` ist die einzige Ingestion-Quelle für Artefaktschlüssel, Pfade, erwartete OSCAL-Root-Typen, Katalogschlüssel und Lifecycle. `scripts/security-guards.mjs` leitet daraus die Allowlist ab und begrenzt zusätzlich Repository, Hosts, Pfade und Refs.
2. **Snapshot-Pinning**: Ist `BSI_SNAPSHOT_SHA` gesetzt (in CI aus `upstream-manifest.json` gelesen), wird exakt dieser Commit abgerufen statt `main`.
3. **Vollständiger Tree vor Blob-Abruf**: Der rekursive GitHub-Tree der überwachten Wurzeln muss vollständig und darf weder Symlinks noch andere nicht reguläre Dateien enthalten. Erst danach werden registrierte Pfade materialisiert.
4. **Lifecycle-getrennte Verarbeitung**: `preview`- und `draft`-Artefakte werden transient auf Pfad, Blob, Inhalt und Root-Typ geprüft. Nur `supported`-Artefakte werden als App-Daten ausgeliefert; die Namespace-Collection materialisiert alle regulären `.csv`-Dateien direkt aus ihrem registrierten Verzeichnis. `ns`-Referenzen des unterstützten Katalogs werden separat als zulässige fachliche Auflösungsquellen validiert.
5. **Abruf über erlaubte GitHub-Endpunkte** mit Retry und Backoff bei transienten Fehlern; optional authentifiziert über `GH_TOKEN`/`GITHUB_TOKEN`.
6. **Integritätsdaten**: SHA-256, Dateigröße, Git-Blob-SHA und Commit-Informationen werden je ausgeliefertem Artefakt erfasst. Das vollständige Manifest v2 enthält zusätzlich für jede materialisierte Registry-Datei Root-Typ und Lifecycle.

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
): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to load ${label}: ${response.status} ${response.statusText}`,
    );
  }
  return response.json() as Promise<T>;
}
```

### Katalog mit Buffer laden

```typescript
export async function fetchCatalogWithBuffer(
  catalogUrl: string,
): Promise<{ buffer: ArrayBuffer; text: string }> {
  const response = await fetch(catalogUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to load catalog: ${response.status} ${response.statusText}`,
    );
  }
  const buffer = await response.arrayBuffer();
  const decoder = new TextDecoder('utf-8');
  const text = decoder.decode(buffer);
  return { buffer, text };
}
```

## CatalogContext Integration

`src/state/CatalogContext.tsx` orchestriert den Ladevorgang:

1. `catalog.json` und `vocabularies.json` werden **parallel** als ArrayBuffer geladen (Startlatenz). Fehlt `catalog.json`, ist das ein harter Ladefehler; fehlt nur `vocabularies.json`, läuft die App ohne Vokabular-Registry weiter.
2. Der Katalog wird als verlustfreies Dokument geparst (`parseCatalogDocument`, siehe [DOMAIN_MODELS.md](./DOMAIN_MODELS.md#verlustfreies-dokumentmodell)), die Vokabular-Registry gebaut (`buildVocabularyRegistry`).
3. Für den Katalog wird `catalog-metadata.json` geladen und `verifyArtifactIntegrity` ausgeführt; für die Vokabulare analog `upstream-sources-metadata.json` (siehe [Vocabulary Integrity](#vocabulary-integrity)).
4. Fehlen zu einem vorhandenen Datenartefakt nur die Metadaten, bleibt das Artefakt nutzbar. Provenance und Verifikation bleiben `null`, die App protokolliert eine Warnung in der Konsole und überspringt die Prüfung.
5. Ein `cancelled`-Flag verhindert State-Updates nach Unmount.

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

Für das Vokabular-Artefakt `vocabularies.json` ruft der Ladepfad dieselbe Funktion `verifyArtifactIntegrity` auf (die `IntegrityMetadata`-Union deckt beide Provenance-Typen ab). Die zugehörigen Metadaten stehen in `upstream-sources-metadata.json`. Darin umfasst `manifest` alle materialisierten Registry-Artefakte; das separate Top-Level-Feld `files` enthält ausschließlich die Datei-Provenance der ausgelieferten Namespace-CSVs. `dataQualityFindings` hält nicht blockierende fachliche Befunde zum unterstützten Katalog fest. `taxonomyCoverage.topics` protokolliert die gemessene UUID-Deckung zwischen Katalogthemen und `topics.csv`. Fetch und Catalog-Sync-Guard verlangen `practices.csv` und blockieren für jeden Snapshot fehlende oder doppelte Practice-UUIDs sowie Practice-Katalog- oder CSV-Orphans. Entsprechend blockieren sie leere Topic-Taxonomiedaten, fehlende oder doppelte Topic-UUIDs und Topic-Katalog- oder CSV-Orphans; für den bekannten gepinnten Snapshot gilt zusätzlich die exakte Topic-Zählwert-Baseline.

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
      "catalogTopicCount": 139,
      "distinctCatalogUuidCount": 119,
      "csvEntryCount": 119,
      "matchedCatalogTopicCount": 139,
      "unmatchedCatalogTopicCount": 0,
      "orphanCsvEntryCount": 0,
      "missingCatalogUuidCount": 0,
      "duplicateCsvUuidCount": 0,
      "unmatchedCatalogTopics": [],
      "orphanCsvEntries": [],
      "duplicateCsvUuids": []
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

Ein fehlendes oder nicht parsebares `catalog.json` bleibt dagegen ein harter Ladefehler. Ein fehlendes `vocabularies.json` ist optional und führt zu einer App ohne Vokabular-Registry.

## SLSA Provenance

Zusätzlich zur internen Integritätsprüfung generiert `.github/workflows/deploy.yml` Build-Provenance über GitHub Artifact Attestations (`actions/attest` mit `subject-path: dist/**`). Die Attestierung wird OIDC-signiert und bei GitHub gespeichert; sie belegt, welcher Workflow-Lauf die deployten Artefakte gebaut hat.

## Sicherheitshinweise

- **SHA-256** ist kollisionsresistent (praktisch)
- **Git Blob SHA** wird zusätzlich verwendet für Git-Integration
- **Workflow Run ID** ermöglicht Rückverfolgung zum Build-Prozess
- **Runner Environment** identifiziert die Build-Plattform
- **Quellregister und Upstream-Grenzen** (`src/domain/sourceRegistry.mjs`, `scripts/security-guards.mjs`) verhindern, dass der Fetch auf fremde Repositories, externe Hosts, nicht registrierte Pfade oder unzulässige Refs umgelenkt wird. Pfad-Traversal, Symlinks bzw. andere nicht reguläre Tree-Einträge und ein OSCAL-Root-Type-Mismatch führen geschlossen zum Abbruch.
- **Vollständiger Read-only-Tree-Diff** (`scripts/upstream-artifacts.mjs`) klassifiziert Änderungen unter allen überwachten Wurzeln als `added`, `modified` oder `removed`. Neue nicht registrierte Pfade werden als `unclassified` gemeldet, ohne ihren Blob zu laden oder sie auszuliefern. Unvollständige Trees und doppelte bzw. unsichere Pfade werden abgelehnt.
- **Catalog-Sync-Guard** (`scripts/catalog-sync-guard.mjs`) prüft bei Sync-PRs Branch und Titel, einen exakt auf `upstream-manifest.json` begrenzten Diff, das strikte Manifest-v2-Schema für das bisherige und das neue Manifest, Registry-Metadaten, kanonische Dateireihenfolge und Signatur. Der neue BSI-Snapshot muss per GitHub Compare API ausnahmslos `ahead` sein; `scripts/sync-upstream-manifest.mjs` blockiert eine Signaturänderung bei unverändertem Snapshot bereits vor jedem Schreibzugriff. Git-Blob-SHAs und Content-Hashes werden gegen den vollständigen Snapshot gebunden; die Namespace-Inventur muss exakt allen direkten `.csv`-Mitgliedern des registrierten Verzeichnisses entsprechen, während externe oder anderweitig unzulässige `ns`-Referenzen weiterhin blockieren. API- und Netzwerkfehler sowie `identical`, `behind` und `diverged` blockieren.
- **Ruleset-Preflight** (`scripts/catalog-sync-policy.mjs`) prüft vor schreibenden Sync-Aktionen Auto-Merge, Branch-Löschung, erwartete Required Checks, CodeQL und den Audit-Pin der Ruleset-Version. GitHub gibt `bypass_actors` nur mit Ruleset-Schreibzugriff zurück; deshalb attestiert der Agent nach vollständigem Audit die bypass-freie Ruleset-Version über `CATALOG_SYNC_RULESET_UPDATED_AT`. Zusätzlich wird der Ref-Scope geschlossen geprüft: `conditions.ref_name.include` muss `main` über `~DEFAULT_BRANCH`, `~ALL` oder `refs/heads/main` abdecken, `exclude` muss leer sein, und der Default-Branch des Repositories muss `main` sein. fnmatch-Globs gelten bewusst nicht als Nachweis, damit jede Scope-Drift den Preflight blockiert statt still fail-open zu laufen.
- **CodeQL-Abgrenzung**: CodeQL schützt Anwendungscode und Workflows, bewertet aber nicht die fachliche Richtigkeit des BSI-Kataloginhalts. Der BSI-Upstream wird als Datenquelle akzeptiert; Two-Source-Verifikation ist bewusst nicht Bestandteil dieser Automatisierung.

## Siehe auch

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Gesamtarchitektur
- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [FILTERING.md](./FILTERING.md) — Filter-System
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
- `src/domain/integrity.ts` — Integrity-Implementierung
- `src/state/CatalogContext.tsx` — Context-Integration
- `scripts/fetch-catalog.mjs` — Build-Skript
- `.github/workflows/deploy.yml` — Deployment mit SLSA
