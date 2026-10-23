import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildUpstreamManifest } from './upstream-artifacts.mjs';
import { listOscalArtifacts } from '../src/domain/sourceRegistry.mjs';
import { UNKNOWN_COMPANION_ROOT_TYPE } from './companion-artifacts.mjs';
import {
  GO_OSCAL_EXECUTION_TIMEOUT_MS,
  GO_OSCAL_RELEASE,
  classifyValidationResult,
  executeGoOscal,
  evaluateArtifactExpectation,
  formatVerificationFailure,
  getReleaseAssetsForPlatform,
  parseChecksums,
  prepareGoOscalInput,
  resolveGoOscalPlatform,
  resolveSbomOutputPath,
  REFERENCE_GRAPH_ALLOWLIST,
  runReferenceGraphStage,
  runVerifyUpstreamOscal,
  selectManifestOscalArtifacts,
  verifyPinnedAsset,
} from './verify-upstream-oscal.mjs';

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitBlobSha(bytes: Buffer) {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

describe('go-oscal Release-Pin', () => {
  it('wählt für Linux amd64 ausschließlich das im Issue gepinnte Artefakt', () => {
    expect(resolveGoOscalPlatform({ platform: 'linux', arch: 'x64' })).toEqual({
      binaryName: 'go-oscal_v0.7.1_Linux_amd64',
      binarySha256: 'e55007ee53fa11ea9830c8bc4ef7a6d2b81929983f525037c1e0b7aee5c9a6f1',
      sbomName: 'sbom_go-oscal_v0.7.1_Linux_amd64.sbom',
      sbomSha256: '7d6bc16934ae597ab7bcd8f484ea9eb55fcf341a2e1ea2b53cc2242ec43179e7',
    });
    expect(GO_OSCAL_RELEASE.tag).toBe('v0.7.1');
  });

  it('lehnt Windows und nicht bekannte Plattform-Architekturpaare fail-closed ab', () => {
    expect(() => resolveGoOscalPlatform({ platform: 'win32', arch: 'x64' })).toThrow(
      'go-oscal v0.7.1 unterstützt diese Plattform/Architektur nicht: win32/x64',
    );
    expect(() => resolveGoOscalPlatform({ platform: 'linux', arch: 'ia32' })).toThrow(
      'go-oscal v0.7.1 unterstützt diese Plattform/Architektur nicht: linux/ia32',
    );
  });
});

describe('go-oscal Supply-Chain-Prüfung', () => {
  const binaryBytes = Buffer.from('go-oscal-test-binary');
  const binarySha256 = createHash('sha256').update(binaryBytes).digest('hex');

  it('verlangt berechneten Hash, GitHub-API-Digest und checksums.txt zugleich', () => {
    const checksums = parseChecksums(`${binarySha256}  go-oscal\n`);

    expect(
      verifyPinnedAsset({
        bytes: binaryBytes,
        name: 'go-oscal',
        expectedSha256: binarySha256,
        apiDigest: `sha256:${binarySha256}`,
        checksumDigest: checksums.get('go-oscal'),
      }),
    ).toBe(binarySha256);
  });

  it('bricht bei einem abweichenden GitHub-API-Digest ab', () => {
    expect(() =>
      verifyPinnedAsset({
        bytes: binaryBytes,
        name: 'go-oscal',
        expectedSha256: binarySha256,
        apiDigest: `sha256:${'0'.repeat(64)}`,
        checksumDigest: binarySha256,
      }),
    ).toThrow('GitHub-API-Digest stimmt nicht mit dem Pin überein');
  });

  it('bricht bei einer abweichenden checksums.txt-Prüfsumme ab', () => {
    expect(() =>
      verifyPinnedAsset({
        bytes: binaryBytes,
        name: 'go-oscal',
        expectedSha256: binarySha256,
        apiDigest: `sha256:${binarySha256}`,
        checksumDigest: '0'.repeat(64),
      }),
    ).toThrow('checksums.txt stimmt nicht mit dem Pin überein');
  });
});

describe('GitHub-Release-Metadaten', () => {
  const linux = resolveGoOscalPlatform({ platform: 'linux', arch: 'x64' });

  function asset(name: string, digest: string) {
    return {
      name,
      digest: `sha256:${digest}`,
      browser_download_url:
        `https://github.com/defenseunicorns/go-oscal/releases/download/v0.7.1/${name}`,
    };
  }

  function release(binaryDigest = linux.binarySha256) {
    return {
      tag_name: 'v0.7.1',
      assets: [
        asset(GO_OSCAL_RELEASE.checksumsName, GO_OSCAL_RELEASE.checksumsSha256),
        asset(linux.binaryName, binaryDigest),
        asset(linux.sbomName, linux.sbomSha256),
      ],
    };
  }

  it('akzeptiert nur die vollständigen Metadaten des statisch gepinnten Linux-Artefakts', () => {
    expect(getReleaseAssetsForPlatform(release(), linux)).toEqual({
      checksums: expect.objectContaining({ name: GO_OSCAL_RELEASE.checksumsName }),
      binary: expect.objectContaining({ name: linux.binaryName }),
      sbom: expect.objectContaining({ name: linux.sbomName }),
    });
  });

  it('lehnt einen anderen API-Digest für das Linux-amd64-Artefakt ab', () => {
    expect(() => getReleaseAssetsForPlatform(release('0'.repeat(64)), linux)).toThrow(
      'GitHub-Release-Metadaten widersprechen dem statischen Pin',
    );
  });
});

describe('SBOM-Ausgabe', () => {
  const linux = resolveGoOscalPlatform({ platform: 'linux', arch: 'x64' });

  it('erlaubt ausschließlich den plattformgleichen Dateinamen im CI-Temporärbereich', async () => {
    const runnerTemp = await mkdtemp(resolve(tmpdir(), 'go-oscal-sbom-'));
    const outputPath = resolve(runnerTemp, linux.sbomName);

    try {
      expect(resolveSbomOutputPath(outputPath, linux, runnerTemp)).toBe(outputPath);
      expect(() =>
        resolveSbomOutputPath(resolve(runnerTemp, '..', linux.sbomName), linux, runnerTemp),
      ).toThrow('GO_OSCAL_SBOM_OUTPUT muss innerhalb des CI-Temporärbereichs liegen');
      expect(() =>
        resolveSbomOutputPath(resolve(runnerTemp, 'other.sbom'), linux, runnerTemp),
      ).toThrow('GO_OSCAL_SBOM_OUTPUT muss den plattformgleichen SBOM-Dateinamen verwenden');
    } finally {
      await rm(runnerTemp, { recursive: true, force: true });
    }
  });
});

describe('CI-Integration', () => {
  it('führt den Korpuslauf nach dem Katalogabruf aus und archiviert seine SBOM', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/validate.yml'), 'utf8');
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    const gitignore = readFileSync(resolve(process.cwd(), '.gitignore'), 'utf8');

    expect(packageJson.scripts['verify-upstream-oscal']).toBe(
      'node scripts/verify-upstream-oscal.mjs',
    );
    expect(workflow).toContain('run: npm run verify-upstream-oscal');
    expect(workflow).toContain('GO_OSCAL_SBOM_OUTPUT: ${{ runner.temp }}/sbom_go-oscal_v0.7.1_Linux_amd64.sbom');
    const sbomUploadStep = workflow.match(
      /^ {6}- name: Archive go-oscal SBOM\n((?: {8}.*\n)*)/m,
    )?.[1];
    expect(sbomUploadStep).toBeDefined();
    expect(sbomUploadStep).toContain('name: go-oscal-v0.7.1-sbom-linux-amd64');
    expect(sbomUploadStep).toContain(
      'path: ${{ runner.temp }}/sbom_go-oscal_v0.7.1_Linux_amd64.sbom',
    );
    expect(sbomUploadStep).toContain('if-no-files-found: error');
    expect(gitignore).toContain('/go-oscal/');
  });
});

