// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { hasRegistryKeyGrammar } from '@/domain/sourceRegistry';
import {
  parseAssessmentPlanDocument,
  validateAssessmentPlanSchema,
} from './oscalAssessmentPlanDocument';
const parse = (source: unknown) =>
  parseAssessmentPlanDocument(source, { trustClass: 'class-2-local-user' });

describe('NIST-Assessment-Plan-Orakel', () => {
  it('prüft vier gepinnte Beispiele offline gegen die eigene Schemazelle', async () => {
    const directory = 'src/test/fixtures/oscal-content-v1.5.0/';
    const manifest = JSON.parse(readFileSync(`${directory}ORACLE_MANIFEST.json`, 'utf8')) as {
      files: { fileName: string; sha256: string; remotePath: string; artifactKey: string }[];
    };
    const examples = manifest.files.filter((f) => f.remotePath.startsWith('examples/ap/json/'));
    expect(examples).toHaveLength(4);
    for (const entry of examples) {
      expect(hasRegistryKeyGrammar(entry.artifactKey), entry.artifactKey).toBe(true);
      const buffer = readFileSync(directory + entry.fileName);
      expect(createHash('sha256').update(buffer).digest('hex')).toBe(entry.sha256);
      const document = parse(JSON.parse(buffer.toString()));
      expect((await validateAssessmentPlanSchema(document)).ok, entry.fileName).toBe(true);
      expect(document.view.diagnostics, entry.fileName).toMatchObject([
        {
          code: 'OSCAL_AP_ACTIVITY_REFERENCE_UNRESOLVED',
          path: '/assessment-plan/tasks/0/associated-activities/0/activity-uuid',
        },
      ]);
      expect(document.view.diagnostics).toHaveLength(1);
      expect(document.view.importSsp?.ssp.status).toBe('not-resolvable-in-context');
    }
  });
});
