import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildUpstreamManifest } from './upstream-artifacts.mjs';
import { SOURCE_REGISTRY } from '../src/domain/sourceRegistry.mjs';
import {
  GO_OSCAL_EXECUTION_TIMEOUT_MS,
  GO_OSCAL_RELEASE,
  classifyValidationResult,
  executeGoOscal,
  evaluateArtifactExpectation,
  fetchWithTransientRetry,
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

describe('transiente Abrufe für die go-oscal-Lieferkette', () => {
  it('wiederholt einen geworfenen Transportfehler höchstens zweimal', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('UND_ERR_SOCKET: other side closed'))
      .mockRejectedValueOnce(new Error('UND_ERR_SOCKET: other side closed'))
      .mockResolvedValue(new Response('ok'));

    await expect(
      fetchWithTransientRetry(fetchImpl, 'https://example.test/pinned', {}, [0, 0]),
    ).resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('bricht bei einem von Undici signalisierten Redirect sofort ab', async () => {
    const redirectError = new TypeError('fetch failed', {
      cause: new Error('unexpected redirect'),
    });
    const fetchImpl = vi.fn().mockRejectedValue(redirectError);

    await expect(
      fetchWithTransientRetry(fetchImpl, 'https://example.test/pinned', { redirect: 'error' }, [0, 0]),
    ).rejects.toBe(redirectError);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('wiederholt HTTP-5xx, aber HTTP-4xx nicht', async () => {
    const transientFailure = vi.fn()
      .mockResolvedValueOnce(new Response('temporary failure', { status: 502 }))
      .mockResolvedValueOnce(new Response('temporary failure', { status: 503 }))
      .mockResolvedValue(new Response('ok'));
    const permanentFailure = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));

    await expect(
      fetchWithTransientRetry(transientFailure, 'https://example.test/pinned', {}, [0, 0]),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      fetchWithTransientRetry(permanentFailure, 'https://example.test/pinned', {}, [0, 0]),
    ).resolves.toMatchObject({ status: 403 });

    expect(transientFailure).toHaveBeenCalledTimes(3);
    expect(permanentFailure).toHaveBeenCalledTimes(1);
  });

  it('wiederholt weder Integritätsfehler noch leakt es ausgeschöpfte Transportfehler', async () => {
    const integrityFailure = vi.fn().mockResolvedValue(new Response('wrong bytes'));
    const response = await fetchWithTransientRetry(
      integrityFailure,
      'https://example.test/pinned',
      {},
      [0, 0],
    );
    const bytes = Buffer.from(await response.text());

    expect(() =>
      verifyPinnedAsset({
        bytes,
        expectedSha256: '0'.repeat(64),
        apiDigest: `sha256:${'0'.repeat(64)}`,
        checksumDigest: '0'.repeat(64),
      }),
    ).toThrow('Berechneter SHA-256 stimmt nicht mit dem Pin überein');
    expect(integrityFailure).toHaveBeenCalledTimes(1);

    const exhaustedFailure = vi.fn().mockRejectedValue(
      new Error('UND_ERR_SOCKET https://example.test/pinned?secret=redact /private/tmp/input'),
    );
    const error = await fetchWithTransientRetry(
      exhaustedFailure,
      'https://example.test/pinned',
      {},
      [0, 0],
    ).catch((failure) => failure);

    expect(exhaustedFailure).toHaveBeenCalledTimes(3);
    expect(formatVerificationFailure(error)).toBe('GO_OSCAL_VERIFICATION_FAILED');
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
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    const gitignore = readFileSync(resolve(process.cwd(), '.gitignore'), 'utf8');

    expect(packageJson.scripts['verify-upstream-oscal']).toBe(
      'node scripts/verify-upstream-oscal.mjs',
    );
    expect(workflow).toContain('run: npm run verify-upstream-oscal');
    expect(workflow).toContain('GO_OSCAL_SBOM_OUTPUT: ${{ runner.temp }}/sbom_go-oscal_v0.7.1_Linux_amd64.sbom');
    expect(workflow).toContain(
      'uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1',
    );
    expect(workflow).toContain('path: ${{ runner.temp }}/sbom_go-oscal_v0.7.1_Linux_amd64.sbom');
    expect(gitignore).toContain('/go-oscal/');
  });
});

describe('manifestgestützter OSCAL-Korpus', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), 'upstream-manifest.json'), 'utf8'),
  );

  it('prüft alle 19 OSCAL-Artefakte und überspringt nur die 13 Vokabulare', () => {
    const selection = selectManifestOscalArtifacts(manifest);

    expect(selection.oscalArtifacts).toHaveLength(19);
    expect(selection.vocabularyArtifacts).toHaveLength(13);
    expect(selection.oscalArtifacts.map((artifact) => artifact.artifactKey)).toContain(
      'mapping-iso27001-annex-a-zu-gspp',
    );
  });

  it('belegt genau die vier gepinnten OSCAL-Versionen und zählt jedes ausgewählte Artefakt genau einmal', () => {
    const { versionCoverage, oscalArtifacts } = selectManifestOscalArtifacts(manifest);

    // Bewusst ohne Häufigkeitstabelle: Die exakte Artefakt-zu-Version-Zuordnung
    // ist der schärfere Vier-Augen-Nachweis und steht vollständig in
    // `DECLARED_UPSTREAM_VERSIONS` (src/domain/sourceRegistry.test.ts). Eine
    // Häufigkeitsverteilung wäre dasselbe schwächer — und würde bei jeder
    // BSI-Rolling-Publication veralten, obwohl sich an der Zuständigkeit dieses
    // Skripts nichts ändert (GSPP-375). Was hier zählt, ist die Auswahl selbst:
    // welche Versionen sie belegt, und dass ihre Aggregation vollständig ist.
    expect(Object.keys(versionCoverage)).toEqual(['1.1.2', '1.1.3', '1.2.1', '1.2.2']);
    expect(Object.values(versionCoverage).reduce((sum, count) => sum + count, 0)).toBe(
      oscalArtifacts.length,
    );
  });

  it('führt drei gesperrte Artefakte mit inverser Erwartung im vollständigen Korpus', () => {
    const { oscalArtifacts } = selectManifestOscalArtifacts(manifest);

    expect(
      oscalArtifacts
        .filter((artifact) => artifact.lifecycle === 'blocked-by-upstream')
        .map((artifact) => artifact.artifactKey)
        .sort(),
    ).toEqual([
      'component-ga-lotse-grundmodul',
      'component-lieferkette',
      'mapping-iso27001-annex-a-zu-gspp',
    ]);
  });

  it('meldet im realen Manifest kein gesperrtes Artefakt als aus dem Upstream-Tree entfernt (ADR-7)', () => {
    // Ergänzt die vorstehende Prüfung: Die drei gesperrten Artefakte sind
    // dort als in `oscalArtifacts` enthalten bestätigt — hier wird explizit
    // gegen die echte, getrackte upstream-manifest.json geprüft, dass
    // `selectManifestOscalArtifacts` (mit Default-Registry) daneben keinen
    // vierten, bisher unbemerkten Fall eines aus dem Baum entfernten
    // gesperrten Artefakts meldet. Bewusst gegen die reale Datei statt nur
    // gegen ein synthetisches Manifest (siehe ADR-7-Nachtrag-Block unten):
    // Ein künftig aus dem BSI-Tree entferntes, noch gesperrtes Artefakt
    // müsste hier auffallen, statt nur im synthetischen Fixture abgedeckt zu
    // sein.
    const selection = selectManifestOscalArtifacts(manifest);

    expect(selection.missingBlockedArtifacts).toEqual([]);
  });
});

