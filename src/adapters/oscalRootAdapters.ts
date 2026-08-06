// =============================================================================
// Adapter-Registrierung je OSCAL-Root-Typ (GSPP-285)
//
// Der Root-Dispatch erkennt alle acht Root-Typen. Verarbeiten kann der
// Navigator davon heute genau einen. Diese Trennung ist bewusst sichtbar: Ein
// bekanntes Modell ohne Adapter ist etwas anderes als ein unbekannter Root und
// bekommt eine eigene Diagnose.
//
// Erweiterung: ein neues Modell ist eine neue Datei mit dem Modelladapter plus
// genau ein Eintrag in `OSCAL_ROOT_ADAPTERS`. Bestehende Adapter bleiben dabei
// unberührt — das ist der Zweck der Registrierung. Ein zentraler
// Universaladapter entsteht ausdrücklich nicht: Geteilt werden Envelope,
// Root-Erkennung, Versionsbindung und Diagnosevertrag, nicht das Parsing.
// =============================================================================

import { parseCatalog } from '@/adapters/oscalAdapter';
import {
  dispatchOscalDocument,
  ROOT_DISPATCH_DIAGNOSTIC_CODES,
  ROOT_DISPATCH_STAGE,
  ROOT_DISPATCH_VALIDATOR,
} from '@/adapters/oscalRootDispatch';
import type {
  OscalRootDispatchFailure,
  OscalRootDispatchSuccess,
} from '@/adapters/oscalRootDispatch';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { Catalog, OscalDocumentContext } from '@/domain/models';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';

/**
 * Ein Modelladapter leitet aus dem erkannten Root-Körper sein Read-Model ab.
 *
 * Er bekommt ausdrücklich nur den Körper und den Kontext — nicht das
 * Gesamtdokument und keine Zuständigkeit für die Root-Bestimmung. Die liegt
 * allein im Dispatch.
 */
export interface OscalRootAdapter<TView = unknown> {
  readonly rootType: OscalRootKey;
  /** Repo-relativer Modul-Einstiegspunkt des Modells — Dokumentationsanker. */
  readonly moduleEntryPoint: string;
  readonly derive: (body: unknown, context: OscalDocumentContext) => TView;
}

/**
 * Katalogadapter (Control Layer). Der `catalogKey` kommt aus dem Kontext und
 * nie aus dem Dokument (ADR-1).
 */
export const catalogRootAdapter: OscalRootAdapter<Catalog> = Object.freeze({
  rootType: 'catalog',
  moduleEntryPoint: 'src/adapters/oscalAdapter.ts',
  derive: (body: unknown, context: OscalDocumentContext) =>
    parseCatalog(body, { catalogKey: context.catalogKey }),
});

/** Registrierte Modelladapter. Ein neues Modell ergänzt hier genau eine Zeile. */
const OSCAL_ROOT_ADAPTERS: ReadonlyMap<OscalRootKey, OscalRootAdapter> = new Map([
  [catalogRootAdapter.rootType, catalogRootAdapter],
]);

export function getOscalRootAdapter(rootType: OscalRootKey): OscalRootAdapter | null {
  return OSCAL_ROOT_ADAPTERS.get(rootType) ?? null;
}

/** Die Root-Typen, für die ein Adapter registriert ist. */
export function listAdaptedOscalRootTypes(): readonly OscalRootKey[] {
  return [...OSCAL_ROOT_ADAPTERS.keys()];
}

export interface OscalDocumentParseSuccess {
  readonly ok: true;
  readonly dispatch: OscalRootDispatchSuccess;
  /**
   * Das Read-Model des zuständigen Adapters. Bewusst `unknown`: Der konkrete
   * Typ gehört dem Modell, nicht der Registry. Typisierte Einstiege — etwa
   * `parseCatalogDocument` — verwenden ihren Adapter direkt.
   */
  readonly view: unknown;
}

export type OscalDocumentParseResult = OscalDocumentParseSuccess | OscalRootDispatchFailure;

/**
 * Root-generischer Einstieg: erkennt den Root, bindet die Version und leitet
 * über den registrierten Adapter ab.
 *
 * Ein bekannter Root ohne Adapter wird mit `OSCAL_ROOT_TYPE_UNSUPPORTED`
 * abgelehnt — unterscheidbar von `OSCAL_ROOT_TYPE_UNKNOWN`.
 */
export function parseOscalDocument(
  source: unknown,
  context: OscalDocumentContext,
): OscalDocumentParseResult {
  const dispatch = dispatchOscalDocument(source, context);
  if (!dispatch.ok) return dispatch;

  const adapter = getOscalRootAdapter(dispatch.rootType);
  if (!adapter) {
    return {
      ok: false,
      diagnostic: createOscalDiagnostic({
        code: ROOT_DISPATCH_DIAGNOSTIC_CODES.ROOT_TYPE_UNSUPPORTED,
        stage: ROOT_DISPATCH_STAGE,
        validator: ROOT_DISPATCH_VALIDATOR,
        path: `/${dispatch.rootType}`,
        artifact: {
          key: dispatch.artifactKey,
          rootType: dispatch.rootType,
          oscalVersion: dispatch.oscalVersion,
        },
      }),
    };
  }

  return { ok: true, dispatch, view: adapter.derive(dispatch.body, context) };
}
