import type { ApTask } from '@/domain/assessmentPlanModel';
import type { PoamItem, PoamReference, Poam, PoamRisk } from '@/domain/poamModel';
import { parseTimestamp } from '@/domain/evidenceReadModel';
import { isJsonObject, readArray, readString } from '@/domain/jsonGuards';

/** Fristlage zu einem Zeitpunkt; OSCAL trägt keinen Beleg für eine Erledigung vor dem Termin, daher kein „eingehalten“. */
export type DeadlineState = 'noch nicht fällig' | 'überschritten' | 'Fristlage unbekannt';

/** Warum ein Fristkandidat keinen absoluten Termin liefert. */
export type DeadlineGapReason =
  | 'keine Frist' | 'ungültiges Datum' | 'ungültiges Intervall' | 'Risikobezug nicht auflösbar' | 'Wiederholung ohne absoluten Termin';

/** Quellpfad (JSON Pointer) und unveränderter Quellwert. */
export interface DeadlineSource {
  readonly path: string;
  readonly value?: string;
}

export interface DeadlineAssessment {
  /** Früheste lesbare Frist; auch bei unbekannter Fristlage für Anzeige und Sortierung. */
  readonly deadline?: DeadlineSource & { readonly value: string };
  readonly state: DeadlineState;
  /** Kandidaten ohne absoluten Termin; leer nur, wenn jeder Kandidat lesbar ist. */
  readonly gaps: readonly (DeadlineSource & { readonly reason: DeadlineGapReason })[];
}

/** Dokumentiertes Spektrum von `response.lifecycle`; jedes andere Token ist unbekannt. */
export const DOCUMENTED_LIFECYCLES = ['recommendation', 'planned', 'completed'] as const;

export interface PoamProgressRow {
  /** Lokaler Quellpfad des `poam-item`. */
  readonly key: string;
  readonly title?: string;
  /** `target-id` der über `related-findings` aufgelösten Findings. */
  readonly requirementIds: readonly string[];
  /** Früheste lesbare Frist der aufgelösten Risiken als unveränderter Quellwert mit Dokument-Offset; auch Sortierschlüssel. */
  readonly deadline?: string;
  readonly deadlineState: DeadlineState;
  readonly deadlineGaps: DeadlineAssessment['gaps'];
  /** Quellpfade für Frist, Risikofristen, Lifecycles und Risikostatus in Dokumentreihenfolge. */
  readonly sources: readonly (DeadlineSource & { readonly label: string })[];
  /** `metadata.roles[].title` je `role-id`, sonst die Kennung. */
  readonly responsible: readonly string[];
  /** `risk.status` unverändert; nie aus `lifecycle` abgeleitet. */
  readonly riskStatuses: readonly string[];
  readonly lifecycles: readonly { readonly value: string; readonly documented: boolean }[];
  /** `related-risks`-Einträge, die nicht auf ein Risiko dieses Dokuments auflösen; ihr Stand und ihre Frist sind unbekannt. */
  readonly unresolvedRisks: number;
  /** Umsetzung erklärt: Alle Risikoverweise lösen auf, jedes Risiko hat Responses, und jede trägt `lifecycle = completed`. Belegt weder Fristeinhaltung noch Wirksamkeit. */
  readonly completed: boolean;
}

