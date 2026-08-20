// =============================================================================
// Domänenmodell einer OSCAL Component Definition (GSPP-248)
//
// Die Projektion des Implementation Layers. Sie trägt bewusst **keine** Logik:
// Abgeleitet wird sie in `src/adapters/oscalComponentAdapter.ts`, erhalten
// bleibt der Quellgraph daneben (ADR-2).
//
// Zwei Modellentscheidungen prägen die Typen:
//
//  1. `control-implementation.source` hängt an **jeder** Implementierung, nicht
//     am Dokument. Ein Dokument kann mehrere Quellen führen — im Bestand tut
//     das `component-netzarchitektur` mit zwei `#uuid`-Quellen.
//  2. `implemented-requirement.control-id` ist eine Control-ID **im Kontext
//     ihrer** `source`. Deshalb gibt es keinen Typ, der eine aufgelöste
//     Control ohne Quellkontext ausdrücken könnte.
//
// Fachliche Abgrenzung: Eine `implemented-requirement` dokumentiert eine
// **Implementierungsbehauptung** — keinen geprüften Compliance-, Audit- oder
// Zertifizierungsstatus. Kein Feld dieses Modells behauptet etwas anderes.
// =============================================================================

import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { ResolvedOscalReference } from '@/domain/referenceResolution';
import type { Catalog, Control } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';

/** Der JSON-Root-Key dieses Modells. Er ist kein Versionsschalter. */
export const COMPONENT_DEFINITION_ROOT_TYPE = 'component-definition' as const;

/* ------------------------------------------------------------------ */
/*  View-Typen                                                         */
/* ------------------------------------------------------------------ */

export interface ComponentDefinitionMetadata {
  readonly title?: string;
  readonly lastModified?: string;
  readonly version?: string;
  /** Die deklarierte `oscal-version` — die alleinige Versionsautorität. */
  readonly oscalVersion?: string;
}

export interface ComponentProp {
  readonly name: string;
  readonly value: string;
  readonly ns?: string;
  readonly class?: string;
}

export interface ComponentLink {
  readonly href: string;
  readonly rel?: string;
  readonly mediaType?: string;
  readonly resourceFragment?: string;
  readonly text?: string;
}

export interface ComponentSetParameter {
  readonly paramId: string;
  readonly values: readonly string[];
  readonly remarks?: string;
}

export interface ComponentResponsibleRole {
  readonly roleId: string;
  readonly partyUuids: readonly string[];
  readonly remarks?: string;
}

export interface ComponentIncorporatedComponent {
  readonly componentUuid: string;
  readonly description?: string;
}

export interface ComponentImplementedStatement {
  readonly statementId?: string;
  readonly uuid?: string;
  readonly description?: string;
  readonly responsibleRoles: readonly ComponentResponsibleRole[];
  readonly props: readonly ComponentProp[];
  readonly links: readonly ComponentLink[];
  readonly remarks?: string;
}

/**
 * Der Referenzkontext einer Control-Implementation: der unveränderte
 * `source`-Wert plus seine Klassifikation aus der Referenzschicht. Beides
 * gehört zusammen — der rohe Wert allein wäre nicht aussagekräftig, die
 * Klassifikation allein nicht rückführbar.
 */
export interface ComponentImplementationSource {
  readonly href: string;
  readonly reference: ResolvedOscalReference;
}

export type ComponentControlReferenceReason =
  /** Die tragende `control-implementation` hat keine `source`. */
  | 'implementation-source-missing'
  /** Die `implemented-requirement` hat keine `control-id`. */
  | 'control-id-missing'
  /** Zur `source` wurde kein Zielkatalog übergeben; nichts wird geraten. */
  | 'catalog-not-supplied'
  /** Der Zielkatalog liegt vor, kennt die `control-id` aber nicht. */
  | 'control-not-in-catalog';

export type ComponentControlReference =
  | {
    readonly status: 'resolved';
    readonly catalogKey: CatalogKey;
    readonly control: Control;
  }
  | {
    readonly status: 'unresolved';
    readonly reason: ComponentControlReferenceReason;
    readonly diagnostic: OscalDiagnostic;
  };

