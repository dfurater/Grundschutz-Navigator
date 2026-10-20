// =============================================================================
// Profile Authoring: Neuanlage und Importliste (GSPP-292)
//
// Jeder Import trägt ein `href`: Das Metaschema verlangt es in jeder Version,
// das JSON-Schema 1.2.x nicht. Die Anwendung schreibt es als Fragment
// `#<uuid>` auf eine eigene `back-matter.resource`; das Ziel hält eine
// Bindung im Speicher fest, nie ein auflösbarer Verweis im Dokument.
// =============================================================================

import { isJsonObject, readArray, type JsonObject } from '@/domain/jsonGuards';
import { ProfilePatchError } from '@/domain/profileAuthoring';

function body(source: unknown): JsonObject | undefined {
  return isJsonObject(source) && isJsonObject(source.profile) ? source.profile : undefined;
}

export interface ImportTargetInput {
  /** UUID der neuen `back-matter.resource`; `import.href` wird `#<uuid>`. */
  readonly resourceUuid: string;
  readonly title: string;
}

function resourceFor(target: ImportTargetInput): JsonObject {
  return { uuid: target.resourceUuid, title: target.title };
}

/** Hängt einen Import mit `include-all` und seine `back-matter.resource` an. */
export function addImport(source: unknown, target: ImportTargetInput): { source: unknown; index: number; href: string } {
  const copy = structuredClone(source);
  const profile = body(copy);
  if (!profile || !Array.isArray(profile.imports)) throw new ProfilePatchError('PROFILE_IMPORTS_INVALID');
  const href = `#${target.resourceUuid}`;
  profile.imports.push({ href, 'include-all': {} });
  if (!isJsonObject(profile['back-matter'])) profile['back-matter'] = {};
  const backMatter = profile['back-matter'] as JsonObject;
  backMatter.resources = [...readArray(backMatter.resources), resourceFor(target)];
  return { source: copy, index: profile.imports.length - 1, href };
}

/** Entfernt einen Import; `imports` behält mindestens einen Eintrag. Die `back-matter` bleibt unverändert. */
export function removeImport(source: unknown, index: number): unknown {
  const copy = structuredClone(source);
  const imports = body(copy)?.imports;
  if (!Array.isArray(imports) || !isJsonObject(imports[index])) throw new ProfilePatchError('PROFILE_IMPORT_NOT_FOUND');
  if (imports.length === 1) throw new ProfilePatchError('PROFILE_IMPORTS_REQUIRED');
  imports.splice(index, 1);
  return copy;
}

export interface NewProfileInput extends ImportTargetInput {
  readonly uuid: string;
  readonly profileTitle: string;
  readonly oscalVersion: string;
  /** `metadata.last-modified`, ISO 8601 mit Zeitzone. */
  readonly lastModified: string;
}

/** Ein Profil verlangt `metadata.title`, das kein reiner Leerraum ist. */
export function isProfileTitle(value: string): boolean {
  return value.trim() !== '';
}

/**
 * Ein neues Profil trägt von Anfang an `uuid`, `metadata` mit der
 * `oscal-version` seines Importziels und genau einen Import mit `href`
 * (`imports` und `metadata.oscal-version` sind Pflicht; ein leeres Profil
 * gibt es in OSCAL nicht).
 */
export function createProfileSource(input: NewProfileInput): { source: JsonObject; href: string } {
  if (!isProfileTitle(input.profileTitle)) throw new ProfilePatchError('PROFILE_TITLE_REQUIRED');
  const href = `#${input.resourceUuid}`;
  return {
    href,
    source: {
      profile: {
        uuid: input.uuid,
        metadata: {
          title: input.profileTitle,
          'last-modified': input.lastModified,
          version: '1.0',
          'oscal-version': input.oscalVersion,
        },
        imports: [{ href, 'include-all': {} }],
        'back-matter': { resources: [resourceFor(input)] },
      },
    },
  };
}

/** JSON Pointer des `href` eines Imports; Ort jeder Import-Bindung. */
export function importHrefPointer(index: number): string {
  return `/profile/imports/${index}/href`;
}

const IMPORT_POINTER = /^\/profile\/imports\/(\d+)\/href$/;