describe('manifestgestützter OSCAL-Korpus', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), 'upstream-manifest.json'), 'utf8'),
  );
  const productPaths = new Set(listOscalArtifacts().map((entry) => entry.upstreamPath));

  it('prüft jedes OSCAL-Artefakt des Manifests und überspringt nur die Vokabulare', () => {
    const selection = selectManifestOscalArtifacts(manifest);
    const vocabularyFiles = manifest.files.filter((file) => file.rootType === 'vocabulary');
    const oscalFiles = manifest.files.filter(
      (file) => file.rootType !== 'vocabulary' && file.rootType !== UNKNOWN_COMPANION_ROOT_TYPE,
    );

    expect(selection.oscalArtifacts.map((artifact) => artifact.upstreamPath).sort())
      .toEqual(oscalFiles.map((file) => file.path).sort());
    expect(selection.vocabularyArtifacts).toHaveLength(vocabularyFiles.length);
  });

  it('nimmt Version und Lifecycle der Produktartefakte aus dem Register', () => {
    const { versionCoverage, oscalArtifacts } = selectManifestOscalArtifacts(manifest);
    const products = oscalArtifacts.filter((artifact) => productPaths.has(artifact.upstreamPath));

    expect(products).toHaveLength(listOscalArtifacts().length);
    for (const product of products) {
      const entry = listOscalArtifacts().find((candidate) => candidate.upstreamPath === product.upstreamPath);
      expect(product).toMatchObject({ oscalVersion: entry?.oscalVersion, lifecycle: entry?.lifecycle });
    }
    expect(Object.values(versionCoverage).reduce((sum, count) => sum + count, 0)).toBe(products.length);
  });
});

