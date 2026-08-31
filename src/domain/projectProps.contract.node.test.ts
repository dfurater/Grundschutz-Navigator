// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PROJECT_PROP_DIAGNOSTIC_CODES,
  PROJECT_PROP_NAMES,
  PROJECT_PROP_REGISTRY,
} from '@/domain/projectProps';

describe('PROJECT_PROPS contract document', () => {
  it('bindet jede öffentliche Vertragszelle beidseitig an die Registry', () => {
    const document = readFileSync('docs/PROJECT_PROPS.md', 'utf8');
    const contractBlock = document.match(
      /<!-- project-props-contract:start -->([\s\S]*?)<!-- project-props-contract:end -->/,
    )?.[1];

    expect(contractBlock).toBeDefined();
    const expectedRows = PROJECT_PROP_NAMES.map((name) => {
      const entry = PROJECT_PROP_REGISTRY[name];
      const { documentation } = entry;
      return `| ${[
        `\`${entry.name}\``,
        entry.meaning,
        documentation.valueSpace,
        entry.carriers.map((carrier) => `\`${carrier}\``).join(', '),
        `\`${entry.cardinality.minimum}\``,
        `\`${entry.cardinality.maximum ?? 'n'}\``,
        `\`${entry.cardinality.scope}\``,
        `\`${entry.valueContract}\``,
        `\`${entry.canonicalization}\``,
        documentation.validation,
        `[${documentation.introducedBy.identifier}](${documentation.introducedBy.url})`,
      ].join(' | ')} |`;
    });
    const expectedLines = [
      '| Name | Bedeutung | Werteraum | Trägerkennungen | Minimum | Maximum | Scope | Wertvertrag | Kanonisierung | Validierung und Schreibweise | Einführendes Issue |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...expectedRows,
    ];

    expect((contractBlock ?? '').trim().split('\n')).toEqual(expectedLines);
  });

  it('dokumentiert den vollständigen öffentlichen Diagnosecode-Vertrag', () => {
    const document = readFileSync('docs/OSCAL_VALIDATION.md', 'utf8');
    const documentedCodes = new Set(document.match(/OSCAL_PROJECT_PROP_[A-Z_]+/g) ?? []);

    expect([...documentedCodes].sort()).toEqual(
      [...Object.values(PROJECT_PROP_DIAGNOSTIC_CODES)].sort(),
    );
  });
});
