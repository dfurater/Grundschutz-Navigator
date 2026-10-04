// =============================================================================
// Auslieferungsvertrag und Ladevorgang je Katalog (GSPP-284)
//
// Trennt das Laden eines einzelnen Katalogartefakts von der Zustandsführung in
// CatalogContext.tsx. Beide Ladewege — der eager geladene Einstiegskatalog und
// jeder bedarfsgerecht nachgeladene Katalog — laufen durch dieselbe Funktion,
// damit Integritätsprüfung und Vertrauensklasse nicht auseinanderlaufen können.
// =============================================================================

import type {
  CatalogDirectoryEntry,
  CatalogDocument,
  CatalogProvenance,
  VerificationResult,
} from '@/domain/models';
import {
  SUPPORTED_CATALOGS,
  catalogDataFileName,
  catalogMetadataFileName,
  type CatalogKey,
} from '@/domain/sourceRegistry';
import {
  fetchCatalogBuffer,
  fetchProvenance,
  verifyArtifactIntegrity,
} from '@/domain/integrity';
import { parseCatalogInWorker } from '@/state/catalogParseWorker';

/**
 * Ein ausgelieferter Katalog mit seinen beiden Artefakt-URLs. Die Dateinamen
 * werden aus dem Quellregister abgeleitet (`catalog.json` für den Einstieg,
 * `catalog-<catalogKey>.json` für jeden weiteren), nie von Hand gepflegt.
 */
export interface SupportedCatalogDescriptor {
  readonly catalogKey: CatalogKey;
  readonly dataUrl: string;
  readonly metadataUrl: string;
  readonly isEntryCatalog: boolean;
}

export function buildSupportedCatalogDescriptors(
  baseUrl: string,
): readonly SupportedCatalogDescriptor[] {
  return SUPPORTED_CATALOGS.map((entry) => ({
    catalogKey: entry.catalogKey,
    dataUrl: `${baseUrl}data/${catalogDataFileName(entry)}`,
    metadataUrl: `${baseUrl}data/${catalogMetadataFileName(entry)}`,
    isEntryCatalog: entry.entryCatalog === true,
  }));
}

export type ProvenanceRequest = (metadataUrl: string, signal?: AbortSignal) => Promise<CatalogProvenance>;

export interface ProvenanceRequests {
  /** Startet immer eine neue Anfrage und führt sie als laufende Anfrage der URL. */
  readonly start: ProvenanceRequest;
  /** Übernimmt die laufende Anfrage der URL, sonst wie `start`. */
  readonly join: ProvenanceRequest;
}

/**
 * Teilt je Metadaten-URL die gerade laufende Anfrage, und zwar nur in eine
 * Richtung: Die Integritätsprüfung fragt ihre Metadaten mit `start` immer
 * zusammen mit ihren Bytes an, das Katalogverzeichnis schließt sich mit `join`
 * an. Übernähme die Prüfung eine früher gestartete Verzeichnisanfrage, prüfte sie
 * nach einem zwischenzeitlichen Deploy neue Bytes gegen alte Metadaten. Ein
 * Ergebnis wird nicht aufbewahrt: Wer nach dem Abschluss anfragt, erhält eine
 * neue Anfrage.
 */
export function createProvenanceRequests(): ProvenanceRequests {
  const pending = new Map<string, Promise<CatalogProvenance>>();
  const start: ProvenanceRequest = (metadataUrl, signal) => {
    const request = fetchProvenance(metadataUrl, signal);
    pending.set(metadataUrl, request);
    const release = () => {
      if (pending.get(metadataUrl) === request) pending.delete(metadataUrl);
    };
    request.then(release, release);
    return request;
  };
  return {
    start,
    join: (metadataUrl) => pending.get(metadataUrl) ?? start(metadataUrl),
  };
}

function ignoreRejection(): void {
  // Die Ablehnung wertet loadCatalogArtifacts selbst aus; endet der Ladevorgang
  // vorher, darf sie nicht als unbehandelt gelten.
}

