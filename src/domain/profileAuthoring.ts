// =============================================================================
// Profile Authoring: Lesemodell und gezielte Patches der Importe (GSPP-292)
//
// Jede Änderung klont die Quelle und ändert genau die betroffenen Felder; alle
// übrigen Inhalte — unbekannte Felder, Extensions, `back-matter`, fremde
// `prop.ns` — bleiben unverändert (ADR-2). Die Funktionen sind rein: kein
// Speicher, keine Uhr, keine Zufallsquelle; UUID und Zeitstempel kommen vom
// Aufrufer.
// =============================================================================

import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import { localFragmentUuid } from '@/domain/referenceResolution';

/** `include-all` ODER `include-controls` (1.2.x: genau einer Pflicht, 1.1.x: auch keiner). */
export type ProfileImportMode = 'all' | 'controls' | 'none' | 'both';
export type ProfileSelectionScope = 'include' | 'exclude';
export type WithChildControls = 'yes' | 'no';

/** Ab OSCAL 1.2.1 ist `import` ein `anyOf` mit gegenseitigem Ausschluss der beiden Zweige. */
export type ProfileImportStructure = 'exclusive' | 'optional';

const WITH_CHILD_CONTROLS: ReadonlySet<string> = new Set(['yes', 'no']);

export function importStructureFor(oscalVersion: string): ProfileImportStructure {
  return oscalVersion.startsWith('1.1.') ? 'optional' : 'exclusive';
}

/** Die Zweigwahl, die das Formular für eine Version anbietet. */
export function importModesFor(oscalVersion: string): readonly ('controls' | 'all' | 'none')[] {
  return importStructureFor(oscalVersion) === 'optional' ? ['controls', 'all', 'none'] : ['controls', 'all'];
}

export interface ProfilePatternView {
  /** Index in `include-controls` bzw. `exclude-controls`. */
  readonly selector: number;
  /** Index in `matching`. */
  readonly item: number;
  /** Fehlt bei einem `matching` ohne `pattern`. */
  readonly pattern?: string;
}

export interface ProfileSelectorView {
  /** `with-ids` aller Selektoren in Quellreihenfolge, ohne Dubletten. */
  readonly withIds: readonly string[];
  readonly patterns: readonly ProfilePatternView[];
  /**
   * `with-child-controls` über alle Selektoren; `mixed`, wenn sie sich
   * unterscheiden. Ein fehlender Wert zählt als `no`.
   */
  readonly withChildControls?: string;
}

export interface ProfileImportView {
  readonly index: number;
  readonly href?: string;
  /** UUID der `back-matter.resource`, wenn `href` ein lokales Fragment ist. */
  readonly resourceUuid?: string;
  readonly resourceTitle?: string;
  readonly mode: ProfileImportMode;
  readonly include: ProfileSelectorView;
  readonly exclude: ProfileSelectorView;
}

function body(source: unknown): JsonObject | undefined {
  return isJsonObject(source) && isJsonObject(source.profile) ? source.profile : undefined;
}

function selectorView(selectors: readonly unknown[]): ProfileSelectorView {
  const withIds: string[] = [];
  const seen = new Set<string>();
  const patterns: ProfilePatternView[] = [];
  selectors.forEach((selector, index) => {
    if (!isJsonObject(selector)) return;
    for (const entry of readArray(selector['with-ids'])) {
      if (typeof entry === 'string' && !seen.has(entry)) {
        seen.add(entry);
        withIds.push(entry);
      }
    }
    readArray(selector.matching).forEach((matching, item) => {
      patterns.push({ selector: index, item, pattern: isJsonObject(matching) ? readString(matching.pattern) : undefined });
    });
  });
  const values = new Set(selectors.filter(isJsonObject).map((selector) => readString(selector['with-child-controls']) ?? 'no'));
  const [single] = values;
  return { withIds, patterns, withChildControls: values.size > 1 ? 'mixed' : single };
}

