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
  const buffer = Buffer.isBuffer(input)
    ? input
    : input instanceof Uint8Array
      ? Buffer.from(input)
      : Buffer.from(String(input), 'utf8');

  return createHash('sha256').update(buffer).digest('hex');
}

export function deriveRouteId(path) {
  return path
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
    segments[0] !== repo.owner ||
    segments[1] !== repo.repo ||
    segments[2] !== 'tree' ||
    segments[3] !== 'main'
  ) {
    return null;
  }

  const path = decodeURIComponent(segments.slice(4).join('/'));
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

export function extractReferencedNamespaceUrls(catalogDocument, repository) {
  const urls = new Set();

  walkJson(catalogDocument, (entry) => {
    if (typeof entry.ns !== 'string') {
      return;
    }

    if (namespaceUrlToRepoPath(entry.ns, repository)) {
      urls.add(entry.ns);
    }
  });

  return [...urls].sort((left, right) => left.localeCompare(right));
}

export function parseCsv(text) {
  const rows = [];
  const source = text.replace(/^\uFEFF/, '');
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (char === '"') {
      if (inQuotes && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';

      if (char === '\r' && source[index + 1] === '\n') {
        index += 1;
      }
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.length > 1 || row[0] !== '' || rows.length === 0) {
    rows.push(row);
  }

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

export function buildUpstreamManifest({
  repository,
  snapshotCommitSha,
  catalogPath,
  catalogGitBlobSha,
  namespaces,
}) {
  const repo = toRepositoryParts(repository);
  const files = [
    {
      kind: 'catalog',
      path: catalogPath,
      gitBlobSha: catalogGitBlobSha,
    },
    ...namespaces
      .map((namespace) => ({
        kind: 'namespace',
        path: namespace.source.path,
        namespace: namespace.source.namespace,
        gitBlobSha: namespace.source.gitBlobSha,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  ];

  const signaturePayload = {
    repository: repo.url,
    snapshotCommitSha,
    catalogPath,
    files,
  };

  return {
    ...signaturePayload,
    signatureSha256: sha256Hex(JSON.stringify(signaturePayload)),
  };
}
