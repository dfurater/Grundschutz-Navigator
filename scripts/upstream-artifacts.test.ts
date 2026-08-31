import { describe, expect, it } from 'vitest';
import {
  buildSnapshotTreeDelta,
  buildUpstreamManifest,
  computeManifestSignature,
  materializeRegisteredPathMap,
  normalizeGitTree,
  validateManifestV2Shape,
} from './upstream-artifacts.mjs';

interface GitTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
}

const MONITORED_ROOTS = [
  'control_layer',
  'documentation/namespaces',
  'implementation_layer',
];

function blob(path: string, sha: string, size = 1): GitTreeEntry {
  return { path, mode: '100644', type: 'blob', sha, size };
}

function tree(entries: GitTreeEntry[], truncated = false) {
  return { truncated, tree: entries };
}

const MODIFIED_FIXTURE = [
  {
    path: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
    baseSha: 'b980d97dbfc296fedd0060ca13cd7944e9889d71',
    headSha: '193e5e0841beab14c207a91e6aa788d70e84632c',
  },
  {
    path: 'implementation_layer/WLAN/WLAN-component_definition.json',
    baseSha: '5cd635dfe86517fe79bc1ef57c3beb26604737c1',
    headSha: 'a3625d0ee0696436c18858ac79498b55b7b6481d',
  },
  {
    path: 'control_layer/Grundschutz++/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-G0-catalog.json',
    baseSha: 'cf5bd68494e48aaf68ca807756845a7be1b2b5a8',
    headSha: '12b49d32e1cda59195799fde4ffd47d361ee75ed',
  },
  {
    path: 'control_layer/Grundschutz++/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-catalog.json',
    baseSha: 'a4a81d395d7e933f6afe024db33c2c5124785059',
    headSha: '6010201a2baa16ccd838f30a0aee336e6d9cfeee',
  },
  {
    path: 'control_layer/Grundschutz++/sources/catalogs/Methodik-Grundschutz++/BSI-Methodik-Grundschutz++-catalog.json',
    baseSha: '1ce08d4833f794aae17f238d7a21adbaf07d3036',
    headSha: 'eda6ffd6b5247377d502ad8f1e425f1d4f41b8d4',
  },
  {
    path: 'control_layer/Grundschutz++/sources/profiles/Grundschutz++-profile.json',
    baseSha: 'a8ae898c2c6c85fef6043cefcef0859570cb528c',
    headSha: '73cabd151d3f7a65de1959aeb3429412c615a900',
  },
  {
    path: 'control_layer/Risikomanagement/BSI-Anforderungen-zum-Risikomanagement-catalog.json',
    baseSha: '4b8a9f7a05a4d30198ed65aa13587798a27a160a',
    headSha: 'e6c214515363e13b88b2066aa0e3c7b45af9c612',
  },
];

const ADDED_FIXTURE = [
  {
    path: 'control_layer/Lieferkettensicherheit/Lieferkettensicherheit-resolved_catalog.json',
    headSha: '0c2e7a7e88e321647edd8346dc08ce16cd058c08',
  },
  {
    path: 'control_layer/WLAN/WLAN-resolved_catalog.json',
    headSha: '8cdf24951c2388c176ed7983be61bef9d7a9d187',
  },
  {
    path: 'documentation/namespaces/security_targets_levels.csv',
    headSha: 'ec48913866f0fd0991aceeb891be710d879a353c',
  },
  {
    path: 'implementation_layer/GA-Lotse_Grundmodul/GA-Lotse_Grundmodul-component_definition.json',
    headSha: 'ebce4b9886ecda020911279e48f6e94f796b9f51',
  },
  {
    path: 'implementation_layer/Lieferkettensicherheit/Lieferkettensicherheit-component_definition.json',
    headSha: '1018a02d9850eccad3146c478eaad62c1bf79e9d',
  },
  {
    path: 'control_layer/ISO27001/ISO27001-AnnexA-catalog.json',
    headSha: 'b42bf1338bee3673db32b85306125330001d5ad9',
  },
  {
    path: 'control_layer/Mappings/ISO-27001-zu-GSpp/ISO27001-AnnexA-to-GS++-mapping_collection.json',
    headSha: '7404229d890158f1cf9ce46e029cffb961673106',
  },
  {
    path: 'control_layer/Mappings/IT-GS2023-zu-GSpp/ITGS-to-GS++-mapping_collection.json',
    headSha: 'c4c869f40d2afee1f2efb337c7f3232fed1a1292',
  },
  {
    path: 'control_layer/Lieferkettensicherheit/sources/profiles/Lieferkettensicherheit-profile.json',
    headSha: 'e00688774ae550f8a3cd0d9d57b25973fa8b334f',
  },
  {
    path: 'control_layer/WLAN/sources/profiles/WLAN-profile.json',
    headSha: 'f32494e45b7cf6d60f2d17dd38c750102286cad8',
  },
];

