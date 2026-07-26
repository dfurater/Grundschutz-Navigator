const TOPIC_COVERAGE_BASELINES = Object.freeze({
  '12abb438fcdb4f4b63fb3e751e89d7c526e647b5': Object.freeze({
    catalogTopicCount: 139,
    distinctCatalogUuidCount: 119,
    csvEntryCount: 119,
    matchedCatalogTopicCount: 139,
    unmatchedCatalogTopicCount: 0,
    orphanCsvEntryCount: 0,
    missingCatalogUuidCount: 0,
    duplicateCsvUuidCount: 0,
  }),
});

function findAltIdentifier(node) {
  return node?.props?.find((prop) => prop?.name === 'alt-identifier')?.value;
}

function findDuplicates(values) {
  const counts = new Map();
  for (const value of values) {
    if (value) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ value, count }));
}

export function analyzePracticeVocabularyIntegrity(
  catalogDocument,
  practicesNamespace,
) {
  const catalogPractices = (catalogDocument?.catalog?.groups ?? []).map(
    (practice) => ({
      id: practice.id,
      uuid: findAltIdentifier(practice),
    }),
  );
  const csvEntries = practicesNamespace?.entries ?? [];
  const entriesWithoutUuid = csvEntries.filter((entry) => !entry.columns?.UUID);
  const csvUuids = csvEntries.map((entry) => entry.columns?.UUID).filter(Boolean);
  const catalogUuids = catalogPractices
    .map((practice) => practice.uuid)
    .filter(Boolean);
  const csvUuidSet = new Set(csvUuids);
  const catalogUuidSet = new Set(catalogUuids);
  const unmatchedCatalogPractices = catalogPractices.filter(
    (practice) => !practice.uuid || !csvUuidSet.has(practice.uuid),
  );
  const orphanCsvEntries = csvEntries.filter(
    (entry) => !entry.columns?.UUID || !catalogUuidSet.has(entry.columns.UUID),
  );
  const duplicateCatalogUuids = findDuplicates(catalogUuids);
  const duplicateUuids = findDuplicates(csvUuids);

  return {
    catalogPracticeCount: catalogPractices.length,
    distinctCatalogUuidCount: catalogUuidSet.size,
    csvEntryCount: csvEntries.length,
    matchedCatalogPracticeCount:
      catalogPractices.length - unmatchedCatalogPractices.length,
    unmatchedCatalogPracticeCount: unmatchedCatalogPractices.length,
    orphanCsvEntryCount: orphanCsvEntries.length,
    missingCatalogUuidCount: catalogPractices.filter((practice) => !practice.uuid).length,
    missingUuidCount: entriesWithoutUuid.length,
    duplicateCatalogUuidCount: duplicateCatalogUuids.length,
    duplicateUuidCount: duplicateUuids.length,
    unmatchedCatalogPractices,
    orphanCsvEntries: orphanCsvEntries.map((entry) => ({
      value: entry.value,
      uuid: entry.columns?.UUID,
    })),
    entriesWithoutUuid: entriesWithoutUuid.map((entry) => entry.value),
    duplicateCatalogUuids,
    duplicateUuids,
  };
}

export function assertPracticeVocabularyIntegrity(
  snapshotCommitSha,
  integrity,
) {
  if (!integrity) {
    throw new Error(
      `practices.csv fehlt für die Coverage-Prüfung des Snapshots ${snapshotCommitSha}.`,
    );
  }

  if (integrity.missingUuidCount !== 0) {
    throw new Error(
      `Practice-UUID-Integrität für Snapshot ${snapshotCommitSha} enthält ${integrity.missingUuidCount} Einträge ohne UUID.`,
    );
  }

  if (integrity.duplicateUuidCount !== 0) {
    throw new Error(
      `Practice-UUID-Integrität für Snapshot ${snapshotCommitSha} enthält ${integrity.duplicateUuidCount} doppelte CSV-UUIDs.`,
    );
  }

  const positiveCounts = [
    'catalogPracticeCount',
    'distinctCatalogUuidCount',
    'csvEntryCount',
    'matchedCatalogPracticeCount',
  ];
  for (const key of positiveCounts) {
    if (!Number.isInteger(integrity[key]) || integrity[key] <= 0) {
      throw new Error(
        `Practice-UUID-Integrität für Snapshot ${snapshotCommitSha} ist bei ${key} leer oder ungültig: ${integrity[key]}.`,
      );
    }
  }

  const zeroDriftCounts = [
    'unmatchedCatalogPracticeCount',
    'orphanCsvEntryCount',
    'missingCatalogUuidCount',
    'duplicateCatalogUuidCount',
  ];
  for (const key of zeroDriftCounts) {
    if (integrity[key] !== 0) {
      throw new Error(
        `Practice-UUID-Integrität für Snapshot ${snapshotCommitSha} verletzt ${key}: ${integrity[key]}.`,
      );
    }
  }

  if (integrity.matchedCatalogPracticeCount !== integrity.catalogPracticeCount) {
    throw new Error(
      `Practice-UUID-Integrität für Snapshot ${snapshotCommitSha} ist unvollständig: ${integrity.matchedCatalogPracticeCount}/${integrity.catalogPracticeCount}.`,
    );
  }
}

