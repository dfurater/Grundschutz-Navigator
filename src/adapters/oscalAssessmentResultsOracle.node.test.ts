// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hasRegistryKeyGrammar } from '@/domain/sourceRegistry';
import {
  parseAssessmentResultsDocument,
  validateAssessmentResultsSchema,
} from './oscalAssessmentResultsDocument';

describe('NIST-Assessment-Results-Orakel', () => {
  it('prüft vier gepinnte Beispiele offline gegen die eigene Schemazelle', async () => {
    const directory = 'src/test/fixtures/oscal-content-v1.5.0/';
    const manifest = JSON.parse(readFileSync(`${directory}ORACLE_MANIFEST.json`, 'utf8')) as {
      files: { fileName: string; sha256: string; remotePath: string; artifactKey: string }[];
    };
    const examples = manifest.files.filter((f) => f.remotePath.startsWith('examples/ar/json/'));
    expect(examples).toHaveLength(4);
    for (const entry of examples) {
      expect(hasRegistryKeyGrammar(entry.artifactKey), entry.artifactKey).toBe(true);
      const buffer = readFileSync(directory + entry.fileName);
      expect(createHash('sha256').update(buffer).digest('hex')).toBe(entry.sha256);
      const document = parseAssessmentResultsDocument(
        JSON.parse(buffer.toString()),
        { trustClass: 'class-2-local-user' },
        { at: new Date('2026-10-22T00:00:00Z') },
      );
      expect((await validateAssessmentResultsSchema(document)).ok, entry.fileName).toBe(true);
      expect(document.view.diagnostics, entry.fileName).toEqual([]);
      expect(document.view.importAp?.status).toBe('not-resolvable-in-context');
      const [result] = document.view.results;
      expect([result.observations.length, result.findings.length, result.risks.length]).toEqual([2, 1, 1]);
      expect(result.observations.map((o) => o.evidence?.validity)).toEqual(['expired', 'expired']);
    }
  });
});
