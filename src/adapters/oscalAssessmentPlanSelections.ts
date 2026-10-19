// Prüfgegenstände, Control-Auswahlen und Teile des Assessment Plans.
import { type JsonObject } from '@/domain/jsonGuards';
import { OSCAL_NAMESPACE } from '@/domain/mappingModel';
import type { ApPart, ApReviewedControls, ApSubject } from '@/domain/assessmentPlanModel';
import {
  controlReference,
  diagnose,
  objectField,
  readElements,
  readObjectArrayField,
  readStringArrayField,
  reference,
  stringField,
} from '@/adapters/oscalAssessmentPlanReaders';
import type { ApDeriveState } from '@/adapters/oscalAssessmentPlanReaders';

const TERM_NAMES = new Set([
  'rules-of-engagement',
  'disclosures',
  'assessment-inclusions',
  'assessment-exclusions',
  'results-delivery',
  'assumptions',
  'methodology',
]);
export function parts(
  node: JsonObject,
  path: string,
  state: ApDeriveState,
  {
    assessmentPart = false,
    validateTermNames = assessmentPart,
  }: { assessmentPart?: boolean; validateTermNames?: boolean } = {},
): readonly ApPart[] {
  return readObjectArrayField(node, 'parts', path, state).map(({ node: part, path: p }) => {
    const name = stringField(part, 'name', p, state, true);
    const ns = stringField(part, 'ns', p, state);
    if (
      validateTermNames &&
      (part.ns === undefined || ns === OSCAL_NAMESPACE) &&
      name !== undefined &&
      !TERM_NAMES.has(name)
    )
      diagnose(state, 'PART_NAME_UNEXPECTED', `${p}/name`);
    return {
      ...readElements(part, p, state, false),
      uuid: assessmentPart ? stringField(part, 'uuid', p, state) : undefined,
      id: assessmentPart ? undefined : stringField(part, 'id', p, state),
      name,
      ns,
      class: stringField(part, 'class', p, state),
      title: stringField(part, 'title', p, state),
      prose: stringField(part, 'prose', p, state),
      parts: parts(part, p, state, { assessmentPart, validateTermNames: false }),
    };
  });
}
export function reviewedControls(
  node: JsonObject,
  key: string,
  path: string,
  state: ApDeriveState,
  required = false,
): ApReviewedControls | null {
  const reviewed = objectField(node, key, path, state, required);
  if (reviewed === null) return null;
  const p = `${path}/${key}`;
  const controls = (group: JsonObject, field: string, gp: string) =>
    readObjectArrayField(group, field, gp, state).map(({ node: selection, path: sp }) => {
      const controlId = stringField(selection, 'control-id', sp, state, true);
      return {
        controlId,
        statementIds: readStringArrayField(selection, 'statement-ids', sp, state),
        control: controlReference(controlId, `${sp}/control-id`, state),
        path: sp,
      };
    });
  const objectives = (group: JsonObject, field: string, gp: string) =>
    readObjectArrayField(group, field, gp, state).map(({ node: selection, path: sp }) => ({
      objectiveId: stringField(selection, 'objective-id', sp, state, true),
      remarks: stringField(selection, 'remarks', sp, state),
      path: sp,
    }));
  return {
    ...readElements(reviewed, p, state),
    description: stringField(reviewed, 'description', p, state),
    controlSelections: readObjectArrayField(reviewed, 'control-selections', p, state).map(
      ({ node: group, path: gp }) => ({
        ...readElements(group, gp, state),
        description: stringField(group, 'description', gp, state),
        includeAll: objectField(group, 'include-all', gp, state) !== null,
        includeControls: controls(group, 'include-controls', gp),
        excludeControls: controls(group, 'exclude-controls', gp),
      }),
    ),
    controlObjectiveSelections: readObjectArrayField(
      reviewed,
      'control-objective-selections',
      p,
      state,
    ).map(({ node: group, path: gp }) => ({
      ...readElements(group, gp, state),
      description: stringField(group, 'description', gp, state),
      includeAll: objectField(group, 'include-all', gp, state) !== null,
      includeObjectives: objectives(group, 'include-objectives', gp),
      excludeObjectives: objectives(group, 'exclude-objectives', gp),
    })),
  };
}
export function subjects(
  node: JsonObject,
  key: string,
  path: string,
  state: ApDeriveState,
): readonly ApSubject[] {
  return readObjectArrayField(node, key, path, state).map(({ node: subject, path: p }) => {
    const type = stringField(subject, 'type', p, state);
    if (type === undefined) diagnose(state, 'SUBJECT_TYPE_MISSING', `${p}/type`);
    const selections = (field: string) =>
      readObjectArrayField(subject, field, p, state).map(({ node: selection, path: sp }) => {
        const subjectUuid = stringField(selection, 'subject-uuid', sp, state, true);
        const selectedType = stringField(selection, 'type', sp, state, true);
        // `type` ist offenes Vokabular; unbekannte Arten werden ohne falsche Negativaussage geführt.
        const knownType = [
          'component',
          'inventory-item',
          'user',
          'party',
          'location',
          'resource',
        ].includes(selectedType ?? '');
        return {
          ...readElements(selection, sp, state),
          subjectUuid,
          type: selectedType,
          reference: knownType
            ? reference(
                state,
                selectedType,
                subjectUuid,
                `${sp}/subject-uuid`,
                true,
                'SUBJECT_REFERENCE_UNRESOLVED',
              )
            : {
                status: 'not-resolvable-in-context' as const,
                reason: 'subject-type-not-supported',
              },
        };
      });
    return {
      ...readElements(subject, p, state),
      type,
      description: stringField(subject, 'description', p, state),
      includeAll: objectField(subject, 'include-all', p, state) !== null,
      includeSubjects: selections('include-subjects'),
      excludeSubjects: selections('exclude-subjects'),
    };
  });
}
