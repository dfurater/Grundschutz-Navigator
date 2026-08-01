// =============================================================================
// OSCAL-Dokumentmodell — verlustfreier Einstieg in den Katalogpfad (ADR-0002)
//
// Der Katalog wurde bisher beim Parsen auf das Domänenmodell reduziert; der
// Quellgraph fiel danach aus dem Scope. Damit ging jedes OSCAL-Feld verloren,
// das `src/domain/models.ts` nicht deklariert — belegbar unter anderem
// `prop.remarks`, `link.resource-fragment`, inhaltsleere back-matter-Ressourcen
// und `metadata.revisions`.
//
// Diese Datei hält beides zusammen: den unveränderten `source` und das daraus
// abgeleitete `view`.
// =============================================================================

import { parseCatalog } from '@/adapters/oscalAdapter';
import type { CatalogDocument, CatalogDocumentContext } from '@/domain/models';

/**
 * Parst ein OSCAL-Katalogdokument verlustfrei nach ADR-0002.
 *
 * `source` bleibt unverändert am Dokument erhalten und wird nicht mutiert (§1).
 * Das Domänenmodell entsteht als Projektion `view = derive(source, context)`
 * (§2); der Kontext wird explizit übergeben und nicht aus dem Dokument geraten.
 *
 * Aufwand und Speicher tragen die Container-Hüllen des Quellgraphen, nicht
 * dessen Textmasse: Das Domänenmodell hält seine Strings per Referenz auf
 * dieselben Quellwerte. Dieses String-Sharing ist der Grund, warum der
 * Zusatzspeicher weit unter der Dateigröße liegt — siehe
 * `scripts/measure-catalog-heap.mjs`.
 *
 * @param source Ergebnis von `JSON.parse` über das OSCAL-Dokument
 * @param context Ableitungskontext: Katalogidentität und Vertrauensklasse
 * @throws Error wenn die Katalogstruktur ungültig ist oder alt-identifier kollidieren
 */
export function parseCatalogDocument(
  source: unknown,
  context: CatalogDocumentContext,
): CatalogDocument {
  return {
    source,
    context,
    view: parseCatalog(source, { catalogKey: context.catalogKey }),
  };
}
