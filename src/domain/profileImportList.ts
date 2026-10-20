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
