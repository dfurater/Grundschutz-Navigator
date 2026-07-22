#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CONTRACT_START = '<!-- documentation-contract:start -->';
const CONTRACT_END = '<!-- documentation-contract:end -->';
const FILES_START = '<!-- documentation-files:start -->';
const FILES_END = '<!-- documentation-files:end -->';
const REASON_START = '<!-- no-documentation-impact:start -->';
const REASON_END = '<!-- no-documentation-impact:end -->';
const DEFAULT_FILES_PLACEHOLDER = '`docs/DATEI.md` oder `README.md`';
const DEFAULT_REASON_PLACEHOLDER = 'Konkrete Begründung eintragen.';

export class DocumentationContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DocumentationContractError';
  }
}

function extractBlock(value, startMarker, endMarker) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (start === -1 || end === -1) {
    return null;
  }

  return value.slice(start + startMarker.length, end).trim();
}

function isDocumentationPath(file) {
  return file === 'README.md' || file.startsWith('docs/');
}

function isInsideHtmlComment(value, index) {
  return value.lastIndexOf('<!--', index) > value.lastIndexOf('-->', index);
}

function getCheckboxState(section, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const optionPattern = new RegExp(
    `^- \\[([ xX])\\] \\*\\*${escaped}\\*\\*[ \\t]*\\r?$`,
    'gm',
  );
  const visibleMatches = [...section.matchAll(optionPattern)]
    .filter((match) => !isInsideHtmlComment(section, match.index ?? 0));

  if (visibleMatches.length !== 1) {
    throw new DocumentationContractError(
      `Die Option „${label}“ muss im Dokumentationsabschnitt genau einmal vorkommen.`,
    );
  }

  return visibleMatches[0][1].toLowerCase() === 'x';
}

function validateUpdatedDocumentation(section, changedFiles) {
  const documentationFiles = changedFiles.filter(isDocumentationPath);
  if (documentationFiles.length === 0) {
    throw new DocumentationContractError(
      '„Dokumentation aktualisiert“ wurde gewählt, aber weder docs/ noch README.md wurde geändert.',
    );
  }

  const declaredFiles = extractBlock(section, FILES_START, FILES_END);
  if (!declaredFiles || declaredFiles === DEFAULT_FILES_PLACEHOLDER) {
    throw new DocumentationContractError(
      'Unter „Betroffene Dateien“ muss mindestens eine geänderte Dokumentationsdatei genannt werden (Pfad in Backticks).',
    );
  }

  if (!documentationFiles.some((file) => declaredFiles.includes(`\`${file}\``))) {
    throw new DocumentationContractError(
      'Unter „Betroffene Dateien“ muss mindestens eine geänderte Dokumentationsdatei genannt werden (Pfad in Backticks).',
    );
  }
}

function validateNoDocumentationImpact(section) {
  const rawReason = extractBlock(section, REASON_START, REASON_END);
  if (rawReason?.includes('<!--') || rawReason?.includes('-->')) {
    throw new DocumentationContractError(
      'Die Begründung darf keine HTML-Kommentar-Marker enthalten.',
    );
  }

  const reason = rawReason?.replace(/\s+/g, ' ').trim();

  if (
    !reason
    || reason === DEFAULT_REASON_PLACEHOLDER
    || reason.length < 30
  ) {
    throw new DocumentationContractError(
      'Für „Keine Dokumentationsauswirkung“ ist eine konkrete Begründung erforderlich.',
    );
  }
}

export function validateDocumentationContract({ changedFiles, pullRequestBody }) {
  if (!changedFiles.some((file) => file.startsWith('src/'))) {
    return { status: 'skipped', documentationImpact: null };
  }

  const section = extractBlock(pullRequestBody ?? '', CONTRACT_START, CONTRACT_END);
  if (section === null) {
    throw new DocumentationContractError(
      'Der Abschnitt „Dokumentationsauswirkung“ fehlt in der Pull-Request-Beschreibung.',
    );
  }

  const documentationUpdated = getCheckboxState(section, 'Dokumentation aktualisiert');
  const noDocumentationImpact = getCheckboxState(section, 'Keine Dokumentationsauswirkung');
  if (Number(documentationUpdated) + Number(noDocumentationImpact) !== 1) {
    throw new DocumentationContractError(
      'Im Abschnitt „Dokumentationsauswirkung“ muss genau eine Option ausgewählt sein.',
    );
  }

  if (documentationUpdated) {
    validateUpdatedDocumentation(section, changedFiles);
    return { status: 'valid', documentationImpact: 'updated' };
  }

  validateNoDocumentationImpact(section);
  return { status: 'valid', documentationImpact: 'none' };
}

export function validateGitSha(value, variableName) {
  if (!/^[0-9a-f]{40}$/i.test(value ?? '')) {
    throw new DocumentationContractError(`${variableName} muss ein vollständiger Git-SHA sein.`);
  }
  return value;
}

export function getChangedFiles({ baseSha, headSha, execFile = execFileSync }) {
  const validatedBaseSha = validateGitSha(baseSha, 'PR_BASE_SHA');
  const validatedHeadSha = validateGitSha(headSha, 'PR_HEAD_SHA');
  const output = execFile(
    'git',
    [
      'diff',
      '--name-only',
      '--no-renames',
      '--diff-filter=ACMRD',
      '-z',
      `${validatedBaseSha}...${validatedHeadSha}`,
      '--',
    ],
    { encoding: 'utf8' },
  );

  return output.split('\0').filter(Boolean);
}

function main() {
  const changedFiles = getChangedFiles({
    baseSha: process.env.PR_BASE_SHA,
    headSha: process.env.PR_HEAD_SHA,
  });
  const result = validateDocumentationContract({
    changedFiles,
    pullRequestBody: process.env.PR_BODY ?? '',
  });

  if (result.status === 'skipped') {
    console.log('Keine Änderungen unter src/; Dokumentationsvertrag ist nicht erforderlich.');
    return;
  }

  console.log(`Dokumentationsvertrag gültig (${result.documentationImpact}).`);
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Dokumentationsvertrag ungültig.');
    process.exitCode = 1;
  }
}
