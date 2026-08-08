// =============================================================================
// OSCAL-Dokumentmodell — verlustfreier Einstieg in den Katalogpfad (ADR-2)
//
// Der Katalog wurde bisher beim Parsen auf das Domänenmodell reduziert; der
// Quellgraph fiel danach aus dem Scope. Damit ging jedes OSCAL-Feld verloren,
// das `src/domain/models.ts` nicht deklariert — belegbar unter anderem
// `prop.remarks`, `link.resource-fragment`, inhaltsleere back-matter-Ressourcen
// und `metadata.revisions`.
//
// Diese Datei hält beides zusammen: den unveränderten `source` und das daraus
// abgeleitete `view`. Seit GSPP-285 läuft sie dabei über den generischen
// Root-Dispatch: Dass hier ein Katalog vorliegt, wird geprüft und nicht
// angenommen.
// =============================================================================

import { catalogRootAdapter } from '@/adapters/oscalRootAdapters';
import {
  dispatchOscalDocumentOrThrow,
  OscalRootDispatchError,
  ROOT_DISPATCH_DIAGNOSTIC_CODES,
  ROOT_DISPATCH_STAGE,
  ROOT_DISPATCH_VALIDATOR,
} from '@/adapters/oscalRootDispatch';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { CatalogDocument, CatalogDocumentContext } from '@/domain/models';
import { getCatalogByKey } from '@/domain/sourceRegistry';

/**
 * Parst ein OSCAL-Katalogdokument verlustfrei nach ADR-2.
 *
 * `source` bleibt unverändert am Dokument erhalten und wird nicht mutiert (§1).
 * Das Domänenmodell entsteht als Projektion `view = derive(source, context)`
 * (§2); der Kontext wird explizit übergeben und nicht aus dem Dokument geraten.
 *
 * Der Root-Typ wird über den Dispatch bestimmt (GSPP-285). Der Upstream-Pfad
 * kommt dabei aus dem Quellregister, wenn der Aufrufer keinen setzt — so
 * greifen Root-Abgleich und Artefaktschlüssel auch dann, wenn nur die
 * Katalogidentität bekannt ist.
 *
 * Aufwand und Speicher tragen die Container-Hüllen des Quellgraphen, nicht
 * dessen Textmasse: Das Domänenmodell hält seine Strings per Referenz auf
 * dieselben Quellwerte. Dieses String-Sharing ist der Grund, warum der
 * Zusatzspeicher weit unter der Dateigröße liegt — gemessen in
 * `src/adapters/oscalDocument.heap.node.test.ts`.
 *
 * @param source Ergebnis von `JSON.parse` über das OSCAL-Dokument
 * @param context Ableitungskontext: Katalogidentität und Vertrauensklasse
 * @throws OscalRootDispatchError wenn Root-Erkennung oder Versionsbindung
 *   fehlschlagen
 * @throws Error wenn die Katalogstruktur ungültig ist oder alt-identifier
 *   kollidieren
 */
export function parseCatalogDocument(
  source: unknown,
  context: CatalogDocumentContext,
): CatalogDocument {
  const dispatch = dispatchOscalDocumentOrThrow(source, {
    ...context,
    upstreamPath: context.upstreamPath ?? getCatalogByKey(context.catalogKey)?.upstreamPath,
  });

  // Zweite Schranke neben dem Registry-Abgleich im Dispatch: Der greift nur,
  // wenn der Upstream-Pfad einen registrierten Eintrag trifft. Dieser Einstieg
  // liefert einen `CatalogDocument` und darf deshalb unter keinen Umständen
  // einen fremden Root durchreichen.
  if (dispatch.rootType !== catalogRootAdapter.rootType) {
    throw new OscalRootDispatchError(
      createOscalDiagnostic({
        code: ROOT_DISPATCH_DIAGNOSTIC_CODES.ROOT_TYPE_MISMATCH,
        stage: ROOT_DISPATCH_STAGE,
        validator: ROOT_DISPATCH_VALIDATOR,
        path: '/',
        artifact: {
          key: dispatch.artifactKey,
          rootType: dispatch.rootType,
          oscalVersion: dispatch.oscalVersion,
        },
        params: { expected: catalogRootAdapter.rootType, found: dispatch.rootType },
      }),
    );
  }

  return {
    source,
    context,
    view: catalogRootAdapter.derive(dispatch.body, context),
  };
}
