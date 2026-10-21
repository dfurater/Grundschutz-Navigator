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
export type CatalogDelivery = ReadonlyMap<string, DeliveredCatalog>;
export interface DeliveredCatalog { readonly commit: string | null; readonly verified: boolean }

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
  /** `catalogKey` der Kataloge, die in dieser Sitzung noch nicht geladen sind; die Sitzung fordert sie an. */
  readonly pending: readonly string[];
  /** Der Zustand stammt aus einem lokal referenzierten Dokument; sperrt Prüfaktionen, nicht das Bearbeiten. */
  readonly inherited?: true;
}

export const CATALOG_PIN_PATH = '/metadata/props';


const CODES: Readonly<Partial<Record<CatalogPinState, string>>> = {
  unpinned: WORKSPACE_DIAGNOSTIC_CODES.catalogPinMissing,
  'not-delivered': WORKSPACE_DIAGNOSTIC_CODES.catalogPinNotDelivered,
  unverified: WORKSPACE_DIAGNOSTIC_CODES.catalogPinUnverified,
  invalid: WORKSPACE_DIAGNOSTIC_CODES.catalogPinInvalid,
};

const catalogKeyByArtifact = new Map<string, string>(SUPPORTED_CATALOGS.map((entry) => [entry.artifactKey, entry.catalogKey]));
const artifactByCatalogKey = new Map<string, string>(SUPPORTED_CATALOGS.map((entry) => [entry.catalogKey, entry.artifactKey]));
const SEVERITY: readonly CatalogPinState[] = ['bound', 'pending', 'unpinned', 'not-delivered', 'unverified', 'invalid'];
const worse = (a: CatalogPinState, b: CatalogPinState) => SEVERITY.indexOf(a) > SEVERITY.indexOf(b);

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

/** Das Dokument trägt ein Katalogpaar, auch ein unvollständiges oder ungültiges. */
function carriesCatalogPair(source: unknown, rootType: string): boolean {
  const props = metadataOf(source, rootType)?.props;
  return Array.isArray(props) && props.some((prop) =>
    isJsonObject(prop) && typeof prop.name === 'string' && prop.name.startsWith('assessed-against-catalog-'));
}

/**
 * Zu prüfende BSI-Kataloge: gebundene und solche, für die das Dokument bereits ein Paar trägt.
 * Ein Paar gilt unabhängig von gespeicherten Bindungen, denn es ist die Bewertungsgrundlage
 * aus der Quelle. `null`, wenn ein Paar einen nicht unterstützten Katalog nennt.
 */
function pinnedCatalogArtifacts(bindings: readonly WorkspaceBinding[], pins: ReadonlyMap<string, string>): string[] | null {
  const artifacts = new Set(boundCatalogArtifacts(bindings));
  for (const catalogKey of pins.keys()) {
    const artifactKey = artifactByCatalogKey.get(catalogKey);
    if (artifactKey === undefined) return null;
    artifacts.add(artifactKey);
  }
  return [...artifacts];
}

/** Zu prüfender Umfang eines Dokuments: keiner, ungültig (mit den gebundenen Katalogen) oder die Kataloge samt Paaren. */
type PinScope =
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid'; readonly bound: readonly string[] }
  | { readonly kind: 'pinned'; readonly pins: ReadonlyMap<string, string>; readonly artifacts: readonly string[] };

function pinScope(source: unknown, rootType: string, bindings: readonly WorkspaceBinding[]): PinScope {
  const bound = boundCatalogArtifacts(bindings);
  const pins = readCatalogPins(source, rootType);
  const artifacts = pins === null ? null : pinnedCatalogArtifacts(bindings, pins);
  if (pins === null || artifacts === null) {
    return bound.length > 0 || carriesCatalogPair(source, rootType) ? { kind: 'invalid', bound } : { kind: 'none' };
  }
  return artifacts.length === 0 ? { kind: 'none' } : { kind: 'pinned', pins, artifacts };
}

