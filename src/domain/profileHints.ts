// =============================================================================
// Unterbestimmte, aber schemagültige Profilkonstrukte (GSPP-292)
//
// Das Profile-Schema erlaubt Konstrukte ohne Wirkung: ein Selektor ohne
// Kriterium, ein `matching` ohne `pattern`, ein leeres `modify`, ein `alter`
// ohne `adds`/`removes` und ein `remove` ohne Kriterium. Sie sind kein Fehler
// und kein Ablehnungsgrund; die Station zeigt sie als Hinweis. Ein Hinweis
// trägt Code und JSON Pointer, nie einen Dokumentwert.
// =============================================================================

import { isJsonObject, readArray, type JsonObject } from '@/domain/jsonGuards';

export const PROFILE_HINT_CODES = Object.freeze({
  selectionEmpty: 'OSCAL_PROFILE_HINT_SELECTION_EMPTY',
  matchingWithoutPattern: 'OSCAL_PROFILE_HINT_MATCHING_WITHOUT_PATTERN',
  modifyEmpty: 'OSCAL_PROFILE_HINT_MODIFY_EMPTY',
  alterWithoutEffect: 'OSCAL_PROFILE_HINT_ALTER_WITHOUT_EFFECT',
  removeWithoutCriteria: 'OSCAL_PROFILE_HINT_REMOVE_WITHOUT_CRITERIA',
} as const);

export type ProfileHintCode = (typeof PROFILE_HINT_CODES)[keyof typeof PROFILE_HINT_CODES];

export interface ProfileHint {
  readonly code: ProfileHintCode;
  readonly path: string;
}

const REMOVE_CRITERIA = ['by-name', 'by-class', 'by-id', 'by-item-name', 'by-ns'];

function selectorHints(selectors: readonly unknown[], path: string, hints: ProfileHint[]): void {
  selectors.forEach((selector, index) => {
    if (!isJsonObject(selector)) return;
    const at = `${path}/${index}`;
    if (!Object.hasOwn(selector, 'with-ids') && !Object.hasOwn(selector, 'matching')) {
      hints.push({ code: PROFILE_HINT_CODES.selectionEmpty, path: at });
    }
    readArray(selector.matching).forEach((matching, item) => {
      if (isJsonObject(matching) && !Object.hasOwn(matching, 'pattern')) {
        hints.push({ code: PROFILE_HINT_CODES.matchingWithoutPattern, path: `${at}/matching/${item}` });
      }
    });
  });
}

function modifyHints(modify: JsonObject, hints: ProfileHint[]): void {
  if (!Object.hasOwn(modify, 'set-parameters') && !Object.hasOwn(modify, 'alters')) {
    hints.push({ code: PROFILE_HINT_CODES.modifyEmpty, path: '/profile/modify' });
  }
  readArray(modify.alters).forEach((alter, index) => {
    if (!isJsonObject(alter)) return;
    const at = `/profile/modify/alters/${index}`;
    if (!Object.hasOwn(alter, 'adds') && !Object.hasOwn(alter, 'removes')) {
      hints.push({ code: PROFILE_HINT_CODES.alterWithoutEffect, path: at });
    }
    readArray(alter.removes).forEach((remove, item) => {
      if (isJsonObject(remove) && !REMOVE_CRITERIA.some((key) => Object.hasOwn(remove, key))) {
        hints.push({ code: PROFILE_HINT_CODES.removeWithoutCriteria, path: `${at}/removes/${item}` });
      }
    });
  });
}

/** Alle Hinweise eines Profils in Dokumentreihenfolge; die Quelle bleibt unverändert. */
export function collectProfileHints(source: unknown): ProfileHint[] {
  const profile = isJsonObject(source) && isJsonObject(source.profile) ? source.profile : undefined;
  if (!profile) return [];
  const hints: ProfileHint[] = [];
  readArray(profile.imports).forEach((entry, index) => {
    if (!isJsonObject(entry)) return;
    selectorHints(readArray(entry['include-controls']), `/profile/imports/${index}/include-controls`, hints);
    selectorHints(readArray(entry['exclude-controls']), `/profile/imports/${index}/exclude-controls`, hints);
  });
  if (isJsonObject(profile.modify)) modifyHints(profile.modify, hints);
  return hints;
}
