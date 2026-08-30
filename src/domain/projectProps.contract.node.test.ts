// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROJECT_PROP_NAMES } from '@/domain/projectProps';

describe('PROJECT_PROPS contract document', () => {
  it('dokumentiert jeden registrierten Namen genau einmal in der Vertragstabelle', () => {
    const document = readFileSync('docs/PROJECT_PROPS.md', 'utf8');

    for (const name of PROJECT_PROP_NAMES) {
      const rowMarker = `| \`${name}\` |`;
      expect(document.split(rowMarker)).toHaveLength(2);
    }
  });
});