/** Lädt nur Metadaten; der Callback veröffentlicht jeden Eintrag sofort. */
export async function loadCatalogDirectory(
  descriptors: readonly SupportedCatalogDescriptor[],
  onEntryLoaded?: (entry: CatalogDirectoryEntry) => void,
  requestProvenance: ProvenanceRequest = fetchProvenance,
): Promise<readonly CatalogDirectoryEntry[]> {
  return Promise.all(descriptors.map(async (descriptor) => {
    const entry = await loadCatalogDirectoryEntry(descriptor, requestProvenance);
    onEntryLoaded?.(entry);
    return entry;
  }));
}

async function loadCatalogDirectoryEntry(
  { catalogKey, metadataUrl }: SupportedCatalogDescriptor,
  requestProvenance: ProvenanceRequest,
): Promise<CatalogDirectoryEntry> {
  try {
    const provenance = await requestProvenance(metadataUrl);
    if (typeof provenance?.title === 'string' && provenance.title.length > 0) {
      return { catalogKey, title: provenance.title };
    }
  } catch {
    // Ein fehlender oder nicht lesbarer Sidecar betrifft nur diesen Eintrag.
  }
  console.warn(`Catalog title metadata not available for "${catalogKey}". Using catalog key.`);
  return { catalogKey, title: catalogKey };
}

export interface LoadedCatalogArtifacts {
  catalogDocument: CatalogDocument;
  provenance: CatalogProvenance | null;
  verification: VerificationResult | null;
}

/**
 * Lädt, verifiziert und parst genau einen Katalog gegen **seine eigenen**
 * Metadaten.
 *
 * Bestandssemantik unverändert (docs/INTEGRITY.md): fehlende Metadaten oder ein
 * abweichender Hash stufen die Vertrauensklasse auf `class-1-unverified-public`
 * herab, verwerfen den Katalog aber nicht. Das Dokument wird erst nach der
 * Prüfung gebaut — sonst behauptete es "verifiziert", bevor geprüft wurde, und
 * behielte diese Aussage auch bei fehlenden Metadaten oder abweichendem Hash.
 *
 * Gibt `null` zurück, wenn der Aufrufer den Vorgang zwischenzeitlich abgebrochen
 * hat; der Ladezustand bleibt dann unberührt.
 */
export async function loadCatalogArtifacts(
  descriptor: SupportedCatalogDescriptor,
  isCancelled: () => boolean = () => false,
  requestProvenance: ProvenanceRequest = fetchProvenance,
): Promise<LoadedCatalogArtifacts | null> {
  // Bytes und Metadaten starten gemeinsam; `requestProvenance` muss eine neue
  // Anfrage starten (im Provider `start`), das Verzeichnis darf sie dann teilen.
  // Beide Anfragen bleiben unabhängig: Wechselt die Auslieferung zwischen ihren
  // Antworten, schlägt der Hashvergleich fehl.
  const bufferRequest = fetchCatalogBuffer(descriptor.dataUrl);
  const provenanceController = new AbortController();
  const provenanceRequest = requestProvenance(descriptor.metadataUrl, provenanceController.signal);
  provenanceRequest.catch(ignoreRejection);
  const buffer = await bufferRequest.catch((error: unknown) => {
    provenanceController.abort(error);
    throw error;
  });
  if (isCancelled()) {
    provenanceController.abort();
    return null;
  }

  let provenance: CatalogProvenance | null = null;
  let verification: VerificationResult | null = null;

  try {
    provenance = await provenanceRequest;
    if (!isCancelled()) {
      verification = await verifyArtifactIntegrity(buffer, provenance);
    }
  } catch {
    // Metadata not available (e.g., local dev without running npm run fetch-catalog)
    // The catalog is still usable, just not verified
    console.warn(
      `Catalog provenance metadata not available for "${descriptor.catalogKey}". Integrity verification skipped.`,
    );
  }

  if (isCancelled()) return null;

  const { catalogDocument } = await parseCatalogInWorker(buffer, {
    catalogKey: descriptor.catalogKey,
    trustClass:
      verification?.valid === true
        ? 'class-1-verified-public'
        : 'class-1-unverified-public',
  });

  return { catalogDocument, provenance, verification };
}

export function toCatalogErrorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : 'Unbekannter Fehler beim Laden des Katalogs';
}