const REGISTERED_FIXTURE = [
  {
    artifactKey: 'catalog-gspp',
    rootType: 'catalog',
    lifecycle: 'supported',
    path: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
  },
  {
    artifactKey: 'catalog-lieferkette',
    rootType: 'catalog',
    lifecycle: 'preview',
    path: 'control_layer/Lieferkettensicherheit/Lieferkettensicherheit-resolved_catalog.json',
  },
  {
    artifactKey: 'catalog-wlan',
    rootType: 'catalog',
    lifecycle: 'preview',
    path: 'control_layer/WLAN/WLAN-resolved_catalog.json',
  },
  {
    artifactKey: 'component-ga-lotse-grundmodul',
    rootType: 'component-definition',
    lifecycle: 'preview',
    path: 'implementation_layer/GA-Lotse_Grundmodul/GA-Lotse_Grundmodul-component_definition.json',
  },
  {
    artifactKey: 'component-lieferkette',
    rootType: 'component-definition',
    lifecycle: 'preview',
    path: 'implementation_layer/Lieferkettensicherheit/Lieferkettensicherheit-component_definition.json',
  },
  {
    artifactKey: 'component-wlan',
    rootType: 'component-definition',
    lifecycle: 'preview',
    path: 'implementation_layer/WLAN/WLAN-component_definition.json',
  },
  {
    artifactKey: 'catalog-iso27001-annex-a',
    rootType: 'catalog',
    lifecycle: 'preview',
    path: 'control_layer/ISO27001/ISO27001-AnnexA-catalog.json',
  },
  {
    artifactKey: 'mapping-iso27001-annex-a-zu-gspp',
    rootType: 'mapping-collection',
    lifecycle: 'preview',
    path: 'control_layer/Mappings/ISO-27001-zu-GSpp/ISO27001-AnnexA-to-GS++-mapping_collection.json',
  },
  {
    artifactKey: 'mapping-itgs2023-zu-gspp',
    rootType: 'mapping-collection',
    lifecycle: 'preview',
    path: 'control_layer/Mappings/IT-GS2023-zu-GSpp/ITGS-to-GS++-mapping_collection.json',
  },
  {
    artifactKey: 'profile-lieferkette',
    rootType: 'profile',
    lifecycle: 'preview',
    path: 'control_layer/Lieferkettensicherheit/sources/profiles/Lieferkettensicherheit-profile.json',
  },
  {
    artifactKey: 'profile-gspp',
    rootType: 'profile',
    lifecycle: 'preview',
    path: 'control_layer/Grundschutz++/sources/profiles/Grundschutz++-profile.json',
  },
  {
    artifactKey: 'profile-wlan',
    rootType: 'profile',
    lifecycle: 'preview',
    path: 'control_layer/WLAN/sources/profiles/WLAN-profile.json',
  },
];

