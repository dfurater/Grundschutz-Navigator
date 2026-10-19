// =============================================================================
// Domänenmodell eines OSCAL System Security Plan (GSPP-293)
//
// Die Projektion trägt keine Logik: Abgeleitet wird sie in
// `src/adapters/oscalSspAdapter.ts`, erhalten bleibt der Quellgraph daneben
// (ADR-2). Drei Modellentscheidungen prägen die Typen:
//
//  1. `implementation-status` sitzt an `by-component` — pro Komponente je
//     Anforderung. `SspImplementedRequirement` und `SspStatement` haben
//     deshalb kein Statusfeld, und es gibt keinen Typ für einen
//     zusammengefassten Control-Status.
//  2. Eine `control-id` hat nur im Kontext der Baseline Bedeutung. Liegt keine
//     Baseline-Bindung vor, ist sie „nicht auflösbar im aktuellen Kontext" —
//     ein eigener Zustand, kein Datenfehler.
//  3. Dokumentinterne Referenzen (`component-uuid`, `role-id`, Party-UUIDs)
//     werden aufgelöst und bei fehlendem Ziel diagnostiziert. Referenzen in
//     ein anderes Dokument (`provided-uuid`, `responsibility-uuid`) bleiben
//     „nicht auflösbar im aktuellen Kontext".
//
// Fachliche Abgrenzung: Ein SSP dokumentiert **Implementierungsbehauptungen**
// eines Systemverantwortlichen — keinen geprüften Compliance-, Audit- oder
// Wirksamkeitsstatus. Kein Feld dieses Modells behauptet etwas anderes.
// =============================================================================

import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { ResolvedOscalReference } from '@/domain/referenceResolution';
import type { Catalog, Control } from '@/domain/models';
import type { WorkspaceCatalog, WorkspaceCatalogControl } from '@/domain/workspaceCatalog';
import type { CatalogKey } from '@/domain/sourceRegistry';
import type {
  OscalLinkView,
  OscalPropView,
  OscalResponsibleRoleView,
  OscalRootMetadataView,
  OscalSetParameterView,
} from '@/domain/oscalRootDocument';
import type {
  SspComponent,
  SspSystemCharacteristics,
  SspSystemImplementation,
} from '@/domain/systemSecurityPlanSystemModel';

export type * from '@/domain/systemSecurityPlanSystemModel';

/** Der JSON-Root-Key dieses Modells. Er ist kein Versionsschalter. */
export const SYSTEM_SECURITY_PLAN_ROOT_TYPE = 'system-security-plan' as const;

/**
 * Zustand einer Referenz, deren Ziel dieser Ableitung nicht vorliegt. Er ist
 * kein Datenfehler und erzeugt keine Diagnose.
 */
export const NOT_RESOLVABLE_IN_CONTEXT = 'not-resolvable-in-context' as const;

/**
 * Die gemeinsamen Elementprojektionen, wie sie auch die übrigen Modelle führen.
 * `props` enthält nur Einträge im OSCAL-Namespace (`ns` fehlt oder ist exakt
 * `OSCAL_NAMESPACE` aus `mappingModel.ts`); jedes andere `prop` bleibt im
 * Quellgraphen.
 */
export interface SspElements {
  readonly props: readonly OscalPropView[];
  readonly links: readonly OscalLinkView[];
}

/** Ein `status` oder `implementation-status`: `state` ist ein offenes Token. */
export interface SspState {
  readonly state: string;
  readonly remarks?: string;
}

/* ------------------------------------------------------------------ */
/*  Baseline und Control-Bezug                                         */
/* ------------------------------------------------------------------ */

/** Explizit übergebener Baseline-Katalog — eine Aussage des Aufrufers. */
export type SspBaselineBinding =
  | { readonly catalogKey: CatalogKey; readonly catalog: Catalog }
  | { readonly kind: 'transient'; readonly catalog: WorkspaceCatalog };

export type SspBaselineState =
  | { readonly status: 'bound'; readonly catalogKey: CatalogKey }
  | { readonly status: 'bound'; readonly kind: 'transient' }
  | { readonly status: typeof NOT_RESOLVABLE_IN_CONTEXT };

export interface SspImportProfile {
  /** Der unveränderte `href` — Profile im Regelfall, Katalog zulässig. */
  readonly href: string;
  /** Klassifikation des `href` durch die Referenzschicht; es wird nichts geladen. */
  readonly reference: ResolvedOscalReference;
  /** Ob die Baseline für die Control-Auflösung gebunden ist. */
  readonly baseline: SspBaselineState;
  readonly remarks?: string;
  readonly path: string;
}

export type SspControlReference =
  | { readonly status: 'resolved'; readonly kind: 'transient'; readonly control: WorkspaceCatalogControl }
  | {
    readonly status: 'resolved';
    readonly catalogKey: CatalogKey;
    readonly control: Control;
  }
  | {
    readonly status: typeof NOT_RESOLVABLE_IN_CONTEXT;
    /** Es wurde keine Baseline-Bindung übergeben; nichts wird geraten. */
    readonly reason: 'catalog-not-supplied';
  }
  | {
    readonly status: 'unresolved';
    readonly reason: 'control-id-missing' | 'control-not-in-catalog';
    readonly diagnostic: OscalDiagnostic;
  };