describe('Begleitartefakte in der Auswahl (ADR-13)', () => {
  const document = Buffer.from('{"catalog":{"metadata":{"oscal-version":"1.1.3"}}}');
  const product = listOscalArtifacts()[0];
  function file(overrides: Record<string, string>) {
    return {
      artifactKey: product.artifactKey,
      rootType: product.expectedRootType,
      lifecycle: product.lifecycle,
      path: product.upstreamPath,
      contentSha256: sha256(document),
      gitBlobSha: gitBlobSha(document),
      ...overrides,
    };
  }
  function manifestWith(files: ReturnType<typeof file>[]) {
    return buildUpstreamManifest({
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      snapshotCommitSha: 'a'.repeat(40),
      files,
    });
  }

  it('übernimmt Root-Typ und Lifecycle eines Begleitartefakts aus dem Manifest', () => {
    const selection = selectManifestOscalArtifacts(manifestWith([
      file({}),
      file({ artifactKey: 'companion', lifecycle: 'blocked-by-upstream', rootType: 'mapping-collection', path: 'control_layer/Mappings/x.json' }),
      file({ artifactKey: 'broken', lifecycle: 'blocked-by-upstream', rootType: UNKNOWN_COMPANION_ROOT_TYPE, path: 'control_layer/broken.json' }),
    ]), [product]);

    expect(selection.oscalArtifacts.map((artifact) => [artifact.artifactKey, artifact.rootType, artifact.lifecycle, artifact.oscalVersion]))
      .toEqual([
        [product.artifactKey, product.expectedRootType, product.lifecycle, product.oscalVersion],
        ['companion', 'mapping-collection', 'blocked-by-upstream', null],
      ]);
  });

  it('lehnt ein fehlendes oder abweichendes Produktartefakt fail-closed ab', () => {
    expect(() => selectManifestOscalArtifacts(
      manifestWith([file({ artifactKey: 'companion', path: 'control_layer/x.json' })]),
      [product],
    )).toThrow('Manifest und OSCAL-Quellregister stimmen nicht überein');
    expect(() => selectManifestOscalArtifacts(manifestWith([file({ lifecycle: 'preview' })]), [product]))
      .toThrow('Manifest und OSCAL-Quellregister stimmen nicht überein');
  });
});

describe('Sperrsemantik und Werkzeugfehler', () => {
  function artifact(lifecycle: string) {
    return {
      artifactKey: `artifact-${lifecycle}`,
      lifecycle,
      rootType: 'catalog',
      oscalVersion: '1.1.3',
    };
  }

  it.each(['supported', 'preview', 'draft'])(
    'lässt ein fehlgeschlagenes, nicht gesperrtes %s-Artefakt fail-closed scheitern',
    (lifecycle) => {
      expect(evaluateArtifactExpectation(artifact(lifecycle), 'failed')).toMatchObject({
        lifecycle,
        expectedSchemaStatus: 'passed',
        schemaStatus: 'failed',
        outcome: 'unexpected-schema-failure',
        verificationPassed: false,
      });
    },
  );

  it('akzeptiert einen Schemafehler eines gesperrten Artefakts, ohne ihn umzudeuten', () => {
    expect(evaluateArtifactExpectation(artifact('blocked-by-upstream'), 'failed')).toMatchObject({
      expectedSchemaStatus: 'failed',
      schemaStatus: 'failed',
      outcome: 'expected-blocked-schema-failure',
      verificationPassed: true,
    });
  });

  it.each([
    ['blocked-by-upstream', 'passed', 'companion-validator-disagreement'],
    ['preview', 'failed', 'companion-validator-disagreement'],
    ['blocked-by-upstream', 'not-checked', 'companion-not-checked'],
  ])('weist bei einem Begleitartefakt (%s, go-oscal %s) die Abweichung aus, ohne zu blockieren', (lifecycle, schemaStatus, outcome) => {
    expect(evaluateArtifactExpectation({ ...artifact(lifecycle), companion: true }, schemaStatus)).toMatchObject({
      schemaStatus,
      outcome,
      verificationPassed: true,
    });
  });

  it('lässt nur Begleitartefakte ungeprüft', () => {
    expect(() => evaluateArtifactExpectation(artifact('supported'), 'not-checked'))
      .toThrow('Only a companion artifact may remain unchecked');
  });

  it('meldet ein bestandenes gesperrtes Artefakt als Entsperrungskandidaten', () => {
    expect(evaluateArtifactExpectation(artifact('blocked-by-upstream'), 'passed')).toMatchObject({
      expectedSchemaStatus: 'failed',
      schemaStatus: 'passed',
      outcome: 'unblock-candidate',
      verificationPassed: false,
    });
  });

  it('behandelt ein nicht auswertbares Validatorergebnis als Werkzeugfehler', () => {
    expect(() => classifyValidationResult({ valid: 'false' })).toThrow(
      'GO_OSCAL_VALIDATION_RESULT_INVALID',
    );
    expect(classifyValidationResult({ valid: false })).toBe('failed');
  });

  it('ordnet Werkzeugfehler dem Registry-Schlüssel zu, ohne einen lokalen Pfad auszugeben', () => {
    expect(
      formatVerificationFailure({
        code: 'GO_OSCAL_VALIDATION_RESULT_UNAVAILABLE',
        artifactKey: 'mapping-itgs2023-zu-gspp',
        resultPath: '/private/tmp/does-not-leave-the-runner.json',
      }),
    ).toBe('GO_OSCAL_VALIDATION_RESULT_UNAVAILABLE artifact=mapping-itgs2023-zu-gspp');
  });

  it('redigiert Artefaktschlüssel außerhalb derselben NCName-kompatiblen Grammatik', () => {
    expect(formatVerificationFailure({
      code: 'GO_OSCAL_VALIDATION_RESULT_UNAVAILABLE',
      artifactKey: '1catalog-fixture',
    })).toBe('GO_OSCAL_VALIDATION_RESULT_UNAVAILABLE');
  });

  it('begrenzt jede go-oscal-Ausführung und redigiert einen Timeout', async () => {
    const execFileImpl = vi.fn(async () => {
      const timeoutError = Object.assign(new Error('private/path/to/untrusted-input.json'), {
        code: null,
        killed: true,
        signal: 'SIGTERM',
      });
      throw timeoutError;
    });

    const failure = await executeGoOscal(
      {
        binaryPath: '/private/tmp/go-oscal',
        inputPath: '/private/tmp/document.json',
        resultPath: '/private/tmp/result.json',
        artifactKey: 'catalog-fixture',
      },
      { execFileImpl },
    ).catch((error) => error);

    expect(failure).toMatchObject({
      code: 'GO_OSCAL_TOOL_EXECUTION_FAILED',
      artifactKey: 'catalog-fixture',
    });
    expect(formatVerificationFailure(failure)).toBe(
      'GO_OSCAL_TOOL_EXECUTION_FAILED artifact=catalog-fixture',
    );
    expect(execFileImpl).toHaveBeenCalledWith(
      '/private/tmp/go-oscal',
      [
        'validate',
        '--input-file',
        '/private/tmp/document.json',
        '--validation-result',
        '/private/tmp/result.json',
      ],
      { maxBuffer: 1024 * 1024, timeout: GO_OSCAL_EXECUTION_TIMEOUT_MS, windowsHide: true },
    );
  });

  it('entfernt nur die zulässige Schema-Direktive aus der temporären go-oscal-Eingabe', () => {
    const source = Buffer.from(JSON.stringify({
      $schema: 'https://example.test/oscal-schema.json',
      'mapping-collection': { metadata: { 'oscal-version': '1.2.1' } },
    }));

    expect(JSON.parse(prepareGoOscalInput(source, 'mapping-itgs2023-zu-gspp').toString('utf8'))).toEqual({
      'mapping-collection': { metadata: { 'oscal-version': '1.2.1' } },
    });
    expect(source.toString('utf8')).toContain('$schema');
  });

  it('enthält keine Ausnahmeliste oder Diagnose-Adapter für go-oscal', () => {
    expect(existsSync(resolve(process.cwd(), 'src/domain/goOscalSchemaPolicy.mjs'))).toBe(false);
  });
});

