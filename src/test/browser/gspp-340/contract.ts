export type OscalCatalogSource = {
  catalog: {
    uuid: string;
    metadata: {
      title: string;
      'last-modified': string;
      version: string;
      'oscal-version': string;
    };
    groups: unknown[];
  };
};

export type DerivedView = {
  title: string;
  summary: string;
};

export type ExportDraft = {
  mediaType: 'application/oscal+json';
  content: string;
};

export type WorkspaceDocumentV1 = {
  localId: string;
  storageSchemaVersion: 1;
  oscalVersion: string;
  source: OscalCatalogSource;
  view: DerivedView;
  exportDraft: ExportDraft;
};

export type WorkspaceDocumentV2 = {
  localId: string;
  storageSchemaVersion: 2;
  oscalVersion: string;
  source: OscalCatalogSource;
  derived: {
    view: DerivedView;
    exportDraft: ExportDraft;
  };
};

export type WorkspaceExport = {
  formatVersion: 1;
  documents: WorkspaceDocumentV2[];
};

export type ResidueInspection = {
  databaseExists: boolean;
  storedValues: string[];
  indexKeys: string[];
  cacheValues: string[];
};

export interface WorkspaceAdapter {
  readonly candidate: 'dexie' | 'idb';
  readonly databaseName: string;
  createV1(records: readonly unknown[]): Promise<void>;
  openV2(): Promise<void>;
  putDocument(document: WorkspaceDocumentV2): Promise<void>;
  getDocument(localId: string): Promise<WorkspaceDocumentV2 | undefined>;
  exportWorkspace(): Promise<WorkspaceExport>;
  restoreWorkspace(snapshot: WorkspaceExport): Promise<void>;
  deleteDocument(localId: string): Promise<void>;
  deleteWorkspace(): Promise<void>;
  inspectResidues(): Promise<ResidueInspection>;
  close(): void;
}

export type WorkspaceAdapterFactory = (databaseName: string) => WorkspaceAdapter;