/** Zeitpunkt nur bei schemagültigem `DateTimeWithTimezoneDatatype`; ein Entwurf kann `2026-02-30` oder einen fehlenden Offset tragen. */
function instant(value: string | undefined): number | undefined {
  const ms = parseTimestamp(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Einmal je Ableitung aufgebaut, damit große POA&Ms nicht je Verweis alle Ziele durchsuchen. */
function indexByUuid<T extends { readonly uuid?: string }>(targets: readonly T[]): ReadonlyMap<string, T> {
  const index = new Map<string, T>();
  for (const target of targets) {
    const uuid = target.uuid?.toLowerCase();
    if (uuid !== undefined && !index.has(uuid)) index.set(uuid, target);
  }
  return index;
}

function resolvedLocal<T>(index: ReadonlyMap<string, T>, uuid: string | undefined, reference: PoamReference): T | undefined {
  if (uuid === undefined || reference.status !== 'resolved' || reference.origin !== 'local') return undefined;
  return index.get(uuid.toLowerCase());
}

interface ProgressContext {
  readonly risks: ReadonlyMap<string, PoamRisk>;
  readonly findings: ReadonlyMap<string, Poam['findings'][number]>;
  readonly now: Date;
  readonly roleTitles: ReadonlyMap<string, string>;
  readonly unreadable: ReadonlySet<string>;
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

type Gap = DeadlineAssessment['gaps'][number];
interface Known { readonly value: string; readonly path: string; readonly ms: number }

/** Ein Zeitpunktkandidat; ein ungültiger oder als Pflichtwert fehlender Wert wird zur Lücke. */
function candidate(value: string | undefined, path: string, reason: DeadlineGapReason, required: boolean): Known | Gap | undefined {
  if (value === undefined) return required ? { reason, path } : undefined;
  const ms = instant(value);
  return ms === undefined ? { reason, path, value } : { value, path, ms };
}

function taskCandidates(task: ApTask, unreadable: ReadonlySet<string>): (Known | Gap | undefined)[] {
  const base = `${task.path}/timing`;
  const { onDate, withinDateRange: range, atFrequency } = task.timing ?? {};
  // Ein vorhandenes oder vom Reader als unlesbar gemeldetes Timing-Objekt verlangt seinen Termin.
  const present = (value: object | null | undefined, path: string) => (value !== null && value !== undefined) || unreadable.has(path);
  const end = candidate(range?.end, `${base}/within-date-range/end`, 'ungültiges Intervall', present(range, `${base}/within-date-range`));
  const start = instant(range?.start);
  const inverted = end !== undefined && 'ms' in end && start !== undefined && start > end.ms;
  return [
    // Ein vom Reader als Ganzes verworfenes `timing` kann einen Termin getragen haben.
    task.timing === null && unreadable.has(base) ? { reason: 'ungültiges Datum', path: base } : undefined,
    candidate(onDate?.date, `${base}/on-date/date`, 'ungültiges Datum', present(onDate, `${base}/on-date`)),
    inverted ? { reason: 'ungültiges Intervall', path: `${base}/within-date-range`, value: JSON.stringify(range) } : end,
    atFrequency ? { reason: 'Wiederholung ohne absoluten Termin', path: `${base}/at-frequency`, value: JSON.stringify(atFrequency) } : undefined,
  ];
}

/** Sekundenbruchteil unter der Millisekunde, den `Date.parse` kappt; vergleichbar als Dezimalbruch. */
function subMillisecond(entry: Known): number {
  return Number(`0.${/\.\d{3}(\d+)/.exec(entry.value)?.[1] ?? '0'}`);
}

const earlier = (a: Known, b: Known) => a.ms < b.ms || (a.ms === b.ms && subMillisecond(a) < subMillisecond(b));

/** `now >= Termin`; ein Rest unter der Millisekunde liegt noch nach `now`. */
function reached(entry: Known, now: number): boolean {
  return entry.ms < now || (entry.ms === now && subMillisecond(entry) === 0);
}

/**
 * Fristlage aus Risikofristen und dem Timing aller rekursiven Tasks ihrer Responses, zeitpunktbasiert gegen `now`.
 * `now >= Termin` ist überschritten. Eine bekannte überschrittene Frist bleibt überschritten; sonst macht jede Lücke
 * die Fristlage unbekannt, weil der nicht lesbare Kandidat früher liegen kann. Je Risiko aufrufbar.
 */
export function assessDeadline(
  risks: readonly PoamRisk[], unresolvedRisks: readonly DeadlineSource[], now: Date,
  /** Quellpfade, die der Reader mit falschem Typ übergangen hat (`*_STRUCTURE_UNEXPECTED`). */
  unreadable: ReadonlySet<string> = new Set(),
): DeadlineAssessment {
  const tasks = flattenTasks(risks.flatMap((risk) => risk.remediations.flatMap((response) => response.tasks)));
  const entries = [
    ...risks.map((risk) => candidate(risk.deadline, `${risk.path}/deadline`, 'ungültiges Datum', unreadable.has(`${risk.path}/deadline`))),
    ...tasks.flatMap((task) => taskCandidates(task, unreadable)),
  ].filter((entry) => entry !== undefined);
  const known = entries.filter((entry): entry is Known => 'ms' in entry);
  const gaps: Gap[] = [
    ...unresolvedRisks.map((source): Gap => ({ ...source, reason: 'Risikobezug nicht auflösbar' })),
    ...entries.filter((entry): entry is Gap => 'reason' in entry),
  ];
  if (known.length === 0 && gaps.length === 0) gaps.push(...risks.map((risk): Gap => ({ reason: 'keine Frist', path: `${risk.path}/deadline` })));
  const earliest = known.reduce<Known | undefined>((best, entry) => (best === undefined || earlier(entry, best) ? entry : best), undefined);
  let state: DeadlineState = 'Fristlage unbekannt';
  if (earliest !== undefined && reached(earliest, now.getTime())) state = 'überschritten';
  else if (earliest !== undefined && gaps.length === 0) state = 'noch nicht fällig';
  return { deadline: earliest && { value: earliest.value, path: earliest.path }, state, gaps };
}

function progressRow(item: PoamItem, { risks: riskIndex, findings, now, roleTitles, unreadable }: ProgressContext): PoamProgressRow {
  const risks: PoamRisk[] = [];
  const unresolved: DeadlineSource[] = [];
  for (const related of item.relatedRisks) {
    const risk = resolvedLocal(riskIndex, related.riskUuid, related.reference);
    if (risk === undefined) unresolved.push({ path: `${related.path}/risk-uuid`, value: related.riskUuid });
    else risks.push(risk);
  }
  const responses = risks.flatMap((risk) => risk.remediations);
  const tasks = flattenTasks(responses.flatMap((response) => response.tasks));
  const assessment = assessDeadline(risks, unresolved, now, unreadable);
  const gaps = assessment.gaps.length === 0 && item.relatedRisks.length === 0
    ? [{ reason: 'keine Frist' as const, path: `${item.key}/related-risks` }]
    : assessment.gaps;
  const requirementIds = item.relatedFindings
    .map((related) => resolvedLocal(findings, related.findingUuid, related.reference)?.target?.targetId)
    .filter((id): id is string => id !== undefined);
  const lifecycles = responses.map((response) => {
    const value = response.lifecycle ?? '';
    return { value, documented: (DOCUMENTED_LIFECYCLES as readonly string[]).includes(value) };
  });
  const sources = [
    ...(assessment.deadline ? [{ label: 'Frist (früheste)', ...assessment.deadline }] : []),
    ...gaps.map((gap) => ({ label: gap.reason, path: gap.path, value: gap.value })),
    ...risks.flatMap((risk) => [
      ...(risk.deadline !== undefined && `${risk.path}/deadline` !== assessment.deadline?.path ? [{ label: 'Risiko-Frist', path: `${risk.path}/deadline`, value: risk.deadline }] : []),
      ...risk.remediations.map((response) => ({ label: 'Lifecycle', path: `${response.path}/lifecycle`, value: response.lifecycle })),
      ...(risk.status === undefined ? [] : [{ label: 'Risikostatus', path: `${risk.path}/status`, value: risk.status }]),
    ]),
  ];
  return {
    key: item.key,
    title: item.title,
    requirementIds: [...new Set(requirementIds)],
    deadline: assessment.deadline?.value,
    deadlineState: assessment.state,
    deadlineGaps: gaps,
    sources,
    responsible: [...new Set(tasks.flatMap((task) => task.responsibleRoles.map((role) => roleTitles.get(role.roleId) ?? role.roleId)))],
    riskStatuses: risks.flatMap((risk) => (risk.status === undefined ? [] : [risk.status])),
    lifecycles,
    unresolvedRisks: unresolved.length,
    completed: risks.length > 0 && unresolved.length === 0
      && risks.every((risk) => risk.remediations.length > 0 && risk.remediations.every((response) => response.lifecycle === 'completed')),
  };
}

/** Eine Zeile je `poam-item`; Frist und Stand kommen ausschließlich aus verknüpften Risiken und deren Responses. */
export function derivePoamProgress(
  poam: Poam, now: Date, roleTitles: ReadonlyMap<string, string> = new Map(),
): PoamProgressRow[] {
  const unreadable = new Set(poam.diagnostics.filter((diagnostic) => diagnostic.code.endsWith('_STRUCTURE_UNEXPECTED')).map((diagnostic) => diagnostic.path));
  const context = { risks: indexByUuid(poam.risks), findings: indexByUuid(poam.findings), now, roleTitles, unreadable };
  return poam.poamItems.map((item) => progressRow(item, context));
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
