/**
 * Rein lesende Projektion einer Profile-Importkette für die About-Provenienz
 * (ADR-13).
 *
 * Ein Import `#<uuid>` zeigt auf eine Back-Matter-Ressource; deren
 * `rlinks[].href` wird relativ zum Profilpfad zu einem Repository-Pfad
 * normalisiert (OSCAL 1.1.3 `import/@href`). Ein relativer Import-href wird
 * direkt auf dieselbe Weise normalisiert. Nur ein Pfad unter
 * `MONITORED_UPSTREAM_ROOTS`, der im selben gepinnten Tree als validiertes
 * Dokument vorliegt, belegt eine Quelle. Absolute URLs und Pfade außerhalb
 * dieser Menge bleiben benannte Zustände; aufgelöst wird nie über das Netz.
 */

import { isPathWithinMonitoredRoot } from './sourceRegistry.mjs';

function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function getRootDocument(artifact, rootName) {
  const document = asRecord(artifact?.document);
  const root = asRecord(document?.[rootName]);
  if (!root) {
    throw new Error(`Lineage artifact does not contain an OSCAL ${rootName} root`);
  }
  return root;
}

function projectDocument(artifactKey, artifact, rootName) {
  const root = getRootDocument(artifact, rootName);
  const metadata = asRecord(root.metadata);
  const manifestFile = asRecord(artifact.manifestFile);

  return {
    artifactKey,
    title: nonEmptyString(metadata?.title),
    documentUuid: nonEmptyString(root.uuid),
    oscalVersion: nonEmptyString(metadata?.['oscal-version']),
    version: nonEmptyString(metadata?.version),
    upstreamPath: nonEmptyString(manifestFile?.path),
    gitBlobSha: nonEmptyString(manifestFile?.gitBlobSha),
    contentSha256: nonEmptyString(manifestFile?.contentSha256),
  };
}

function unresolvedImport({ index, state, importHref = null, resourceUuid = null, rlinkHref = null }) {
  return {
    index,
    state,
    importHref,
    resourceUuid,
    rlinkHref,
    source: null,
  };
}

/**
 * Normalisiert einen relativen href gegen den Ordner des Profils. Absolute
 * URIs, Wurzelpfade, Fragmente und Pfade oberhalb der Repository-Wurzel
 * liefern `null`.
 * shortcut: Prozentkodierung wird nicht dekodiert; die BSI-Profile nutzen
 * unkodierte relative Pfade. Erst ein kodierter relativer href braucht es.
 */
function isRelativeHref(href) {
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('/') && !href.startsWith('#');
}