function importIndex(pointer: string): number | undefined {
  const match = IMPORT_POINTER.exec(pointer);
  return match ? Number(match[1]) : undefined;
}

/** Bindungen nach `removeImport(index)`: Die Bindung des entfernten Imports entfällt, die folgenden rücken nach. */
export function shiftImportBindings<T extends { readonly pointer: string }>(bindings: readonly T[], removed: number): T[] {
  return bindings.flatMap((binding) => {
    const index = importIndex(binding.pointer);
    if (index === undefined || index < removed) return [binding];
    return index === removed ? [] : [{ ...binding, pointer: importHrefPointer(index - 1) }];
  });
}

function importHrefs(source: unknown): (string | undefined)[] {
  const imports = isJsonObject(source) && isJsonObject(source.profile) ? readArray(source.profile.imports) : [];
  return imports.map((entry) => isJsonObject(entry) && typeof entry.href === 'string' ? entry.href : undefined);
}

/**
 * Richtet gespeicherte Import-Bindungen an einem Entwurf aus, dessen Importe
 * sich gegenüber dem gespeicherten Dokument verschoben haben können.
 * Gemeinsamer Anfang und gemeinsames Ende der `href`-Folgen behalten ihre
 * Bindungen an der jeweils neuen Position; eine Überlappung beider und jeder
 * Randwert, der auch in einer Mitte vorkommt, gelten als mehrdeutig und gehören
 * zur Mitte. In der Mitte folgt ein `href`
 * nur dann seiner Bindung, wenn er in beiden Fassungen eindeutig ist, sonst
 * bleibt der Import ungebunden statt fremd gebunden.
 */
export function alignImportBindings<T extends { readonly pointer: string; readonly href: string }>(bindings: readonly T[], stored: unknown, draft: unknown): T[] {
  const before = importHrefs(stored);
  const after = importHrefs(draft);
  if (before.length === after.length && before.every((href, index) => href === after[index])) return [...bindings];
  const shorter = Math.min(before.length, after.length);
  let head = 0;
  while (head < shorter && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < shorter && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const overlap = Math.max(0, head + tail - shorter);
  head -= overlap;
  tail -= overlap;
  // Ein Randwert, der auch in einer Mitte steht, kann von dort nachgerückt sein: dann ist auch der Rand mehrdeutig.
  // Die Werte der Mitten wachsen beim Verkleinern nur; als Menge geführt bleibt das linear.
  const middle = new Set([...before.slice(head, before.length - tail), ...after.slice(head, after.length - tail)]);
  let narrowed = true;
  while (narrowed) {
    narrowed = false;
    if (head > 0 && middle.has(before[head - 1])) {
      head--;
      middle.add(before[head]).add(after[head]);
      narrowed = true;
    }
    if (tail > 0 && middle.has(before[before.length - tail])) {
      middle.add(before[before.length - tail]).add(after[after.length - tail]);
      tail--;
      narrowed = true;
    }
  }
  // Position im Entwurf zu einer gespeicherten Position am Anfang oder Ende; die Mitte hat keine.
  const moved = (index: number) => {
    if (index < head) return index;
    return index >= before.length - tail ? index - before.length + after.length : undefined;
  };
  const counts = (list: readonly (string | undefined)[]) => {
    const map = new Map<string | undefined, number>();
    for (const href of list) map.set(href, (map.get(href) ?? 0) + 1);
    return map;
  };
  const beforeCounts = counts(before);
  const afterCounts = counts(after);
  const firstInDraft = new Map<string | undefined, number>();
  after.forEach((href, index) => { if (!firstInDraft.has(href)) firstInDraft.set(href, index); });
  return bindings.flatMap((binding) => {
    const index = importIndex(binding.pointer);
    if (index === undefined) return [binding];
    const target = moved(index);
    if (target !== undefined) return after[target] === binding.href ? [{ ...binding, pointer: importHrefPointer(target) }] : [];
    if (beforeCounts.get(binding.href) !== 1 || afterCounts.get(binding.href) !== 1) return [];
    const position = firstInDraft.get(binding.href) ?? -1;
    return position >= head && position < after.length - tail ? [{ ...binding, pointer: importHrefPointer(position) }] : [];
  });
}
