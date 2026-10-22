import type { ApComponent, ApEntity, AssessmentPlan, AssessmentPlanDeriveOptions } from '@/domain/assessmentPlanModel';
import type { ArOrigin, ArReference, ArRelatedObservation, AssessmentFinding, AssessmentObservation, AssessmentResults, AssessmentRisk } from '@/domain/assessmentResultsModel';
import type { EvidenceReadModel } from '@/domain/evidenceReadModel';
import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { OscalDocumentContext } from '@/domain/models';
import type { OscalRootMetadataView } from '@/domain/oscalRootDocument';
import type { ResolvedOscalReference } from '@/domain/referenceResolution';

export const POAM_ROOT_TYPE = 'plan-of-action-and-milestones' as const;
export type PoamObservation = AssessmentObservation;
export type PoamFinding = AssessmentFinding;
export type PoamRisk = AssessmentRisk;
export type PoamReference = ArReference | { readonly status: 'resolved'; readonly origin: 'assessment-results'; readonly path: string };
export interface PoamItem extends ApEntity {
  /** Lokaler Quellpfad; auch ohne optionale OSCAL-UUID adressierbar. */
  readonly key: string;
  readonly origins: readonly ArOrigin[];
  readonly relatedObservations: readonly ArRelatedObservation[];
  readonly relatedRisks: readonly { readonly riskUuid?: string; readonly path: string; readonly reference: PoamReference }[];
  readonly relatedFindings: readonly { readonly findingUuid?: string; readonly path: string; readonly reference: PoamReference }[];
}
export interface Poam {
  readonly uuid?: string;
  readonly metadata: OscalRootMetadataView;
  readonly importSsp: {
    readonly href: string;
    readonly remarks?: string;
    readonly path: string;
    readonly reference: ResolvedOscalReference;
    readonly status: 'bound' | 'not-resolvable-in-context';
  } | null;
  readonly systemId: { readonly id?: string; readonly identifierType?: string; readonly path: string } | null;
  readonly localDefinitions: {
    readonly components: readonly ApComponent[];
    readonly inventoryItems: readonly ApEntity[];
    readonly assessmentAssets: AssessmentPlan['assessmentAssets'];
    readonly remarks?: string;
  };
  readonly poamItems: readonly PoamItem[];
  readonly observations: readonly PoamObservation[];
  readonly risks: readonly PoamRisk[];
  readonly findings: readonly PoamFinding[];
  readonly evidence: EvidenceReadModel;
  readonly diagnostics: readonly OscalDiagnostic[];
}
export interface PoamDeriveOptions extends AssessmentPlanDeriveOptions {
  /** Vom Aufrufer ausdrücklich zugeordnete AR-Quelle; keine OSCAL-Importkante. */
  readonly assessmentResults?: {
    readonly source: unknown;
    readonly view: AssessmentResults;
    readonly context: OscalDocumentContext;
  };
  readonly at?: Date;
}
