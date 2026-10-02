export declare const CHECKSUMS_FILE: 'SHA256SUMS';

export declare class DeploymentManifestError extends Error {}

export declare function assertSafeRelativePath(path: string): string;

export declare function collectDeployedFiles(distDir: string): string[];

export declare function readRegularFileNoFollow(path: string, label?: string): Buffer;

export declare function sha256Hex(bytes: string | Uint8Array): string;

export declare function buildChecksumsManifest(distDir: string): string;

export declare function writeChecksumsManifestFile(distDir: string): string;

export declare function parseChecksumsManifest(text: string): Map<string, string>;

export declare function assertChecksumsManifest(distDir: string): {
  fileCount: number;
  subjectCount: 1;
};

export declare function parseCheckArgs(argv: readonly string[]): { distDir: string };

export declare function main(argv?: readonly string[]): void;
