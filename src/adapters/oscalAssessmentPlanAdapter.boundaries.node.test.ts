// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const modules = ['Adapter', 'Readers', 'Selections', 'Tasks', 'Document'];
describe('Assessment-Plan-Ableitungsgrenze', () => {
  it.each(modules)('enthält in %s keinen Netzwerk-, Datei- oder Storagezugriff', (suffix) => {
    const source = readFileSync(`src/adapters/oscalAssessmentPlan${suffix}.ts`, 'utf8');
    expect(source).not.toMatch(
      /\b(fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|atob)\s*[.(]/,
    );
    expect(source).not.toMatch(
      /(?:from\s*|import\s*\()['"](?:node:|fs|https?:|@\/adapters\/workspace)/,
    );
  });
});
