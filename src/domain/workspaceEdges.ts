import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { ReferenceEdgeKind } from '@/domain/referenceGraphModel';

/** The eight document edges of an information network; names come from `REFERENCE_EDGE_KINDS`. */
export type WorkspaceDocumentEdgeKind = Extract<ReferenceEdgeKind,
  | 'profile-import'
  | 'ssp-import-profile'
  | 'ssp-leveraged-authorization'
  | 'component-source'
  | 'component-import'
  | 'ap-import-ssp'
  | 'ar-import-ap'
  | 'poam-import-ssp'>;

export interface WorkspaceDocumentReference {
  readonly kind: WorkspaceDocumentEdgeKind;
  /** Exact JSON Pointer to the reference field, including an absent href. */
  readonly path: string;
  readonly href: string | undefined;
  readonly allowedRoots: readonly OscalRootKey[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function items(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Reads only normative document references; binding and classification belong to the graph. */
export function readWorkspaceDocumentEdges(
  source: unknown,
  rootType: OscalRootKey,
): readonly WorkspaceDocumentReference[] {
  const body = record(record(source)?.[rootType]);
  if (!body) return [];
  const edges: WorkspaceDocumentReference[] = [];
  const rootPath = `/${rootType}`;
  const add = (
    value: unknown,
    field: string,
    path: string,
    kind: WorkspaceDocumentEdgeKind,
    allowedRoots: readonly OscalRootKey[],
  ) => {
    const object = record(value);
    if (!object) return;
    edges.push({ kind, path: `${path}/${field}`, href: typeof object[field] === 'string' ? object[field] : undefined, allowedRoots });
  };

  switch (rootType) {
    case 'profile':
      items(body.imports).forEach((entry, index) => {
        add(entry, 'href', `${rootPath}/imports/${index}`, 'profile-import', ['catalog', 'profile']);
      });
      break;
    case 'system-security-plan':
      add(body['import-profile'], 'href', `${rootPath}/import-profile`, 'ssp-import-profile', ['catalog', 'profile']);
      items(record(body['system-implementation'])?.['leveraged-authorizations']).forEach((authorization, index) => {
        items(record(authorization)?.links).forEach((link, linkIndex) => {
          if (record(link)?.rel === 'system-security-plan') {
            add(link, 'href', `${rootPath}/system-implementation/leveraged-authorizations/${index}/links/${linkIndex}`, 'ssp-leveraged-authorization', ['system-security-plan']);
          }
        });
      });
      break;
    case 'component-definition':
      for (const collection of ['components', 'capabilities']) {
        items(body[collection]).forEach((entry, index) => {
          items(record(entry)?.['control-implementations']).forEach((implementation, implementationIndex) => {
            add(implementation, 'source', `${rootPath}/${collection}/${index}/control-implementations/${implementationIndex}`, 'component-source', ['catalog', 'profile']);
          });
        });
      }
      items(body['import-component-definitions']).forEach((entry, index) => {
        add(entry, 'href', `${rootPath}/import-component-definitions/${index}`, 'component-import', ['component-definition']);
      });
      break;
    case 'assessment-plan':
      add(body['import-ssp'], 'href', `${rootPath}/import-ssp`, 'ap-import-ssp', ['system-security-plan']);
      break;
    case 'assessment-results':
      add(body['import-ap'], 'href', `${rootPath}/import-ap`, 'ar-import-ap', ['assessment-plan']);
      break;
    case 'plan-of-action-and-milestones':
      add(body['import-ssp'], 'href', `${rootPath}/import-ssp`, 'poam-import-ssp', ['system-security-plan']);
      break;
  }
  return edges;
}
