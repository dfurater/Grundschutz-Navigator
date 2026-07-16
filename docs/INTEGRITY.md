# Integritätsprüfung — Grundschutz++ Navigator

Beschreibung der SHA-256 Hash-Verifikation und des Provenance-Metadaten-Systems.

## Überblick

Die Anwendung verwendet ein **Integrity-Verification-System**, das:

1. **Zum Build-Zeitpunkt**: SHA-256 Hash der Artefakte berechnet und in Metadaten speichert
2. **Zur Laufzeit**: Hash erneut berechnet und mit dem gespeicherten Wert vergleicht
3. **In der UI**: Prüfungsergebnis anzeigt

Das System prüft, ob die geladenen Artefakte zu den gemeinsam ausgelieferten Integritätsmetadaten passen. Da Artefakt und Metadaten aus demselben Deployment stammen, erkennt die Prüfung Inkonsistenzen zwischen beiden (z.B. beschädigte oder unvollständige Deployments) — sie ist aber kein unabhängiger Herkunftsnachweis. Den liefert die extern bei GitHub gespeicherte Artifact Attestation (siehe [SLSA Provenance](#slsa-provenance)); die Upstream-Authentizität wird zur Fetch-Zeit über Snapshot-Pinning und die Upstream-Allowlist verankert.

## Build-Zeitpunkt (scripts/fetch-catalog.sh → fetch-catalog.mjs)

`scripts/fetch-catalog.sh` ist nur der Einstiegspunkt: Es ruft `scripts/fetch-catalog.mjs` auf und schreibt die von dort gelieferten Artefakte nach `public/data/` — ausschließlich Dateien aus einer festen Allowlist:

- `catalog.json` — der OSCAL-Katalog
- `catalog-metadata.json` — Katalog-Provenance + Integrity
- `vocabularies.json` — offizielle BSI-Vokabulare (aus CSV konvertiert)
- `upstream-sources-metadata.json` — Vokabular-Provenance + Upstream-Manifest

`fetch-catalog.mjs` führt den eigentlichen Abruf durch:

1. **Quelle fest verdrahtet**: Repository und Katalogpfad kommen aus `scripts/security-guards.mjs` (`BSI-Bund/Stand-der-Technik-Bibliothek`, `Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json`). Abweichende Repos, Pfade oder Refs werden abgelehnt.
2. **Snapshot-Pinning**: Ist `BSI_SNAPSHOT_SHA` gesetzt (in CI aus `upstream-manifest.json` gelesen), wird exakt dieser Commit abgerufen statt `main`.
3. **Abruf über die GitHub-API** mit Retry und Backoff bei transienten Fehlern; optional authentifiziert über `GH_TOKEN`/`GITHUB_TOKEN`.
4. **Integritätsdaten**: SHA-256, Dateigröße, Git-Blob-SHA und Commit-Informationen werden je Artefakt erfasst.

### Provenance-Metadaten (catalog-metadata.json)

```json
{
  "source": {
    "repository": "https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek",
    "file": "Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json",
    "commit_sha": "d6153cbb…",
    "commit_date": "2026-07-03T09:37:29Z",
    "git_blob_sha": "b980d97d…",
    "upstream_sha256": "dab255ae…",
    "upstream_size_bytes": 5377756
  },
  "integrity": {
    "sha256": "dab255ae…",
    "size_bytes": 5377756,
    "fetched_at": "2026-07-11T15:42:56.334Z"
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

1. `catalog.json` und `vocabularies.json` werden **parallel** als ArrayBuffer geladen (Startlatenz).
2. Der Katalog wird geparst (`parseCatalog`), das Vokabular-Registry gebaut (`buildVocabularyRegistry`).
3. Für den Katalog wird `catalog-metadata.json` geladen und `verifyArtifactIntegrity` ausgeführt; für die Vokabulare analog `upstream-sources-metadata.json` (siehe [Vocabulary Integrity](#vocabulary-integrity)).
4. Fehlende Metadaten sind kein harter Fehler: Die App läuft weiter, die Verifikation wird übersprungen und eine Warnung geloggt (z.B. lokale Entwicklung ohne `npm run fetch-catalog`).
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
- **Nicht verifizierbar**: neutraler Hinweis (Metadaten fehlen)

Dazu kommen Quell-Repository, Commit-SHA und Abrufzeitpunkt mit Link auf den exakten Upstream-Stand; für die Vokabulare Abrufzeitpunkt, Anzahl der Namespace-Dateien und Snapshot-Commit.

## Vocabulary Integrity

Für das Vokabular-Artefakt `vocabularies.json` ruft der Ladepfad dieselbe Funktion `verifyArtifactIntegrity` auf (die `IntegrityMetadata`-Union deckt beide Provenance-Typen ab). Die zugehörigen Metadaten stehen in `upstream-sources-metadata.json`, das zusätzlich das Upstream-Manifest (Katalog + alle Namespace-Dateien mit Git-Blob-SHAs und einer Manifest-Signatur) sowie Datei-Provenance je Namespace-CSV (SHA-256, Größe, Git-Blob-SHA) enthält.

### Provenance-Metadaten (upstream-sources-metadata.json)

```json
{
  "source": {
    "repository": "https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek",
    "catalogPath": "Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json",
    "snapshotCommitSha": "d6153cbb…",
    "snapshotCommitDate": "2026-07-03T09:37:29Z"
  },
  "manifest": {
    "repository": "https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek",
    "snapshotCommitSha": "d6153cbb…",
    "catalogPath": "Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json",
    "files": [ { "kind": "catalog", "path": "…", "gitBlobSha": "…" } ],
    "signatureSha256": "…"
  },
  "files": [
    {
      "namespace": "https://github.com/…/tree/main/Dokumentation/namespaces/modal_verbs.csv",
      "path": "Dokumentation/namespaces/modal_verbs.csv",
      "fileName": "modal_verbs.csv",
      "routeId": "dokumentation-namespaces-modal-verbs",
      "gitBlobSha": "…",
      "sha256": "…",
      "sizeBytes": 1234
    }
  ],
  "integrity": {
    "sha256": "…",
    "size_bytes": 56789,
    "fetched_at": "2026-07-11T15:42:56.334Z"
  },
  "build": {
    "workflow_run_id": "…",
    "workflow_run_url": "…",
    "runner_environment": "…"
  }
}
```

`integrity.sha256` ist der SHA-256 über das generierte `vocabularies.json`-Artefakt; der Laufzeit-Abgleich (`vocabularyVerification`) funktioniert damit identisch zur Katalog-Prüfung und wird auf `/about` angezeigt. Das `manifest` ist zugleich die Signatur-Basis für den `update-catalog`-Workflow (`scripts/sync-upstream-manifest.mjs` liest `metadata.manifest`). Zusätzlich bleibt die Upstream-Integrität zur Fetch-Zeit verankert: gepinnter Snapshot-Commit, Git-Blob-SHAs und Manifest-Signatur in `upstream-manifest.json`.

## Typen (src/domain/models.ts)

```typescript
interface CatalogProvenance {
  source: {
    repository: string;
    file: string;
    commit_sha: string;
    commit_date?: string;
    git_blob_sha: string;
    upstream_sha256?: string;
    upstream_size_bytes?: number;
  };
  integrity: {
    sha256: string;
    size_bytes: number;
    fetched_at: string;
  };
  build: {
    workflow_run_id: string;
    workflow_run_url: string | null;
    runner_environment: string;
  };
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
  source: {
    repository: string;
    catalogPath: string;
    snapshotCommitSha: string;
    snapshotCommitDate?: string;
  };
  manifest: UpstreamManifest;
  files: VocabularyFileProvenance[];
  integrity: {
    sha256: string;
    size_bytes: number;
    fetched_at: string;
  };
  build: {
    workflow_run_id: string;
    workflow_run_url: string | null;
    runner_environment: string;
  };
}
```

## Ausnahmen

Die Integritätsprüfung kann in folgenden Fällen nicht durchgeführt werden:

1. **Lokale Entwicklung**: Ohne Metadaten-Dateien (wenn `npm run fetch-catalog` nicht ausgeführt wurde)
2. **Abruf-Fehler**: Wenn die Metadaten nicht geladen werden können

In diesen Fällen wird:
- Der Katalog trotzdem verwendet (mit Warnung in der Konsole)
- "Nicht verifizierbar" in der UI angezeigt

## SLSA Provenance

Zusätzlich zur internen Integritätsprüfung generiert `.github/workflows/deploy.yml` Build-Provenance über GitHub Artifact Attestations (`actions/attest` mit `subject-path: dist/**`). Die Attestierung wird OIDC-signiert und bei GitHub gespeichert; sie belegt, welcher Workflow-Lauf die deployten Artefakte gebaut hat.

## Sicherheitshinweise

- **SHA-256** ist kollisionsresistent (praktisch)
- **Git Blob SHA** wird zusätzlich verwendet für Git-Integration
- **Workflow Run ID** ermöglicht Rückverfolgung zum Build-Prozess
- **Runner Environment** identifiziert die Build-Plattform
- **Upstream-Allowlist** (`scripts/security-guards.mjs`) verhindert, dass der Fetch auf fremde Repos oder Pfade umgelenkt wird

## Siehe auch

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Gesamtarchitektur
- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [FILTERING.md](./FILTERING.md) — Filter-System
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
- `src/domain/integrity.ts` — Integrity-Implementierung
- `src/state/CatalogContext.tsx` — Context-Integration
- `scripts/fetch-catalog.sh` / `scripts/fetch-catalog.mjs` — Build-Skripte
- `.github/workflows/deploy.yml` — Deployment mit SLSA