export function analyzeTopicVocabularyCoverage(
  catalogDocument,
  topicsNamespace,
) {
  const catalogTopics = (catalogDocument?.catalog?.groups ?? []).flatMap(
    (practice) => (practice.groups ?? []).map((topic) => ({
      id: topic.id,
      practiceId: practice.id,
      uuid: findAltIdentifier(topic),
    })),
  );
  const csvEntries = topicsNamespace?.entries ?? [];
  const csvUuids = csvEntries.map((entry) => entry.columns?.UUID).filter(Boolean);
  const csvUuidSet = new Set(csvUuids);
  const catalogUuidSet = new Set(
    catalogTopics.map((topic) => topic.uuid).filter(Boolean),
  );
  const unmatchedCatalogTopics = catalogTopics.filter(
    (topic) => !topic.uuid || !csvUuidSet.has(topic.uuid),
  );
  const orphanCsvEntries = csvEntries.filter(
    (entry) => !entry.columns?.UUID || !catalogUuidSet.has(entry.columns.UUID),
  );
  const duplicateCsvUuids = findDuplicates(csvUuids);

  return {
    catalogTopicCount: catalogTopics.length,
    distinctCatalogUuidCount: catalogUuidSet.size,
    csvEntryCount: csvEntries.length,
    matchedCatalogTopicCount:
      catalogTopics.length - unmatchedCatalogTopics.length,
    unmatchedCatalogTopicCount: unmatchedCatalogTopics.length,
    orphanCsvEntryCount: orphanCsvEntries.length,
    missingCatalogUuidCount: catalogTopics.filter((topic) => !topic.uuid).length,
    duplicateCsvUuidCount: duplicateCsvUuids.length,
    unmatchedCatalogTopics,
    orphanCsvEntries: orphanCsvEntries.map((entry) => ({
      value: entry.value,
      uuid: entry.columns?.UUID,
    })),
    duplicateCsvUuids,
  };
}

export function assertTopicVocabularyCoverage(snapshotCommitSha, coverage) {
  if (!coverage) {
    throw new Error(
      `topics.csv fehlt für die Coverage-Baseline des Snapshots ${snapshotCommitSha}.`,
    );
  }

  const positiveCounts = [
    'catalogTopicCount',
    'distinctCatalogUuidCount',
    'csvEntryCount',
    'matchedCatalogTopicCount',
  ];
  for (const key of positiveCounts) {
    if (!Number.isInteger(coverage[key]) || coverage[key] <= 0) {
      throw new Error(
        `Topic-Coverage für Snapshot ${snapshotCommitSha} ist bei ${key} leer oder ungültig: ${coverage[key]}.`,
      );
    }
  }

  const zeroDriftCounts = [
    'unmatchedCatalogTopicCount',
    'orphanCsvEntryCount',
    'missingCatalogUuidCount',
    'duplicateCsvUuidCount',
  ];
  for (const key of zeroDriftCounts) {
    if (coverage[key] !== 0) {
      throw new Error(
        `Topic-Coverage für Snapshot ${snapshotCommitSha} verletzt ${key}: ${coverage[key]}.`,
      );
    }
  }
  if (coverage.matchedCatalogTopicCount !== coverage.catalogTopicCount) {
    throw new Error(
      `Topic-Coverage für Snapshot ${snapshotCommitSha} ist unvollständig: ${coverage.matchedCatalogTopicCount}/${coverage.catalogTopicCount}.`,
    );
  }

  const expected = TOPIC_COVERAGE_BASELINES[snapshotCommitSha];
  if (!expected) {
    return;
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (coverage[key] !== expectedValue) {
      throw new Error(
        `Topic-Coverage für Snapshot ${snapshotCommitSha} weicht bei ${key} ab: erwartet ${expectedValue}, erhalten ${coverage[key]}.`,
      );
    }
  }
}
