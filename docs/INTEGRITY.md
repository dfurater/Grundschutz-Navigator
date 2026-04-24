# Integritätsprüfung — Grundschutz++ Navigator

Beschreibung des SHA-256 Hash-Verifikation und Provenance-Metadaten-Systems.

## Überblick

Die Anwendung verwendet ein **Integrity-Verification-System**, das:

1. **Zum Build-Zeitpunkt**: SHA-256 Hash des Katalogs berechnen und in Metadaten speichern
2. **Zur Laufzeit**: Hash erneut berechnen und mit gespeicherten Wert vergleichen
3. **In der UI**: Prüfungsergebnis anzeigen

Das System stellt sicher, dass der geladene Katalog dem ursprünglich abgerufenen Katalog entspricht und nicht manipuliert wurde.

## Build-Zeitpunkt (scripts/fetch-catalog.sh)

Beim Abrufen des Katalogs werden folgende Schritte ausgeführt:

### 1. Katalog-Abruf

```bash
#!/bin/bash
# fetch-catalog.sh

BSI_REPO="${BSI_REPO:-bsi-fuer_it_sicherheit/Grundschutz}"
CATALOG_PATH="${CATALOG_PATH:-oscal/convert json/documentation-NIST}"

# Clone BSI repository
gh repo clone "$BSI_REPO" /tmp/bsi-repo -- --depth=1

# Copy catalog to public/data/
cp "/tmp/bsi-repo/$CATALOG_PATH" public/data/catalog.json
```

### 2. SHA-256 Berechnung

```bash
# Compute SHA-256 hash
CHECKSUM=$(sha256sum public/data/catalog.json | cut -d' ' -f1)

# Get file size
SIZE=$(stat -f%z public/data/catalog.json)

# Get git blob SHA
BLOB_SHA=$(git hash-object public/data/catalog.json)
```

### 3. Provenance-Metadaten generieren

Die Metadaten werden in `catalog-metadata.json` geschrieben:

```json
{
  "source": {
    "repository": "bsi-fuer_it_sicherheit/Grundschutz",
    "file": "oscal/convert json/documentation-NIST",
    "commit_sha": "abc123...",
    "commit_date": "2024-01-15T10:30:00Z",
    "git_blob_sha": "def456..."
  },
  "integrity": {
    "sha256": "abc123def456...",
    "size_bytes": 1234567,
    "fetched_at": "2024-01-15T10:35:00Z"
  },
  "build": {
    "workflow_run_id": "1234567890",
    "workflow_run_url": "https://github.com/...",
    "runner_environment": "Linux"
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

### Catalog Integrity Verifikation

```typescript
export async function verifyCatalogIntegrity(
  catalogBuffer: ArrayBuffer,
  metadata: CatalogProvenance,
): Promise<VerificationResult> {
  return verifyArtifactIntegrity(catalogBuffer, metadata);
}

export async function verifyArtifactIntegrity(
  artifactBuffer: ArrayBuffer,
  metadata: CatalogProvenance,
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

### Provenance Abruf

```typescript
export async function fetchProvenance(
  metadataUrl: string,
): Promise<CatalogProvenance> {
  const response = await fetch(metadataUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to load catalog metadata: ${response.status} ${response.statusText}`,
    );
  }
  return response.json();
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

In `src/state/CatalogContext.tsx` wird beides kombiniert:

```typescript
useEffect(() => {
  async function loadCatalog() {
    dispatch({ type: 'LOAD_START' });

    try {
      // 1. Fetch catalog (as ArrayBuffer for integrity check + text for parsing)
      const { buffer, text } = await fetchCatalogWithBuffer(catalogUrl);

      // 2. Parse OSCAL JSON into domain model
      const rawJson = JSON.parse(text);
      const catalog = parseCatalog(rawJson);

      // 3. Try to fetch provenance metadata and verify integrity
      let provenance: CatalogProvenance | null = null;
      let verification: VerificationResult | null = null;

      try {
        provenance = await fetchProvenance(metadataUrl);
        if (!cancelled) {
          verification = await verifyCatalogIntegrity(buffer, provenance);
        }
      } catch {
        console.warn(
          'Catalog provenance metadata not available. Integrity verification skipped.',
        );
      }

      dispatch({
        type: 'LOAD_SUCCESS',
        catalog,
        provenance,
        verification,
        // vocabulary data...
      });
    } catch (err) {
      dispatch({
        type: 'LOAD_ERROR',
        error: err instanceof Error
          ? err.message
          : 'Unbekannter Fehler beim Laden des Katalogs',
      });
    }
  }

  loadCatalog();
}, [catalogUrl, metadataUrl/* ... */]);
```

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

Das Prüfungsergebnis wird in der UI angezeigt (z.B. in der Footer oder Status-Komponente):

- **Gültig**: Grün/Symbol "Verifiziert"
- **Ungültig**: Rot/Warnung mit Details
- **Ausstehend**: Blau "Prüfe..."
- **Fehler**: Grau "Nicht verifizierbar"

Beispiel:

```
Integrität: ✓ Verifiziert (SHA-256)
Quelle: bsi-fuer_it_sicherheit/Grundschutz @ abc123def
Abgerufen: 15.01.2024, 10:35 UTC
```

## Vocabulary Integrity

Das gleiche System gilt für Vocabulary-Dateien:

```typescript
export async function verifyArtifactIntegrity(
  artifactBuffer: ArrayBuffer,
  metadata: VocabularyProvenance,
): Promise<VerificationResult> {
  // Same logic as CatalogProvenance
}
```

Metadaten werden in `vocabularies-metadata.json` und `upstream-sources-metadata.json` gespeichert.

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

interface VocabularyProvenance {
  source: UpstreamManifest;
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

1. **Lokale Entwicklung**: Ohne `catalog-metadata.json` (wenn `fetch-catalog.sh` nicht ausgeführt wurde)
2. **API-Fehler**: Wenn die Metadaten nicht geladen werden können
3. **Alte Versionen**: Wenn die Katalogversion aktualisiert wurde

In diesen Fällen wird:
- Der Katalog trotzdem verwendet (mit Warnung)
- "Nicht verifizierbar" in der UI angezeigt

## SLSA Provenance

Zusätzlich zur internen Integritätsprüfung wird SLSA (Supply chain Levels for Software Artifacts) Provenance generiert (in `.github/workflows/deploy.yml`):

- **Build Level**: 3 (nicht replaybar)
- **Provenancen**: Signiert mit OIDC
- **Attestation**: In `attestation.json` gespeichert

Siehe `.github/workflows/deploy.yml` für die SLSA-Konfiguration.

## Sicherheitshinweise

- **SHA-256** ist kollisionsresistent (praktisch)
- **Git Blob SHA** wird zusätzlich verwendet für Git-Integration
- **Workflow Run ID** ermöglicht Rückverfolgung zum Build-Prozess
- **Runner Environment** identifiziert die Build-Plattform

## Siehe auch

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Gesamtarchitektur
- [DOMAIN_MODELS.md](./DOMAIN_MODELS.md) — Domänenmodelle
- [FILTERING.md](./FILTERING.md) — Filter-System
- [VOCABULARY.md](./VOCABULARY.md) — Vokabular-System
- `src/domain/integrity.ts` — Integrity-Implementierung
- `src/state/CatalogContext.tsx` — Context-Integration
- `scripts/fetch-catalog.sh` — Build-Skript
- `.github/workflows/deploy.yml` — Deployment mit SLSA