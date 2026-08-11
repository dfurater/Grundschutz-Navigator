import type {
  OscalCatalogSource,
  WorkspaceDocumentV1,
  WorkspaceDocumentV2,
} from './contract';

function createSource(localId: string, sentinel: string, oscalVersion: string): OscalCatalogSource {
  return {
    catalog: {
      uuid: `synthetic-oscal-${localId}`,
      metadata: {
        title: `${sentinel} source`,
        'last-modified': '2026-08-11T00:00:00Z',
        version: '1.0.0',
        'oscal-version': oscalVersion,
      },
      groups: [],
    },
  };
}

export function createV1Document(
  localId: string,
  sentinel: string,
  oscalVersion = '1.1.3',
): WorkspaceDocumentV1 {
  return {
    localId,
    storageSchemaVersion: 1,
    oscalVersion,
    source: createSource(localId, sentinel, oscalVersion),
    view: {
      title: `${sentinel} view`,
      summary: 'Synthetische Testprojektion',
    },
    exportDraft: {
      mediaType: 'application/oscal+json',
      content: `${sentinel} export draft`,
    },
  };
}

export function expectedV2Document(document: WorkspaceDocumentV1): WorkspaceDocumentV2 {
  return {
    localId: document.localId,
    storageSchemaVersion: 2,
    oscalVersion: document.oscalVersion,
    source: document.source,
    derived: {
      view: document.view,
      exportDraft: document.exportDraft,
    },
  };
}

export function createV2Document(
  localId: string,
  sentinel: string,
  oscalVersion = '1.1.3',
): WorkspaceDocumentV2 {
  return expectedV2Document(createV1Document(localId, sentinel, oscalVersion));
}