describe('upstream snapshot tree delta', () => {
  it('verwendet für registrierte Pfade dieselbe NCName-kompatible Schlüsselgrammatik', () => {
    expect(() => materializeRegisteredPathMap([{
      ...REGISTERED_FIXTURE[0],
      artifactKey: '1catalog-gspp',
    }])).toThrow(/key grammar/i);
  });

  it('reports all 17 official layer-structure paths and classifications', () => {
    const baseTree = tree(
      MODIFIED_FIXTURE.map((entry) => blob(entry.path, entry.baseSha)),
    );
    const headTree = tree([
      ...MODIFIED_FIXTURE.map((entry) => blob(entry.path, entry.headSha)),
      ...ADDED_FIXTURE.map((entry) => blob(entry.path, entry.headSha)),
    ]);
    const registeredPaths = materializeRegisteredPathMap(REGISTERED_FIXTURE);

    const delta = buildSnapshotTreeDelta({
      baseTree,
      headTree,
      monitoredRoots: MONITORED_ROOTS,
      registeredPaths,
    });

    expect(delta).toHaveLength(17);
    expect(delta.filter((entry) => entry.status === 'added')).toHaveLength(10);
    expect(delta.filter((entry) => entry.status === 'modified')).toHaveLength(7);
    expect(delta.filter((entry) => entry.status === 'removed')).toHaveLength(0);
    expect(delta.filter((entry) => entry.classification === 'registered')).toHaveLength(12);
    expect(delta.filter((entry) => entry.classification === 'unclassified')).toHaveLength(5);
    expect(delta.map(({ status, path }) => ({ status, path }))).toEqual([
      {
        status: 'modified',
        path: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
      },
      {
        status: 'modified',
        path: 'control_layer/Grundschutz++/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-G0-catalog.json',
      },
      {
        status: 'modified',
        path: 'control_layer/Grundschutz++/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-catalog.json',
      },
      {
        status: 'modified',
        path: 'control_layer/Grundschutz++/sources/catalogs/Methodik-Grundschutz++/BSI-Methodik-Grundschutz++-catalog.json',
      },
      {
        status: 'modified',
        path: 'control_layer/Grundschutz++/sources/profiles/Grundschutz++-profile.json',
      },
      {
        status: 'added',
        path: 'control_layer/ISO27001/ISO27001-AnnexA-catalog.json',
      },
      {
        status: 'added',
        path: 'control_layer/Lieferkettensicherheit/Lieferkettensicherheit-resolved_catalog.json',
      },
      {
        status: 'added',
        path: 'control_layer/Lieferkettensicherheit/sources/profiles/Lieferkettensicherheit-profile.json',
      },
      {
        status: 'added',
        path: 'control_layer/Mappings/ISO-27001-zu-GSpp/ISO27001-AnnexA-to-GS++-mapping_collection.json',
      },
      {
        status: 'added',
        path: 'control_layer/Mappings/IT-GS2023-zu-GSpp/ITGS-to-GS++-mapping_collection.json',
      },
      {
        status: 'modified',
        path: 'control_layer/Risikomanagement/BSI-Anforderungen-zum-Risikomanagement-catalog.json',
      },
      { status: 'added', path: 'control_layer/WLAN/WLAN-resolved_catalog.json' },
      { status: 'added', path: 'control_layer/WLAN/sources/profiles/WLAN-profile.json' },
      { status: 'added', path: 'documentation/namespaces/security_targets_levels.csv' },
      {
        status: 'added',
        path: 'implementation_layer/GA-Lotse_Grundmodul/GA-Lotse_Grundmodul-component_definition.json',
      },
      {
        status: 'added',
        path: 'implementation_layer/Lieferkettensicherheit/Lieferkettensicherheit-component_definition.json',
      },
      {
        status: 'modified',
        path: 'implementation_layer/WLAN/WLAN-component_definition.json',
      },
    ]);
    expect(
      delta.find(
        (entry) => entry.path === 'documentation/namespaces/security_targets_levels.csv',
      ),
    ).toEqual({
      status: 'added',
      path: 'documentation/namespaces/security_targets_levels.csv',
      classification: 'unclassified',
    });
  });

  it('reports removed registered files', () => {
    const registered = REGISTERED_FIXTURE[0];
    const registeredPaths = materializeRegisteredPathMap([registered]);
    const delta = buildSnapshotTreeDelta({
      baseTree: tree([blob(registered.path, '1'.repeat(40))]),
      headTree: tree([]),
      monitoredRoots: MONITORED_ROOTS,
      registeredPaths,
    });

    expect(delta).toEqual([
      {
        status: 'removed',
        path: registered.path,
        classification: 'registered',
        artifactKey: registered.artifactKey,
        rootType: registered.rootType,
        lifecycle: registered.lifecycle,
      },
    ]);
  });
});

