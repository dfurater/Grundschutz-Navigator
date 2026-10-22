// Referenz-, Herkunfts- und Indexleser des Assessment-Results-Adapters. Diagnosen tragen nur strukturelle Pfade.
import type { JsonObject } from '@/domain/jsonGuards';
import type { ApTask } from '@/domain/assessmentPlanModel';
import type {
  ArOrigin,
  ArReference,
  ArRelatedObservation,
  ArSubjectReference,
  AssessmentResultsDeriveOptions,
} from '@/domain/assessmentResultsModel';
import type { EvidenceObservation, UuidReference } from '@/domain/evidenceReadModel';
import {
  diagnose,
  readElements,
  readObjectArrayField,
  stringField,
} from '@/adapters/oscalAssessmentPlanReaders';
import type { ApDeriveState } from '@/adapters/oscalAssessmentPlanReaders';

export const AR_BASE_PATH = '/assessment-results';
type Index = ApDeriveState['local'];
export interface ArDeriveState extends ApDeriveState {
  readonly options: AssessmentResultsDeriveOptions;
  readonly plan: Index;
  planAvailable: boolean;
  /** Dokumentweite Identitäten von Beobachtungen, Risiken, Findings und Maßnahmen. */
  readonly document: Index;
  readonly evidenceByPath: Map<string, EvidenceObservation>;
  readonly observationReferences: Map<string, UuidReference>;
}
export type ArScope = 'local' | 'assets' | 'document' | 'assessment-plan' | 'ssp';

/** Löst in der Reihenfolge `scopes` auf; ein nicht gebundener Kontext ergibt keine Fehldiagnose. */
export function arReference(
  state: ArDeriveState,
  type: string,
  id: string | undefined,
  path: string,
  code: string,
  scopes: readonly ArScope[],
): ArReference {
  if (id === undefined) {
    diagnose(state, code, path);
    return { status: 'unresolved', reason: 'identity-missing' };
  }
  const key = type === 'role' ? id : id.toLowerCase();
  let missingContext: string | undefined;
  for (const scope of scopes) {
    const binding = scope === 'ssp' ? state.options.ssp : state.options.assessmentPlan;
    const available =
      scope === 'ssp' ? state.sspAvailable : scope === 'assessment-plan' ? state.planAvailable : true;
    if (!available) {
      missingContext ??= `${scope}-${binding === undefined ? 'not-supplied' : 'binding-invalid'}`;
      continue;
    }
    const index = { local: state.local, assets: state.assets, document: state.document, 'assessment-plan': state.plan, ssp: state.ssp }[scope];
    const hits = index.get(type)?.get(key) ?? [];
    if (hits.length === 1)
      return {
        status: 'resolved',
        origin: scope === 'ssp' || scope === 'assessment-plan' ? scope : 'local',
        path: hits[0],
      };
    if (hits.length > 1) {
      diagnose(state, code, path);
      return { status: 'unresolved', reason: 'identity-ambiguous' };
    }
  }
  if (missingContext !== undefined) return { status: 'not-resolvable-in-context', reason: missingContext };
  diagnose(state, code, path);
  return { status: 'unresolved', reason: 'identity-not-found' };
}

/** `origin-actor.type` ist ein geschlossenes Vokabular; jede Art hat ihren Identitätsbereich. */
const ACTOR_TARGETS: Readonly<Record<string, readonly [string, readonly ArScope[]]>> = {
  tool: ['component', ['assets', 'local', 'assessment-plan', 'ssp']],
  'assessment-platform': ['assessment-platform', ['assets', 'assessment-plan']],
  party: ['party', ['local', 'assessment-plan', 'ssp']],
};
export function origin(node: JsonObject, path: string, state: ArDeriveState): ArOrigin {
  return {
    path,
    actors: readObjectArrayField(node, 'actors', path, state).map(({ node: actor, path: ap }) => {
      const type = stringField(actor, 'type', ap, state, true);
      const actorUuid = stringField(actor, 'actor-uuid', ap, state, true);
      const target = type === undefined ? undefined : ACTOR_TARGETS[type];
      return {
        ...readElements(actor, ap, state, false),
        type,
        actorUuid,
        roleId: stringField(actor, 'role-id', ap, state),
        reference:
          target === undefined
            ? { status: 'unresolved' as const, reason: 'actor-type-not-supported' }
            : arReference(state, target[0], actorUuid, `${ap}/actor-uuid`, 'ACTOR_REFERENCE_UNRESOLVED', target[1]),
      };
    }),
    relatedTasks: readObjectArrayField(node, 'related-tasks', path, state).map(({ node: task, path: tp }) => {
      const taskUuid = stringField(task, 'task-uuid', tp, state, true);
      return {
        ...readElements(task, tp, state),
        taskUuid,
        reference: arReference(state, 'task', taskUuid, `${tp}/task-uuid`, 'TASK_REFERENCE_UNRESOLVED', [
          'local',
          'assessment-plan',
        ]),
      };
    }),
  };
}
export function origins(node: JsonObject, path: string, state: ArDeriveState): readonly ArOrigin[] {
  return readObjectArrayField(node, 'origins', path, state).map((entry) => origin(entry.node, entry.path, state));
}
export function subjectReferences(
  node: JsonObject,
  path: string,
  state: ArDeriveState,
): readonly ArSubjectReference[] {
  return readObjectArrayField(node, 'subjects', path, state).map(({ node: subject, path: sp }) => ({
    ...readElements(subject, sp, state),
    subjectUuid: stringField(subject, 'subject-uuid', sp, state, true),
    type: stringField(subject, 'type', sp, state, true),
    title: stringField(subject, 'title', sp, state),
  }));
}
/** Der Zustand stammt aus dem Evidenz-Read-Model; fehlende Ziele diagnostiziert es selbst. */
export function relatedObservations(
  node: JsonObject,
  path: string,
  state: ArDeriveState,
): readonly ArRelatedObservation[] {
  return readObjectArrayField(node, 'related-observations', path, state).map(({ node: related, path: rp }) => ({
    observationUuid: stringField(related, 'observation-uuid', rp, state, true),
    remarks: stringField(related, 'remarks', rp, state),
    path: rp,
    reference: state.observationReferences.get(`${rp}/observation-uuid`) ?? null,
  }));
}
/** Meldet jede Abhängigkeit, die einen Zyklus schließt, an ihrem strukturellen Pfad. */
export function diagnoseTaskCycles(tasks: readonly ApTask[], state: ArDeriveState): void {
  const edges = new Map<string, { to: string; path: string }[]>();
  const collect = (list: readonly ApTask[]) =>
    list.forEach((task) => {
      if (task.uuid !== undefined)
        edges.set(
          task.uuid.toLowerCase(),
          task.dependencies.flatMap((dependency) =>
            dependency.taskUuid === undefined
              ? []
              : [{ to: dependency.taskUuid.toLowerCase(), path: `${dependency.path}/task-uuid` }],
          ),
        );
      collect(task.tasks);
    });
  collect(tasks);
  const done = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string) => {
    if (done.has(id)) return;
    active.add(id);
    for (const edge of edges.get(id) ?? []) {
      if (active.has(edge.to)) diagnose(state, 'TASK_DEPENDENCY_CYCLE', edge.path);
      else visit(edge.to);
    }
    active.delete(id);
    done.add(id);
  };
  edges.forEach((_, id) => visit(id));
}
export function cloneIndex(index: Index): Index {
  return new Map([...index].map(([type, byId]) => [type, new Map([...byId].map(([id, paths]) => [id, [...paths]]))]));
}
