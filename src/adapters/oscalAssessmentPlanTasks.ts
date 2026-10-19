// Rekursive Aufgaben und Aktivitäten; Referenzen zeigen auf strukturelle Pfade, nicht auf zyklische Objekte.
import type { JsonObject } from '@/domain/jsonGuards';
import type { ApActivity, ApTask, ApTiming } from '@/domain/assessmentPlanModel';
import {
  entity,
  objectField,
  readElements,
  readObjectArrayField,
  reference,
  responsibleRoles,
  stringField,
  unexpected,
} from '@/adapters/oscalAssessmentPlanReaders';
import type { ApDeriveState } from '@/adapters/oscalAssessmentPlanReaders';
import { reviewedControls, subjects } from '@/adapters/oscalAssessmentPlanSelections';

function timing(node: JsonObject, path: string, state: ApDeriveState): ApTiming | null {
  const value = objectField(node, 'timing', path, state);
  if (value === null) return null;
  const p = `${path}/timing`;
  const date = objectField(value, 'on-date', p, state);
  const range = objectField(value, 'within-date-range', p, state);
  const frequency = objectField(value, 'at-frequency', p, state);
  let period: number | undefined;
  if (frequency !== null) {
    if (typeof frequency.period === 'number' && Number.isFinite(frequency.period))
      period = frequency.period;
    else unexpected(state, `${p}/at-frequency/period`);
  }
  // Alle drei Formen bleiben erhalten; 1.1.x erlaubt ihre Kombination.
  return {
    onDate:
      date === null
        ? null
        : {
            date: stringField(date, 'date', `${p}/on-date`, state, true),
            remarks: stringField(date, 'remarks', `${p}/on-date`, state),
          },
    withinDateRange:
      range === null
        ? null
        : {
            start: stringField(range, 'start', `${p}/within-date-range`, state, true),
            end: stringField(range, 'end', `${p}/within-date-range`, state, true),
            remarks: stringField(range, 'remarks', `${p}/within-date-range`, state),
          },
    atFrequency:
      frequency === null
        ? null
        : {
            period,
            unit: stringField(frequency, 'unit', `${p}/at-frequency`, state, true),
            remarks: stringField(frequency, 'remarks', `${p}/at-frequency`, state),
          },
  };
}
export function activities(
  node: JsonObject,
  path: string,
  state: ApDeriveState,
): readonly ApActivity[] {
  return readObjectArrayField(node, 'activities', path, state).map(
    ({ node: activity, path: p }) => ({
      ...entity(activity, p, state),
      relatedControls: reviewedControls(activity, 'related-controls', p, state),
      responsibleRoles: responsibleRoles(activity, p, state),
      steps: readObjectArrayField(activity, 'steps', p, state).map(({ node: step, path: sp }) => ({
        ...entity(step, sp, state),
        reviewedControls: reviewedControls(step, 'reviewed-controls', sp, state),
        responsibleRoles: responsibleRoles(step, sp, state),
      })),
    }),
  );
}
export function tasks(node: JsonObject, path: string, state: ApDeriveState): readonly ApTask[] {
  return readObjectArrayField(node, 'tasks', path, state).map(({ node: task, path: p }) => ({
    ...entity(task, p, state),
    type: stringField(task, 'type', p, state, true),
    timing: timing(task, p, state),
    dependencies: readObjectArrayField(task, 'dependencies', p, state).map(
      ({ node: dependency, path: dp }) => {
        const taskUuid = stringField(dependency, 'task-uuid', dp, state, true);
        return {
          taskUuid,
          remarks: stringField(dependency, 'remarks', dp, state),
          path: dp,
          reference: reference(
            state,
            'task',
            taskUuid,
            `${dp}/task-uuid`,
            false,
            'TASK_REFERENCE_UNRESOLVED',
          ),
        };
      },
    ),
    associatedActivities: readObjectArrayField(task, 'associated-activities', p, state).map(
      ({ node: associated, path: ap }) => {
        const activityUuid = stringField(associated, 'activity-uuid', ap, state, true);
        return {
          ...readElements(associated, ap, state),
          activityUuid,
          reference: reference(
            state,
            'activity',
            activityUuid,
            `${ap}/activity-uuid`,
            false,
            'ACTIVITY_REFERENCE_UNRESOLVED',
          ),
          subjects: subjects(associated, 'subjects', ap, state),
          responsibleRoles: responsibleRoles(associated, ap, state),
        };
      },
    ),
    subjects: subjects(task, 'subjects', p, state),
    responsibleRoles: responsibleRoles(task, p, state),
    tasks: tasks(task, p, state),
  }));
}