function resourceTitle(profile: JsonObject, uuid: string | undefined): string | undefined {
  if (uuid === undefined || !isJsonObject(profile['back-matter'])) return undefined;
  const resource = readArray(profile['back-matter'].resources)
    .find((entry) => isJsonObject(entry) && readString(entry.uuid)?.toLowerCase() === uuid);
  return isJsonObject(resource) ? readString(resource.title) : undefined;
}

function modeOf(entry: JsonObject): ProfileImportMode {
  const all = Object.hasOwn(entry, 'include-all');
  const controls = Object.hasOwn(entry, 'include-controls');
  if (all && controls) return 'both';
  if (all) return 'all';
  return controls ? 'controls' : 'none';
}

/** Lesemodell aller Importe; ein Eintrag, der kein Objekt ist, erscheint nicht. */
export function readProfileImports(source: unknown): ProfileImportView[] {
  const profile = body(source);
  if (!profile) return [];
  return readArray(profile.imports).flatMap((entry, index) => {
    if (!isJsonObject(entry)) return [];
    const href = readString(entry.href);
    const uuid = href === undefined ? undefined : localFragmentUuid(href) ?? undefined;
    return [{
      index,
      href,
      resourceUuid: uuid,
      resourceTitle: resourceTitle(profile, uuid),
      mode: modeOf(entry),
      include: selectorView(readArray(entry['include-controls'])),
      exclude: selectorView(readArray(entry['exclude-controls'])),
    }];
  });
}

export function profileTitle(source: unknown): string | undefined {
  const metadata = body(source)?.metadata;
  return isJsonObject(metadata) ? readString(metadata.title) : undefined;
}

export function profileOscalVersion(source: unknown): string | undefined {
  const metadata = body(source)?.metadata;
  return isJsonObject(metadata) ? readString(metadata['oscal-version']) : undefined;
}

export class ProfilePatchError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'ProfilePatchError';
  }
}

/** Klont die Quelle und reicht den Import `index` der Kopie an `change` weiter. */
function patchImport(source: unknown, index: number, change: (entry: JsonObject) => void): unknown {
  const copy = structuredClone(source);
  const entry = readArray(body(copy)?.imports)[index];
  if (!isJsonObject(entry)) throw new ProfilePatchError('PROFILE_IMPORT_NOT_FOUND');
  change(entry);
  return copy;
}

function selectorKey(scope: ProfileSelectionScope): 'include-controls' | 'exclude-controls' {
  return scope === 'include' ? 'include-controls' : 'exclude-controls';
}

/** Erster Selektor des Bereichs; fehlt die Liste, entsteht `[{}]`. */
function firstSelector(entry: JsonObject, scope: ProfileSelectionScope): JsonObject {
  const key = selectorKey(scope);
  if (!Array.isArray(entry[key]) || entry[key].length === 0) entry[key] = [{}];
  const selectors = entry[key] as unknown[];
  if (!isJsonObject(selectors[0])) throw new ProfilePatchError('PROFILE_SELECTOR_INVALID');
  return selectors[0];
}

/** `minItems: 1` für `with-ids`, `matching` und `exclude-controls`: Eine leere Liste entfällt. */
function dropEmpty(container: JsonObject, key: string): void {
  if (Array.isArray(container[key]) && container[key].length === 0) delete container[key];
}

/** Ein Ausschluss ohne Wirkung entfällt; ein leerer Einschlussselektor bleibt als Hinweis stehen. */
function tidyExclude(entry: JsonObject): void {
  const selectors = readArray(entry['exclude-controls']);
  if (selectors.length === 1 && isJsonObject(selectors[0]) && Object.keys(selectors[0]).length === 0) delete entry['exclude-controls'];
}

export function setImportMode(source: unknown, index: number, mode: 'all' | 'controls' | 'none', oscalVersion: string): unknown {
  if (!importModesFor(oscalVersion).includes(mode)) throw new ProfilePatchError('PROFILE_IMPORT_MODE_UNSUPPORTED');
  return patchImport(source, index, (entry) => {
    if (mode !== 'all') delete entry['include-all'];
    if (mode !== 'controls') delete entry['include-controls'];
    if (mode === 'all' && !isJsonObject(entry['include-all'])) entry['include-all'] = {};
    if (mode === 'controls') firstSelector(entry, 'include');
  });
}

