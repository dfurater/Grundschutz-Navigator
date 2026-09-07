// Measurement-only input preparation and sequential orchestration. Node builds
// the fixture; the E2E browser realm receives bytes and never a parsed graph.
import { CLASS_2_WORST_CASE_FIXTURES, toBytes } from './class2WorstCaseFixtures.mjs';
import { CLASS_2_TRANSPORT_FIXTURES } from './class2TransportFixtures.mjs';

export const EXPECTED_CODES = {
  'depth-bound': 'OSCAL_DOCUMENT_NOT_OBJECT',
  'heap-bound': 'OSCAL_DOCUMENT_NOT_OBJECT',
  'record-bound': 'OSCAL_ROOT_KEY_AMBIGUOUS',
  'key-bound': 'OSCAL_SCHEMA_ADDITIONAL_PROPERTY',
};

export function buildTimingInput(fixtureId, totalNodes = null) {
  const fixture = [...CLASS_2_WORST_CASE_FIXTURES, ...CLASS_2_TRANSPORT_FIXTURES]
    .find((entry) => entry.id === fixtureId);
  if (!fixture) throw new Error(`Unbekanntes Fixture: ${fixtureId}`);
  if (totalNodes !== null && !fixture.buildScaled) throw new Error(`Fixture ${fixtureId} ist nicht skalierbar`);
  const started = performance.now();
  const bytes = toBytes(totalNodes === null ? fixture.build() : fixture.buildScaled(totalNodes));
  return { bytes, metadata: {
    id: fixture.id, expectedCode: EXPECTED_CODES[fixture.id] ?? null,
    label: fixture.label, limit: fixture.limit, reachesSchemaStage: fixture.reachesSchemaStage,
    bytes: bytes.byteLength, buildMs: performance.now() - started,
    ...(totalNodes === null ? {} : { totalNodes }),
  } };
}

export async function measureIsolatedTiming(direct, worker, metadata) {
  let endToEnd;
  try {
    await worker('prepareBytes', metadata);
    endToEnd = await worker('endToEnd');
  } finally {
    await worker('release');
  }
  try {
    await direct('prepareBytes', metadata);
    const stage1 = await direct('stage1');
    const objectChain = await direct('objectChain');
    return { ...metadata, stage1, objectChain, endToEnd };
  } finally {
    await direct('release');
  }
}