/** Zustand eines einzelnen Katalogs aus ausgeliefertem Stand und Paar. */
function catalogState(delivered: DeliveredCatalog | undefined, pin: string | undefined): CatalogPinState {
  if (delivered === undefined) return 'pending';
  if (!delivered.verified || delivered.commit === null) return 'unverified';
  if (pin === undefined) return 'unpinned';
  return pin === delivered.commit ? 'bound' : 'not-delivered';
}

/**
 * Bindungszustand eines gespeicherten Dokuments. `undefined` heißt: Das Dokument
 * verweist auf keinen BSI-Katalog und trägt kein Katalogpaar, ein Stand ist nicht zu prüfen.
 */
export function catalogPinStatus(
  source: unknown,
  rootType: string,
  bindings: readonly WorkspaceBinding[],
  delivery: CatalogDelivery,
): CatalogPin | undefined {
  const scope = pinScope(source, rootType, bindings);
  if (scope.kind === 'none') return undefined;
  if (scope.kind === 'invalid') return { state: 'invalid', code: CODES.invalid, offers: [], withheld: scope.bound, pending: [] };
  // Der schwerste Befund bestimmt den Zustand; Angebote sammeln alle Kataloge mit anderem ausgeliefertem Stand.
  let state: CatalogPinState = 'bound';
  const offers: string[] = [];
  const withheld: string[] = [];
  const pending: string[] = [];
  for (const artifactKey of scope.artifacts) {
    const catalogKey = catalogKeyByArtifact.get(artifactKey)!;
    const found = catalogState(delivery.get(artifactKey), scope.pins.get(catalogKey));
    if (found === 'pending') pending.push(catalogKey);
    if (found === 'unpinned' || found === 'not-delivered') {
      offers.push(catalogKey);
      withheld.push(artifactKey);
    }
    if (worse(found, state)) state = found;
  }
  return { state, code: CODES[state], offers, withheld, pending };
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

/** Paar, das für einen Katalog zu ergänzen ist; leer bei passendem vorhandenem Paar, sonst der Grund der Ablehnung. */
function missingPair(
  catalogKey: string,
  pins: ReadonlyMap<string, string>,
  delivered: DeliveredCatalog | undefined,
): { readonly ok: true; readonly props: RawOscalProp[] } | { readonly ok: false; readonly code: string } {
  if (!delivered?.verified || delivered.commit === null) return { ok: false, code: WORKSPACE_DIAGNOSTIC_CODES.catalogPinUnverified };
  const pin = pins.get(catalogKey);
  if (pin !== undefined) {
    return pin === delivered.commit ? { ok: true, props: [] } : { ok: false, code: WORKSPACE_DIAGNOSTIC_CODES.catalogPinNotDelivered };
  }
  const pair = createCatalogReferenceProjectProps({ catalogKey, commit: delivered.commit });
  return pair.ok ? { ok: true, props: pair.props.map((prop) => ({ ...prop })) } : { ok: false, code: WORKSPACE_DIAGNOSTIC_CODES.catalogPinInvalid };
}

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
  // Auch ein Paar ohne Bindung wird geprüft: Ein noch nicht zugeordneter Import behält seine Bewertungsgrundlage.
  const scope = pinScope(source, rootType, bindings);
  if (scope.kind === 'none') return { ok: true, source };
  const metadata = metadataOf(source, rootType);
  if (scope.kind === 'invalid' || metadata === undefined) return { ok: false, code: WORKSPACE_DIAGNOSTIC_CODES.catalogPinInvalid };
  const added: RawOscalProp[] = [];
  for (const artifactKey of scope.artifacts) {
    const pair = missingPair(catalogKeyByArtifact.get(artifactKey)!, scope.pins, delivery.get(artifactKey));
    if (!pair.ok) return pair;
    added.push(...pair.props);
  }
  if (added.length === 0) return { ok: true, source };
  const props = Array.isArray(metadata.props) ? metadata.props : [];
  const root = (source as Record<string, Record<string, unknown>>)[rootType];
  return { ok: true, source: { ...(source as object), [rootType]: { ...root, metadata: { ...metadata, props: [...props, ...added] } } } };
}

