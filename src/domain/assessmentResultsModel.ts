// Projektion von Prüfergebnissen. Gültigkeit der Beobachtungen stammt ausschließlich aus dem Evidenz-Read-Model.
import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { OscalRootMetadataView } from '@/domain/oscalRootDocument';
import type { ResolvedOscalReference } from '@/domain/referenceResolution';
import type {
  ApComponent,
  ApControlReference,
  ApElements,
  ApEntity,
  ApPart,
  ApReviewedControls,
  ApTask,
  ApUser,
  AssessmentPlan,
  AssessmentPlanDeriveOptions,
} from '@/domain/assessmentPlanModel';
import type {
  EvidenceObservation,
  EvidenceReadModel,
  UuidReference,
} from '@/domain/evidenceReadModel';
import type { OscalDocumentContext } from '@/domain/models';

export const ASSESSMENT_RESULTS_ROOT_TYPE = 'assessment-results' as const;

/** `assessment-plan`: Ziel liegt im explizit gebundenen Assessment Plan. */
export type ArReference =
  | {
      readonly status: 'resolved';
      readonly origin: 'local' | 'assessment-plan' | 'ssp';
      readonly path: string;
    }
  | { readonly status: 'not-resolvable-in-context'; readonly reason: string }
  | { readonly status: 'unresolved'; readonly reason: string };

