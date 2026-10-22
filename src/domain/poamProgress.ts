import type { ApTask } from '@/domain/assessmentPlanModel';
import type { PoamItem, PoamReference, Poam, PoamRisk } from '@/domain/poamModel';
import { isJsonObject, readArray, readString } from '@/domain/jsonGuards';

/** Fristzustände nach GSPP-314 Befund 8; kein vierter Zustand. */
export type DeadlineState = 'eingehalten' | 'überschritten' | 'ohne Frist';

/** Dokumentiertes Spektrum von `response.lifecycle`; jedes andere Token ist unbekannt. */
export const DOCUMENTED_LIFECYCLES = ['recommendation', 'planned', 'completed'] as const;

export interface PoamProgressRow {
  /** Lokaler Quellpfad des `poam-item`. */
  readonly key: string;
  readonly title?: string;
  /** `target-id` der über `related-findings` aufgelösten Findings. */
  readonly requirementIds: readonly string[];
  /** Früheste Frist als unveränderter Quellwert mit Dokument-Offset. */
  readonly deadline?: string;
  readonly deadlineState: DeadlineState;
  /** `metadata.roles[].title` je `role-id`, sonst die Kennung. */
  readonly responsible: readonly string[];
  /** `risk.status` unverändert; nie aus `lifecycle` abgeleitet. */
  readonly riskStatuses: readonly string[];
  readonly lifecycles: readonly { readonly value: string; readonly documented: boolean }[];
  /** Jedes aufgelöste Risiko hat Responses, und jede trägt `lifecycle = completed`. */
  readonly completed: boolean;
}

// DateTimeWithTimezoneDatatype verlangt einen Offset; ohne ihn wäre der Zeitpunkt von der Gerätezeitzone abhängig.
const WITH_OFFSET = /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function instant(value: string | undefined): number | undefined {
  if (value === undefined || !WITH_OFFSET.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

function resolvedLocal<T extends { readonly uuid?: string }>(
  targets: readonly T[], uuid: string | undefined, reference: PoamReference,
): T | undefined {
  if (uuid === undefined || reference.status !== 'resolved' || reference.origin !== 'local') return undefined;
  const wanted = uuid.toLowerCase();
  return targets.find((target) => target.uuid?.toLowerCase() === wanted);
}

function flattenTasks(tasks: readonly ApTask[]): ApTask[] {
  return tasks.flatMap((task) => [task, ...flattenTasks(task.tasks)]);
}

/** `metadata.roles[].title` je `id` aus der Quelle; die Projektion führt keine Rollen. */
export function readRoleTitles(source: unknown): ReadonlyMap<string, string> {
  const root = isJsonObject(source) ? source['plan-of-action-and-milestones'] : undefined;
  const metadata = isJsonObject(root) ? root.metadata : undefined;
  const titles = new Map<string, string>();
  for (const role of readArray(isJsonObject(metadata) ? metadata.roles : undefined)) {
    if (!isJsonObject(role)) continue;
    const id = readString(role.id);
    const title = readString(role.title);
    if (id !== undefined && title !== undefined) titles.set(id, title);
  }
  return titles;
}

function deadlineState(deadline: number | undefined, now: number): DeadlineState {
  if (deadline === undefined) return 'ohne Frist';
  return deadline < now ? 'überschritten' : 'eingehalten';
}

function progressRow(item: PoamItem, poam: Poam, now: number, roleTitles: ReadonlyMap<string, string>): PoamProgressRow {
  const risks = item.relatedRisks
    .map((related) => resolvedLocal<PoamRisk>(poam.risks, related.riskUuid, related.reference))
    .filter((risk): risk is PoamRisk => risk !== undefined);
  const responses = risks.flatMap((risk) => risk.remediations);
  const tasks = flattenTasks(responses.flatMap((response) => response.tasks));
  const candidates = [
    ...risks.map((risk) => risk.deadline),
    ...tasks.flatMap((task) => [task.timing?.onDate?.date, task.timing?.withinDateRange?.end]),
  ].flatMap((value) => {
    const ms = instant(value);
    return ms === undefined || value === undefined ? [] : [{ value, ms }];
  });
  const earliest = candidates.reduce<{ value: string; ms: number } | undefined>(
    (best, entry) => (best === undefined || entry.ms < best.ms ? entry : best), undefined);
  const requirementIds = item.relatedFindings
    .map((related) => resolvedLocal(poam.findings, related.findingUuid, related.reference)?.target?.targetId)
    .filter((id): id is string => id !== undefined);
  const lifecycles = responses.map((response) => {
    const value = response.lifecycle ?? '';
    return { value, documented: (DOCUMENTED_LIFECYCLES as readonly string[]).includes(value) };
  });
  return {
    key: item.key,
    title: item.title,
    requirementIds: [...new Set(requirementIds)],
    deadline: earliest?.value,
    deadlineState: deadlineState(earliest?.ms, now),
    responsible: [...new Set(tasks.flatMap((task) => task.responsibleRoles.map((role) => roleTitles.get(role.roleId) ?? role.roleId)))],
    riskStatuses: risks.flatMap((risk) => (risk.status === undefined ? [] : [risk.status])),
    lifecycles,
    completed: risks.length > 0
      && risks.every((risk) => risk.remediations.length > 0 && risk.remediations.every((response) => response.lifecycle === 'completed')),
  };
}

/** Eine Zeile je `poam-item`; Frist und Stand kommen ausschließlich aus verknüpften Risiken und deren Responses. */
export function derivePoamProgress(
  poam: Poam, now: Date, roleTitles: ReadonlyMap<string, string> = new Map(),
): PoamProgressRow[] {
  return poam.poamItems.map((item) => progressRow(item, poam, now.getTime(), roleTitles));
}

export type PoamProgressSort = 'frist' | 'verantwortlich' | 'stand';

function standKey(row: PoamProgressRow): string {
  return row.lifecycles.map((entry) => entry.value).join(' ');
}

/** Fehlende Werte stehen zuletzt. */
function compareOptional<T>(a: T | undefined, b: T | undefined, compare: (x: T, y: T) => number): number {
  if (a === undefined || b === undefined) return Number(a === undefined) - Number(b === undefined);
  return compare(a, b);
}

const byText = (a: string | undefined, b: string | undefined) => compareOptional(a, b, (x, y) => x.localeCompare(y, 'de'));

/** Stabile Sortierung; Zeilen ohne Sortierwert stehen zuletzt. */
export function sortPoamProgress<T extends PoamProgressRow>(rows: readonly T[], sort: PoamProgressSort): T[] {
  const primary = (a: T, b: T): number => {
    if (sort === 'frist') return compareOptional(instant(a.deadline), instant(b.deadline), (x, y) => x - y);
    if (sort === 'verantwortlich') return byText(a.responsible[0], b.responsible[0]);
    return byText(standKey(a) || undefined, standKey(b) || undefined);
  };
  return [...rows].sort((a, b) => primary(a, b) || byText(a.title, b.title) || a.key.localeCompare(b.key));
}
