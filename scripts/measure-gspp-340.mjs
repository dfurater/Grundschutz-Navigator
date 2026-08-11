import { gzipSync } from 'node:zlib';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..');
const AREA_MARKER = /^\s*\/\/\s*GSPP-340 area:\s*(.+?)\s*$/;

const CANDIDATE_FILES = {
  dexie: 'src/test/browser/gspp-340/dexieAdapter.ts',
  idb: 'src/test/browser/gspp-340/idbAdapter.ts',
};

const SHARED_FILES = [
  'src/test/browser/gspp-340/contract.ts',
  'src/test/browser/gspp-340/bundleBaseline.ts',
  'src/test/browser/gspp-340/browserTestSupport.ts',
  'src/test/browser/gspp-340/fixtures.ts',
  'src/test/browser/gspp-340/workspaceAdapters.browser.test.ts',
  'src/test/browser/egressOracle.negative.browser.test.ts',
  'scripts/verify-browser-egress.mjs',
  'scripts/verify-browser-egress.test.ts',
  'scripts/measure-gspp-340.mjs',
  'scripts/measure-gspp-340.test.ts',
];

function codeLinesByArea(source) {
  const lines = [];
  let area = 'Scaffolding';
  let insideBlockComment = false;

  for (const line of source.split(/\r?\n/u)) {
    const marker = line.match(AREA_MARKER);
    if (marker) {
      area = marker[1];
      continue;
    }

    let remainder = line;
    let code = '';
    while (remainder.length > 0) {
      if (insideBlockComment) {
        const blockEnd = remainder.indexOf('*/');
        if (blockEnd === -1) {
          remainder = '';
          continue;
        }
        insideBlockComment = false;
        remainder = remainder.slice(blockEnd + 2);
        continue;
      }

      const lineComment = remainder.indexOf('//');
      const blockStart = remainder.indexOf('/*');
      if (lineComment !== -1 && (blockStart === -1 || lineComment < blockStart)) {
        code += remainder.slice(0, lineComment);
        remainder = '';
        continue;
      }
      if (blockStart === -1) {
        code += remainder;
        remainder = '';
        continue;
      }

      code += remainder.slice(0, blockStart);
      const blockEnd = remainder.indexOf('*/', blockStart + 2);
      if (blockEnd === -1) {
        insideBlockComment = true;
        remainder = '';
      } else {
        remainder = remainder.slice(blockEnd + 2);
      }
    }

    if (code.trim().length > 0) {
      lines.push(area);
    }
  }

  return lines;
}

export function countPhysicalLines(source) {
  return codeLinesByArea(source).length;
}

export function countLinesByArea(source) {
  const counts = {};
  for (const area of codeLinesByArea(source)) {
    counts[area] = (counts[area] ?? 0) + 1;
  }
  return counts;
}

export function measureCandidateLoc({ readFile = readFileSync } = {}) {
  const candidates = Object.fromEntries(Object.entries(CANDIDATE_FILES).map(([name, file]) => {
    const source = readFile(resolve(PROJECT_ROOT, file), 'utf8');
    return [name, {
      file,
      total: countPhysicalLines(source),
      areas: countLinesByArea(source),
    }];
  }));

  const shared = Object.fromEntries(SHARED_FILES.map((file) => {
    const source = readFile(resolve(PROJECT_ROOT, file), 'utf8');
    return [file, countPhysicalLines(source)];
  }));

  return {
    rule: 'Physische, nichtleere und nicht ausschließlich kommentierende TypeScript/JavaScript-Zeilen.',
    candidates,
    shared: {
      files: shared,
      total: Object.values(shared).reduce((sum, count) => sum + count, 0),
    },
  };
}

async function measureBundleEntry(build, entry, outputDirectory) {
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      emptyOutDir: true,
      minify: 'oxc',
      outDir: outputDirectory,
      lib: {
        entry,
        formats: ['es'],
        fileName: 'bundle',
      },
    },
  });

  const outputFile = readdirSync(outputDirectory)
    .find((file) => /\.m?js$/u.test(file));
  if (!outputFile) {
    throw new Error(`GSPP340_BUNDLE_OUTPUT_MISSING: ${entry}`);
  }
  const bytes = readFileSync(join(outputDirectory, outputFile));
  return {
    rawBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes).byteLength,
  };
}

export async function measureCandidateBundles() {
  const { build } = await import('vite');
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'gspp-340-bundle-'));

  try {
    const entries = {
      baseline: resolve(PROJECT_ROOT, 'src/test/browser/gspp-340/bundleBaseline.ts'),
      ...Object.fromEntries(Object.entries(CANDIDATE_FILES).map(([name, file]) => (
        [name, resolve(PROJECT_ROOT, file)]
      ))),
    };
    const measurements = {};
    for (const [name, entry] of Object.entries(entries)) {
      measurements[name] = await measureBundleEntry(
        build,
        entry,
        join(temporaryRoot, `dist-${name}`),
      );
    }

    const baseline = measurements.baseline;
    return Object.fromEntries(Object.entries(measurements).map(([name, measurement]) => [
      name,
      {
        ...measurement,
        rawDeltaBytes: measurement.rawBytes - baseline.rawBytes,
        gzipDeltaBytes: measurement.gzipBytes - baseline.gzipBytes,
      },
    ]));
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

export async function measureGspp340() {
  return {
    loc: measureCandidateLoc(),
    bundles: await measureCandidateBundles(),
  };
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    process.stdout.write(`${JSON.stringify(await measureGspp340(), null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
