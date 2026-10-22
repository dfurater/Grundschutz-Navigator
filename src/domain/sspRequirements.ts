// =============================================================================
// Offene Pflichtstruktur eines SSP (GSPP-609)
//
// Pflichtfelder der SSP-Metaschemas 1.1.2 bis 1.2.2, abhängig von
// `metadata.oscal-version`: `system-implementation.users` ist in 1.1.x Pflicht,
// `protocol.name` nur in 1.1.2. Das Ergebnis führt jede offene Struktur als
// JSON Pointer; Formate und Aufzählungen prüft beim Speichern das Schema.
// =============================================================================

import { isJsonObject, readArray } from '@/domain/jsonGuards';
import { sspBody, sspOscalVersion, sspProtocolNameRequired, sspUsersRequired } from '@/domain/sspAuthoring';

const ROOT = '/system-security-plan';

function filled(value: unknown): boolean {
  return typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null;
}

function requireFields(node: unknown, path: string, fields: readonly string[], missing: string[]): void {
  const object = isJsonObject(node) ? node : {};
  for (const field of fields) if (!filled(object[field])) missing.push(`${path}/${field}`);
}

/** Pflichtliste mit mindestens einem Eintrag; jeder Eintrag wird mit `each` geprüft. */
function requireList(node: unknown, path: string, field: string, missing: string[], each: (item: unknown, itemPath: string) => void): void {
  const list = isJsonObject(node) ? node[field] : undefined;
  if (!Array.isArray(list) || list.length === 0) {
    missing.push(`${path}/${field}`);
    return;
  }
  list.forEach((item, index) => each(item, `${path}/${field}/${index}`));
}

function optionalList(node: unknown, field: string, path: string, each: (item: unknown, itemPath: string) => void): void {
  readArray(isJsonObject(node) ? node[field] : undefined).forEach((item, index) => each(item, `${path}/${field}/${index}`));
}

function child(node: unknown, field: string): unknown {
  return isJsonObject(node) ? node[field] : undefined;
}

/**
 * Offene Pflichtstruktur als JSON Pointer, abhängig von `metadata.oscal-version`
 * (Pflichtfelder der SSP-Metaschemas 1.1.2 bis 1.2.2). Eine leere Liste heißt:
 * Diese Pflichtstrukturen sind belegt; das Schema prüft beim Speichern
 * zusätzlich Formate und Aufzählungen.
 */
export function missingSspStructure(source: unknown): readonly string[] {
  const body = sspBody(source);
  if (!body) return [ROOT];
  const version = sspOscalVersion(source);
  const missing: string[] = [];
  requireFields(body, ROOT, ['uuid'], missing);
  const metadata = child(body, 'metadata');
  requireFields(metadata, `${ROOT}/metadata`, ['title', 'last-modified', 'version', 'oscal-version'], missing);
  optionalList(metadata, 'roles', `${ROOT}/metadata`, (role, path) => requireFields(role, path, ['id', 'title'], missing));
  optionalList(metadata, 'parties', `${ROOT}/metadata`, (party, path) => requireFields(party, path, ['uuid', 'type'], missing));
  requireFields(child(body, 'import-profile'), `${ROOT}/import-profile`, ['href'], missing);

  const characteristics = child(body, 'system-characteristics');
  const sc = `${ROOT}/system-characteristics`;
  requireList(characteristics, sc, 'system-ids', missing, (entry, path) => requireFields(entry, path, ['id'], missing));
  requireFields(characteristics, sc, ['system-name', 'description'], missing);
  requireList(child(characteristics, 'system-information'), `${sc}/system-information`, 'information-types', missing,
    (entry, path) => requireFields(entry, path, ['title', 'description'], missing));
  requireFields(child(characteristics, 'status'), `${sc}/status`, ['state'], missing);
  requireFields(child(characteristics, 'authorization-boundary'), `${sc}/authorization-boundary`, ['description'], missing);

  const implementation = child(body, 'system-implementation');
  const si = `${ROOT}/system-implementation`;
  requireList(implementation, si, 'components', missing, (component, path) => {
    requireFields(component, path, ['uuid', 'type', 'title', 'description'], missing);
    requireFields(child(component, 'status'), `${path}/status`, ['state'], missing);
    if (sspProtocolNameRequired(version)) optionalList(component, 'protocols', path, (protocol, protocolPath) => requireFields(protocol, protocolPath, ['name'], missing));
  });
  const eachUser = (user: unknown, path: string) => requireFields(user, path, ['uuid'], missing);
  if (sspUsersRequired(version)) requireList(implementation, si, 'users', missing, eachUser);
  else optionalList(implementation, 'users', si, eachUser);

  const control = child(body, 'control-implementation');
  const ci = `${ROOT}/control-implementation`;
  requireFields(control, ci, ['description'], missing);
  requireList(control, ci, 'implemented-requirements', missing, (requirement, path) => requireFields(requirement, path, ['uuid', 'control-id'], missing));
  return missing;
}