export interface ComponentImplementedRequirement {
  readonly uuid?: string;
  readonly controlId?: string;
  readonly description?: string;
  /** Die `source` der tragenden Implementierung; `null`, wenn sie fehlt. */
  readonly source: ComponentImplementationSource | null;
  /** Auflösungsstand der `control-id` — nie ohne `source` interpretiert. */
  readonly control: ComponentControlReference;
  readonly setParameters: readonly ComponentSetParameter[];
  readonly responsibleRoles: readonly ComponentResponsibleRole[];
  readonly statements: readonly ComponentImplementedStatement[];
  readonly props: readonly ComponentProp[];
  readonly links: readonly ComponentLink[];
  readonly remarks?: string;
  /** Struktureller JSON Pointer auf den Quellknoten. */
  readonly path: string;
}

export interface ComponentControlImplementation {
  readonly uuid?: string;
  readonly source: ComponentImplementationSource | null;
  readonly description?: string;
  readonly setParameters: readonly ComponentSetParameter[];
  readonly implementedRequirements: readonly ComponentImplementedRequirement[];
  readonly props: readonly ComponentProp[];
  readonly links: readonly ComponentLink[];
  readonly path: string;
}

export interface DefinedComponent {
  readonly uuid?: string;
  readonly type?: string;
  readonly title?: string;
  readonly description?: string;
  readonly purpose?: string;
  readonly responsibleRoles: readonly ComponentResponsibleRole[];
  readonly controlImplementations: readonly ComponentControlImplementation[];
  readonly props: readonly ComponentProp[];
  readonly links: readonly ComponentLink[];
  readonly remarks?: string;
  readonly path: string;
}

export interface ComponentCapability {
  readonly uuid?: string;
  readonly name?: string;
  readonly description?: string;
  readonly incorporatesComponents: readonly ComponentIncorporatedComponent[];
  readonly controlImplementations: readonly ComponentControlImplementation[];
  readonly props: readonly ComponentProp[];
  readonly links: readonly ComponentLink[];
  readonly remarks?: string;
  readonly path: string;
}

export interface ComponentDefinitionImport {
  readonly href: string;
  readonly reference: ResolvedOscalReference;
  readonly remarks?: string;
  readonly path: string;
}

export interface ComponentDefinition {
  readonly uuid?: string;
  readonly metadata: ComponentDefinitionMetadata;
  readonly importComponentDefinitions: readonly ComponentDefinitionImport[];
  readonly components: readonly DefinedComponent[];
  readonly capabilities: readonly ComponentCapability[];
  /** Implementierungen aus Components **und** Capabilities, in Quellreihenfolge. */
  readonly controlImplementations: readonly ComponentControlImplementation[];
  /** Alle implemented requirements des Dokuments, in Quellreihenfolge. */
  readonly implementedRequirements: readonly ComponentImplementedRequirement[];
  /**
   * Implementierungen getrennt nach ihrem unveränderten `source`-Wert. Ein
   * Dokument mit zwei Quellen hat hier zwei Einträge — die Definition wird
   * nicht auf eine Quelle reduziert.
   */
  readonly implementationsBySource: ReadonlyMap<string, readonly ComponentControlImplementation[]>;
  /** Modellinterne Befunde. Sie verwerfen das Dokument nie (ADR-2, ADR-7). */
  readonly diagnostics: readonly OscalDiagnostic[];
}

/** Explizit übergebene Zielkataloge, adressiert mit dem unveränderten `source`. */
export interface ComponentSourceCatalogBinding {
  readonly catalogKey: CatalogKey;
  readonly catalog: Catalog;
}

export interface ComponentDefinitionDeriveOptions {
  /**
   * Ohne diese Bindung bleibt jede `control-id` unaufgelöst. Das ist Absicht:
   * Welcher Katalog hinter einer `source` steht, ist eine Aussage des
   * Aufrufers und nichts, was der Adapter aus einem `href` erraten dürfte.
   */
  readonly catalogsBySource?: ReadonlyMap<string, ComponentSourceCatalogBinding>;
}
