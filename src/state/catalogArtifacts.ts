// =============================================================================
// Auslieferungsvertrag und Ladevorgang je Katalog (GSPP-284)
//
// Trennt das Laden eines einzelnen Katalogartefakts von der Zustandsführung in
// CatalogContext.tsx. Beide Ladewege — der eager geladene Einstiegskatalog und
// jeder bedarfsgerecht nachgeladene Katalog — laufen durch dieselbe Funktion,
// damit Integritätsprüfung und Vertrauensklasse nicht auseinanderlaufen können.
// =============================================================================

import type {
  CatalogDocument,
  CatalogProvenance,
  VerificationResult,
} from '@/domain/models';
import { parseCatalogDocument } from '@/adapters/oscalDocument';
import { projectResolvedControlLinks } from '@/domain/catalogReferenceProjection';
import {
  SUPPORTED_CATALOGS,
  catalogDataFileName,
  catalogMetadataFileName,
  type CatalogKey,
} from '@/domain/sourceRegistry';
import {
  fetchCatalogWithBuffer,
  fetchProvenance,
  verifyArtifactIntegrity,
} from '@/domain/integrity';

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
): Promise<LoadedCatalogArtifacts | null> {
  const { buffer, text } = await fetchCatalogWithBuffer(descriptor.dataUrl);
  if (isCancelled()) return null;

  let provenance: CatalogProvenance | null = null;
  let verification: VerificationResult | null = null;

  try {
    provenance = await fetchProvenance(descriptor.metadataUrl);
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

  const catalogDocument = projectResolvedControlLinks(
    parseCatalogDocument(JSON.parse(text), {
      catalogKey: descriptor.catalogKey,
      trustClass:
        verification?.valid === true
          ? 'class-1-verified-public'
          : 'class-1-unverified-public',
    }),
  );

  return { catalogDocument, provenance, verification };
}

export function toCatalogErrorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : 'Unbekannter Fehler beim Laden des Katalogs';
}
