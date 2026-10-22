// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const modules = ['Adapter', 'Readers', 'Findings', 'Document'];
describe('Assessment-Results-Ableitungsgrenze', () => {
  it.each(modules)('enthält in %s keinen Netzwerk-, Datei-, Storage- oder Renderzugriff', (suffix) => {
    const source = readFileSync(`src/adapters/oscalAssessmentResults${suffix}.ts`, 'utf8');
    expect(source).not.toMatch(
      /\b(fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|atob|innerHTML|dangerouslySetInnerHTML|console)\s*[.(=]/,
    );
    expect(source).not.toMatch(
      /(?:from\s*|import\s*\()['"](?:node:|fs|https?:|@\/adapters\/workspace)/,
    );
  });
});
