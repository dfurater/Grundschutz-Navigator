// =============================================================================
// Struktureller Checkpoint-Diff (GSPP-315)
//
// Der Diff nennt nur Pfad, Art und Wertart — keine Rohwerte. Er ist unabhängig
// von der Reihenfolge der Objektschlüssel, vergleicht Arrays über den Index und
// kappt sein Ergebnis. Identitäts- und Mapping-Semantik liefert GSPP-299.
// =============================================================================

import { compareStringsByCodeUnit } from '@/domain/codeUnitOrder.mjs';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { isJsonObject } from '@/domain/jsonGuards';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';

export const DOCUMENT_DIFF_VERSION = 1;
export const DOCUMENT_DIFF_MAX_ENTRIES = 5_000;
export const DOCUMENT_DIFF_MAX_BYTES = 1024 * 1024;
/** Der Quellgraph fügt vor dem Dokumentwurzelobjekt eine Ebene hinzu. */
export const DOCUMENT_DIFF_MAX_DEPTH = CLASS_2_IMPORT_LIMITS.maxDepth + 1;

export type DiffEntryKind = 'added' | 'removed' | 'changed';
export type DiffValueKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface DiffEntry {
  /** JSON Pointer ab dem Quellgraph, z. B. `/profile/metadata/title`. */
  readonly path: string;
  readonly kind: DiffEntryKind;
  readonly valueKind: DiffValueKind;
  /** Root-`uuid` und Root-`metadata.last-modified`: Schreibmarker, kein Inhalt. */
  readonly marker: boolean;
}

export interface DocumentDiff {
  readonly version: typeof DOCUMENT_DIFF_VERSION;
  /** `null`: gegen das leere Dokument verglichen (noch keine Baseline). */
  readonly baseSequence: number | null;
  readonly entries: readonly DiffEntry[];
  readonly truncated: boolean;
}

export interface DocumentDiffInput {
  readonly base: unknown;
  readonly next: unknown;
  readonly rootType: OscalRootKey;
  readonly baseSequence: number | null;
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly maxNodes?: number;
  readonly maxDepth?: number;
}

interface DiffState {
  readonly entries: DiffEntry[];
  readonly markerPaths: ReadonlySet<string>;
  readonly encoder: TextEncoder;
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly maxNodes: number;
  readonly maxDepth: number;
  bytes: number;
  nodes: number;
  truncated: boolean;
  stopped: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return isJsonObject(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function valueKind(value: unknown): DiffValueKind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return isPlainObject(value) ? 'object' : failInvalid();
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : failInvalid();
  if (typeof value === 'boolean') return 'boolean';
  return failInvalid();
}

function failInvalid(): never {
  throw new Error('REVIEW_DIFF_INVALID');
}

/** JSON Pointer: `~` und `/` in Schlüsseln werden escaped, Indizes bleiben Zahlen. */
function escapeSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function push(state: DiffState, path: string, kind: DiffEntryKind, valueKindName: DiffValueKind): void {
  if (state.stopped) return;
  const size = state.encoder.encode(JSON.stringify({ path, kind, valueKind: valueKindName, marker: state.markerPaths.has(path) })).byteLength + 1;
  if (state.entries.length >= state.maxEntries || state.bytes + size > state.maxBytes) {
    state.truncated = true;
    state.stopped = true;
    return;
  }
  state.bytes += size;
  state.entries.push({ path, kind, valueKind: valueKindName, marker: state.markerPaths.has(path) });
}

function countNode(state: DiffState, depth: number): void {
  state.nodes += 1;
  if (state.nodes > state.maxNodes || depth > state.maxDepth) throw new Error('REVIEW_DIFF_LIMIT');
}

/** Fügt einen vollständig neue oder entfallenen Teilbaum als Blätter ein. */
function emitSubtree(state: DiffState, value: unknown, path: string, kind: DiffEntryKind, depth: number): void {
  if (state.stopped) return;
  countNode(state, depth);
  if (Array.isArray(value)) {
    if (!value.length) { push(state, path, kind, 'array'); return; }
    for (let index = 0; index < value.length; index += 1) emitSubtree(state, value[index], `${path}/${index}`, kind, depth + 1);
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort(compareStringsByCodeUnit);
    if (!keys.length) { push(state, path, kind, 'object'); return; }
    for (const key of keys) emitSubtree(state, value[key], `${path}/${escapeSegment(key)}`, kind, depth + 1);
    return;
  }
  push(state, path, kind, valueKind(value));
}

function walk(state: DiffState, base: unknown, next: unknown, path: string, depth: number): void {
  if (state.stopped) return;
  countNode(state, depth);
  const baseKind = valueKind(base);
  const nextKind = valueKind(next);
  if (baseKind !== nextKind || (baseKind !== 'object' && baseKind !== 'array')) {
    if (!Object.is(base, next)) push(state, path, 'changed', nextKind);
    return;
  }
  if (baseKind === 'array') {
    const baseItems = base as readonly unknown[];
    const nextItems = next as readonly unknown[];
    const length = Math.max(baseItems.length, nextItems.length);
    for (let index = 0; index < length; index += 1) {
      const childPath = `${path}/${index}`;
      if (index >= baseItems.length) emitSubtree(state, nextItems[index], childPath, 'added', depth + 1);
      else if (index >= nextItems.length) emitSubtree(state, baseItems[index], childPath, 'removed', depth + 1);
      else walk(state, baseItems[index], nextItems[index], childPath, depth + 1);
    }
    return;
  }
  const baseObject = base as Record<string, unknown>;
  const nextObject = next as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(baseObject), ...Object.keys(nextObject)])].sort(compareStringsByCodeUnit);
  for (const key of keys) {
    const childPath = `${path}/${escapeSegment(key)}`;
    if (!Object.hasOwn(baseObject, key)) emitSubtree(state, nextObject[key], childPath, 'added', depth + 1);
    else if (!Object.hasOwn(nextObject, key)) emitSubtree(state, baseObject[key], childPath, 'removed', depth + 1);
    else walk(state, baseObject[key], nextObject[key], childPath, depth + 1);
  }
}

export function diffDocuments({ base, next, rootType, baseSequence, maxEntries = DOCUMENT_DIFF_MAX_ENTRIES, maxBytes = DOCUMENT_DIFF_MAX_BYTES, maxNodes = CLASS_2_IMPORT_LIMITS.maxNodes, maxDepth = DOCUMENT_DIFF_MAX_DEPTH }: DocumentDiffInput): DocumentDiff {
  const state: DiffState = {
    entries: [],
    markerPaths: new Set([`/${escapeSegment(rootType)}/uuid`, `/${escapeSegment(rootType)}/metadata/last-modified`]),
    encoder: new TextEncoder(),
    maxEntries, maxBytes, maxNodes, maxDepth,
    bytes: 0, nodes: 0, truncated: false, stopped: false,
  };
  walk(state, base, next, '', 0);
  return { version: DOCUMENT_DIFF_VERSION, baseSequence, entries: state.entries, truncated: state.truncated };
}