/**
 * Synthetischer Ein-Artefakt-Korpus mit eigenem go-oscal-Release-Pin. `respond`
 * bedient jede erlaubte Abruf-URL fehlerfrei; Tests legen ihre Störung davor.
 */
async function createCorpusFixture() {
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'verify-upstream-oscal-'));
  const binary = Buffer.from('binary');
  const sbom = Buffer.from('sbom');
  const document = Buffer.from('{"catalog":{"metadata":{"oscal-version":"1.1.3"}}}');
  const binarySha256 = sha256(binary);
  const sbomSha256 = sha256(sbom);
  const checksums = `${binarySha256}  go-oscal_vtest_Linux_amd64\n${sbomSha256}  sbom_go-oscal_vtest_Linux_amd64.sbom\n`;
  const releaseConfig = {
    repository: 'example/go-oscal',
    tag: 'vtest',
    checksumsName: 'checksums.txt',
    checksumsSha256: sha256(Buffer.from(checksums)),
    platforms: {
      'linux-x64': {
        binaryName: 'go-oscal_vtest_Linux_amd64',
        binarySha256,
        sbomName: 'sbom_go-oscal_vtest_Linux_amd64.sbom',
        sbomSha256,
      },
    },
  } as const;
  const registry = [
    {
      artifactKey: 'catalog-fixture',
      expectedRootType: 'catalog',
      oscalVersion: '1.1.3',
      lifecycle: 'preview',
      upstreamPath: 'control_layer/fixture.json',
    },
  ];
  const manifest = buildUpstreamManifest({
    repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
    snapshotCommitSha: 'a'.repeat(40),
    files: [
      {
        artifactKey: 'catalog-fixture',
        rootType: 'catalog',
        lifecycle: 'preview',
        path: registry[0].upstreamPath,
        contentSha256: sha256(document),
        gitBlobSha: gitBlobSha(document),
      },
      {
        artifactKey: 'namespaces-fixture',
        rootType: 'vocabulary',
        lifecycle: 'supported',
        path: 'documentation/namespaces/example.csv',
        contentSha256: sha256(Buffer.from('term\n')),
        gitBlobSha: gitBlobSha(Buffer.from('term\n')),
      },
    ],
  });
  await writeFile(resolve(tempRoot, 'upstream-manifest.json'), JSON.stringify(manifest));

  const releaseBase = 'https://github.com/example/go-oscal/releases/download/vtest';
  const metadataUrl = 'https://api.github.com/repos/example/go-oscal/releases/tags/vtest';
  const bsiUrl = 'https://raw.githubusercontent.com/BSI-Bund/Stand-der-Technik-Bibliothek/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/control_layer/fixture.json';
  const binaryUrl = `${releaseBase}/${releaseConfig.platforms['linux-x64'].binaryName}`;

  function respond(url: string) {
    if (url === metadataUrl) {
      return new Response(JSON.stringify({
        tag_name: 'vtest',
        assets: [
          { name: 'checksums.txt', digest: `sha256:${releaseConfig.checksumsSha256}`, browser_download_url: `${releaseBase}/checksums.txt` },
          { name: 'go-oscal_vtest_Linux_amd64', digest: `sha256:${binarySha256}`, browser_download_url: binaryUrl },
          { name: 'sbom_go-oscal_vtest_Linux_amd64.sbom', digest: `sha256:${sbomSha256}`, browser_download_url: `${releaseBase}/sbom_go-oscal_vtest_Linux_amd64.sbom` },
        ],
      }));
    }
    if (url === `${releaseBase}/checksums.txt`) return new Response(checksums);
    if (url === binaryUrl) return new Response(binary);
    if (url === `${releaseBase}/sbom_go-oscal_vtest_Linux_amd64.sbom`) return new Response(sbom);
    if (url === bsiUrl) return new Response(document);
    throw new Error(`unexpected network request: ${url}`);
  }

  const executeTool = vi.fn(async ({ resultPath }: { resultPath: string }) => {
    await writeFile(resultPath, JSON.stringify({ valid: true, errors: [] }));
    return 0;
  });

  function run(fetchImpl: (url: string) => Promise<Response>, overrides: Record<string, unknown> = {}) {
    return runVerifyUpstreamOscal({
      repoRoot: tempRoot,
      registry,
      fetchImpl,
      executeTool,
      platform: 'linux',
      arch: 'x64',
      releaseConfig,
      retryDelaysMs: [0, 0],
      ...overrides,
    });
  }

  return {
    tempRoot,
    registry,
    releaseConfig,
    releaseBase,
    metadataUrl,
    bsiUrl,
    binaryUrl,
    respond,
    executeTool,
    run,
    cleanup: () => rm(tempRoot, { recursive: true, force: true }),
  };
}

