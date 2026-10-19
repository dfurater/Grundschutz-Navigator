// Raw-Typen des Assessment Plans. Versionsautorität ist metadata.oscal-version.
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import type { RawOscalMetadata, RawOscalProp } from '@/domain/models';
import type {
  RawOscalComponentBackMatter,
  RawOscalComponentLink,
  RawOscalResponsibleRole,
} from '@/domain/oscalComponentDefinition';
import type {
  RawOscalSystemComponent,
  RawOscalSystemUser,
  RawOscalInventoryItem,
} from '@/domain/oscalSystemSecurityPlan';

export type LegacyAssessmentVersion = '1.1.2' | '1.1.3';
type Remarks<V extends PinnedOscalVersion> = V extends LegacyAssessmentVersion
  ? { remarks?: never }
  : { remarks?: string };
/** Ab 1.2.1 erzwingt das JSON-Schema genau einen Auswahlzweig. */
type Selection<
  V extends PinnedOscalVersion,
  K extends string,
  T,
> = V extends LegacyAssessmentVersion
  ? { 'include-all'?: object } & { [P in K]?: T[] }
  : | ({ 'include-all': object } & { [P in K]?: never })
    | ({ 'include-all'?: never } & { [P in K]: T[] });
export interface RawApElements {
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  remarks?: string;
}
export interface RawApPart {
  id?: string;
  name: string;
  ns?: string;
  class?: string;
  title?: string;
  props?: RawOscalProp[];
  prose?: string;
  parts?: RawApPart[];
  links?: RawOscalComponentLink[];
}
export type RawApAssessmentPart = Omit<RawApPart, 'id' | 'parts'> & {
  uuid?: string;
  parts?: RawApAssessmentPart[];
};
export interface RawApControlSelection {
  'control-id': string;
  'statement-ids'?: string[];
}
export type RawApObjectiveSelection<V extends PinnedOscalVersion> = {
  'objective-id': string;
} & Remarks<V>;
export type RawApControlGroup<V extends PinnedOscalVersion> = RawApElements & {
  description?: string;
  'exclude-controls'?: RawApControlSelection[];
} & Selection<V, 'include-controls', RawApControlSelection>;
export type RawApObjectiveGroup<V extends PinnedOscalVersion> = RawApElements & {
  description?: string;
  'exclude-objectives'?: RawApObjectiveSelection<V>[];
} & Selection<V, 'include-objectives', RawApObjectiveSelection<V>>;
export interface RawApReviewedControls<V extends PinnedOscalVersion> extends RawApElements {
  description?: string;
  'control-selections': RawApControlGroup<V>[];
  'control-objective-selections'?: RawApObjectiveGroup<V>[];
}
export interface RawApSubjectReference extends RawApElements {
  'subject-uuid': string;
  type: string;
}
export type RawApSubject<V extends PinnedOscalVersion> = RawApElements & {
  description?: string;
  'exclude-subjects'?: RawApSubjectReference[];
} & (V extends LegacyAssessmentVersion ? { type: string } : { type?: string }) &
  Selection<V, 'include-subjects', RawApSubjectReference>;
export type RawApTiming<V extends PinnedOscalVersion> = V extends LegacyAssessmentVersion
  ? {
      'on-date'?: { date: string };
      'within-date-range'?: { start: string; end: string };
      'at-frequency'?: { period: number; unit: string };
    }
  : | {
        'on-date': { date: string } & Remarks<V>;
        'within-date-range'?: never;
        'at-frequency'?: never;
      }
    | {
        'on-date'?: never;
        'within-date-range': { start: string; end: string } & Remarks<V>;
        'at-frequency'?: never;
      }
    | {
        'on-date'?: never;
        'within-date-range'?: never;
        'at-frequency': { period: number; unit: string } & Remarks<V>;
      };
export interface RawApActivity<V extends PinnedOscalVersion> extends RawApElements {
  uuid: string;
  title?: string;
  description: string;
  steps?: Array<
    RawApElements & {
      uuid: string;
      title?: string;
      description: string;
      'reviewed-controls'?: RawApReviewedControls<V>;
      'responsible-roles'?: RawOscalResponsibleRole[];
    }
  >;
  'related-controls'?: RawApReviewedControls<V>;
  'responsible-roles'?: RawOscalResponsibleRole[];
}
export interface RawApTask<V extends PinnedOscalVersion> extends RawApElements {
  uuid: string;
  type: string;
  title: string;
  description?: string;
  timing?: RawApTiming<V>;
  dependencies?: Array<{ 'task-uuid': string; remarks?: string }>;
  tasks?: RawApTask<V>[];
  'associated-activities'?: Array<
    RawApElements & {
      'activity-uuid': string;
      subjects: RawApSubject<V>[];
      'responsible-roles'?: RawOscalResponsibleRole[];
    }
  >;
  subjects?: RawApSubject<V>[];
  'responsible-roles'?: RawOscalResponsibleRole[];
}
export interface RawOscalAssessmentPlan<V extends PinnedOscalVersion = PinnedOscalVersion> {
  uuid: string;
  metadata: RawOscalMetadata;
  'import-ssp': { href: string; remarks?: string };
  'reviewed-controls': RawApReviewedControls<V>;
  'local-definitions'?: {
    components?: RawOscalSystemComponent<V>[];
    users?: RawOscalSystemUser[];
    'inventory-items'?: RawOscalInventoryItem[];
    'objectives-and-methods'?: Array<
      RawApElements & {
        'control-id': string;
        description?: string;
        parts: RawApPart[];
      }
    >;
    activities?: RawApActivity<V>[];
    remarks?: string;
  };
  'terms-and-conditions'?: { parts?: RawApAssessmentPart[] };
  'assessment-subjects'?: RawApSubject<V>[];
  'assessment-assets'?: {
    components?: RawOscalSystemComponent<V>[];
    'assessment-platforms': Array<
      RawApElements & {
        uuid: string;
        title?: string;
        'uses-components'?: Array<
          RawApElements & {
            'component-uuid': string;
            'responsible-parties'?: Array<{
              'role-id': string;
              'party-uuids': string[];
            }>;
          }
        >;
      }
    >;
  };
  tasks?: RawApTask<V>[];
  'back-matter'?: RawOscalComponentBackMatter;
}
