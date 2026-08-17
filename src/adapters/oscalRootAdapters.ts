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
  COMPONENT_DEFINITION_ROOT_TYPE,
  deriveComponentDefinition,
} from '@/adapters/oscalComponentAdapter';
import type { ComponentDefinition } from '@/adapters/oscalComponentAdapter';
import { deriveProfile, PROFILE_ROOT_TYPE } from '@/adapters/oscalProfileAdapter';
import type { Profile } from '@/adapters/oscalProfileAdapter';
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
import { getArtifactByUpstreamPath } from '@/domain/sourceRegistry';
import type { CatalogKey } from '@/domain/sourceRegistry';

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
  /**
   * Wirft bei modellinternen Verstößen — etwa fehlender Identität oder
   * ungültiger Struktur. Das Ergebnisobjekt des Dispatch deckt Stufe 2 ab,
   * nicht die Modellinvarianten dahinter.
   */
  readonly derive: (body: unknown, context: OscalDocumentContext) => TView;
}

/**
 * Löst die Katalogidentität nach ADR-1 auf: entweder trägt der Kontext sie,
 * oder das Quellregister leitet sie aus dem Upstream-Pfad ab.
 *
 * Zwei Fälle brechen ab, statt sich auf einen Wert zu einigen:
 *
 * - **Fehlt beides**, wäre ein Rückfall auf den unterstützten Katalog genau
 *   die stille Deutung, die dieser Dispatch beseitigt: Ein gültiger
 *   WLAN-Katalog käme als `gspp` heraus.
 * - **Widersprechen sich beide**, gewönne sonst der Kontext, und ein
 *   registriertes Artefakt wäre unter einer fremden Katalogidentität
 *   adressierbar. Dieselbe Regel gilt bereits für den Root-Typ, den der
 *   Dispatch mit `OSCAL_ROOT_TYPE_MISMATCH` abweist.
 */
function resolveCatalogKey(context: OscalDocumentContext): CatalogKey {
  const entry = context.upstreamPath
    ? getArtifactByUpstreamPath(context.upstreamPath)
    : null;
  const registered = entry?.kind === 'oscal' ? entry.catalogKey : undefined;

  if (context.catalogKey && registered && context.catalogKey !== registered) {
    // Beide Werte stammen aus der geschlossenen `CatalogKey`-Menge und sind
    // kein Dokumentinhalt; sie dürfen benannt werden.
    throw new Error(
      `Conflicting catalog identity: context declares "${context.catalogKey}", the source registry expects "${registered}" (ADR-1)`,
    );
  }

  const catalogKey = context.catalogKey ?? registered;
  if (!catalogKey) {
    throw new Error(
      'Missing catalog identity: parsing a catalog root requires a catalogKey or a registered upstreamPath (ADR-1)',
    );
  }
  return catalogKey;
}

/**
 * Katalogadapter (Control Layer). Der `catalogKey` kommt aus dem Kontext oder
 * dem Quellregister und nie aus dem Dokument (ADR-1).
 */
export const catalogRootAdapter: OscalRootAdapter<Catalog> = Object.freeze({
  rootType: 'catalog',
  moduleEntryPoint: 'src/adapters/oscalAdapter.ts',
  derive: (body: unknown, context: OscalDocumentContext) =>
    parseCatalog(body, { catalogKey: resolveCatalogKey(context) }),
});

/**
 * Component-Definition-Adapter (Implementation Layer). Er braucht keine
 * Identität aus Kontext oder Register: Eine Component Definition trägt ihre
 * `uuid` selbst und ist nicht kataloggescopt (GSPP-248).
 */
export const componentDefinitionRootAdapter: OscalRootAdapter<ComponentDefinition> = Object.freeze({
  rootType: COMPONENT_DEFINITION_ROOT_TYPE,
  moduleEntryPoint: 'src/adapters/oscalComponentAdapter.ts',
  derive: (body: unknown, context: OscalDocumentContext) =>
    deriveComponentDefinition(body, context),
});

/**
 * Profile-Adapter (Control Layer). Wie die Component Definition braucht ein
 * Profil keine Identität aus Kontext oder Register: Es trägt seine `uuid`
 * selbst und ist nicht kataloggescopt. Der `catalogKey` bleibt hier bewusst
 * ungenutzt — ein Profil **wählt** Controls aus importierten Quellen aus, es
 * gehört keiner (GSPP-240).
 */
export const profileRootAdapter: OscalRootAdapter<Profile> = Object.freeze({
  rootType: PROFILE_ROOT_TYPE,
  moduleEntryPoint: 'src/adapters/oscalProfileAdapter.ts',
  derive: (body: unknown, context: OscalDocumentContext) => deriveProfile(body, context),
});

/** Registrierte Modelladapter. Ein neues Modell ergänzt hier genau eine Zeile. */
const OSCAL_ROOT_ADAPTERS: ReadonlyMap<OscalRootKey, OscalRootAdapter> = new Map<
  OscalRootKey,
  OscalRootAdapter
>([
  [catalogRootAdapter.rootType, catalogRootAdapter],
  [componentDefinitionRootAdapter.rootType, componentDefinitionRootAdapter],
  [profileRootAdapter.rootType, profileRootAdapter],
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