describe('Korpus-Orchestrierung', () => {
  it('prüft ein Begleitartefakt ohne vorbereitbare $schema-Direktive nicht, ohne den Lauf abzubrechen', async () => {
    const fixture = await createCorpusFixture();
    const companion = Buffer.from('{"$schema":5,"catalog":{"metadata":{"oscal-version":"9.9.9"}}}');
    const companionPath = 'control_layer/companion.json';
    const manifest = JSON.parse(await readFile(resolve(fixture.tempRoot, 'upstream-manifest.json'), 'utf8'));
    await writeFile(resolve(fixture.tempRoot, 'upstream-manifest.json'), JSON.stringify(buildUpstreamManifest({
      repository: manifest.repository,
      snapshotCommitSha: manifest.snapshotCommitSha,
      files: [...manifest.files, {
        artifactKey: 'companion-fixture',
        rootType: 'catalog',
        lifecycle: 'blocked-by-upstream',
        path: companionPath,
        contentSha256: sha256(companion),
        gitBlobSha: gitBlobSha(companion),
      }],
    })));
    const companionUrl = fixture.bsiUrl.replace('control_layer/fixture.json', companionPath);

    try {
      const result = await fixture.run(async (url: string) =>
        url === companionUrl ? new Response(companion) : fixture.respond(url));

      expect(result.verificationPassed).toBe(true);
      expect(result.artifactResults.find((entry) => entry.artifactKey === 'companion-fixture'))
        .toMatchObject({ schemaStatus: 'not-checked', outcome: 'companion-not-checked' });
      expect(fixture.executeTool).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('liefert eine deterministische, redigierte Zusammenfassung ohne Schema- oder Referenzabrufe', async () => {
    const fixture = await createCorpusFixture();
    const { tempRoot, registry, releaseConfig, releaseBase, executeTool } = fixture;
    const calls: string[] = [];
    let remainingMetadataTransportFailures = 1;
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === fixture.metadataUrl && remainingMetadataTransportFailures > 0) {
        remainingMetadataTransportFailures -= 1;
        throw new Error('UND_ERR_SOCKET: other side closed');
      }
      return fixture.respond(url);
    });

    try {
      const first = await runVerifyUpstreamOscal({
        repoRoot: tempRoot,
        registry,
        fetchImpl,
        executeTool,
        platform: 'linux',
        arch: 'x64',
        releaseConfig,
        retryDelaysMs: [0, 0],
      });
      const second = await runVerifyUpstreamOscal({
        repoRoot: tempRoot,
        registry,
        fetchImpl,
        executeTool,
        platform: 'linux',
        arch: 'x64',
        releaseConfig,
      });

      expect(first.summary).toBe(second.summary);
      expect(first.summary).toContain('OSCAL: 1 geprüft');
      expect(first.summary).toContain('vocabulary: 1 übersprungen (kein OSCAL-Root-Modell)');
      expect(first.summary).not.toMatch(/private\/|documentPath|failedValue|stack/i);
      expect(calls).toHaveLength(11);
      expect(calls.every((url) =>
        url.startsWith('https://api.github.com/repos/example/go-oscal/') ||
        url.startsWith(releaseBase) ||
        url.startsWith('https://raw.githubusercontent.com/BSI-Bund/Stand-der-Technik-Bibliothek/'),
      )).toBe(true);

      await expect(
        runVerifyUpstreamOscal({
          repoRoot: tempRoot,
          registry,
          fetchImpl,
          executeTool: async () => {},
          platform: 'linux',
          arch: 'x64',
          releaseConfig,
        }),
      ).rejects.toMatchObject({
        code: 'GO_OSCAL_VALIDATION_RESULT_UNAVAILABLE',
        artifactKey: 'catalog-fixture',
      });

      const integrityFailureFetch = vi.fn(async (url: string) => {
        const response = await fetchImpl(url);
        return url === `${releaseBase}/${releaseConfig.platforms['linux-x64'].binaryName}`
          ? new Response('wrong bytes')
          : response;
      });
      await expect(
        runVerifyUpstreamOscal({
          repoRoot: tempRoot,
          registry,
          fetchImpl: integrityFailureFetch,
          executeTool,
          platform: 'linux',
          arch: 'x64',
          releaseConfig,
          retryDelaysMs: [0, 0],
        }),
      ).rejects.toThrow('Berechneter SHA-256 stimmt nicht mit dem Pin überein');
      expect(
        integrityFailureFetch.mock.calls.filter(
          ([url]) => url === `${releaseBase}/${releaseConfig.platforms['linux-x64'].binaryName}`,
        ),
      ).toHaveLength(1);

      const exhaustedServerErrorFetch = vi.fn(async (url: string) => {
        if (url === 'https://api.github.com/repos/example/go-oscal/releases/tags/vtest') {
          return new Response('temporary failure', { status: 503 });
        }
        return fetchImpl(url);
      });
      await expect(
        runVerifyUpstreamOscal({
          repoRoot: tempRoot,
          registry,
          fetchImpl: exhaustedServerErrorFetch,
          executeTool,
          platform: 'linux',
          arch: 'x64',
          releaseConfig,
          retryDelaysMs: [0, 0],
        }),
      ).rejects.toThrow('GitHub-Release-Metadaten konnten nicht geladen werden');
      expect(
        exhaustedServerErrorFetch.mock.calls.filter(
          ([url]) => url === 'https://api.github.com/repos/example/go-oscal/releases/tags/vtest',
        ),
      ).toHaveLength(3);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe('Diagnose fehlgeschlagener Abrufe (GSPP-359)', () => {
  const SECRET_MESSAGE = 'UND_ERR_SOCKET https://example.test/pinned?secret=redact /private/tmp/input';

  async function failureLine(
    disturb: (url: string, respond: (url: string) => Response) => Response | Promise<Response>,
  ) {
    const fixture = await createCorpusFixture();
    try {
      const fetchImpl = vi.fn(async (url: string) => disturb(url, fixture.respond));
      const error = await fixture.run(fetchImpl).then(
        () => new Error('runVerifyUpstreamOscal hätte fehlschlagen müssen'),
        (failure: unknown) => failure,
      );
      return { fixture, fetchImpl, error, line: formatVerificationFailure(error) };
    } finally {
      await fixture.cleanup();
    }
  }

  function callsTo(fetchImpl: { mock: { calls: unknown[][] } }, url: string) {
    return fetchImpl.mock.calls.filter(([calledUrl]) => calledUrl === url).length;
  }

  it('meldet einen über alle drei Versuche erschöpften BSI-5xx mit Schlüssel, Status und Versuch', async () => {
    let bsiUrl = '';
    const { fetchImpl, line } = await failureLine((url, respond) => {
      if (url.startsWith('https://raw.githubusercontent.com/')) {
        bsiUrl = url;
        return new Response(SECRET_MESSAGE, { status: 503 });
      }
      return respond(url);
    });

    expect(line).toBe(
      `GO_OSCAL_VERIFICATION_FAILED artifact=catalog-fixture httpStatus=503 attempt=3 url=${bsiUrl}`,
    );
    expect(callsTo(fetchImpl, bsiUrl)).toBe(3);
    expect(line).not.toMatch(/fehlgeschlagen|secret|private|UND_ERR/);
  });

  it('meldet einen BSI-404 ohne Wiederholung mit dem echten Status', async () => {
    const { fixture, line } = await failureLine((url, respond) =>
      url.startsWith('https://raw.githubusercontent.com/')
        ? new Response('not found', { status: 404 })
        : respond(url),
    );

    expect(line).toBe(
      `GO_OSCAL_VERIFICATION_FAILED artifact=catalog-fixture httpStatus=404 attempt=1 url=${fixture.bsiUrl}`,
    );
  });

  it('meldet auf den Release-Pfaden Status und Versuch, aber keinen Artefaktschlüssel', async () => {
    const metadata = await failureLine((url, respond) =>
      url.startsWith('https://api.github.com/')
        ? new Response('down', { status: 502 })
        : respond(url),
    );
    expect(metadata.line).toBe(
      `GO_OSCAL_VERIFICATION_FAILED httpStatus=502 attempt=3 url=${metadata.fixture.metadataUrl}`,
    );

    const asset = await failureLine((url, respond) =>
      url.endsWith('/go-oscal_vtest_Linux_amd64')
        ? new Response('gone', { status: 410 })
        : respond(url),
    );
    expect(asset.line).toBe(
      `GO_OSCAL_VERIFICATION_FAILED httpStatus=410 attempt=1 url=${asset.fixture.binaryUrl}`,
    );
    expect([metadata.line, asset.line].join(' ')).not.toContain('artifact=');
  });

  it('meldet einen erschöpften Transportfehler mit Versuch, ohne Status und ohne Fehlertext', async () => {
    const { error, line } = await failureLine((url, respond) => {
      if (url.startsWith('https://raw.githubusercontent.com/')) {
        throw new Error(SECRET_MESSAGE);
      }
      return respond(url);
    });

    expect(line).toMatch(/^GO_OSCAL_VERIFICATION_FAILED artifact=catalog-fixture attempt=3 url=https:\/\/raw\.githubusercontent\.com\/\S+$/);
    expect(line).not.toContain('httpStatus=');
    expect(line).not.toMatch(/secret|private|UND_ERR/);
    expect((error as Error).cause).toMatchObject({ attempts: 3 });
  });

  it('gibt vom Redirect-Ziel nur Origin und Pfad aus, nie Query oder Fragment', async () => {
    const signedTarget = 'https://objects.githubusercontent.com/release/asset?X-Amz-Signature=secret&token=redact#fragment';
    const { line } = await failureLine((url, respond) => {
      if (url.endsWith('/go-oscal_vtest_Linux_amd64')) {
        return new Response(null, { status: 302, headers: { location: signedTarget } });
      }
      if (url.startsWith('https://objects.githubusercontent.com/')) {
        return new Response('down', { status: 500 });
      }
      return respond(url);
    });

    expect(line).toBe(
      'GO_OSCAL_VERIFICATION_FAILED httpStatus=500 attempt=3 url=https://objects.githubusercontent.com/release/asset',
    );
    expect(line).not.toMatch(/[?#]|secret|redact|Signature/);
  });

  it.each([
    ['ohne Ziel', () => new Response(null, { status: 302 })],
    [
      'zu einem nicht erlaubten Host',
      () => new Response(null, {
        status: 302,
        headers: { location: 'https://attacker.example/asset?token=secret' },
      }),
    ],
  ])('meldet einen Redirect %s mit Status, Versuch und der auslösenden URL', async (_case, redirect) => {
    const { fixture, line } = await failureLine((url, respond) =>
      url.endsWith('/go-oscal_vtest_Linux_amd64') ? redirect() : respond(url),
    );

    expect(line).toBe(
      `GO_OSCAL_VERIFICATION_FAILED httpStatus=302 attempt=1 url=${fixture.binaryUrl}`,
    );
    expect(line).not.toMatch(/attacker|secret/);
  });

  it('meldet eine überschrittene Redirect-Grenze mit der letzten Redirect-Antwort', async () => {
    const hop = (index: number) =>
      `https://objects.githubusercontent.com/hop/${index}?X-Amz-Signature=secret`;
    const { fetchImpl, line } = await failureLine((url, respond) => {
      if (url.endsWith('/go-oscal_vtest_Linux_amd64')) {
        return new Response(null, { status: 302, headers: { location: hop(1) } });
      }
      const match = /\/hop\/(\d+)/.exec(url);
      if (match) {
        return new Response(null, { status: 307, headers: { location: hop(Number(match[1]) + 1) } });
      }
      return respond(url);
    });

    // Sechs Abrufe (Hop 0 bis MAX_REDIRECT_HOPS); der letzte kam von Hop 5.
    expect(fetchImpl.mock.calls.filter(([url]) => /\/hop\/\d+/.test(url))).toHaveLength(5);
    expect(line).toBe(
      'GO_OSCAL_VERIFICATION_FAILED httpStatus=307 attempt=1 url=https://objects.githubusercontent.com/hop/5',
    );
  });

  it('meldet einen Redirect-Abbruch mit dem ersten Versuch', async () => {
    const { fixture, line } = await failureLine((url, respond) => {
      if (url.startsWith('https://api.github.com/')) {
        throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
      }
      return respond(url);
    });

    expect(line).toBe(`GO_OSCAL_VERIFICATION_FAILED attempt=1 url=${fixture.metadataUrl}`);
  });

  it('lässt ungültige Diagnosefelder ersatzlos entfallen', () => {
    expect(formatVerificationFailure({
      artifactKey: '1catalog-fixture',
      httpStatus: '503',
      attempt: 0,
      url: 'http://example.test/plain?secret=redact',
    })).toBe('GO_OSCAL_VERIFICATION_FAILED');
    expect(formatVerificationFailure({
      httpStatus: 503.5,
      attempt: -1,
      url: 'kein URL',
    })).toBe('GO_OSCAL_VERIFICATION_FAILED');
    expect(formatVerificationFailure({
      httpStatus: 503,
      attempt: 2,
      url: 'https://user:pass@example.test/path/to?query#frag',
    })).toBe('GO_OSCAL_VERIFICATION_FAILED httpStatus=503 attempt=2 url=https://example.test/path/to');
  });
});

describe('Stufe 5 — Referenzgraph im Korpuslauf', () => {
  // Synthetisch wie im übrigen Korpus-Orchestrierungstest: Geprüft wird die
  // Bindung an *einen* Snapshot, nicht an den gerade aktuellen.
  const SNAPSHOT = 'c'.repeat(40);

  function catalogSource(controlId: string, linkHref: string) {
    return {
      catalog: {
        uuid: '11111111-1111-4111-8111-111111111111',
        metadata: {
          title: 'Fixture',
          'last-modified': '2026-08-18T00:00:00Z',
          version: '1.0',
          'oscal-version': '1.1.3',
        },
        groups: [
          {
            id: 'GRP',
            title: 'Gruppe',
            props: [{ name: 'alt-identifier', value: 'grp' }],
            controls: [
              {
                id: controlId,
                title: 'Control',
                props: [{ name: 'alt-identifier', value: 'ctl' }],
                links: [{ href: linkHref, rel: 'related' }],
              },
            ],
          },
        ],
      },
    };
  }

  function artifact(overrides: Record<string, unknown> = {}) {
    return {
      artifactKey: 'catalog-fixture',
      rootType: 'catalog',
      oscalVersion: '1.1.3',
      lifecycle: 'supported',
      catalogKey: 'gspp',
      upstreamPath: 'control_layer/fixture.json',
      ...overrides,
    };
  }

  async function loadDomain() {
    const [adapters, graph, policy] = await Promise.all([
      import('../src/adapters/oscalRootAdapters'),
      import('../src/domain/referenceGraph'),
      import('../src/domain/referenceGraphPolicy'),
    ]);
    return {
      parseOscalDocument: adapters.parseOscalDocument,
      buildReferenceGraph: graph.buildReferenceGraph,
      evaluateReferenceGraph: policy.evaluateReferenceGraph,
      formatReferenceGraphSummary: policy.formatReferenceGraphSummary,
      toReferenceGraphReport: policy.toReferenceGraphReport,
    };
  }

  async function runStage(input: {
    artifacts: readonly ReturnType<typeof artifact>[];
    sources: Map<string, unknown>;
    results: readonly { artifactKey: string; schemaStatus: string }[];
    allowlist?: readonly { signature: string; snapshotCommitSha: string; reason: string }[];
  }) {
    return runReferenceGraphStage({
      manifest: { snapshotCommitSha: SNAPSHOT },
      selection: { oscalArtifacts: input.artifacts },
      artifactResults: input.results,
      sources: input.sources,
      loadDomain,
      ...(input.allowlist ? { allowlist: input.allowlist } : {}),
    });
  }

  it('lässt einen Referenzfehler an einem supported-Artefakt fehlschlagen', async () => {
    const stage = await runStage({
      artifacts: [artifact()],
      sources: new Map([['catalog-fixture', catalogSource('C.1', '#C.99')]]),
      results: [{ artifactKey: 'catalog-fixture', schemaStatus: 'passed' }],
    });

    expect(stage.referenceGraphPassed).toBe(false);
    expect(stage.report.blocking).toHaveLength(1);
    expect(stage.summary).toContain('OSCAL_GRAPH_TARGET_NOT_FOUND');
  });

  it('deckt denselben Befund über Signatur und Snapshot ab, aber nicht über einen anderen Snapshot', async () => {
    const sources = new Map([['catalog-fixture', catalogSource('C.1', '#C.99')]]);
    const results = [{ artifactKey: 'catalog-fixture', schemaStatus: 'passed' }];
    const uncovered = await runStage({ artifacts: [artifact()], sources, results });
    const signature = uncovered.report.blocking[0].signature;

    const covered = await runStage({
      artifacts: [artifact()],
      sources,
      results,
      allowlist: [{ signature, snapshotCommitSha: SNAPSHOT, reason: 'upstream gemeldet' }],
    });
    expect(covered.referenceGraphPassed).toBe(true);
    expect(covered.report.allowed).toHaveLength(1);

    const expired = await runStage({
      artifacts: [artifact()],
      sources,
      results,
      allowlist: [{ signature, snapshotCommitSha: 'd'.repeat(40), reason: 'alter Snapshot' }],
    });
    expect(expired.referenceGraphPassed).toBe(false);
    expect(expired.report.expiredAllowlistEntries).toHaveLength(1);
  });

  it('nimmt ein Artefakt ohne bestandene Stufe 3 nicht in den Graphen auf', async () => {
    const stage = await runStage({
      artifacts: [artifact({ lifecycle: 'blocked-by-upstream' })],
      sources: new Map([['catalog-fixture', catalogSource('C.1', '#C.99')]]),
      results: [{ artifactKey: 'catalog-fixture', schemaStatus: 'failed' }],
    });

    expect(stage.report.artifacts).toHaveLength(0);
    expect(stage.referenceGraphPassed).toBe(true);
  });

  it('meldet ein nicht ableitbares Artefakt redigiert und blockiert nur bei supported', async () => {
    const undeducible = { catalog: { metadata: { 'oscal-version': '1.1.3' } } };

    const blocking = await runStage({
      artifacts: [artifact()],
      sources: new Map([['catalog-fixture', undeducible]]),
      results: [{ artifactKey: 'catalog-fixture', schemaStatus: 'passed' }],
    });
    expect(blocking.referenceGraphPassed).toBe(false);
    expect(blocking.parseFailures).toEqual([
      { artifactKey: 'catalog-fixture', lifecycle: 'supported' },
    ]);
    expect(blocking.summary).not.toMatch(/alt-identifier|uuid|Invalid OSCAL/i);

    const tolerated = await runStage({
      artifacts: [artifact({ lifecycle: 'preview' })],
      sources: new Map([['catalog-fixture', undeducible]]),
      results: [{ artifactKey: 'catalog-fixture', schemaStatus: 'passed' }],
    });
    expect(tolerated.referenceGraphPassed).toBe(true);
  });

  it('bindet keine relativen oder externen Ziele und weist sie als nicht bewertbar aus', async () => {
    const stage = await runStage({
      artifacts: [artifact({ lifecycle: 'preview' })],
      sources: new Map([
        ['catalog-fixture', catalogSource('C.1', 'anderer-katalog.json')],
      ]),
      results: [{ artifactKey: 'catalog-fixture', schemaStatus: 'passed' }],
    });

    expect(stage.report.edges.notEvaluable).toBe(1);
    expect(stage.report.edges.unresolvable).toBe(0);
    expect(stage.summary).toContain('status=nicht abschliessend bewertet');
  });

  it('hält die Allowlist der CI-Lane leer, solange kein Befund akzeptiert ist', () => {
    expect(REFERENCE_GRAPH_ALLOWLIST).toEqual([]);
  });
});
