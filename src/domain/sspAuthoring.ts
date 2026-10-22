// =============================================================================
// SSP Authoring: Neuanlage, gezielte Patches und offene Pflichtstruktur (GSPP-609)
//
// Jede Änderung klont die Quelle und ändert genau den adressierten Wert; alle
// übrigen Inhalte — unbekannte Felder, fremde `props`, `links`, `remarks`,
// `back-matter` und nicht bearbeitete Strukturen — bleiben unverändert (ADR-2).
// Die Funktionen sind rein: UUIDs und Zeitstempel kommen vom Aufrufer. Nur die
// Neuanlage und das Anhängen einer Zeile bringen neue UUIDs ins Dokument; die
// Root-UUID ist `per-subject` und wird von keiner Änderung berührt.
// =============================================================================

import { uuidKey } from '@/adapters/oscalSspReaders';
import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import { resolveSchemaBinding } from '@/domain/oscalVersionMatrix';
import { createReferenceDocument, localFragmentUuid, resolveOscalReference } from '@/domain/referenceResolution';
import { isBindableReference } from '@/domain/workspaceGraphContext';

/** Neue SSPs tragen diese `oscal-version` (Vorgabe des Projektinhabers). */
export const NEW_SSP_OSCAL_VERSION = '1.2.2';

/** JSON Pointer des Baseline-Verweises; Ort der Baseline-Bindung. */
export const SSP_IMPORT_PROFILE_POINTER = '/system-security-plan/import-profile/href';

/** Geschlossene Aufzählung von `system-characteristics.status.state`. */
export const SSP_SYSTEM_STATES = ['operational', 'under-development', 'under-major-modification', 'disposition', 'other'] as const;

/** Geschlossene Aufzählung von `system-component.status.state`. */
export const SSP_COMPONENT_STATES = ['under-development', 'operational', 'disposition', 'other'] as const;

export class SspPatchError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'SspPatchError';
  }
}

/** Pfad unterhalb von `system-security-plan`; Schlüssel stammen aus dem Code, nie aus Eingaben. */
export type SspPath = readonly (string | number)[];

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);

export function sspBody(source: unknown): JsonObject | undefined {
  return isJsonObject(source) && isJsonObject(source['system-security-plan']) ? source['system-security-plan'] : undefined;
}

/**
 * Die gebundene Schemaversion eines SSP-Quellgraphen, wie der Root-Dispatch
 * sie für Klasse 2 bildet (`v1.1.2` bindet 1.1.2); der Quellwert bleibt.
 */
export function sspOscalVersion(source: unknown): string | undefined {
  const metadata = sspBody(source)?.metadata;
  const declared = isJsonObject(metadata) ? readString(metadata['oscal-version']) : undefined;
  const binding = resolveSchemaBinding({ rootType: 'system-security-plan', oscalVersion: declared, acceptVersionPrefix: true });
  return binding.ok ? binding.pin.oscalVersion : undefined;
}

/**
 * Lässt sich `import-profile.href` an ein Dokument binden? Dieselbe Regel wie
 * im Verbundgraphen: Ein externer oder unsicherer Verweis erhält nie ein
 * Workspace-Ziel (`isBindableReference()`).
 */
export function sspBaselineBindable(source: unknown): boolean {
  const href = readString(readSspValue(source, ['import-profile', 'href']));
  const oscalVersion = sspOscalVersion(source);
  if (href === undefined || oscalVersion === undefined) return false;
  const document = createReferenceDocument({ source, context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion });
  return isBindableReference(resolveOscalReference({ href, path: SSP_IMPORT_PROFILE_POINTER }, { document }));
}

/** `system-implementation.users`: Pflicht in 1.1.2 und 1.1.3, optional ab 1.2.1. */
export function sspUsersRequired(oscalVersion: string | undefined): boolean {
  return oscalVersion?.startsWith('1.1.') === true;
}

/** `protocol.name`: Pflicht nur in 1.1.2. */
export function sspProtocolNameRequired(oscalVersion: string | undefined): boolean {
  return oscalVersion === '1.1.2';
}