export function resolveRelativeRepoPath(baseFilePath, href) {
  if (!isRelativeHref(href)) return null;
  const segments = baseFilePath.split('/').slice(0, -1);
  for (const segment of href.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const resolved = segments.join('/');
  return isPathWithinMonitoredRoot(resolved) ? resolved : null;
}

/**
 * Wählt aus den hrefs eines Imports genau eine validierte Quelle desselben
 * Trees. `resourceUuid` ist bei einem Direktimport `null`; dann bleibt auch
 * `rlinkHref` leer, weil der Import-href selbst das Ziel nennt.
 */
function selectImportSource({
  index,
  importHref,
  resourceUuid,
  hrefs,
  profilePath,
  resolvedImportPaths,
  artifactsByPath,
}) {
  const viaResource = resourceUuid !== null;
  const candidates = [
    ...new Map(
      hrefs
        .map((href) => [href, resolveRelativeRepoPath(profilePath, href)])
        .filter(([, path]) => path !== null && artifactsByPath.has(path))
        .map(([href, path]) => [path, href]),
    ),
  ];
  if (candidates.length === 0) {
    return unresolvedImport({
      index,
      state: 'artifact-unregistered',
      importHref,
      resourceUuid,
      rlinkHref: viaResource && hrefs.length === 1 ? hrefs[0] : null,
    });
  }
  if (candidates.length !== 1) {
    return unresolvedImport({ index, state: 'rlink-ambiguous', importHref, resourceUuid });
  }

  const [[sourcePath, href]] = candidates;
  const rlinkHref = viaResource ? href : null;
  if (resolvedImportPaths.has(sourcePath)) {
    return unresolvedImport({
      index,
      state: 'import-duplicate',
      importHref,
      resourceUuid,
      rlinkHref,
    });
  }

  resolvedImportPaths.add(sourcePath);
  const sourceArtifact = artifactsByPath.get(sourcePath);
  return {
    index,
    state: 'complete',
    importHref,
    resourceUuid,
    rlinkHref,
    source: projectDocument(sourceArtifact.manifestFile.artifactKey, sourceArtifact, 'catalog'),
  };
}

function resolveImport({
  imported,
  index,
  resourcesByUuid,
  profilePath,
  resolvedImportPaths,
  artifactsByPath,
}) {
  const importHref = nonEmptyString(imported?.href);
  if (!importHref) {
    return unresolvedImport({ index, state: 'import-href-missing' });
  }
  const target = { index, importHref, profilePath, resolvedImportPaths, artifactsByPath };
  if (isRelativeHref(importHref)) {
    return selectImportSource({ ...target, resourceUuid: null, hrefs: [importHref] });
  }
  if (!importHref.startsWith('#') || importHref.length === 1) {
    return unresolvedImport({ index, state: 'import-href-not-fragment', importHref });
  }

  const resourceUuid = importHref.slice(1);
  const resources = resourcesByUuid.get(resourceUuid);
  if (!resources) {
    return unresolvedImport({ index, state: 'resource-missing', importHref, resourceUuid });
  }
  if (resources.length !== 1) {
    return unresolvedImport({ index, state: 'resource-ambiguous', importHref, resourceUuid });
  }
  const [resource] = resources;

  const rlinks = Array.isArray(resource.rlinks) ? resource.rlinks : [];
  const hrefs = rlinks
    .map((rlink) => nonEmptyString(asRecord(rlink)?.href))
    .filter((href) => href !== null);
  if (hrefs.length === 0) {
    return unresolvedImport({ index, state: 'rlink-missing', importHref, resourceUuid });
  }

  return selectImportSource({ ...target, resourceUuid, hrefs });
}

/**
 * Projektiert ein validiertes OSCAL-Profile und seine Quellen aus demselben
 * gepinnten Tree zu serialisierbaren Sidecar-Daten. Fehlende Kanten bleiben
 * sichtbare, benannte Zustände; sie werden weder erraten noch über das Netz
 * ergänzt.
 */
export function projectCatalogLineage({ catalogKey, profileArtifact, artifactsByPath }) {
  const profilePath = nonEmptyString(asRecord(profileArtifact?.manifestFile)?.path);
  if (!catalogKey || !profilePath || !artifactsByPath?.get) {
    throw new Error('Catalog lineage projection requires a catalog key, a profile and materialized artifacts');
  }

  const profile = getRootDocument(profileArtifact, 'profile');
  const backMatter = asRecord(profile['back-matter']);
  const resources = Array.isArray(backMatter?.resources) ? backMatter.resources : [];
  const resourcesByUuid = new Map();
  for (const candidate of resources) {
    const resource = asRecord(candidate);
    const uuid = nonEmptyString(resource?.uuid);
    if (!uuid || !resource) continue;
    const matchingResources = resourcesByUuid.get(uuid) ?? [];
    matchingResources.push(resource);
    resourcesByUuid.set(uuid, matchingResources);
  }
  const profileImports = Array.isArray(profile.imports) ? profile.imports : [];
  const resolvedImportPaths = new Set();
  const imports = profileImports.map((imported, index) =>
    resolveImport({
      imported: asRecord(imported),
      index,
      resourcesByUuid,
      profilePath,
      resolvedImportPaths,
      artifactsByPath,
    }),
  );

  return {
    catalogKey,
    profile: projectDocument(profileArtifact.manifestFile.artifactKey, profileArtifact, 'profile'),
    imports,
  };
}