describe('ADR-7-Nachtrag: gesperrtes Artefakt vollständig aus dem Upstream-Tree entfernt', () => {
  function sha256(bytes: Buffer) {
    return createHash('sha256').update(bytes).digest('hex');
  }

  function gitBlobSha(bytes: Buffer) {
    return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  }

  const document = Buffer.from('{"catalog":{"metadata":{"oscal-version":"1.1.3"}}}');
  // R4-keine-doppelten-registerfakten: reale Registry-Einträge verwenden statt
  // Pfad/Lifecycle/Version hier erneut zu deklarieren.
  const oscalEntries = SOURCE_REGISTRY.filter((entry) => entry.kind === 'oscal');
  const blockedRegistryEntry = oscalEntries.find(
    (entry) => entry.lifecycle === 'blocked-by-upstream',
  );
  const presentRegistryEntry = oscalEntries.find(
    (entry) => entry.lifecycle !== 'blocked-by-upstream' && entry.artifactKey !== blockedRegistryEntry?.artifactKey,
  );
  const secondMissingNonBlockedEntry = oscalEntries.find(
    (entry) =>
      entry.lifecycle !== 'blocked-by-upstream' &&
      entry.artifactKey !== presentRegistryEntry?.artifactKey &&
      entry.artifactKey !== blockedRegistryEntry?.artifactKey,
  );
  if (!blockedRegistryEntry || !presentRegistryEntry || !secondMissingNonBlockedEntry) {
    throw new Error(
      'Fixture braucht ein gesperrtes und mindestens zwei nicht gesperrte OSCAL-Registry-Einträge',
    );
  }
  const manifestWithoutBlockedFile = buildUpstreamManifest({
    repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
    snapshotCommitSha: 'a'.repeat(40),
    files: [
      {
        artifactKey: presentRegistryEntry.artifactKey,
        rootType: presentRegistryEntry.expectedRootType,
        lifecycle: presentRegistryEntry.lifecycle,
        path: presentRegistryEntry.upstreamPath,
        contentSha256: sha256(document),
        gitBlobSha: gitBlobSha(document),
      },
    ],
  });

  it('überspringt ein gesperrtes Artefakt ohne Manifesteintrag, statt einen Mismatch zu werfen', () => {
    const selection = selectManifestOscalArtifacts(manifestWithoutBlockedFile, [
      presentRegistryEntry,
      blockedRegistryEntry,
    ]);

    expect(selection.oscalArtifacts.map((artifact) => artifact.artifactKey)).toEqual([
      presentRegistryEntry.artifactKey,
    ]);
    expect(selection.missingBlockedArtifacts).toEqual([
      {
        artifactKey: blockedRegistryEntry.artifactKey,
        upstreamPath: blockedRegistryEntry.upstreamPath,
      },
    ]);
  });

  it('lehnt weiterhin ein nicht gesperrtes Artefakt ohne Manifesteintrag fail-closed ab', () => {
    expect(() =>
      selectManifestOscalArtifacts(manifestWithoutBlockedFile, [
        presentRegistryEntry,
        secondMissingNonBlockedEntry,
      ]),
    ).toThrow('Manifest und OSCAL-Quellregister stimmen nicht überein');
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

describe('Korpus-Orchestrierung', () => {
  function sha256(bytes: Buffer) {
    return createHash('sha256').update(bytes).digest('hex');
  }

  function gitBlobSha(bytes: Buffer) {
    return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  }

  it('liefert eine deterministische, redigierte Zusammenfassung ohne Schema- oder Referenzabrufe', async () => {
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
    const calls: string[] = [];
    let remainingMetadataTransportFailures = 1;
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === 'https://api.github.com/repos/example/go-oscal/releases/tags/vtest') {
        if (remainingMetadataTransportFailures > 0) {
          remainingMetadataTransportFailures -= 1;
          throw new Error('UND_ERR_SOCKET: other side closed');
        }
        return new Response(JSON.stringify({
          tag_name: 'vtest',
          assets: [
            { name: 'checksums.txt', digest: `sha256:${releaseConfig.checksumsSha256}`, browser_download_url: `${releaseBase}/checksums.txt` },
            { name: 'go-oscal_vtest_Linux_amd64', digest: `sha256:${binarySha256}`, browser_download_url: `${releaseBase}/go-oscal_vtest_Linux_amd64` },
            { name: 'sbom_go-oscal_vtest_Linux_amd64.sbom', digest: `sha256:${sbomSha256}`, browser_download_url: `${releaseBase}/sbom_go-oscal_vtest_Linux_amd64.sbom` },
          ],
        }));
      }
      if (url === `${releaseBase}/checksums.txt`) return new Response(checksums);
      if (url === `${releaseBase}/go-oscal_vtest_Linux_amd64`) return new Response(binary);
      if (url === `${releaseBase}/sbom_go-oscal_vtest_Linux_amd64.sbom`) return new Response(sbom);
      if (url === 'https://raw.githubusercontent.com/BSI-Bund/Stand-der-Technik-Bibliothek/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/control_layer/fixture.json') {
        return new Response(document);
      }
      throw new Error(`unexpected network request: ${url}`);
    });
    const executeTool = vi.fn(async ({ resultPath }: { resultPath: string }) => {
      await writeFile(resultPath, JSON.stringify({ valid: true, errors: [] }));
      return 0;
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
      await rm(tempRoot, { recursive: true, force: true });
    }
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