/**
 * Setzt oder entfernt Anforderungen auf einer einzigen Kopie; entfernt wird
 * eine Anforderung aus jedem Selektor des Bereichs.
 */
export function setSelectedControls(source: unknown, index: number, scope: ProfileSelectionScope, controlIds: readonly string[], selected: boolean): unknown {
  if (controlIds.includes('')) throw new ProfilePatchError('PROFILE_CONTROL_ID_INVALID');
  return patchImport(source, index, (entry) => {
    for (const controlId of controlIds) {
      const selectors = readArray(entry[selectorKey(scope)]).filter(isJsonObject);
      const present = selectors.some((selector) => readArray(selector['with-ids']).includes(controlId));
      if (selected && !present) {
        const first = firstSelector(entry, scope);
        first['with-ids'] = [...readArray(first['with-ids']), controlId];
      } else if (!selected) {
        for (const selector of selectors) {
          if (!Array.isArray(selector['with-ids'])) continue;
          selector['with-ids'] = selector['with-ids'].filter((id) => id !== controlId);
          dropEmpty(selector, 'with-ids');
        }
      }
    }
    if (!selected && scope === 'exclude') tidyExclude(entry);
  });
}

export function setSelectedControl(source: unknown, index: number, scope: ProfileSelectionScope, controlId: string, selected: boolean): unknown {
  return setSelectedControls(source, index, scope, [controlId], selected);
}

/** Schreibt `with-child-controls` in jeden Selektor des Bereichs; fehlt einer, entsteht der erste. */
export function setWithChildControls(source: unknown, index: number, scope: ProfileSelectionScope, value: string): unknown {
  if (!WITH_CHILD_CONTROLS.has(value)) throw new ProfilePatchError('PROFILE_WITH_CHILD_CONTROLS_INVALID');
  return patchImport(source, index, (entry) => {
    firstSelector(entry, scope);
    for (const selector of readArray(entry[selectorKey(scope)]).filter(isJsonObject)) selector['with-child-controls'] = value;
  });
}

/** Ein neues `matching` beginnt ohne `pattern`; das ist schemagültig und erscheint als Hinweis. */
export function addPattern(source: unknown, index: number, scope: ProfileSelectionScope): unknown {
  return patchImport(source, index, (entry) => {
    const first = firstSelector(entry, scope);
    first.matching = [...readArray(first.matching), {}];
  });
}

function matchingAt(entry: JsonObject, scope: ProfileSelectionScope, ref: Pick<ProfilePatternView, 'selector' | 'item'>): { selector: JsonObject; matching: JsonObject } {
  const selector = readArray(entry[selectorKey(scope)])[ref.selector];
  const matching = isJsonObject(selector) ? readArray(selector.matching)[ref.item] : undefined;
  if (!isJsonObject(selector) || !isJsonObject(matching)) throw new ProfilePatchError('PROFILE_MATCHING_NOT_FOUND');
  return { selector, matching };
}

/** `pattern` ist ein Glob-Ausdruck auf Control-IDs; ein leerer Wert entfernt das Feld. */
export function setPattern(source: unknown, index: number, scope: ProfileSelectionScope, ref: Pick<ProfilePatternView, 'selector' | 'item'>, pattern: string): unknown {
  return patchImport(source, index, (entry) => {
    const { matching } = matchingAt(entry, scope, ref);
    if (pattern === '') delete matching.pattern;
    else matching.pattern = pattern;
  });
}

export function removePattern(source: unknown, index: number, scope: ProfileSelectionScope, ref: Pick<ProfilePatternView, 'selector' | 'item'>): unknown {
  return patchImport(source, index, (entry) => {
    const { selector } = matchingAt(entry, scope, ref);
    selector.matching = readArray(selector.matching).filter((_, item) => item !== ref.item);
    dropEmpty(selector, 'matching');
    if (scope === 'exclude') tidyExclude(entry);
  });
}
