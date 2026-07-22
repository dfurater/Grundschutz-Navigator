import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateDocumentationContract } from './pr-documentation-contract.mjs';

const TEMPLATE_PATH = resolve(process.cwd(), '.github/pull_request_template.md');
const WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/ci.yml');

describe('pull request documentation template', () => {
  it('contains one machine-readable contract with both unselected options', () => {
    const template = readFileSync(TEMPLATE_PATH, 'utf8');

    expect(template.match(/<!-- documentation-contract:start -->/g)).toHaveLength(1);
    expect(template.match(/<!-- documentation-contract:end -->/g)).toHaveLength(1);
    expect(template.match(/- \[ \] \*\*Dokumentation aktualisiert\*\*/g)).toHaveLength(1);
    expect(template.match(/- \[ \] \*\*Keine Dokumentationsauswirkung\*\*/g)).toHaveLength(1);
    expect(template).toContain('<!-- documentation-files:start -->');
    expect(template).toContain('<!-- no-documentation-impact:start -->');
  });

  it('produces a valid updated-documentation declaration', () => {
    const body = readFileSync(TEMPLATE_PATH, 'utf8')
      .replace('- [ ] **Dokumentation aktualisiert**', '- [x] **Dokumentation aktualisiert**')
      .replace('`docs/DATEI.md` oder `README.md`', '`docs/ARCHITECTURE.md`');

    expect(validateDocumentationContract({
      changedFiles: ['src/main.tsx', 'docs/ARCHITECTURE.md'],
      pullRequestBody: body,
    })).toEqual({ status: 'valid', documentationImpact: 'updated' });
  });

  it('produces a valid no-impact declaration', () => {
    const body = readFileSync(TEMPLATE_PATH, 'utf8')
      .replace('- [ ] **Keine Dokumentationsauswirkung**', '- [x] **Keine Dokumentationsauswirkung**')
      .replace(
        'Konkrete Begründung eintragen.',
        'Nur ein bestehender Testname wurde präzisiert; Produktverhalten und Dokumentation bleiben unverändert.',
      );

    expect(validateDocumentationContract({
      changedFiles: ['src/domain/models.test.ts'],
      pullRequestBody: body,
    })).toEqual({ status: 'valid', documentationImpact: 'none' });
  });
});

describe('pull request workflow integration', () => {
  it('revalidates the contract when code or the pull request body changes', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

    expect(workflow).toMatch(/types: \[opened, reopened, synchronize, edited\]/);
    expect(workflow).toMatch(/documentation-contract:\n\s+if: github\.event_name == 'pull_request'/);
    expect(workflow).toMatch(/fetch-depth: 0/);
    expect(workflow).toContain('PR_BODY: ${{ github.event.pull_request.body }}');
    expect(workflow).toContain('node scripts/pr-documentation-contract.mjs');
  });
});