export function readSspValue(source: unknown, path: SspPath): unknown {
  let node: unknown = sspBody(source);
  for (const segment of path) {
    if (Array.isArray(node) && typeof segment === 'number') node = node[segment];
    else if (isJsonObject(node) && typeof segment === 'string' && Object.hasOwn(node, segment)) node = node[segment];
    else return undefined;
  }
  return node;
}

function checkSegment(segment: string | number): void {
  if (typeof segment === 'string' && FORBIDDEN_KEYS.has(segment)) throw new SspPatchError('SSP_PATH_INVALID');
}

function asContainer(value: unknown): JsonObject | unknown[] {
  if (!isJsonObject(value) && !Array.isArray(value)) throw new SspPatchError('SSP_PATH_INVALID');
  return value;
}

/** Ein Schritt entlang des Pfads; Listen werden über Indizes, Objekte über Schlüssel betreten. */
function child(node: JsonObject | unknown[], segment: string | number, create: boolean): JsonObject | unknown[] {
  checkSegment(segment);
  if (Array.isArray(node)) return asContainer(typeof segment === 'number' ? node[segment] : undefined);
  if (typeof segment !== 'string') throw new SspPatchError('SSP_PATH_INVALID');
  if (!Object.hasOwn(node, segment) && create) node[segment] = {};
  return asContainer(node[segment]);
}

/** Container am Pfad in einer Kopie; fehlende Objekte entlang des Pfads entstehen, Listen nie. */
function containerAt(body: JsonObject, path: SspPath, create: boolean): JsonObject | unknown[] {
  return path.reduce<JsonObject | unknown[]>((node, segment) => child(node, segment, create), body);
}

function editable(source: unknown): { copy: unknown; body: JsonObject } {
  const copy = structuredClone(source);
  const body = sspBody(copy);
  if (!body) throw new SspPatchError('SSP_ROOT_INVALID');
  return { copy, body };
}

/**
 * Setzt einen Textwert. Leerraum allein entfernt den Schlüssel: Ein fehlendes
 * Pflichtfeld erscheint dann als offene Pflichtstruktur statt als
 * schemawidriger Leertext.
 */
export function setSspValue(source: unknown, path: SspPath, value: string): unknown {
  if (path.length === 0) throw new SspPatchError('SSP_PATH_INVALID');
  const { copy, body } = editable(source);
  const parent = containerAt(body, path.slice(0, -1), true);
  const key = path.at(-1)!;
  checkSegment(key);
  if (Array.isArray(parent)) {
    if (typeof key !== 'number' || key < 0 || key >= parent.length) throw new SspPatchError('SSP_PATH_INVALID');
    if (value.trim() === '') parent.splice(key, 1);
    else parent[key] = value;
    return copy;
  }
  if (typeof key !== 'string') throw new SspPatchError('SSP_PATH_INVALID');
  if (value.trim() === '') delete parent[key];
  else parent[key] = value;
  return copy;
}

function listAt(body: JsonObject, path: SspPath, create: boolean): unknown[] {
  const parent = containerAt(body, path.slice(0, -1), create);
  const key = path.at(-1);
  if (Array.isArray(parent) || typeof key !== 'string') throw new SspPatchError('SSP_PATH_INVALID');
  checkSegment(key);
  if (!Object.hasOwn(parent, key) && create) parent[key] = [];
  const list: unknown = parent[key];
  if (!Array.isArray(list)) throw new SspPatchError('SSP_PATH_INVALID');
  return list;
}

/** Hängt eine Zeile an; eine fehlende Liste entsteht. */
export function addSspItem(source: unknown, listPath: SspPath, item: unknown): unknown {
  const { copy, body } = editable(source);
  listAt(body, listPath, true).push(structuredClone(item));
  return copy;
}

/**
 * Entfernt eine Zeile. Eine geleerte Liste entfällt mit ihrem Schlüssel, weil
 * jede SSP-Liste mindestens einen Eintrag verlangt, wenn sie vorhanden ist.
 */
