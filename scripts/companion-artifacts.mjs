// =============================================================================
// Begleitartefakte (ADR-13)
//
// Jede `.json`-Datei unter `MONITORED_UPSTREAM_ROOTS` des gepinnten Trees, die
// das Quellregister nicht als Produktartefakt führt, ist ein Begleitartefakt.
// Fetch und Catalog-Sync-Guard teilen sich hier Entdeckung, Schlüsselvergabe
// und Lifecycle-Ableitung, damit beide dieselbe Aussage über denselben Tree
// treffen.
// =============================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import { sha256Hex } from './contentHashes.mjs';
import { REPO_ROOT } from './security-guards.mjs';
import {
  deriveCompanionArtifactKey,
  isPathWithinMonitoredRoot,
  listProductUpstreamPaths,
} from '../src/domain/sourceRegistry.mjs';
import { resolveSchemaBinding } from '../src/domain/oscalVersionMatrix.mjs';

const OSCAL_ROOT_TYPES = Object.freeze([
  'catalog',
  'profile',
  'mapping-collection',
  'component-definition',
]);

/** Root-Typ eines Begleitartefakts, dessen Dokument keine eindeutige OSCAL-Wurzel trägt. */
export const UNKNOWN_COMPANION_ROOT_TYPE = 'unknown';
export const COMPANION_LIFECYCLES = Object.freeze(['preview', 'blocked-by-upstream']);

/** Begleitpfade des Trees in Tree-Reihenfolge. */
export function listCompanionTreePaths(treeFiles, registryEntries) {
  const productPaths = new Set(listProductUpstreamPaths(registryEntries));
  return treeFiles
    .map((file) => file.path)
    .filter((path) => path.endsWith('.json') && isPathWithinMonitoredRoot(path) && !productPaths.has(path));
}

/**
 * Vergibt die Begleitschlüssel. Ein Pfad aus dem getrackten Manifest behält
 * dessen Schlüssel, weil `artifactKey` in die Manifest-Signatur eingeht; ein
 * neuer Pfad erhält den abgeleiteten Schlüssel. Kollisionen brechen ab.
 */
export function assignCompanionArtifactKeys(paths, { trackedManifest = null, registryEntries }) {
  const productPaths = new Set(listProductUpstreamPaths(registryEntries));
  const trackedKeyByPath = new Map(
    (trackedManifest?.files ?? [])
      .filter((file) => file.rootType !== 'vocabulary' && !productPaths.has(file.path))
      .map((file) => [file.path, file.artifactKey]),
  );
  const usedKeys = new Set(registryEntries.map((entry) => entry.artifactKey));
  const keyByPath = new Map();
  for (const path of paths) {
    const key = trackedKeyByPath.get(path) ?? deriveCompanionArtifactKey(path);
    if (!key) {
      throw new Error(`Begleitartefakt hat keinen gültigen Schlüssel: ${path}`);
    }
    if (usedKeys.has(key)) {
      throw new Error(`Schlüsselkollision für Begleitartefakt ${path}: ${key}`);
    }
    usedKeys.add(key);
    keyByPath.set(path, key);
  }
  return keyByPath;
}

const compiledSchemas = new Map();

function compilePinnedSchema(pin) {
  const cached = compiledSchemas.get(pin.vendorPath);
  if (cached) return cached;
  const bytes = readFileSync(join(REPO_ROOT, pin.vendorPath));
  // Fail-closed: Nur die gepinnten Schemabytes entscheiden über den Lifecycle.
  if (sha256Hex(bytes) !== pin.sha256) {
    throw new Error(`Gepinntes OSCAL-Schema weicht vom Matrix-Hash ab: ${pin.vendorPath}`);
  }
  const ajv = new Ajv({ validateFormats: false, allErrors: false, strictTypes: false });
  const validate = ajv.compile(JSON.parse(bytes.toString('utf8')));
  compiledSchemas.set(pin.vendorPath, validate);
  return validate;
}

/**
 * Leitet Root-Typ und Lifecycle eines Begleitartefakts aus seinen Bytes ab:
 * `preview`, wenn das Dokument genau eine bekannte OSCAL-Wurzel trägt, seine
 * `metadata.oscal-version` eine Matrixzelle bindet und es das gepinnte Schema
 * erfüllt; sonst `blocked-by-upstream`.
 */
export function classifyCompanionArtifact(buffer) {
  let document;
  try {
    document = JSON.parse(buffer.toString('utf8'));
  } catch {
    return { rootType: UNKNOWN_COMPANION_ROOT_TYPE, lifecycle: 'blocked-by-upstream', document: null };
  }
  const roots = document !== null && typeof document === 'object' && !Array.isArray(document)
    ? OSCAL_ROOT_TYPES.filter((rootType) => document[rootType] !== undefined)
    : [];
  if (roots.length !== 1) {
    return { rootType: UNKNOWN_COMPANION_ROOT_TYPE, lifecycle: 'blocked-by-upstream', document: null };
  }
  const [rootType] = roots;
  const binding = resolveSchemaBinding({
    rootType,
    oscalVersion: document[rootType]?.metadata?.['oscal-version'],
    schemaDirective: document.$schema,
  });
  const valid = binding.ok && compilePinnedSchema(binding.pin)(document);
  return { rootType, lifecycle: valid ? 'preview' : 'blocked-by-upstream', document };
}
