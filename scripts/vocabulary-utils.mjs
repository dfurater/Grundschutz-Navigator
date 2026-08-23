import { createHash } from 'node:crypto';

function toRepositoryParts(repository) {
  if (repository.startsWith('https://github.com/')) {
    const url = new URL(repository);
    const [, owner, repo] = url.pathname.split('/');
    return {
      owner,
      repo,
      slug: `${owner}/${repo}`,
      url: `https://github.com/${owner}/${repo}`,
    };
  }

  const [owner, repo] = repository.split('/');
  return {
    owner,
    repo,
    slug: repository,
    url: `https://github.com/${repository}`,
  };
}

export function sha256Hex(input) {
  let buffer;
  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else if (input instanceof Uint8Array) {
    buffer = Buffer.from(input);
  } else {
    buffer = Buffer.from(String(input), 'utf8');
  }

  return createHash('sha256').update(buffer).digest('hex');
}

export function deriveRouteId(path) {
  return path
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export function namespaceUrlToRepoPath(namespaceUrl, repository) {
  const repo = toRepositoryParts(repository);
  let parsedUrl;

  try {
    parsedUrl = new URL(namespaceUrl);
  } catch {
    return null;
  }

  const segments = parsedUrl.pathname.split('/').filter(Boolean);
  if (
    parsedUrl.hostname !== 'github.com' ||
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.port !== '' ||
    parsedUrl.username !== '' ||
    parsedUrl.password !== '' ||
    parsedUrl.search !== '' ||
    parsedUrl.hash !== '' ||
    segments[0] !== repo.owner ||
    segments[1] !== repo.repo ||
    segments[2] !== 'tree' ||
    segments[3] !== 'main'
  ) {
    return null;
  }

  let path;
  try {
    path = decodeURIComponent(segments.slice(4).join('/'));
  } catch {
    return null;
  }
  return path.endsWith('.csv') ? path : null;
}

function walkJson(value, visit) {
  if (Array.isArray(value)) {
    value.forEach((item) => walkJson(item, visit));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  visit(value);
  Object.values(value).forEach((child) => walkJson(child, visit));
}

function compareStringsByCodeUnit(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function extractReferencedNamespaceUrls(catalogDocument, repository) {
  const urls = new Set();

  walkJson(catalogDocument, (entry) => {
    if (typeof entry.ns !== 'string') {
      return;
    }

    if (namespaceUrlToRepoPath(entry.ns, repository)) {
      urls.add(entry.ns);
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(entry.ns);
    } catch {
      return;
    }

    // Non-file namespaces such as the OSCAL schema URI are metadata, not
    // ingestion sources. Any HTTP(S) CSV reference, however, is an attempted
    // vocabulary source and must point at the official pinned BSI contract.
    if (
      (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') &&
      parsedUrl.pathname.toLowerCase().endsWith('.csv')
    ) {
      throw new Error(`Externe oder nicht erlaubte Namespace-Quelle: ${entry.ns}`);
    }
  });

  return [...urls].sort(compareStringsByCodeUnit);
}

function encodeRepositoryPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function matchesVocabularyCollection(collection, repoPath) {
  const prefix = `${collection.upstreamDirectory}/`;
  return (
    repoPath.startsWith(prefix) &&
    repoPath.endsWith(collection.fileSuffix) &&
    !repoPath.slice(prefix.length).includes('/')
  );
}

export function materializeVocabularyCollectionMembers({
  collection,
  treeFiles,
  referencedNamespaceUrls,
  repository,
}) {
  if (collection?.kind !== 'vocabulary-collection') {
    throw new Error('Vokabular-Membership benötigt eine registrierte Vokabularsammlung.');
  }
  if (!Array.isArray(treeFiles) || !Array.isArray(referencedNamespaceUrls)) {
    throw new TypeError('Vokabular-Membership benötigt vollständige Tree- und Referenzlisten.');
  }

  const repo = toRepositoryParts(repository);
  const members = treeFiles
    .filter((file) => matchesVocabularyCollection(collection, file.path))
    .sort((left, right) => compareStringsByCodeUnit(left.path, right.path));
  const memberPaths = new Set(members.map((file) => file.path));
  const referencedUrlByPath = new Map();

  for (const namespaceUrl of referencedNamespaceUrls) {
    const path = namespaceUrlToRepoPath(namespaceUrl, repository);
    if (!path || !memberPaths.has(path)) {
      throw new Error(
        `Referenzierter Namespace-Pfad ist kein direktes Mitglied der registrierten Vokabularsammlung: ${namespaceUrl}`,
      );
    }
    const existingUrl = referencedUrlByPath.get(path);
    if (existingUrl && existingUrl !== namespaceUrl) {
      throw new Error(`Namespace-Pfad wird über mehrere URLs referenziert: ${path}`);
    }
    referencedUrlByPath.set(path, namespaceUrl);
  }

  return members.map((file) => ({
    ...file,
    namespaceUrl:
      referencedUrlByPath.get(file.path) ??
      `${repo.url}/tree/main/${encodeRepositoryPath(file.path)}`,
  }));
}

function isLineBreak(char) {
  return char === '\n' || char === '\r';
}

function createCsvState() {
  return { cell: '', inQuotes: false, row: [] };
}

function endCell(state) {
  state.row.push(state.cell);
  state.cell = '';
}

function endRow(rows, state) {
  endCell(state);
  rows.push(state.row);
  state.row = [];
}

function consumeQuotedCharacter(state, source, index) {
  if (state.inQuotes && source[index + 1] === '"') {
    state.cell += '"';
    return 1;
  }
  state.inQuotes = !state.inQuotes;
  return 0;
}

function consumeCsvCharacter(rows, state, source, index) {
  const char = source[index];

  if (char === '"') {
    return consumeQuotedCharacter(state, source, index);
  }

  if (!state.inQuotes && char === ',') {
    endCell(state);
    return 0;
  }

  if (!state.inQuotes && isLineBreak(char)) {
    endRow(rows, state);
    if (char === '\r' && source[index + 1] === '\n') {
      return 1;
    }
    return 0;
  }

  state.cell += char;
  return 0;
}

function flushFinalRow(rows, state) {
  endCell(state);
  if (state.row.length > 1 || state.row[0] !== '' || rows.length === 0) {
    rows.push(state.row);
  }
}

export function parseCsv(text) {
  const rows = [];
  const source = text.replace(/^\uFEFF/, '');
  const state = createCsvState();

  for (let index = 0; index < source.length; index += 1) {
    index += consumeCsvCharacter(rows, state, source, index);
  }

  flushFinalRow(rows, state);

  return rows.filter((currentRow) => currentRow.some((value) => value !== ''));
}

function normalizeHeader(header) {
  return header.trim().toLowerCase().replace(/\s+/g, ' ');
}

function inferDefinitionColumn(headers) {
  return headers.find((header) => normalizeHeader(header).startsWith('definition'));
}

export function parseVocabularyCsv(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new Error('CSV enthält keine Daten.');
  }

  const columnOrder = rows[0].map((header) => header.trim());
  const valueColumn = columnOrder[0];
  if (!valueColumn) {
    throw new Error('CSV enthält keine Wertspalte.');
  }

  const definitionColumn = inferDefinitionColumn(columnOrder);
  const entries = [];
  const seenValues = new Set();

  for (const currentRow of rows.slice(1)) {
    const paddedRow = columnOrder.map((_, index) => currentRow[index] ?? '');
    const hasAnyValue = paddedRow.some((value) => value !== '');
    if (!hasAnyValue) {
      continue;
    }

    if (currentRow.length > columnOrder.length) {
      throw new Error(`CSV-Zeile hat mehr Spalten als Header (${currentRow.length} > ${columnOrder.length}).`);
    }

    const columns = Object.fromEntries(
      columnOrder.map((header, index) => [header, paddedRow[index]]),
    );

    const value = columns[valueColumn];
    if (!value) {
      throw new Error(`CSV-Eintrag ohne Wert in Spalte "${valueColumn}".`);
    }

    if (seenValues.has(value)) {
      throw new Error(`Doppelter Wert "${value}" im Vokabular.`);
    }
    seenValues.add(value);

    entries.push({
      value,
      definition: definitionColumn ? columns[definitionColumn] || undefined : undefined,
      columns,
    });
  }

  return {
    columnOrder,
    valueColumn,
    definitionColumn,
    entries,
  };
}

export function buildVocabularyNamespaceData({
  namespaceUrl,
  repository,
  path,
  gitBlobSha,
  csvText,
}) {
  const repo = toRepositoryParts(repository);
  const parsed = parseVocabularyCsv(csvText);

  return {
    source: {
      namespace: namespaceUrl,
      repository: repo.url,
      path,
      fileName: path.split('/').pop() ?? path,
      routeId: deriveRouteId(path),
      gitBlobSha,
    },
    columnOrder: parsed.columnOrder,
    valueColumn: parsed.valueColumn,
    definitionColumn: parsed.definitionColumn,
    entries: parsed.entries,
  };
}
