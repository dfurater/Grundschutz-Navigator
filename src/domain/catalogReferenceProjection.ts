// =============================================================================
// Katalog-View-Projektion für zentrale OSCAL-Control-Referenzen (GSPP-286)
//
// Wird nach dem reinen Adapter-Parsing und vor der Veröffentlichung des
// CatalogDocument im Anwendungskontext ausgeführt. Der Resolver bleibt die
// einzige Stelle, die href-Formen klassifiziert.
// =============================================================================

import type { CatalogDocument } from '@/domain/models';
import {
  referenceDocumentFromCatalog,
  resolveCatalogControlLinks,
} from '@/domain/referenceResolution';

/**
 * Ersetzt die adapterseitige Rohprojektion durch ausschließlich aufgelöste,
 * kataloggescopte Control-Links. Das Dokument ist zu diesem Zeitpunkt noch
 * nicht veröffentlicht; die bestehende View wird deshalb ohne zweite Kopie
 * der Controls ergänzt.
 */
export function projectResolvedControlLinks(
  document: CatalogDocument,
): CatalogDocument {
  const catalog = document.view;
  const linksByControlId = resolveCatalogControlLinks({
    document: referenceDocumentFromCatalog(document),
    catalogsByKey: new Map([[catalog.catalogKey, catalog]]),
  });

  for (const control of catalog.controls) {
    control.links = [...(linksByControlId.get(control.id) ?? [])];
  }

  return document;
}
