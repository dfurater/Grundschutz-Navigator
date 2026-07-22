import { describe, expect, it, vi } from 'vitest';
import {
  getChangedFiles,
  validateDocumentationContract,
  validateGitSha,
} from './pr-documentation-contract.mjs';

const TEMPLATE_BODY = `
<!-- documentation-contract:start -->
## Dokumentationsauswirkung

- [ ] **Dokumentation aktualisiert**
  Betroffene Dateien: <!-- documentation-files:start --> \`docs/DATEI.md\` oder \`README.md\` <!-- documentation-files:end -->
- [ ] **Keine Dokumentationsauswirkung**
  Begründung: <!-- no-documentation-impact:start --> Konkrete Begründung eintragen. <!-- no-documentation-impact:end -->
<!-- documentation-contract:end -->
`;

function bodyWithDocumentation(files: string) {
  return TEMPLATE_BODY
    .replace('- [ ] **Dokumentation aktualisiert**', '- [x] **Dokumentation aktualisiert**')
    .replace('`docs/DATEI.md` oder `README.md`', files);
}

function bodyWithoutDocumentation(reason: string) {
  return TEMPLATE_BODY
    .replace('- [ ] **Keine Dokumentationsauswirkung**', '- [x] **Keine Dokumentationsauswirkung**')
    .replace('Konkrete Begründung eintragen.', reason);
}

