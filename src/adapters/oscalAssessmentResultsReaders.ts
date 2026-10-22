// Referenz-, Herkunfts- und Indexleser des Assessment-Results-Adapters. Diagnosen tragen nur strukturelle Pfade.
import type { JsonObject } from '@/domain/jsonGuards';
import type { ApTask } from '@/domain/assessmentPlanModel';
import type {
  ArOrigin,
  ArReference,
  ArRelatedObservation,
  ArRelatedTask,
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

const ORIGIN: Readonly<Record<ArScope, 'local' | 'assessment-plan' | 'ssp'>> = {
  local: 'local',
  assets: 'local',
  document: 'local',
  'assessment-plan': 'assessment-plan',
  ssp: 'ssp',
};
/** Index eines Bereichs; `available` ist nur für Plan und SSP an eine gültige Bindung geknüpft. */
function scopeIndex(state: ArDeriveState, scope: ArScope): { index: Index; available: boolean; bound: boolean } {
  if (scope === 'ssp')
    return { index: state.ssp, available: state.sspAvailable, bound: state.options.ssp !== undefined };
  if (scope === 'assessment-plan')
    return { index: state.plan, available: state.planAvailable, bound: state.options.assessmentPlan !== undefined };
  return { index: state[scope], available: true, bound: true };
}

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
    const { index, available, bound } = scopeIndex(state, scope);
    if (!available) {
      missingContext ??= `${scope}-${bound ? 'binding-invalid' : 'not-supplied'}`;
      continue;
    }
    const hits = index.get(type)?.get(key) ?? [];
    if (hits.length === 1) return { status: 'resolved', origin: ORIGIN[scope], path: hits[0] };
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
    relatedTasks: relatedTasks(node, path, state),
  };
}
export function relatedTasks(node: JsonObject, path: string, state: ArDeriveState): readonly ArRelatedTask[] {
  return readObjectArrayField(node, 'related-tasks', path, state).map(({ node: task, path: tp }) => {
    const taskUuid = stringField(task, 'task-uuid', tp, state, true);
    return {
      ...readElements(task, tp, state),
      taskUuid,
      reference: arReference(state, 'task', taskUuid, `${tp}/task-uuid`, 'TASK_REFERENCE_UNRESOLVED', [
        'local',
        'assessment-plan',
      ]),
    };
  });
}
/** Urheber eines Protokolleintrags: Partei und Rolle im Dokument, im Plan oder im SSP. */
export function loggedBy(node: JsonObject, path: string, state: ArDeriveState) {
  const scopes: readonly ArScope[] = ['local', 'assessment-plan', 'ssp'];
  return readObjectArrayField(node, 'logged-by', path, state).map(({ node: entry, path: lp }) => {
    const partyUuid = stringField(entry, 'party-uuid', lp, state, true);
    const roleId = stringField(entry, 'role-id', lp, state);
    return {
      partyUuid,
      roleId,
      remarks: stringField(entry, 'remarks', lp, state),
      path: lp,
      party: arReference(state, 'party', partyUuid, `${lp}/party-uuid`, 'PARTY_REFERENCE_UNRESOLVED', scopes),
      role:
        roleId === undefined
          ? null
          : arReference(state, 'role', roleId, `${lp}/role-id`, 'ROLE_REFERENCE_UNRESOLVED', scopes),
    };
  });
}
export function origins(node: JsonObject, path: string, state: ArDeriveState): readonly ArOrigin[] {
  return readObjectArrayField(node, 'origins', path, state).map((entry) => origin(entry.node, entry.path, state));
}
const SUBJECT_TYPES = new Set(['component', 'inventory-item', 'user', 'party', 'location', 'resource']);
function subjectReference(
  state: ArDeriveState,
  type: string | undefined,
  subjectUuid: string | undefined,
  path: string,
): ArReference {
  if (type === undefined || !SUBJECT_TYPES.has(type))
    return { status: 'not-resolvable-in-context', reason: 'subject-type-not-supported' };
  // Ressourcen-Subjekte sind dokumentintern, wie im Evidenz-Read-Model.
  const scopes: readonly ArScope[] = type === 'resource' ? ['local'] : ['local', 'assessment-plan', 'ssp'];
  return arReference(state, type, subjectUuid, path, 'SUBJECT_REFERENCE_UNRESOLVED', scopes);
}
export function subjectReferences(
  node: JsonObject,
  path: string,
  state: ArDeriveState,
): readonly ArSubjectReference[] {
  return readObjectArrayField(node, 'subjects', path, state).map(({ node: subject, path: sp }) => {
    const subjectUuid = stringField(subject, 'subject-uuid', sp, state, true);
    const type = stringField(subject, 'type', sp, state, true);
    return {
      ...readElements(subject, sp, state),
      subjectUuid,
      type,
      title: stringField(subject, 'title', sp, state),
      reference: subjectReference(state, type, subjectUuid, `${sp}/subject-uuid`),
    };
  });
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
  // Eigener Stapel statt Rekursion: eine lange Abhängigkeitskette darf den Aufrufstapel nicht sprengen.
  for (const start of edges.keys()) {
    if (done.has(start)) continue;
    const stack = [{ id: start, next: 0 }];
    active.add(start);
    for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
      const edge = edges.get(frame.id)?.[frame.next++];
      if (edge === undefined) {
        active.delete(frame.id);
        done.add(frame.id);
        stack.pop();
      } else if (active.has(edge.to)) {
        diagnose(state, 'TASK_DEPENDENCY_CYCLE', edge.path);
      } else if (!done.has(edge.to)) {
        active.add(edge.to);
        stack.push({ id: edge.to, next: 0 });
      }
    }
  }
}
