/**
 * Rein lesende Projektion einer Profile-Importkette für die About-Provenienz.
 *
 * Relative `rlinks.href` bleiben absichtlich unverändert: Nur ein exakter
 * Stringtreffer in der vom Quellregister gepflegten Zuordnung darf eine
 * Quelle sichtbar als belegt markieren. Diese Projektion benutzt bewusst
 * nicht den generischen Referenzresolver, dessen fail-closed-Vertrag relative
 * Referenzen als nicht auflösbar einstuft.
 */

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

function resolveImport({ imported, index, resourcesByUuid, configuredImportsByHref, artifactsByKey }) {
  const importHref = nonEmptyString(imported?.href);
  if (!importHref) {
    return unresolvedImport({ index, state: 'import-href-missing' });
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

  // Keine URL- oder Pfadnormalisierung: Die Map akzeptiert nur den exakten
  // `rlinks.href`-String, der im Quellregister dokumentiert wurde.
  const configuredMatches = hrefs.filter((href) => configuredImportsByHref.has(href));
  if (configuredMatches.length === 0) {
    return unresolvedImport({
      index,
      state: 'artifact-unregistered',
      importHref,
      resourceUuid,
      rlinkHref: hrefs.length === 1 ? hrefs[0] : null,
    });
  }
  if (configuredMatches.length !== 1) {
    return unresolvedImport({ index, state: 'rlink-ambiguous', importHref, resourceUuid });
  }

  const rlinkHref = configuredMatches[0];
  const configuredImport = configuredImportsByHref.get(rlinkHref);
  const sourceArtifact = artifactsByKey.get(configuredImport.artifactKey);
  if (!sourceArtifact) {
    return unresolvedImport({
      index,
      state: 'artifact-unregistered',
      importHref,
      resourceUuid,
      rlinkHref,
    });
  }

  return {
    index,
    state: 'complete',
    importHref,
    resourceUuid,
    rlinkHref,
    source: projectDocument(configuredImport.artifactKey, sourceArtifact, 'catalog'),
  };
}

/**
 * Projektiert ein validiertes OSCAL-Profile und seine registrierten Quellen
 * zu serialisierbaren Sidecar-Daten. Fehlende Kanten bleiben sichtbare,
 * benannte Zustände; sie werden weder erraten noch über das Netz ergänzt.
 */
export function projectCatalogLineage({ lineage, artifactsByKey }) {
  if (!lineage || !artifactsByKey?.get) {
    throw new Error('Catalog lineage projection requires a lineage and materialized artifacts');
  }

  const profileArtifact = artifactsByKey.get(lineage.profileArtifactKey);
  if (!profileArtifact) {
    throw new Error(`Catalog lineage profile was not materialized: ${lineage.profileArtifactKey}`);
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
  const configuredImportsByHref = new Map(lineage.imports.map((item) => [item.href, item]));
  const imports = Array.isArray(profile.imports) ? profile.imports : [];

  return {
    catalogKey: lineage.catalogKey,
    profile: projectDocument(lineage.profileArtifactKey, profileArtifact, 'profile'),
    imports: imports.map((imported, index) =>
      resolveImport({
        imported: asRecord(imported),
        index,
        resourcesByUuid,
        configuredImportsByHref,
        artifactsByKey,
      }),
    ),
  };
}
