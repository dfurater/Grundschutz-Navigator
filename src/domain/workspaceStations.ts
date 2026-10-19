import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { DocumentState } from '@/domain/workspaceModel';
import type { WorkspaceDocumentEdgeKind } from '@/domain/workspaceEdges';
import type { WorkspaceGraphEdge } from '@/domain/workspaceGraphModel';

/** Stationen mit eigener Arbeitsroute; die Station Catalog liegt im Katalogbereich (ADR-11). */
export const WORKSPACE_STATIONS = ['profile', 'ssp', 'assessment', 'poam'] as const;
export type WorkspaceStation = (typeof WORKSPACE_STATIONS)[number];

export function isWorkspaceStation(value: unknown): value is WorkspaceStation {
  return typeof value === 'string' && (WORKSPACE_STATIONS as readonly string[]).includes(value);
}

export interface StationDefinition {
  /** OSCAL-Modellname als Titel. */
  readonly title: string;
  /** BSI-Erklärzeile aus der Stationstabelle von ADR-11. */
  readonly explanation: string;
  readonly rootTypes: readonly OscalRootKey[];
}

export const CATALOG_STATION: Omit<StationDefinition, 'rootTypes'> = {
  title: 'Catalog',
  explanation: 'Der Anforderungsbestand zum Nachschlagen',
};

export const STATION_DEFINITIONS: Readonly<Record<WorkspaceStation, StationDefinition>> = {
  profile: {
    title: 'Profile',
    explanation: 'Das Anforderungspaket für einen Informationsverbund',
    rootTypes: ['profile'],
  },
  ssp: {
    title: 'SSP',
    explanation: 'Der Umsetzungsstatus je Anforderung',
    rootTypes: ['system-security-plan'],
  },
  assessment: {
    title: 'Assessment Plan / Results',
    explanation: 'Die Wirksamkeitsprüfung',
    rootTypes: ['assessment-plan', 'assessment-results'],
  },
  poam: {
    title: 'POA&M',
    explanation: 'Die Umsetzungsplanung für nicht erfüllte Anforderungen',
    rootTypes: ['plan-of-action-and-milestones'],
  },
};

/** Anzeigename je Root-Typ; `mapping-collection` ist kein Mitglied eines Informationsverbunds. */
export const ROOT_TYPE_LABELS: Readonly<Record<OscalRootKey, string>> = {
  catalog: 'Catalog',
  profile: 'Profile',
  'mapping-collection': 'Mapping Collection',
  'component-definition': 'Component Definition',
  'system-security-plan': 'SSP',
  'assessment-plan': 'Assessment Plan',
  'assessment-results': 'Assessment Results',
  'plan-of-action-and-milestones': 'POA&M',
};

export type DocumentValidity = 'Entwurf' | 'Gültig';

/**
 * `imported` und `export-ready` setzen beim Aufnehmen und Speichern ein
 * schemagültiges Dokument voraus (docs/PERSISTENCE.md §4); nur `draft` darf
 * unvollständig sein.
 */
export function documentValidity(state: DocumentState): DocumentValidity {
  return state === 'draft' ? 'Entwurf' : 'Gültig';
}

/**
 * Pflichtstatus der acht Dokumentverweise: Pflicht ist ein Verweis, den das
 * Modell für jedes Dokument seines Root-Typs verlangt (`profile.imports`,
 * `import-profile`, `control-implementation.source`, `import-ssp` im
 * Assessment Plan, `import-ap`).
 */
export const DOCUMENT_REFERENCE_REQUIREMENT: Readonly<Record<WorkspaceDocumentEdgeKind, 'Pflicht' | 'optional'>> = {
  'profile-import': 'Pflicht',
  'ssp-import-profile': 'Pflicht',
  'ssp-leveraged-authorization': 'optional',
  'component-source': 'Pflicht',
  'component-import': 'optional',
  'ap-import-ssp': 'Pflicht',
  'ar-import-ap': 'Pflicht',
  'poam-import-ssp': 'optional',
};

export function referenceRequirement(kind: WorkspaceGraphEdge['kind']): 'Pflicht' | 'optional' | undefined {
  return (DOCUMENT_REFERENCE_REQUIREMENT as Readonly<Record<string, 'Pflicht' | 'optional'>>)[kind];
}

export const EDGE_STATE_LABELS: Readonly<Record<WorkspaceGraphEdge['state'], string>> = {
  resolved: 'aufgelöst',
  'resolved-empty': 'aufgelöst, ohne Inhalt',
  'missing-source': 'Quelle fehlt',
  'not-evaluable': 'nicht zugeordnet',
  external: 'extern, nicht aufgelöst',
  error: 'Fehler',
};