export interface ArOriginActor extends ApElements {
  readonly type?: string;
  readonly actorUuid?: string;
  readonly roleId?: string;
  readonly reference: ArReference;
}
export interface ArRelatedTask extends ApElements {
  readonly taskUuid?: string;
  readonly reference: ArReference;
}
export interface ArOrigin {
  readonly path: string;
  readonly actors: readonly ArOriginActor[];
  readonly relatedTasks: readonly ArRelatedTask[];
}
export interface ArSubjectReference extends ApElements {
  readonly subjectUuid?: string;
  readonly type?: string;
  readonly title?: string;
  /** Auflösung im lokalen Bereich des eigenen `result`, danach Assessment Plan und SSP. */
  readonly reference: ArReference;
}
export interface AssessmentObservation extends ApEntity {
  readonly origins: readonly ArOrigin[];
  readonly subjects: readonly ArSubjectReference[];
  /** Methoden, Typen, Evidenz und Gültigkeit aus `deriveEvidenceReadModel()`. */
  readonly evidence: EvidenceObservation | null;
}
export interface ArRelatedObservation {
  readonly observationUuid?: string;
  readonly remarks?: string;
  readonly path: string;
  /** Zustand aus `EvidenceReadModel.observationReferences`. */
  readonly reference: UuidReference | null;
}
export interface AssessmentFinding extends ApEntity {
  readonly origins: readonly ArOrigin[];
  readonly target: (ApElements & {
    readonly type?: string;
    readonly targetId?: string;
    readonly title?: string;
    readonly description?: string;
    readonly status: { readonly state?: string; readonly reason?: string } | null;
    readonly implementationStatus: { readonly state?: string; readonly remarks?: string } | null;
  }) | null;
  readonly implementationStatementUuid?: string;
  /** `null` ohne `implementation-statement-uuid`; löst nur gegen ein gebundenes SSP auf. */
  readonly implementationStatement: ArReference | null;
  readonly relatedObservations: readonly ArRelatedObservation[];
  readonly relatedRisks: readonly {
    readonly riskUuid?: string;
    readonly remarks?: string;
    readonly path: string;
    readonly reference: ArReference;
  }[];
  /** `false`: das Finding trägt weder `related-observations` noch `related-risks`. */
  readonly hasLinkedEvidence: boolean;
}
export interface AssessmentRemediation extends ApEntity {
  readonly lifecycle?: string;
  readonly origins: readonly ArOrigin[];
  readonly requiredAssets: readonly (ApEntity & { readonly subjects: readonly ArSubjectReference[] })[];
  readonly tasks: readonly ApTask[];
}
export interface AssessmentRisk extends ApEntity {
  readonly statement?: string;
  readonly status?: string;
  readonly origins: readonly ArOrigin[];
  /** `href` bleibt ein ungeladener String. */
  readonly threatIds: readonly { readonly system?: string; readonly id?: string; readonly href?: string; readonly path: string }[];
  readonly characterizations: readonly (ApElements & {
    readonly origin: ArOrigin | null;
    readonly facets: readonly (ApElements & {
      readonly name?: string;
      readonly system?: string;
      readonly value?: string;
    })[];
  })[];
  readonly mitigatingFactors: readonly (ApEntity & {
    readonly implementationUuid?: string;
    readonly subjects: readonly ArSubjectReference[];
  })[];
  readonly deadline?: string;
  readonly remediations: readonly AssessmentRemediation[];
  readonly riskLog: readonly (ApEntity & {
    readonly start?: string;
    readonly end?: string;
    readonly statusChange?: string;
    readonly relatedResponses: readonly {
      readonly responseUuid?: string;
      readonly path: string;
      readonly reference: ArReference;
    }[];
  })[];
  readonly relatedObservations: readonly ArRelatedObservation[];
}
export interface AssessmentResult extends ApEntity {
  readonly start?: string;
  readonly end?: string;
  readonly localDefinitions: {
    readonly components: readonly ApComponent[];
    readonly inventoryItems: readonly ApEntity[];
    readonly users: readonly ApUser[];
    readonly assessmentAssets: AssessmentPlan['assessmentAssets'];
    readonly tasks: readonly ApTask[];
  };
  readonly reviewedControls: ApReviewedControls | null;
  readonly attestations: readonly {
    readonly path: string;
    readonly responsibleParties: readonly {
      readonly roleId?: string;
      readonly partyUuids: readonly string[];
      readonly path: string;
    }[];
    readonly parts: readonly ApPart[];
  }[];
  readonly assessmentLog: readonly (ApEntity & {
    readonly start?: string;
    readonly end?: string;
    readonly loggedBy: readonly {
      readonly partyUuid?: string;
      readonly roleId?: string;
      readonly remarks?: string;
      readonly path: string;
      readonly party: ArReference;
      readonly role: ArReference | null;
    }[];
    readonly relatedTasks: readonly ArRelatedTask[];
  })[];
  readonly observations: readonly AssessmentObservation[];
  readonly risks: readonly AssessmentRisk[];
  readonly findings: readonly AssessmentFinding[];
}
export interface AssessmentResults {
  readonly uuid?: string;
  readonly metadata: OscalRootMetadataView;
  readonly importAp: {
    readonly href: string;
    readonly remarks?: string;
    readonly path: string;
    readonly reference: ResolvedOscalReference;
    readonly status: 'bound' | 'not-resolvable-in-context';
  } | null;
  readonly localDefinitions: {
    readonly objectivesAndMethods: readonly (ApElements & {
      readonly controlId?: string;
      readonly control: ApControlReference;
      readonly description?: string;
      readonly parts: readonly ApPart[];
    })[];
    readonly activities: AssessmentPlan['localDefinitions']['activities'];
    readonly remarks?: string;
  };
  readonly results: readonly AssessmentResult[];
  /** Vollständiges Evidenz-Read-Model desselben Quellgraphs; Nutzlasten werden nicht gelesen. */
  readonly evidence: EvidenceReadModel;
  readonly diagnostics: readonly OscalDiagnostic[];
}
export interface AssessmentResultsDeriveOptions extends AssessmentPlanDeriveOptions {
  /** Explizit gebundener Assessment Plan; der Aufrufer ordnet ihn `import-ap` zu. */
  readonly assessmentPlan?: {
    readonly source: unknown;
    readonly view: AssessmentPlan;
    readonly context: OscalDocumentContext;
  };
  /** Bewertungszeitpunkt der Evidenzgültigkeit; ohne Angabe der Ableitungszeitpunkt. */
  readonly at?: Date;
}