export interface PinnedBindings {
  /** Bindungszustand je `localId`, einschließlich der über lokale Bindungen geerbten Sperren; Dokumente ohne Katalogbezug fehlen. */
  readonly pins: ReadonlyMap<string, CatalogPin>;
  /** Bindungen, die der Dokumentgraph auflösen darf. */
  readonly bindings: readonly WorkspaceBinding[];
  /** Katalogbindungen gesperrter Dokumente: Sie lösen nie gegen einen anderen als den gebundenen Stand auf. */
  readonly withheld: readonly WorkspaceBinding[];
}

/**
 * Überträgt den schwersten Zustand lokal referenzierter Dokumente auf das referenzierende Dokument
 * (SSP → Profil → Katalog): Seine Bewertung stützt sich auf deren Bezugsstand. Zyklussicher; ein
 * Dokument im Zyklus erbt, was der Zyklus insgesamt erreicht. Nur ein gebundenes oder fehlendes
 * eigenes Paar erbt.
 */
function inheritCatalogPins(direct: ReadonlyMap<string, CatalogPin>, bindings: readonly WorkspaceBinding[]): Map<string, CatalogPin> {
  const targets = new Map<string, string[]>();
  for (const binding of bindings) {
    if (binding.target.kind !== 'local' || binding.target.localId === binding.fromLocalId) continue;
    targets.set(binding.fromLocalId, [...(targets.get(binding.fromLocalId) ?? []), binding.target.localId]);
  }
  /** Schwerster gesperrter Zustand eines erreichbaren Dokuments, ohne das Dokument selbst. */
  const reachable = (start: string): CatalogPin | undefined => {
    const seen = new Set<string>([start]);
    const queue = [...(targets.get(start) ?? [])];
    let worst: CatalogPin | undefined;
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      const pin = direct.get(next);
      if (pin && pin.state !== 'bound' && (worst === undefined || worse(pin.state, worst.state))) worst = pin;
      queue.push(...(targets.get(next) ?? []));
    }
    return worst;
  };
  const pins = new Map(direct);
  for (const localId of targets.keys()) {
    const inherited = reachable(localId);
    if (inherited === undefined) continue;
    const own = direct.get(localId);
    // Ein eigener gesperrter Zustand sperrt bereits Bearbeiten und Prüfen; er bleibt mit Diagnose und Bindeaktion stehen.
    if (reviewLocked(own)) continue;
    pins.set(localId, { state: inherited.state, code: inherited.code, offers: own?.offers ?? [], withheld: own?.withheld ?? [], pending: own?.pending ?? [], inherited: true });
  }
  return pins;
}

/** Hält die Katalogbindungen jedes nicht gebundenen Dokuments aus dem Dokumentgraphen heraus. */
export function applyCatalogPins(
  members: readonly Pick<WorkspaceEnvelope, 'localId' | 'rootType' | 'source'>[],
  bindings: readonly WorkspaceBinding[],
  delivery: CatalogDelivery,
): PinnedBindings {
  const direct = new Map<string, CatalogPin>();
  for (const member of members) {
    const pin = catalogPinStatus(member.source, member.rootType, bindings.filter((binding) => binding.fromLocalId === member.localId), delivery);
    if (pin) direct.set(member.localId, pin);
  }
  // Je Bindung: Ein nicht geladener oder nicht verifizierter Katalog fehlt dem Graphen ohnehin; zurückgehalten
  // wird, was sonst gegen einen anderen als den gebundenen Stand auflösen würde.
  const locked = (binding: WorkspaceBinding) => binding.target.kind === 'class-1'
    && (direct.get(binding.fromLocalId)?.withheld.includes(binding.target.artifactKey) ?? false);
  return { pins: inheritCatalogPins(direct, bindings), bindings: bindings.filter((binding) => !locked(binding)), withheld: bindings.filter(locked) };
}

/** Prüf- und Freigabeaktionen sind nur über einem gebundenen Bezugsstand zulässig, auch einem geerbten. */
export function reviewLocked(pin: CatalogPin | undefined): boolean {
  return pin !== undefined && pin.state !== 'bound';
}

/** Bearbeiten sperrt nur der eigene Bezugsstand; eine geerbte Sperre lässt das Dokument bearbeitbar. */
export function editLocked(pin: CatalogPin | undefined): boolean {
  return reviewLocked(pin) && pin?.inherited !== true;
}