/* ------------------------------------------------------------------ */
/*  Dokumentinterne Referenzen                                         */
/* ------------------------------------------------------------------ */

export type SspComponentReference =
  | { readonly status: 'resolved'; readonly component: SspComponent }
  | {
    readonly status: 'unresolved';
    /**
     * `component-not-found`: keine Komponente trägt die UUID.
     * `component-ambiguous`: mehrere Komponenten tragen sie (Indexverletzung).
     * `component-uuid-missing`: der Eintrag nennt keine UUID.
     */
    readonly reason: 'component-not-found' | 'component-ambiguous' | 'component-uuid-missing';
    readonly diagnostic: OscalDiagnostic;
  };

/** Eine UUID, die in das `export` eines anderen SSP zeigt. */
export interface SspExternalUuidReference {
  readonly uuid: string;
  readonly status: typeof NOT_RESOLVABLE_IN_CONTEXT;
}

/* ------------------------------------------------------------------ */
/*  control-implementation                                             */
/* ------------------------------------------------------------------ */

export interface SspProvided extends SspElements {
  readonly uuid?: string;
  readonly description?: string;
  readonly responsibleRoles: readonly OscalResponsibleRoleView[];
  readonly remarks?: string;
  readonly path: string;
}

export interface SspResponsibility extends SspProvided {
  /** Verweist auf ein `provided` desselben `export`; es wird nicht aufgelöst. */
  readonly providedUuid?: string;
}

export interface SspExport extends SspElements {
  readonly description?: string;
  readonly provided: readonly SspProvided[];
  readonly responsibilities: readonly SspResponsibility[];
  readonly remarks?: string;
}

export interface SspInherited extends SspElements {
  readonly uuid?: string;
  readonly description?: string;
  /** Das `provided` des geleasten Systems; `null`, wenn das Feld fehlt. */
  readonly provided: SspExternalUuidReference | null;
  readonly responsibleRoles: readonly OscalResponsibleRoleView[];
  readonly path: string;
}

export interface SspSatisfied extends SspElements {
  readonly uuid?: string;
  readonly description?: string;
  /** Die `responsibility` des geleasten Systems; `null`, wenn das Feld fehlt. */
  readonly responsibility: SspExternalUuidReference | null;
  readonly responsibleRoles: readonly OscalResponsibleRoleView[];
  readonly remarks?: string;
  readonly path: string;
}

/** Wie eine Komponente eine Anforderung oder ein Statement umsetzt. */
export interface SspByComponent extends SspElements {
  readonly uuid?: string;
  readonly componentUuid?: string;
  readonly component: SspComponentReference;
  readonly description?: string;
  /** Der Umsetzungsstatus dieser Komponente für diese Anforderung. */
  readonly implementationStatus: SspState | null;
  readonly export: SspExport | null;
  readonly inherited: readonly SspInherited[];
  readonly satisfied: readonly SspSatisfied[];
  readonly setParameters: readonly OscalSetParameterView[];
  readonly responsibleRoles: readonly OscalResponsibleRoleView[];
  readonly remarks?: string;
  readonly path: string;
}

export interface SspStatement extends SspElements {
  readonly uuid?: string;
  /** Gelesener Wert; die Auflösung gegen das Control erfolgt nicht. */
  readonly statementId?: string;
  readonly byComponents: readonly SspByComponent[];
  readonly responsibleRoles: readonly OscalResponsibleRoleView[];
  readonly remarks?: string;
  readonly path: string;
}

export interface SspImplementedRequirement extends SspElements {
  readonly uuid?: string;
  readonly controlId?: string;
  readonly control: SspControlReference;
  readonly setParameters: readonly OscalSetParameterView[];
  readonly responsibleRoles: readonly OscalResponsibleRoleView[];
  readonly statements: readonly SspStatement[];
  readonly byComponents: readonly SspByComponent[];
  readonly remarks?: string;
  readonly path: string;
}

export interface SspControlImplementation {
  readonly description?: string;
  readonly setParameters: readonly OscalSetParameterView[];
  readonly implementedRequirements: readonly SspImplementedRequirement[];
  readonly path: string;
}

/* ------------------------------------------------------------------ */
/*  Root                                                               */
/* ------------------------------------------------------------------ */

export interface SystemSecurityPlan {
  readonly uuid?: string;
  readonly metadata: OscalRootMetadataView;
  /** `null`, wenn der Pflichtknoten fehlt oder kein Objekt ist (Diagnose). */
  readonly importProfile: SspImportProfile | null;
  readonly systemCharacteristics: SspSystemCharacteristics | null;
  readonly systemImplementation: SspSystemImplementation | null;
  readonly controlImplementation: SspControlImplementation | null;
  /** Modellinterne Befunde. Sie verwerfen das Dokument nie (ADR-2, ADR-7). */
  readonly diagnostics: readonly OscalDiagnostic[];
}

export interface SystemSecurityPlanDeriveOptions {
  /**
   * Ohne diese Bindung bleibt jede `control-id` „nicht auflösbar im aktuellen
   * Kontext". Welcher Katalog hinter `import-profile` steht, ist eine Aussage
   * des Aufrufers und nichts, was der Adapter aus einem `href` erraten dürfte.
   */
  readonly baseline?: SspBaselineBinding;
}