describe('validateDocumentationContract', () => {
  it('skips pull requests that do not change src', () => {
    expect(validateDocumentationContract({
      changedFiles: ['scripts/fetch-catalog.mjs', '.github/workflows/ci.yml'],
      pullRequestBody: '',
    })).toEqual({ status: 'skipped', documentationImpact: null });
  });

  it('accepts a named documentation file that is part of the diff', () => {
    expect(validateDocumentationContract({
      changedFiles: ['src/domain/models.ts', 'docs/DOMAIN_MODELS.md'],
      pullRequestBody: bodyWithDocumentation('`docs/DOMAIN_MODELS.md`'),
    })).toEqual({ status: 'valid', documentationImpact: 'updated' });
  });

  it('accepts a concrete explanation when source changes have no documentation impact', () => {
    expect(validateDocumentationContract({
      changedFiles: ['src/domain/models.test.ts'],
      pullRequestBody: bodyWithoutDocumentation(
        'Nur bestehende Testabdeckung erweitert; produktives Verhalten und dokumentierte Verträge bleiben unverändert.',
      ),
    })).toEqual({ status: 'valid', documentationImpact: 'none' });
  });

  it('rejects a missing documentation contract for source changes', () => {
    expect(() => validateDocumentationContract({
      changedFiles: ['src/domain/models.ts'],
      pullRequestBody: '## Zusammenfassung\nProduktcode geändert.',
    })).toThrow(/Abschnitt „Dokumentationsauswirkung“ fehlt/);
  });

  it('rejects a contract with no selected option', () => {
    expect(() => validateDocumentationContract({
      changedFiles: ['src/domain/models.ts'],
      pullRequestBody: TEMPLATE_BODY,
    })).toThrow(/genau eine Option/);
  });

  it('rejects a contract with both options selected', () => {
    const body = TEMPLATE_BODY.replaceAll('- [ ] **', '- [x] **');

    expect(() => validateDocumentationContract({
      changedFiles: ['src/domain/models.ts', 'docs/DOMAIN_MODELS.md'],
      pullRequestBody: body,
    })).toThrow(/genau eine Option/);
  });

  it('accepts uppercase checkbox markers', () => {
    const body = bodyWithoutDocumentation(
      'Interne Typnamen wurden ohne Verhaltensänderung vereinheitlicht; die Dokumentation beschreibt keine internen Namen.',
    ).replace('- [x] **Keine', '- [X] **Keine');

    expect(validateDocumentationContract({
      changedFiles: ['src/domain/models.ts'],
      pullRequestBody: body,
    })).toEqual({ status: 'valid', documentationImpact: 'none' });
  });

  it('rejects documentation-updated when no documentation file changed', () => {
    expect(() => validateDocumentationContract({
      changedFiles: ['src/domain/models.ts'],
      pullRequestBody: bodyWithDocumentation('`docs/DOMAIN_MODELS.md`'),
    })).toThrow(/weder docs\/ noch README\.md/);
  });

  it('rejects documentation-updated when the changed file is not named', () => {
    expect(() => validateDocumentationContract({
      changedFiles: ['src/domain/models.ts', 'docs/DOMAIN_MODELS.md'],
      pullRequestBody: bodyWithDocumentation('`docs/ARCHITECTURE.md`'),
    })).toThrow(/geänderte Dokumentationsdatei genannt/);
  });

  it('does not accept a changed documentation path as a substring of another path', () => {
    expect(() => validateDocumentationContract({
      changedFiles: ['src/domain/models.ts', 'docs/DOMAIN_MODELS.md'],
      pullRequestBody: bodyWithDocumentation('`docs/DOMAIN_MODELS.md.backup`'),
    })).toThrow(/geänderte Dokumentationsdatei genannt/);
  });

  it('rejects an unchanged no-impact placeholder', () => {
    expect(() => validateDocumentationContract({
      changedFiles: ['src/domain/models.ts'],
      pullRequestBody: TEMPLATE_BODY.replace(
        '- [ ] **Keine Dokumentationsauswirkung**',
        '- [x] **Keine Dokumentationsauswirkung**',
      ),
    })).toThrow(/konkrete Begründung/);
  });

  it.each(['N/A', 'Keine Auswirkung', 'Nicht relevant'])('rejects a non-specific reason: %s', (reason) => {
    expect(() => validateDocumentationContract({
      changedFiles: ['src/domain/models.ts'],
      pullRequestBody: bodyWithoutDocumentation(reason),
    })).toThrow(/konkrete Begründung/);
  });

  it('rejects a reason that is hidden entirely inside an HTML comment', () => {
    expect(() => validateDocumentationContract({
      changedFiles: ['src/domain/models.ts'],
      pullRequestBody: bodyWithoutDocumentation(
        '<!-- Dieser Text ist im gerenderten Pull Request vollständig unsichtbar. -->',
      ),
    })).toThrow(/konkrete Begründung/);
  });

  it('treats only the repository root README as governed documentation', () => {
    expect(() => validateDocumentationContract({
      changedFiles: ['src/domain/models.ts', 'src/README.md'],
      pullRequestBody: bodyWithDocumentation('`src/README.md`'),
    })).toThrow(/weder docs\/ noch README\.md/);
  });
});

describe('validateGitSha', () => {
  it('accepts a full Git SHA', () => {
    expect(validateGitSha('a'.repeat(40), 'PR_BASE_SHA')).toBe('a'.repeat(40));
  });

  it.each(['', 'abc123', 'g'.repeat(40), 'a'.repeat(39)])(
    'rejects an unsafe or incomplete Git SHA: %s',
    (sha) => {
      expect(() => validateGitSha(sha, 'PR_HEAD_SHA')).toThrow(/PR_HEAD_SHA/);
    },
  );
});

describe('getChangedFiles', () => {
  it('passes validated SHAs directly to git without a shell and parses NUL-separated paths', () => {
    const baseSha = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    const execFile = vi.fn(() => 'src/domain/models.ts\0docs/DOMAIN_MODELS.md\0');

    expect(getChangedFiles({ baseSha, headSha, execFile })).toEqual([
      'src/domain/models.ts',
      'docs/DOMAIN_MODELS.md',
    ]);
    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', '--diff-filter=ACMR', '-z', `${baseSha}...${headSha}`, '--'],
      { encoding: 'utf8' },
    );
  });
});