describe('normalizeGitTree', () => {
  it('ignores normal tree directories and files outside monitored roots', () => {
    const normalized = normalizeGitTree(
      tree([
        {
          path: 'Mappings',
          mode: '040000',
          type: 'tree',
          sha: '1'.repeat(40),
        },
        blob('Mappings/z.json', '3'.repeat(40), 30),
        blob('Mappings/a.json', '2'.repeat(40), 20),
        blob('README.md', '4'.repeat(40), 10),
      ]),
      { monitoredRoots: ['Mappings'] },
    );

    expect(normalized).toEqual([
      { path: 'Mappings/a.json', gitBlobSha: '2'.repeat(40), sizeBytes: 20 },
      { path: 'Mappings/z.json', gitBlobSha: '3'.repeat(40), sizeBytes: 30 },
    ]);
  });

  it.each([
    ['path traversal', 'Mappings/../secret.json'],
    ['absolute path', '/Mappings/secret.json'],
    ['backslash', 'Mappings\\secret.json'],
    ['empty segment', 'Mappings//secret.json'],
  ])('rejects %s', (_label, path) => {
    expect(() =>
      normalizeGitTree(tree([blob(path, '1'.repeat(40))]), {
        monitoredRoots: ['Mappings'],
      }),
    ).toThrow(/unsafe/);
  });

  it('rejects duplicate paths and invalid SHAs', () => {
    const duplicate = blob('Mappings/a.json', '1'.repeat(40));
    expect(() =>
      normalizeGitTree(tree([duplicate, duplicate]), { monitoredRoots: ['Mappings'] }),
    ).toThrow('duplicate path');
    expect(() =>
      normalizeGitTree(tree([blob('Mappings/a.json', 'not-a-sha')]), {
        monitoredRoots: ['Mappings'],
      }),
    ).toThrow('invalid Git SHA');
  });

  it('rejects truncated trees', () => {
    expect(() =>
      normalizeGitTree(tree([], true), { monitoredRoots: ['Mappings'] }),
    ).toThrow('truncated or incomplete');
  });

  it.each([
    ['symlink', { mode: '120000', type: 'blob' }],
    ['submodule', { mode: '160000', type: 'commit' }],
    ['executable file', { mode: '100755', type: 'blob' }],
  ])('rejects a %s in a monitored root', (_label, kind) => {
    expect(() =>
      normalizeGitTree(
        tree([
          {
            path: 'Mappings/unsafe',
            sha: '1'.repeat(40),
            ...kind,
          },
        ]),
        { monitoredRoots: ['Mappings'] },
      ),
    ).toThrow('not a regular file');
  });
});

describe('upstream manifest v2', () => {
  const repository = 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek';
  const snapshotCommitSha = 'a'.repeat(40);
  const files = [
    {
      artifactKey: 'profile-wlan',
      rootType: 'profile',
      lifecycle: 'preview',
      path: 'control_layer/WLAN/sources/profiles/WLAN-profile.json',
      gitBlobSha: '2'.repeat(40),
      contentSha256: 'b'.repeat(64),
    },
    {
      artifactKey: 'catalog-gspp',
      rootType: 'catalog',
      lifecycle: 'supported',
      path: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
      gitBlobSha: '1'.repeat(40),
      contentSha256: 'a'.repeat(64),
    },
  ];

  it('builds path-sorted entries and a canonical v2 signature', () => {
    const manifest = buildUpstreamManifest({ repository, snapshotCommitSha, files });

    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.files.map((file) => file.path)).toEqual([
      'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
      'control_layer/WLAN/sources/profiles/WLAN-profile.json',
    ]);
    expect(manifest.signatureSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(computeManifestSignature(manifest)).toBe(manifest.signatureSha256);
    expect(validateManifestV2Shape(manifest)).toBe(manifest);
  });

  it('changes the signature when only a content hash changes', () => {
    const original = buildUpstreamManifest({ repository, snapshotCommitSha, files });
    const changed = buildUpstreamManifest({
      repository,
      snapshotCommitSha,
      files: [
        files[0],
        {
          ...files[1],
          contentSha256: 'c'.repeat(64),
        },
      ],
    });

    expect(changed.signatureSha256).not.toBe(original.signatureSha256);
  });

  it('rejects extra fields, noncanonical order, and a manipulated signature', () => {
    const manifest = buildUpstreamManifest({ repository, snapshotCommitSha, files });

    expect(() => validateManifestV2Shape({ ...manifest, extra: true })).toThrow(
      'unexpected or missing fields',
    );
    expect(() =>
      validateManifestV2Shape({ ...manifest, files: [...manifest.files].reverse() }),
    ).toThrow('canonical path order');
    expect(() =>
      validateManifestV2Shape({ ...manifest, signatureSha256: 'f'.repeat(64) }),
    ).toThrow('does not match');
  });
});
