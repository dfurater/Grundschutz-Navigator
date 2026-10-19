// Projektion eines Prüfplans. Ergebnis- und Wirksamkeitsaussagen gehören in Assessment Results.
import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type {
  OscalLinkView,
  OscalPropView,
  OscalRootMetadataView,
} from '@/domain/oscalRootDocument';
import type { ResolvedOscalReference } from '@/domain/referenceResolution';
import type { ComponentSourceCatalogBinding } from '@/domain/componentDefinitionModel';
import type { Control, OscalDocumentContext } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';
import type { SystemSecurityPlan } from '@/domain/systemSecurityPlanModel';

export const ASSESSMENT_PLAN_ROOT_TYPE = 'assessment-plan' as const;
export type ApReference =
  | {
      readonly status: 'resolved';
      readonly origin: 'local' | 'ssp';
      readonly path: string;
    }
  | { readonly status: 'not-resolvable-in-context'; readonly reason: string }
  | { readonly status: 'unresolved'; readonly reason: string };
export type ApControlReference =
  | {
      readonly status: 'resolved';
      readonly catalogKey: CatalogKey;
      readonly control: Control;
    }
  | {
      readonly status: 'not-resolvable-in-context';
      readonly reason: 'catalog-not-supplied';
    }
  | {
      readonly status: 'unresolved';
      readonly reason: 'control-not-in-catalog' | 'control-id-missing';
    };
export interface ApElements {
  readonly props: readonly OscalPropView[];
  readonly links: readonly OscalLinkView[];
  readonly remarks?: string;
  readonly path: string;
}
export interface ApEntity extends ApElements {
  readonly uuid?: string;
  readonly title?: string;
  readonly description?: string;
}
export interface ApComponent extends ApEntity {
  readonly type?: string;
  readonly purpose?: string;
  readonly status: { readonly state?: string; readonly remarks?: string } | null;
}
export interface ApUser extends ApEntity {
  readonly shortName?: string;
  readonly roleIds: readonly string[];
}

export interface ApPart extends ApElements {
  readonly uuid?: string;
  readonly id?: string;
  readonly name?: string;
  readonly ns?: string;
  readonly class?: string;
  readonly title?: string;
  readonly prose?: string;
  readonly parts: readonly ApPart[];
}
export interface ApSelectedControl {
  readonly controlId?: string;
  readonly statementIds: readonly string[];
  readonly control: ApControlReference;
  readonly path: string;
}
export interface ApSelectedObjective {
  readonly objectiveId?: string;
  readonly remarks?: string;
  readonly path: string;
}
export interface ApControlSelection extends ApElements {
  readonly description?: string;
  readonly includeAll: boolean;
  readonly includeControls: readonly ApSelectedControl[];
  readonly excludeControls: readonly ApSelectedControl[];
}
export interface ApObjectiveSelection extends ApElements {
  readonly description?: string;
  readonly includeAll: boolean;
  readonly includeObjectives: readonly ApSelectedObjective[];
  readonly excludeObjectives: readonly ApSelectedObjective[];
}
export interface ApReviewedControls extends ApElements {
  readonly description?: string;
  readonly controlSelections: readonly ApControlSelection[];
  readonly controlObjectiveSelections: readonly ApObjectiveSelection[];
}
export interface ApSubjectReference extends ApElements {
  readonly subjectUuid?: string;
  readonly type?: string;
  readonly reference: ApReference;
}
export interface ApSubject extends ApElements {
  readonly type?: string;
  readonly description?: string;
  readonly includeAll: boolean;
  readonly includeSubjects: readonly ApSubjectReference[];
  readonly excludeSubjects: readonly ApSubjectReference[];
}
export interface ApResponsibleRole {
  readonly roleId: string;
  readonly partyUuids: readonly string[];
  readonly remarks?: string;
  readonly reference: ApReference;
}
export interface ApStep extends ApEntity {
  readonly reviewedControls: ApReviewedControls | null;
  readonly responsibleRoles: readonly ApResponsibleRole[];
}
export interface ApActivity extends ApEntity {
  readonly steps: readonly ApStep[];
  readonly relatedControls: ApReviewedControls | null;
  readonly responsibleRoles: readonly ApResponsibleRole[];
}
export interface ApTiming {
  readonly onDate: { readonly date?: string; readonly remarks?: string } | null;
  readonly withinDateRange: {
    readonly start?: string;
    readonly end?: string;
    readonly remarks?: string;
  } | null;
  readonly atFrequency: {
    readonly period?: number;
    readonly unit?: string;
    readonly remarks?: string;
  } | null;
}
export interface ApTask extends ApEntity {
  readonly type?: string;
  readonly timing: ApTiming | null;
  readonly dependencies: readonly {
    readonly taskUuid?: string;
    readonly remarks?: string;
    readonly reference: ApReference;
    readonly path: string;
  }[];
  readonly associatedActivities: readonly (ApElements & {
    readonly activityUuid?: string;
    readonly reference: ApReference;
    readonly subjects: readonly ApSubject[];
    readonly responsibleRoles: readonly ApResponsibleRole[];
  })[];
  readonly subjects: readonly ApSubject[];
  readonly responsibleRoles: readonly ApResponsibleRole[];
  readonly tasks: readonly ApTask[];
}
export interface AssessmentPlan {
  readonly uuid?: string;
  readonly metadata: OscalRootMetadataView;
  readonly importSsp: {
    readonly href: string;
    readonly remarks?: string;
    readonly reference: ResolvedOscalReference;
    readonly ssp: { readonly status: 'bound' | 'not-resolvable-in-context' };
    readonly path: string;
  } | null;
  readonly reviewedControls: ApReviewedControls | null;
  readonly localDefinitions: {
    readonly components: readonly ApComponent[];
    readonly users: readonly ApUser[];
    readonly inventoryItems: readonly ApEntity[];
    readonly activities: readonly ApActivity[];
    readonly objectivesAndMethods: readonly (ApElements & {
      readonly controlId?: string;
      readonly control: ApControlReference;
      readonly description?: string;
      readonly parts: readonly ApPart[];
    })[];
    readonly remarks?: string;
  };
  readonly termsAndConditions: readonly ApPart[];
  readonly assessmentSubjects: readonly ApSubject[];
  readonly assessmentAssets: {
    readonly components: readonly ApComponent[];
    readonly assessmentPlatforms: readonly (ApElements & {
      readonly uuid?: string;
      readonly title?: string;
      readonly usesComponents: readonly (ApElements & {
        readonly componentUuid?: string;
        readonly reference: ApReference;
      })[];
    })[];
  } | null;
  readonly tasks: readonly ApTask[];
  readonly diagnostics: readonly OscalDiagnostic[];
}
export interface AssessmentPlanDeriveOptions {
  /** Explizit gebundenes SSP-Dokument; source stellt die Metadatenidentitäten bereit. */
  readonly ssp?: {
    readonly source: unknown;
    readonly view: SystemSecurityPlan;
    readonly context: OscalDocumentContext;
  };
  readonly catalog?: ComponentSourceCatalogBinding;
}
