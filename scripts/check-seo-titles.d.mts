export declare const EM_DASH: string;

export declare class SeoTitleCheckError extends Error {}

export declare function extractSeoTitleFields(html: string): {
  title: string;
  ogTitle: string;
  description: string;
  ogImageAlt: string;
};

export declare function collectBuiltHtmlFiles(distDir: string): string[];

export declare function checkBuiltSeoTitles(distDir: string): {
  fileCount: number;
  fieldCount: number;
};

export declare function parseCheckArgs(argv: readonly string[]): { distDir: string };

export declare function main(argv?: readonly string[]): void;
