import { describe, expect, it } from 'vitest';
import {
  PROJECT_PROPS_NAMESPACE,
  readProjectProps,
} from '@/domain/projectProps';
import type { RawOscalProp } from '@/domain/models';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { runNoOpRoundTrip } from '@/test/oscalRoundTrip';

describe('projectProps no-op round-trip', () => {
  it('erhält fremde und unbekannte Projektproperties vollständig und sperrt nur Semantik', async () => {
    const secretMarker = 'synthetischer-klasse-2-marker';
    const foreignProp: RawOscalProp = {
      uuid: '99999999-9999-4999-8999-999999999991',
      name: 'future-name',
      ns: 'https://example.invalid/future/props',
      value: secretMarker,
      class: 'future-class',
      group: 'future-group',
      remarks: 'synthetischer Freitext',
    };
    const unknownProjectProp: RawOscalProp = {
      uuid: '99999999-9999-4999-8999-999999999992',
      name: 'future-project-name',
      ns: PROJECT_PROPS_NAMESPACE,
      value: secretMarker,
      class: 'future-project-class',
      group: 'future-project-group',
      remarks: 'synthetischer Projektfreitext',
    };
    const metadataProps = [foreignProp, unknownProjectProp];
    const document = makeSchemaValidOscalDocument(
      'plan-of-action-and-milestones',
      '1.1.3',
    );
    const body = document['plan-of-action-and-milestones'] as Record<string, unknown>;
    const metadata = body.metadata as Record<string, unknown>;
    metadata.props = metadataProps;
    const fixtureText = JSON.stringify(document);

    const roundTrip = await runNoOpRoundTrip({ fixtureText });
    const readResult = readProjectProps(metadataProps, 'metadata');

    expect(roundTrip.serialization.status).toBe('passed');
    expect(roundTrip.graph.status).toBe('passed');
    expect(readResult.preservedProps).toBe(metadataProps);
    expect(readResult.foreignProps).toContain(foreignProp);
    expect(readResult.unknownProjectProps).toContain(unknownProjectProp);
    expect(readResult.writeAllowed).toBe(false);
    expect(JSON.stringify(readResult.diagnostics)).not.toContain(secretMarker);
    expect(JSON.stringify(document)).toBe(fixtureText);
  });
});
