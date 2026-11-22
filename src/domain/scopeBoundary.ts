/**
 * Abgrenzung eines Anwendungsbereichs nach BSI-Standard 300-1 § 2.3 (Scope-Vertrag §4, Kategorie `scope`).
 * „Erfasst“ heißt vollständig dokumentiert, nicht von der Institutionsleitung festgelegt.
 */

export const SCOPE_BOUNDARY_DETAILS = [
  ['organization', 'Organisatorische Abgrenzung'],
  ['processCoverage', 'Geschäftsprozesse'],
  ['infrastructure', 'Standorte, Anwendungen und IT-Systeme'],
  ['externalParties', 'Externe Partner und Dienstleister'],
  ['interfaces', 'Schnittstellen'],
  ['exclusions', 'Ausschlüsse'],
] as const;

export type ScopeBoundaryDetailKey = typeof SCOPE_BOUNDARY_DETAILS[number][0];
export type ScopeBoundaryDetails = Readonly<Record<ScopeBoundaryDetailKey, string>>;

export interface ScopeBoundaryItem {
  /** Zufällige UUID; bleibt bei jeder Überarbeitung stabil. */
  readonly itemId: string;
  readonly category: 'scope';
  readonly content?: string;
  readonly details: ScopeBoundaryDetails;
  readonly source?: { readonly label: string; readonly version?: string; readonly issuedAt?: string };
  readonly responsibility?: { readonly role: string; readonly party: string };
  readonly evidenceIds: readonly [];
  readonly conflictsWith: readonly [];
  readonly supersedes: readonly [];
}

/** Formularwerte des Editors; jedes Feld ist roh eingegebener Text. */
export type ScopeBoundaryInput = Readonly<Record<ScopeBoundaryDetailKey | 'content' | 'sourceLabel' | 'sourceVersion' | 'sourceIssuedAt' | 'role' | 'party', string>>;

export type ScopeBoundaryState =
  | { readonly kind: 'missing' }
  | { readonly kind: 'open'; readonly missing: readonly string[] }
  | { readonly kind: 'complete' };

const ISSUED_AT = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeText(value: string): string {
  return value.normalize('NFC').trim();
}

/** `YYYY-MM-DD` eines existierenden Kalendertags. */
export function isIssuedAt(value: unknown): value is string {
  if (typeof value !== 'string' || !ISSUED_AT.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Eintrag aus Formularwerten; leere optionale Angaben entfallen, ein ungültiges Datum wird abgelehnt. */
export function buildScopeBoundary(itemId: string, input: ScopeBoundaryInput): ScopeBoundaryItem | null {
  const text = (key: keyof ScopeBoundaryInput) => normalizeText(input[key]);
  const details = Object.fromEntries(SCOPE_BOUNDARY_DETAILS.map(([key]) => [key, text(key)])) as Record<ScopeBoundaryDetailKey, string>;
  const [content, label, version, issuedAt, role, party] = (['content', 'sourceLabel', 'sourceVersion', 'sourceIssuedAt', 'role', 'party'] as const).map(text);
  if (issuedAt !== '' && !isIssuedAt(issuedAt)) return null;
  return {
    itemId,
    category: 'scope',
    ...(content ? { content } : {}),
    details,
    ...(label || version || issuedAt ? { source: { label, ...(version ? { version } : {}), ...(issuedAt ? { issuedAt } : {}) } } : {}),
    ...(role || party ? { responsibility: { role, party } } : {}),
    evidenceIds: [],
    conflictsWith: [],
    supersedes: [],
  };
}

/** Formularwerte eines vorhandenen Eintrags; ohne Eintrag leer. */
export function scopeBoundaryInput(item: ScopeBoundaryItem | undefined): ScopeBoundaryInput {
  return {
    ...Object.fromEntries(SCOPE_BOUNDARY_DETAILS.map(([key]) => [key, item?.details[key] ?? ''])) as Record<ScopeBoundaryDetailKey, string>,
    content: item?.content ?? '',
    sourceLabel: item?.source?.label ?? '',
    sourceVersion: item?.source?.version ?? '',
    sourceIssuedAt: item?.source?.issuedAt ?? '',
    role: item?.responsibility?.role ?? '',
    party: item?.responsibility?.party ?? '',
  };
}

/** Gleiche Formularwerte in allen Feldern. */
export function sameBoundaryInput(a: ScopeBoundaryInput, b: ScopeBoundaryInput): boolean {
  return (Object.keys(a) as (keyof ScopeBoundaryInput)[]).every((key) => a[key] === b[key]);
}

/** Editorentwurf mit dem `savedAt` und dem Inhalt des Anwendungsbereichs, auf denen er beruht. */
export interface ScopeBoundaryDraft {
  readonly input: ScopeBoundaryInput;
  readonly base: string;
  readonly baseInput: ScopeBoundaryInput;
  /** `itemId` des gespeicherten Eintrags oder `null` ohne Eintrag. */
  readonly baseItemId: string | null;
}

/** Neuer Entwurf aus dem gespeicherten Stand eines Anwendungsbereichs. */
export function startBoundaryDraft(scope: { readonly savedAt: string; readonly items: readonly ScopeBoundaryItem[] }): ScopeBoundaryDraft {
  const input = scopeBoundaryInput(scope.items[0]);
  return { input, base: scope.savedAt, baseInput: input, baseItemId: scope.items[0]?.itemId ?? null };
}

/**
 * Vergleichsstand, mit dem ein Entwurf speichern darf: Ist die gespeicherte Abgrenzung noch derselbe Eintrag mit
 * demselben Inhalt, auf dem er beruht, gilt der neuere Stempel (etwa nach einer Zuordnungsänderung); sonst `null`, weil neuerer Inhalt vorliegt.
 */
export function boundaryDraftBase(draft: ScopeBoundaryDraft, scope: { readonly savedAt: string; readonly items: readonly ScopeBoundaryItem[] }): string | null {
  if (scope.savedAt === draft.base) return draft.base;
  const item = scope.items[0];
  return (item?.itemId ?? null) === draft.baseItemId && sameBoundaryInput(scopeBoundaryInput(item), draft.baseInput) ? scope.savedAt : null;
}

/** „Fehlt“ ohne Eintrag, „Erfasst“ bei vollständigen Angaben, sonst „Offen“ mit den fehlenden Feldern in Formularreihenfolge. */
export function scopeBoundaryState(item: ScopeBoundaryItem | undefined): ScopeBoundaryState {
  if (!item) return { kind: 'missing' };
  const missing: string[] = SCOPE_BOUNDARY_DETAILS.filter(([key]) => item.details[key] === '').map(([, label]) => label);
  if (!item.source?.label) missing.push('Quelle');
  if (!item.source?.version && !item.source?.issuedAt) missing.push('Version oder Datum');
  if (!item.responsibility?.role) missing.push('Rolle');
  if (!item.responsibility?.party) missing.push('Zuständige Stelle');
  return missing.length === 0 ? { kind: 'complete' } : { kind: 'open', missing };
}

/** Quellenstand ausschließlich aus `source`: „Abgrenzung v2 · v2 · 22.10.2026“ ohne leere Teile. */
export function scopeBoundarySourceText(source: ScopeBoundaryItem['source']): string {
  if (!source) return '';
  const date = source.issuedAt ? source.issuedAt.split('-').reverse().join('.') : '';
  return [source.label, source.version ?? '', date].filter(Boolean).join(' · ');
}
