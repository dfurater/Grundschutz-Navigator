import { isJsonObject } from '@/domain/jsonGuards';
import type { RawOscalProp } from '@/domain/models';
import { createCatalogReferenceProjectProps, readProjectProps } from '@/domain/projectProps';
import { SUPPORTED_CATALOGS } from '@/domain/sourceRegistry';
import { WORKSPACE_DIAGNOSTIC_CODES } from '@/domain/workspaceDiagnostics';
import type { WorkspaceBinding, WorkspaceEnvelope } from '@/domain/workspaceModel';

/*
 * Bindung lokaler Dokumente an verifizierte Katalogstände (ADR-10 §4, GSPP-362).
 * Das Dokument trägt je gebundenem BSI-Katalog das Paar
 * `assessed-against-catalog-key/-commit` auf `metadata.props`; der Arbeitsbereich
 * speichert keine Katalogbytes. Ausgeliefert ist ein Stand nur, wenn der in
 * dieser Sitzung geladene Katalog die Hashprüfung bestanden hat und sein Manifest
 * genau diesen Commit nennt. Die Auslieferungstiefe ist eins: je `catalogKey`
 * liefert der Build nur den aktuellen Stand aus.
 */

/** Ausgelieferter Stand je `artifactKey` in dieser Sitzung; fehlt ein Eintrag, ist der Katalog noch nicht geladen. */
export type CatalogDelivery = ReadonlyMap<string, { readonly commit: string | null; readonly verified: boolean }>;

export type CatalogPinState = 'bound' | 'pending' | 'unpinned' | 'not-delivered' | 'unverified' | 'invalid';

/** Bindungszustand eines Dokuments; `bound` als einziger Zustand gibt das Schreiben frei. */
export interface CatalogPin {
  readonly state: CatalogPinState;
  /** Redigierte Diagnose; Werte, Schlüssel und Commits erscheinen nie darin. */
  readonly code?: string;
  /** Kataloge, für die ein neuerer ausgelieferter Stand als Angebot besteht. */
  readonly offers: readonly string[];
  /** `artifactKey` der Katalogbindungen, die gegen einen anderen als den gebundenen Stand auflösen würden. */
  readonly withheld: readonly string[];
}

export const CATALOG_PIN_PATH = '/metadata/props';


const CODES: Readonly<Partial<Record<CatalogPinState, string>>> = {
  unpinned: WORKSPACE_DIAGNOSTIC_CODES.catalogPinMissing,
  'not-delivered': WORKSPACE_DIAGNOSTIC_CODES.catalogPinNotDelivered,
  unverified: WORKSPACE_DIAGNOSTIC_CODES.catalogPinUnverified,
  invalid: WORKSPACE_DIAGNOSTIC_CODES.catalogPinInvalid,
};

const catalogKeyByArtifact = new Map<string, string>(SUPPORTED_CATALOGS.map((entry) => [entry.artifactKey, entry.catalogKey]));

function metadataOf(source: unknown, rootType: string): Record<string, unknown> | undefined {
  const root = isJsonObject(source) ? source[rootType] : undefined;
  const metadata = isJsonObject(root) ? root.metadata : undefined;
  return isJsonObject(metadata) ? metadata : undefined;
}

/** Gebundene Katalogstände nach `catalogKey`; `null`, wenn die Projekt-Props den Schreibpfad sperren. */
export function readCatalogPins(source: unknown, rootType: string): ReadonlyMap<string, string> | null {
  const read = readProjectProps(metadataOf(source, rootType)?.props, 'metadata');
  if (!read.writeAllowed) return null;
  return new Map(read.projectProps
    .filter((prop) => prop.name === 'assessed-against-catalog-commit' && prop.group !== undefined)
    .map((prop) => [prop.group as string, prop.value]));
}

/** `artifactKey` der BSI-Kataloge, auf die das Dokument per Bindung verweist. */
function boundCatalogArtifacts(bindings: readonly WorkspaceBinding[]): string[] {
  return [...new Set(bindings.flatMap((binding) =>
    binding.target.kind === 'class-1' && catalogKeyByArtifact.has(binding.target.artifactKey) ? [binding.target.artifactKey] : []))];
}

/**
 * Bindungszustand eines gespeicherten Dokuments. `undefined` heißt: Das Dokument
 * verweist auf keinen BSI-Katalog, ein Stand ist nicht zu prüfen.
 */
export function catalogPinStatus(
  source: unknown,
  rootType: string,
  bindings: readonly WorkspaceBinding[],
  delivery: CatalogDelivery,
): CatalogPin | undefined {
  const artifacts = boundCatalogArtifacts(bindings);
  if (artifacts.length === 0) return undefined;
  const pins = readCatalogPins(source, rootType);
  if (pins === null) return { state: 'invalid', code: CODES.invalid, offers: [], withheld: artifacts };
  // Der schwerste Befund bestimmt den Zustand; Angebote sammeln alle Kataloge mit anderem ausgeliefertem Stand.
  const severity: readonly CatalogPinState[] = ['bound', 'pending', 'unpinned', 'not-delivered', 'unverified'];
  let state: CatalogPinState = 'bound';
  const offers: string[] = [];
  const withheld: string[] = [];
  for (const artifactKey of artifacts) {
    const catalogKey = catalogKeyByArtifact.get(artifactKey)!;
    const delivered = delivery.get(artifactKey);
    const pin = pins.get(catalogKey);
    let found: CatalogPinState;
    if (delivered === undefined) found = 'pending';
    else if (!delivered.verified || delivered.commit === null) found = 'unverified';
    else if (pin === undefined) found = 'unpinned';
    else found = pin === delivered.commit ? 'bound' : 'not-delivered';
    if (found === 'unpinned' || found === 'not-delivered') {
      offers.push(catalogKey);
      withheld.push(artifactKey);
    }
    if (severity.indexOf(found) > severity.indexOf(state)) state = found;
  }
  return { state, code: CODES[state], offers, withheld };
}

