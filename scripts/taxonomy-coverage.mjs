/**
 * Einträge aus practices.csv, die upstream bewusst ohne Katalogbezug
 * ausgeliefert werden und deshalb keine echte Coverage-Lücke darstellen.
 *
 * Aktuell genau ein Eintrag: das BSI liefert seit Snapshot cea4589c die
 * Beispielpraktik „EXMP — Beispiel für Tests." mit, zu der es keine
 * Katalog-Gruppe gibt. Die Duldung ist bewusst auf diese eine UUID begrenzt;
 * jede andere verwaiste CSV-Zeile lässt den Guard weiterhin hart fehlschlagen.
 */
const TOLERATED_ORPHAN_PRACTICE_UUIDS = Object.freeze([
  '9d330062-5c39-4bb0-bef2-62ab66414aa5',
]);

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
  const allOrphanCsvEntries = csvEntries.filter(
    (entry) => !entry.columns?.UUID || !catalogUuidSet.has(entry.columns.UUID),
  );
  const toleratedOrphanCsvEntries = allOrphanCsvEntries.filter(
    (entry) => TOLERATED_ORPHAN_PRACTICE_UUIDS.includes(entry.columns?.UUID),
  );
  const orphanCsvEntries = allOrphanCsvEntries.filter(
    (entry) => !TOLERATED_ORPHAN_PRACTICE_UUIDS.includes(entry.columns?.UUID),
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
    toleratedOrphanCsvEntryCount: toleratedOrphanCsvEntries.length,
    missingCatalogUuidCount: catalogPractices.filter((practice) => !practice.uuid).length,
    missingUuidCount: entriesWithoutUuid.length,
    duplicateCatalogUuidCount: duplicateCatalogUuids.length,
    duplicateUuidCount: duplicateUuids.length,
    unmatchedCatalogPractices,
    orphanCsvEntries: orphanCsvEntries.map((entry) => ({
      value: entry.value,
      uuid: entry.columns?.UUID,
    })),
    toleratedOrphanCsvEntries: toleratedOrphanCsvEntries.map((entry) => ({
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
}