export function removeSspItem(source: unknown, listPath: SspPath, index: number): unknown {
  const { copy, body } = editable(source);
  const list = listAt(body, listPath, false);
  if (!Number.isInteger(index) || index < 0 || index >= list.length) throw new SspPatchError('SSP_ITEM_NOT_FOUND');
  list.splice(index, 1);
  if (list.length === 0) delete (containerAt(body, listPath.slice(0, -1), false) as JsonObject)[listPath.at(-1) as string];
  return copy;
}

/** Verschiebt eine Zeile innerhalb ihrer Liste. */
export function moveSspItem(source: unknown, listPath: SspPath, from: number, to: number): unknown {
  const { copy, body } = editable(source);
  const list = listAt(body, listPath, false);
  if (![from, to].every((index) => Number.isInteger(index) && index >= 0 && index < list.length)) throw new SspPatchError('SSP_ITEM_NOT_FOUND');
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return copy;
}

function referencesComponent(node: unknown, uuid: string): boolean {
  if (Array.isArray(node)) return node.some((item) => referencesComponent(item, uuid));
  if (!isJsonObject(node)) return false;
  return Object.entries(node).some(([key, value]) => (key === 'component-uuid' && typeof value === 'string' && uuidKey(value) === uuid) || referencesComponent(value, uuid));
}

/** Entfernt eine Komponente; eine Komponente, auf die eine `component-uuid` zeigt, bleibt. */
export function removeSspComponent(source: unknown, index: number): unknown {
  const component = readArray(readSspValue(source, ['system-implementation', 'components']))[index];
  const uuid = isJsonObject(component) ? readString(component.uuid) : undefined;
  const body = sspBody(source);
  if (uuid !== undefined && referencesComponent(body, uuidKey(uuid))) throw new SspPatchError('SSP_COMPONENT_REFERENCED');
  return removeSspItem(source, ['system-implementation', 'components'], index);
}

export interface NewSspInput {
  readonly uuid: string;
  /** UUID der `back-matter.resource`; `import-profile.href` wird `#<uuid>`. */
  readonly resourceUuid: string;
  readonly title: string;
  /** Titel der Baseline für die `back-matter.resource`. */
  readonly baselineTitle: string;
  /** `metadata.last-modified`, ISO 8601 mit Zeitzone. */
  readonly lastModified: string;
}

export function isSspTitle(value: string): boolean {
  return value.trim() !== '';
}

/**
 * Ein neues SSP: Root-UUID, `metadata`, `import-profile` mit Fragment auf eine
 * eigene `back-matter.resource` und leere Rahmenstrukturen. Es besteht das
 * Schema noch nicht und entsteht deshalb als Entwurf.
 */
export function createSspSource(input: NewSspInput): { source: JsonObject; href: string } {
  if (!isSspTitle(input.title)) throw new SspPatchError('SSP_TITLE_REQUIRED');
  const href = `#${input.resourceUuid}`;
  return {
    href,
    source: {
      'system-security-plan': {
        uuid: input.uuid,
        metadata: {
          title: input.title.trim(),
          'last-modified': input.lastModified,
          version: '1.0',
          'oscal-version': NEW_SSP_OSCAL_VERSION,
        },
        'import-profile': { href },
        'system-characteristics': {},
        'system-implementation': {},
        'control-implementation': {},
        'back-matter': { resources: [{ uuid: input.resourceUuid, title: input.baselineTitle }] },
      },
    },
  };
}

/** Schreibt den Titel der Baseline-Ressource, auf die `import-profile.href` zeigt; sonst bleibt die Quelle. */
export function setBaselineTitle(source: unknown, title: string): unknown {
  const href = readString(readSspValue(source, ['import-profile', 'href']));
  const fragment = href === undefined ? null : localFragmentUuid(href);
  if (fragment === null) return source;
  const resources = readArray(readSspValue(source, ['back-matter', 'resources']));
  const index = resources.findIndex((resource) => isJsonObject(resource) && readString(resource.uuid)?.toLowerCase() === fragment);
  return index < 0 ? source : setSspValue(source, ['back-matter', 'resources', index, 'title'], title);
}