/**
 * Schreibfreigabe eines expliziten Speicherns: Der gespeicherte Stand muss gebunden sein
 * (`rebind` erlaubt zusätzlich das bestätigte Binden eines Dokuments ohne Paar); danach
 * ergänzt `withCatalogPins` die Paare neuer Katalogbindungen.
 */
export function catalogPinsForSave(
  saved: Readonly<{ source: unknown; rootType: string; bindings: readonly WorkspaceBinding[] }>,
  working: unknown,
  bindings: readonly WorkspaceBinding[],
  delivery: CatalogDelivery,
  rebind = false,
): CatalogPinWrite {
  const pin = catalogPinStatus(saved.source, saved.rootType, saved.bindings, delivery);
  if (pin && pin.state !== 'bound' && !(rebind && pin.state === 'unpinned')) {
    return { ok: false, code: pin.code ?? WORKSPACE_DIAGNOSTIC_CODES.catalogPinUnverified };
  }
  return withCatalogPins(working, saved.rootType, bindings, delivery);
}

export type CatalogPinWrite =
  | { readonly ok: true; readonly source: unknown }
  | { readonly ok: false; readonly code: string };

/**
 * Ergänzt für jeden gebundenen BSI-Katalog ohne Paar den ausgelieferten,
 * verifizierten Stand. Ein vorhandenes Paar bleibt unverändert; weicht es vom
 * ausgelieferten Stand ab, scheitert das Schreiben, statt still zu migrieren.
 */
export function withCatalogPins(
  source: unknown,
  rootType: string,
  bindings: readonly WorkspaceBinding[],
  delivery: CatalogDelivery,
): CatalogPinWrite {
  const artifacts = boundCatalogArtifacts(bindings);
  if (artifacts.length === 0) return { ok: true, source };
  const pins = readCatalogPins(source, rootType);
  const metadata = metadataOf(source, rootType);
  if (pins === null || metadata === undefined) return { ok: false, code: WORKSPACE_DIAGNOSTIC_CODES.catalogPinInvalid };
  const added: RawOscalProp[] = [];
  for (const artifactKey of artifacts) {
    const catalogKey = catalogKeyByArtifact.get(artifactKey)!;
    const delivered = delivery.get(artifactKey);
    if (!delivered?.verified || delivered.commit === null) return { ok: false, code: WORKSPACE_DIAGNOSTIC_CODES.catalogPinUnverified };
    const pin = pins.get(catalogKey);
    if (pin !== undefined) {
      if (pin !== delivered.commit) return { ok: false, code: WORKSPACE_DIAGNOSTIC_CODES.catalogPinNotDelivered };
      continue;
    }
    const pair = createCatalogReferenceProjectProps({ catalogKey, commit: delivered.commit });
    if (!pair.ok) return { ok: false, code: WORKSPACE_DIAGNOSTIC_CODES.catalogPinInvalid };
    added.push(...pair.props.map((prop) => ({ ...prop })));
  }
  if (added.length === 0) return { ok: true, source };
  const props = Array.isArray(metadata.props) ? metadata.props : [];
  const root = (source as Record<string, Record<string, unknown>>)[rootType];
  return { ok: true, source: { ...(source as object), [rootType]: { ...root, metadata: { ...metadata, props: [...props, ...added] } } } };
}

export interface PinnedBindings {
  /** Bindungszustand je `localId`; Dokumente ohne Katalogbindung fehlen. */
  readonly pins: ReadonlyMap<string, CatalogPin>;
  /** Bindungen, die der Dokumentgraph auflösen darf. */
  readonly bindings: readonly WorkspaceBinding[];
  /** Katalogbindungen gesperrter Dokumente: Sie lösen nie gegen einen anderen als den gebundenen Stand auf. */
  readonly withheld: readonly WorkspaceBinding[];
}

/** Hält die Katalogbindungen jedes nicht gebundenen Dokuments aus dem Dokumentgraphen heraus. */
export function applyCatalogPins(
  members: readonly Pick<WorkspaceEnvelope, 'localId' | 'rootType' | 'source'>[],
  bindings: readonly WorkspaceBinding[],
  delivery: CatalogDelivery,
): PinnedBindings {
  const pins = new Map<string, CatalogPin>();
  for (const member of members) {
    const pin = catalogPinStatus(member.source, member.rootType, bindings.filter((binding) => binding.fromLocalId === member.localId), delivery);
    if (pin) pins.set(member.localId, pin);
  }
  // Je Bindung: Ein nicht geladener oder nicht verifizierter Katalog fehlt dem Graphen ohnehin; zurückgehalten
  // wird, was sonst gegen einen anderen als den gebundenen Stand auflösen würde.
  const locked = (binding: WorkspaceBinding) => binding.target.kind === 'class-1'
    && (pins.get(binding.fromLocalId)?.withheld.includes(binding.target.artifactKey) ?? false);
  return { pins, bindings: bindings.filter((binding) => !locked(binding)), withheld: bindings.filter(locked) };
}
